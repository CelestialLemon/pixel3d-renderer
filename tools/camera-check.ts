// Camera remainder regression: projected landmarks agree with the requested camera after output-pixel correction.
// Requires the dev server. Run: node tools/camera-check.ts
import assert from 'node:assert/strict';
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 480, height: 270 });
  await open(page, 'pass3.html?scene=test-chart&px=1&auto=0&time=0&clean-ui=1');
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const a = window.app3, r = a.p3;
    const views = Array.from({ length: 72 }, (_, i) => ({
      az: i * Math.PI / 36, el: (15 + i % 70) * Math.PI / 180,
      size: 6 + i / 3, tx: -27 + i * 0.71, tz: -10.5 + i * 0.137,
    }));
    let projectionError = 0, paddingError = 0, largestShift = 0, correctedError = 0;
    const signs = new Set<string>();
    const project = (point: InstanceType<typeof THREE.Vector3>, cam: typeof r.camera) => {
      const p = point.clone().project(cam);
      return new THREE.Vector2((p.x + 1) * r.width / 2, (1 - p.y) * r.height / 2);
    };
    for (const view of views) {
      Object.assign(a.orbit.view, view);
      const focus = a.orbit.focus(), height = a.orbit.viewHeight(480 / 270);
      const landmarks = [focus.clone(), focus.clone().add(new THREE.Vector3(3, 2, -4)), new THREE.Vector3(0, 0, 0)];
      r.resize(480, 270); r.placeCamera(focus, view.az, view.el, height);
      const shift = r.snapShift.clone(), positions = landmarks.map(p => project(p, r.camera));
      largestShift = Math.max(largestShift, Math.abs(shift.x), Math.abs(shift.y));
      signs.add(shift.x > 0 ? '+x' : '-x'); signs.add(shift.y > 0 ? '+y' : '-y');
      // Independent requested camera: same orientation and frustum, centred exactly on focus, without snapping.
      const ideal = r.camera.clone();
      ideal.position.copy(focus).addScaledVector(new THREE.Vector3(
        Math.sin(view.az) * Math.cos(view.el), Math.sin(view.el), Math.cos(view.az) * Math.cos(view.el)), 100);
      ideal.updateMatrixWorld();
      for (let j = 0; j < landmarks.length; j++) {
        const requested = project(landmarks[j], ideal);
        projectionError = Math.max(projectionError, positions[j].clone().add(shift).distanceTo(requested));
        for (const scale of [1, 2, 4, 8]) for (const step of [1, 2]) {
          const corrected = positions[j].clone().multiplyScalar(scale).add(new THREE.Vector2(
            step * Math.round(shift.x * scale / step), step * Math.round(shift.y * scale / step)));
          const error = corrected.sub(requested.clone().multiplyScalar(scale));
          correctedError = Math.max(correctedError, Math.abs(error.x) / step, Math.abs(error.y) / step);
        }
      }
      // Symmetric padding and matched texel size must preserve phase (four pixels also preserve the Bayer grid).
      for (const margin of [1, 4]) {
        r.resize(480 + 2 * margin, 270 + 2 * margin);
        r.placeCamera(focus, view.az, view.el, height * (270 + 2 * margin) / 270);
        paddingError = Math.max(paddingError, shift.distanceTo(r.snapShift));
        for (let j = 0; j < landmarks.length; j++)
          paddingError = Math.max(paddingError, project(landmarks[j], r.camera).subScalar(margin).distanceTo(positions[j]));
      }
    }
    r.resize(480, 270);
    const first = a.capture({ time: 0, view: views[0] }), saved = { ...first };
    a.capture({ time: 0, view: views[1] });
    const same = a.capture({ time: 0, view: views[0] });
    const canvas = document.getElementById('p3-view') as HTMLCanvasElement;
    const image = canvas.toDataURL();
    a.capture({ time: 0, view: views[0] });
    return { projectionError, paddingError, largestShift, correctedError, signs: [...signs], first, saved, same,
      imageStable: canvas.toDataURL() === image };
  });
  assert.ok(result.projectionError < 1e-8, `Remainder sign or units: projected error ${result.projectionError} art px`);
  assert.ok(result.paddingError < 1e-8, `Padding changed camera phase: ${result.paddingError} art px`);
  assert.ok(result.largestShift <= 0.5 + 1e-8, `Remainder exceeds half an art pixel: ${result.largestShift}`);
  assert.ok(result.correctedError <= 0.5 + 1e-8, `Output correction error ${result.correctedError} exceeds half a correction step`);
  assert.equal(result.signs.length, 4, 'Exercise both correction directions on both axes');
  assert.deepEqual(result.first, result.saved, 'Capture returns a snapshot, not a mutable renderer vector');
  assert.deepEqual(result.same, result.saved, 'Repeated camera has the same remainder');
  assert.ok(result.imageStable, 'Repeated frozen capture has identical pixels');
  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.log('PASS: camera remainder restores projected landmarks; padding preserves phase; 1/2-pixel corrections stay within half a step.');
} finally { await browser.close(); }
