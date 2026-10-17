// Regression for #41: shallow piecewise-planar folds are neither silhouettes nor contacts.
import assert from 'node:assert/strict';
import { launch, newPage, open, writePng } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 320, height: 240 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { PixelRenderer, GeometryCollector, FLAG, lookAt, DEFAULT_SETTINGS, place } = await import('/src/renderer/index.ts');
    const W = 320, H = 240, results: { name: string; ink: number; contacts: number; controlChanges: number; png: string }[] = [];
    // Indexed 1 m tiles, alternating diagonals. A terrace ends in a zigzag to exercise diagonal folds too.
    const grid = new THREE.BufferGeometry(), positions: number[] = [], indices: number[] = [];
    for (let z = 0; z <= 8; z++) for (let x = 0; x <= 10; x++) {
      const start = z < 4 ? 4 : 5;
      positions.push(x - 5, x > start && x <= 8 ? 0.25 : 0, z - 4);
    }
    for (let z = 0; z < 8; z++) for (let x = 0; x < 10; x++) {
      const a = z * 11 + x, b = a + 1, c = a + 11, d = c + 1;
      indices.push(...((x + z) % 2 ? [a,c,b, b,c,d] : [a,c,d, a,d,b]));
    }
    grid.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    grid.setIndex(indices); grid.computeVertexNormals();
    const settings = { ...DEFAULT_SETTINGS, clouds: false, glow: false, vignette: false, dither: false, cleanup: false };
    const diff = (a: Uint8Array, b: Uint8Array, inside: Uint8Array) => {
      let count = 0;
      for (let i = 0; i < W * H; i++) if (inside[i] &&
        (a[i*4] !== b[i*4] || a[i*4+1] !== b[i*4+1] || a[i*4+2] !== b[i*4+2])) count++;
      return count;
    };
    for (const elevation of [38, 26, 18]) for (const supersample of [1, 3] as const) for (const flat of [false, true]) for (const control of [false, true]) {
      const collector = new GeometryCollector();
      const ground = control ? new THREE.PlaneGeometry(10, 8).rotateX(-Math.PI/2) : grid;
      collector.add(ground, null, [0.18, 0.36, 0.08], FLAG.NORMAL, flat);
      if (control) ground.dispose();
      if (control) {
        // Box/ground contact, and walls meeting a horizontal and a 45-degree roof (90/135 degree interiors).
        const box = new THREE.BoxGeometry(1, 1, 1);
        collector.add(box, place(-2, 0.5, 0), [0.4, 0.26, 0.16]);
        collector.add(box, place(0, 0.75, -1.8, 0, 0, 0, 2, 1.5, 0.12), [0.4, 0.26, 0.16]);
        collector.add(box, place(0, 1.5, -1.3, 0, 0, 0, 2, 0.12, 1.1), [0.28, 0.16, 0.09]);
        collector.add(box, place(2.8, 0.75, -1.8, 0, 0, 0, 2, 1.5, 0.12), [0.4, 0.26, 0.16]);
        collector.add(box, place(2.8, 1, -1.3, Math.PI/4, 0, 0, 2, 0.12, 1.5), [0.28, 0.16, 0.09]);
        // A low slab exercises same-normal depth discontinuities separately from sharp side faces.
        collector.add(box, place(-2, 0.15, 2, 0, 0, 0, 2, 0.3, 1), [0.3, 0.3, 0.3]);
        // Disconnected 14-degree static board: shares id 0 with the ground, but must keep ink and contacts.
        const board = new THREE.BufferGeometry();
        board.setAttribute('position', new THREE.Float32BufferAttribute([
          -0.05, 0.0215, 0.19, 1, 0.284, 0.19, -0.05, 0.0215, 2, 1, 0.284, 2,
        ], 3));
        board.setIndex([0,2,1, 1,2,3]); board.computeVertexNormals();
        collector.add(board, null, [0.3, 0.3, 0.3]); board.dispose();
        box.dispose();
      }
      const r = new PixelRenderer(document.createElement('canvas'), {
        staticGeometry: collector.build(), shadow: { center: new THREE.Vector3(), radius: 12 },
      }, { supersample, shadowMapSize: 128 });
      try {
        r.resize(W, H); r.setLook({ ...lookAt(12), ambient: 1, sunI: 0 });
        r.placeCamera(new THREE.Vector3(), control ? 0 : Math.PI/3, elevation*Math.PI/180, 7);
        r.renderGeometry(8);
        const normal = new Float32Array(W*H*4), inside = new Uint8Array(W*H);
        r.renderer.readRenderTargetPixels(r['gbuf'], 0, 0, W, H, normal, undefined, 1);
        // Exclude the terrain's real outer silhouette; controls keep all pixels.
        for (let y = 2; y < H-2; y++) for (let x = 2; x < W-2; x++) {
          const i = y*W+x;
          inside[i] = control || (normal[i*4+3] > 0 &&
            [-2,2,-2*W,2*W].every(o => normal[(i+o)*4+3] > 0)) ? 1 : 0;
        }
        const capture = (outlines: boolean, contacts: boolean) => {
          r.renderStyle({ ...settings, outlines, contacts }, 8);
          const pixels = new Uint8Array(W*H*4), gl = r.renderer.getContext();
          gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,pixels); return pixels;
        };
        const none = capture(false,false), inkImage = capture(true,false), ink = diff(inkImage,none,inside);
        const contacts = diff(capture(false,true),none,inside);
        const current = capture(true,true), png = r.renderer.domElement.toDataURL('image/png');
        let controlChanges = 0;
        if (control) {
          // With the fold rejection disabled, these real contacts and discontinuities must render identically.
          const material = r['postMat'];
          material.fragmentShader = material.fragmentShader.replace(
            'bool shallowFold(ivec2 p, ivec2 q, vec3 face){',
            'bool shallowFold(ivec2 p, ivec2 q, vec3 face){ return false;');
          material.needsUpdate = true;
          controlChanges = diff(capture(true,true), current, inside);
        }
        results.push({ name: `E${elevation}-S${supersample}-${flat ? 'faceted' : 'smooth'}-${control ? 'controls' : 'folds'}`,
          ink, contacts, controlChanges, png });
      } finally { r.dispose(); }
    }
    grid.dispose(); return results;
  });
  assert.deepEqual(errors, [], 'No browser or shader errors');
  for (const { name, ink, contacts, controlChanges, png } of results) {
    console.log(`${name}: ${ink} ink pixels, ${contacts} contact pixels`);
    if (process.env.FOLD_CAPTURE) await writePng(`${process.env.FOLD_CAPTURE}/${name}.png`, png);
    if (!process.argv.includes('--diagnose')) {
      if (name.endsWith('folds')) {
        assert.equal(ink, 0, `${name}: no fold ink`);
        assert.equal(contacts, 0, `${name}: no fold contacts`);
      }
      else { assert.equal(controlChanges, 0, `${name}: real controls stay pixel-identical`); assert.ok(ink > 100, `${name}: real edges retain ink`); assert.ok(contacts > 20, `${name}: real contacts stay shaded`); }
    }
  }
} finally { await browser.close(); }
