// GPU picking regression: known surfaces, per-instance identity and the exact resolve representative.
// Requires the dev server and pinned browser, like the other renderer checks. Goldens are checked separately.
import assert from 'node:assert/strict';
import type { PixelScene } from '../src/renderer/index.ts';
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 640, height: 480 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { PixelRenderer, GeometryCollector, FluidCollector, place, lookAt, motion } = await import('/src/renderer/index.ts');
    const { RESOLVE_FRAG } = await import('/src/renderer/shaders/resolve.ts');
    const { POST_VERT } = await import('/src/renderer/shaders/common.ts');
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
    const close = (a: number, b: number) => Math.abs(a - b) < 2e-4;
    const W = 80, H = 60, HEIGHT = 6;
    const box = new THREE.BoxGeometry(1, 1, 1), local = new GeometryCollector();
    local.add(box, null, [0.8, 0.12, 0.07]);
    const geometry = local.build(), out: string[] = [];
    const scene = (): PixelScene => {
      const s = new GeometryCollector(), d = new GeometryCollector(true);
      s.add(box, place(-2, 1, 0), [0.4, 0.4, 0.4]);
      d.add(box, place(2, 1, 0), [0.2, 0.3, 0.7], undefined, false, motion.spin([2, 1, 0], [0, 1, 0], 1));
      return { staticGeometry: s.build(), dynamicGeometry: d.build(), lamps: [], grooves: null,
        fluids: new FluidCollector().build(), shadow: { center: new THREE.Vector3(), radius: 8 }, stats: { triangles: 0, paletteColors: 0 } };
    };
    for (const S of [1, 3]) {
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;left:23px;top:31px;width:240px;height:180px;';
      document.body.append(canvas);
      const r = new PixelRenderer(canvas, scene());
      r.supersample = S; r.resize(W, H); r.setLook(lookAt(12)); r.placeCamera(new THREE.Vector3(), 0, 0, HEIGHT);
      try {
        check(r.pickPixel(40, 19) === null, `S=${S}: pick before first render`);
        const objects = Array.from({ length: 20 }, () => r.addObject(geometry));
        objects.forEach((o) => { o.snap = false; o.position.set(100, 100, 0); });
        const a = objects[0], b = objects[19];
        a.position.set(0, 1, 0); b.position.set(1, 1, 0); b.scale.x = -1;
        r.renderGeometry(0);
        check(a.batch.mesh.instanceMatrix.count >= 20, `S=${S}: batch did not grow`);
        const hit = r.pickPixel(40, 19)!;
        check(r.pickPixel(40.75, 19.25)!.object === a, `S=${S}: fractional art coordinate flooring`);
        for (const [x, y] of [[-1, 19], [W, 19], [40, H], [NaN, 19], [40, Infinity]])
          check(r.pickPixel(x, y) === null, `S=${S}: invalid art coordinate ${x},${y}`);
        check(hit.object === a, `S=${S}: normal mesh identity`);
        check(hit.world !== null && close(hit.world.x, 0.05) && close(hit.world.y, 1.05) && close(hit.world.z, 0.5),
          `S=${S}: known front plane position ${hit.world?.toArray()}`);
        check(hit.normal !== null && close(hit.normal.x, 0) && close(hit.normal.y, 0) && close(hit.normal.z, 1), `S=${S}: front normal`);
        check(r.pickPixel(50, 19)!.object === b, `S=${S}: mirrored mesh identity`);
        for (const x of [20, 60]) {
          const h = r.pickPixel(x, 19)!;
          check(h.object === null && h.world !== null && close(h.world.z, 0.5), `S=${S}: baked/dynamic surface ${x}`);
        }
        const sky = r.pickPixel(40, 0)!;
        check(sky.world === null && sky.normal === null && sky.object === null, `S=${S}: sky`);
        const rect = canvas.getBoundingClientRect();
        const css = r.pick(rect.left + 40.75 * rect.width / W, rect.top + 19.25 * rect.height / H)!;
        check(css.x === 40 && css.y === 19 && css.object === a, `S=${S}: CSS scale and canvas offset`);
        check(r.pick(rect.left - 0.1, rect.top) === null && r.pick(rect.right, rect.top) === null && r.pick(rect.left, rect.bottom) === null,
          `S=${S}: outside canvas`);
        // A new camera request must not reinterpret the old G-buffer.
        r.placeCamera(new THREE.Vector3(3, 2, 1), 0.6, 0.5, 9);
        check(r.pickPixel(40, 19)!.world!.distanceTo(hit.world!) < 1e-5, `S=${S}: camera snapshot`);
        r.placeCamera(new THREE.Vector3(), 0, 0, HEIGHT);
        a.visible = false; b.scale.x = 1; b.position.set(0, 1, 0);
        r.renderGeometry(0);
        check(r.pickPixel(40, 19)!.object === b, `S=${S}: hidden slot compaction and mirror-to-normal`);
        b.remove();
        check(r.pickPixel(40, 19)!.object === null && r.pickPixel(40, 19)!.world !== null, `S=${S}: removed handle before rerender`);
        const replacement = r.addObject(geometry); replacement.snap = false; replacement.position.set(0, 1, 0);
        check(replacement.id > b.id, `S=${S}: ids reused`);
        r.renderGeometry(0);
        check(r.pickPixel(40, 19)!.object === replacement, `S=${S}: replacement identity`);
        // A CPU ray/triangle intersection independently checks the reconstructed point and inverse-transpose normal.
        replacement.snap = true; replacement.position.set(0.035, 1.027, 0.021);
        replacement.quaternion.setFromEuler(new THREE.Euler(0.23, 0.41, 0.17));
        r.placeCamera(new THREE.Vector3(0, 1, 0), 0.45, 0.35, HEIGHT);
        const material = new THREE.MeshBasicMaterial(), oracle = new THREE.Mesh(geometry, material);
        oracle.matrixAutoUpdate = false;
        try {
          for (const sx of [1.6, -1.6]) {
            replacement.scale.set(sx, 0.8, 1.2); r.renderGeometry(0);
            oracle.matrixWorld.copy(replacement.drawn);
            const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(2 * 40.5 / W - 1, 1 - 2 * 30.5 / H), r.camera);
            const expected = ray.intersectObject(oracle)[0], actual = r.pickPixel(40, 30)!;
            check(!!expected && actual.object === replacement && actual.world !== null && actual.world.distanceTo(expected.point) < 2e-4,
              `S=${S}, scale=${sx}: angled surface position ${actual.world?.toArray()} vs ${expected?.point.toArray()}`);
            const normal = expected.face!.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(replacement.drawn));
            check(actual.normal !== null && actual.normal.distanceTo(normal) < 2e-4, `S=${S}, scale=${sx}: transformed normal`);
          }
        } finally { material.dispose(); }
        replacement.scale.x = 0; r.renderGeometry(0);
        check(r.pickPixel(40, 30)!.object === null, `S=${S}: zero-scale object still pickable`);
        r.resize(W, H);
        check(r.pickPixel(40, 19) === null, `S=${S}: pick after resize before rendering`);
        out.push(`S=${S}: position, transformed normal, sky, baked/animated world, CSS mapping, growth, mirroring, compaction, removal, camera snapshot, guards`);
      } finally { r.dispose(); canvas.remove(); }
    }
    geometry.dispose(); box.dispose();

    // Synthetic 3×3 input isolates majority/near-priority selection and same-plane grouping with different ids.
    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
    const texture = (rows: number[][]) => {
      const t = new THREE.DataTexture(new Float32Array(rows.flat()), 3, 3, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
    };
    const resolve = (name: string, sample: (x: number, y: number) => { id: number; flag: number; depth: number; color: number }, expectedId: number, expectedColor: number, S = 3) => {
      const a: number[][] = [], nd: number[][] = [], ids: number[][] = [], shadows: number[][] = [];
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        const s = sample(x, y); a.push([s.color, 0.3, 0.4, s.flag]); nd.push([0, 0, 1, s.depth]);
        ids.push([s.id, 0, 0, 0]); shadows.push([0, 0, 0, 0.625]);
      }
      const inputs = [texture(a), texture(nd), texture(ids), texture(shadows)];
      const material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
        vertexShader: POST_VERT, fragmentShader: RESOLVE_FRAG, uniforms: {
          tAlbedo: { value: inputs[0] }, tNormal: { value: inputs[1] }, tObjectId: { value: inputs[2] }, tShadow: { value: inputs[3] },
          uS: { value: S }, uPolicy: { value: 1 }, uThinOnly: { value: 1 }, uTexel: { value: 0.1 },
          uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uFwd: { value: new THREE.Vector3(0, 0, -1) },
        } });
      const target = new THREE.WebGLRenderTarget(1, 1, { count: 3, type: THREE.FloatType });
      const scene = new THREE.Scene(), plane = new THREE.PlaneGeometry(2, 2);
      scene.add(new THREE.Mesh(plane, material));
      try {
        renderer.setRenderTarget(target); renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
        const shadow = new Float32Array(4), albedo = new Float32Array(4);
        renderer.readRenderTargetPixels(target, 0, 0, 1, 1, shadow, undefined, 2);
        renderer.readRenderTargetPixels(target, 0, 0, 1, 1, albedo, undefined, 0);
        check(shadow[0] === expectedId && close(albedo[0], expectedColor) && close(shadow[3], 0.625),
          `${name}: id=${shadow[0]}, colour=${albedo[0]}, shadow=${shadow[3]}`);
        out.push(name);
      } finally { target.dispose(); plane.dispose(); material.dispose(); inputs.forEach((t) => t.dispose()); }
    };
    try {
      resolve('majority copies off-centre representative', (x) => ({ id: x === 1 ? 11 : x === 0 ? 22 : 33, flag: 1, depth: x === 1 ? 9 : 10, color: x === 1 ? 0.2 : 0.8 }), 22, 0.8);
      resolve('thin near-priority copies foreground representative', (x, y) => ({ id: x === 0 && y !== 1 ? 44 : 55, flag: x === 0 && y !== 1 ? 1.25 : 1, depth: x === 0 && y !== 1 ? 8 : 10, color: x === 0 && y !== 1 ? 0.2 : 0.8 }), 44, 0.2);
      resolve('ids do not split same-colour coplanar surfaces', (x, y) => ({ id: x === 1 && y === 1 ? 16777216 : 66, flag: 1, depth: 10, color: 0.8 }), 16777216, 0.8);
      resolve('S=1 carries id', () => ({ id: 77, flag: 1, depth: 10, color: 0.8 }), 77, 0.8, 1);
      resolve('sky carries zero id', () => ({ id: 0, flag: 0, depth: 0, color: 0 }), 0, 0);
    } finally { renderer.dispose(); }
    return out;
  });
  assert.deepEqual(errors, [], 'No browser or shader errors');
  results.forEach((r) => console.log('PASS:', r));
} finally { await browser.close(); }
