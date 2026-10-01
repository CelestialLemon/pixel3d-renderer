// GPU regression for the thin-feature resolve (src/renderer/shaders/resolve.ts) on surfaces seen at a grazing angle.
// Feeds the real resolve shader one art pixel of hand-built 3 x 3 G-buffer samples and reads back what it emits.
// Requires the dev server like the other checks.
//   npm run resolve-check  (DEMO_URL / CHROME_PATH to override)
import assert from 'node:assert/strict';
import { launch, newPage, open } from './lib.mjs';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const cases = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { RESOLVE_FRAG } = await import('/src/renderer/shaders/resolve.ts');
    const { POST_VERT } = await import('/src/renderer/shaders/common.ts');
    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
    const TEXEL = 0.075, D0 = 10;
    // Camera basis: right +x, up +y, forward +z. Depth is measured along forward.
    const texture = (rows) => {
      const t = new THREE.DataTexture(new Float32Array(rows.flat()), 3, 3, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
    };
    // sample(sx, sy) -> { albedo: [r, g, b, a], normal: [x, y, z], depth }; sub-sample offsets are (s - 1) / 3 art pixels.
    const resolve = (sample) => {
      const albedo = [], normal = [];
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const s = sample(sx, sy); albedo.push(s.albedo); normal.push([...s.normal, s.depth]);
      }
      const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, vertexShader: POST_VERT, fragmentShader: RESOLVE_FRAG,
        uniforms: {
          tAlbedo: { value: texture(albedo) }, tNormal: { value: texture(normal) }, tShadow: { value: texture(albedo.map(() => [0, 0, 0, 1])) },
          uS: { value: 3 }, uPolicy: { value: 1 }, uThinOnly: { value: 1 }, uTexel: { value: TEXEL },
          uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uFwd: { value: new THREE.Vector3(0, 0, 1) },
        },
      });
      const target = new THREE.WebGLRenderTarget(1, 1, { count: 3, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
      renderer.setRenderTarget(target); renderer.render(scene, cam); renderer.setRenderTarget(null);
      const a = new Float32Array(4), n = new Float32Array(4);
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, a, undefined, 0);
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, n, undefined, 1);
      target.dispose(); mat.dispose();
      return { albedo: Array.from(a), depth: n[3] };
    };
    // A plane through depth D0 at the pixel centre with normal n: its depth at a sub-sample (exact, no clamping).
    const plane = (n, colour) => (sx, sy) => ({
      albedo: [...colour, 1], normal: n,
      depth: D0 - (n[0] * (sx - 1) / 3 + n[1] * (sy - 1) / 3) * TEXEL / n[2],
    });
    const A = [0.8, 0.5, 0.2], B = [0.2, 0.4, 0.9];
    const grazing = [Math.sqrt(0.99), 0, -0.1];               // n.fwd = -0.1, the PR #2 review repro
    const edgeOn = [Math.sqrt(1 - 1e-6), 0, -1e-3];
    // Middle column: a different, nearer, non-thin surface (3 samples). The grazing plane covers the other 6 samples,
    // so it is the majority and its emitted sample is off-centre.
    const withNearColumn = (n) => { const p = plane(n, A); return (sx, sy) => sx === 1 ? { albedo: [...B, 1], normal: [0, 0, -1], depth: D0 - 1 } : p(sx, sy); };
    try {
      return {
        grazing: resolve(withNearColumn(grazing)),
        flat: resolve(withNearColumn([0, 0, -1])),
        edgeOn: resolve(withNearColumn(edgeOn)),
        edgeOnSampleDepth: plane(edgeOn, A)(0, 1).depth,
        margin2: 2 * Math.max(0.10, TEXEL * 3), D0, A,
      };
    } finally { renderer.dispose(); }
  });

  const isA = (r, label) => assert.ok(r.albedo.slice(0, 3).every((v, i) => Math.abs(v - cases.A[i]) < 1e-4), `${label}: expected the 6-sample plane to win, got albedo ${r.albedo}`);
  isA(cases.grazing, 'grazing plane');
  assert.ok(Math.abs(cases.grazing.depth - cases.D0) < 1e-3, `grazing plane: centre depth ${cases.grazing.depth}, expected ${cases.D0}`);
  isA(cases.flat, 'flat plane');
  assert.ok(Math.abs(cases.flat.depth - cases.D0) < 1e-4, `flat plane: centre depth ${cases.flat.depth}, expected ${cases.D0}`);
  // Near edge-on: the move to the centre is capped instead of extrapolating ~25 units along the plane.
  assert.ok(Math.abs(cases.edgeOn.depth - cases.edgeOnSampleDepth) <= cases.margin2 + 1e-4,
    `edge-on plane: emitted ${cases.edgeOn.depth}, sample ${cases.edgeOnSampleDepth}, cap ${cases.margin2}`);
  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.log('PASS: resolve groups grazing-angle planes and emits their exact centre depth; edge-on moves stay capped.');
} finally { await browser.close(); }
