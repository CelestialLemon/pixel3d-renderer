// Regression for #38: shading normals must not change geometric depth tests or resolve reconstruction.
// Uses a smooth indexed heightfield converted to triangles, with a faceted copy as the geometric oracle.
import assert from 'node:assert/strict';
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 160, height: 120 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { PixelRenderer, GeometryCollector, lookAt, DEFAULT_SETTINGS, motion } = await import('/src/renderer/index.ts');
    const W = 160, H = 120, results: string[] = [];
    const grid = new THREE.PlaneGeometry(10, 10, 20, 20); grid.rotateX(-Math.PI / 2);
    const p = grid.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, 0.5 * Math.sin(p.getX(i) * Math.PI / 5) * Math.cos(p.getZ(i) * Math.PI / 5));
    grid.computeVertexNormals();
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
    const settings = { ...DEFAULT_SETTINGS, clouds: false, glow: false, vignette: false, dither: false, cleanup: false };
    const styles = [settings, { ...settings, outlines: false }, { ...settings, contacts: false },
      { ...settings, dither: true, cleanup: true }];
    for (const supersample of [1, 3] as const) for (const path of ['static', 'dynamic', 'object', 'object-motion']) {
      const images: Uint8Array[][] = [], depths: Float32Array[] = [], shading: Float32Array[] = [];
      for (const flat of [false, true]) {
        const dynamic = path === 'dynamic' || path === 'object-motion', collector = new GeometryCollector(dynamic);
        collector.add(grid, null, [0.18, 0.36, 0.08], undefined, flat, dynamic ? motion.spin([0, 0, 0], [0, 1, 0], 0.03) : undefined);
        const geometry = collector.build(), empty = new GeometryCollector().build();
        const object = path.startsWith('object');
        const r = new PixelRenderer(document.createElement('canvas'), {
          staticGeometry: path === 'static' ? geometry : empty,
          ...(path === 'dynamic' ? { dynamicGeometry: geometry } : {}),
          shadow: { center: new THREE.Vector3(), radius: 12 },
        }, { supersample, shadowMapSize: 128, objectShadowMapSize: 128 });
        try {
          r.resize(W, H);
          // All normals lie in one lighting band, so a difference here is a depth-test artifact, not smooth lighting.
          r.setLook({ ...lookAt(12), ambient: 1, sunI: 0 });
          // Keep this parity oracle away from self-occluding folds; the separate grazing test checks near-edge-on depth.
          r.placeCamera(new THREE.Vector3(), 0.6, 0.5, 4);
          const o = object ? r.addObject(geometry) : undefined;
          if (o) { o.snap = false; o.scale.set(-1.1, 0.9, 0.85); }
          r.renderGeometry(8);
          const normal = new Float32Array(W * H * 4), surface = new Float32Array(W * H * 4);
          r.renderer.readRenderTargetPixels(r['gbuf'], 0, 0, W, H, normal, undefined, 1);
          r.renderer.readRenderTargetPixels(r['gbuf'], 0, 0, W, H, surface, undefined, 2);
          depths.push(Float32Array.from({ length: W * H }, (_, i) => normal[i * 4 + 3])); shading.push(normal);
          const captures: Uint8Array[] = [];
          for (const style of styles) {
            r.renderStyle(style, 8);
            const pixels = new Uint8Array(W * H * 4), gl = r.renderer.getContext();
            gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels); captures.push(pixels);
          }
          if (o) {
            o.highlight = true; r.renderStyle({ ...settings, cleanup: true }, 8);
            const pixels = new Uint8Array(W * H * 4), gl = r.renderer.getContext();
            gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels); captures.push(pixels);
          }
          images.push(captures);
          if (!flat) {
            let encoded = 0;
            for (let i = 0; i < surface.length; i += 4) if (surface[i + 1] !== 0) encoded++;
            check(encoded > 100, `${path}, S=${supersample}: smooth terrain must carry a geometric plane`);
          }
        } finally { r.dispose(); if (object) geometry.dispose(); empty.dispose(); }
      }
      for (let k = 0; k < images[0].length; k++) {
        let changed = 0;
        for (let i = 0; i < W * H * 4; i += 4)
          if (images[0][k].slice(i, i + 3).some((v, c) => v !== images[1][k][i + c])) changed++;
        // Float normal encoding can move a hard band threshold at up to two pixels on another GL backend.
        check(changed <= 2, `${path}, S=${supersample}, style=${k}: shading normals changed ${changed} pixels`);
      }
      let maxDepthError = 0, normalDifferences = 0;
      for (let i = 0; i < W * H; i++) {
        maxDepthError = Math.max(maxDepthError, Math.abs(depths[0][i] - depths[1][i]));
        if (Math.abs(shading[0][i * 4] - shading[1][i * 4]) > 0.001) normalDifferences++;
      }
      check(maxDepthError < 2e-4, `${path}, S=${supersample}: resolve changed depths by ${maxDepthError}`);
      check(normalDifferences > 100, `${path}, S=${supersample}: shading normals must remain smooth`);
      results.push(`${path}, S=${supersample}: smooth/faceted depth effects agree within two band-boundary pixels; smooth lighting normals preserved`);
    }
    // Nearly equal smooth/geometric normals must stay distinct even below a milliradian: resolve amplifies
    // that error on a grazing plane. The old shortcut moved this single plane's reconstructed centre depth.
    for (const smooth of [false, true]) {
      const patch = new THREE.PlaneGeometry(12, 8);
      patch.rotateY(Math.acos(0.04));
      const normals = patch.attributes.normal;
      for (let i = 0; i < normals.count; i++) {
        const z = 0.0409 + (smooth ? (i - 1.5) * 0.00001 : 0);
        normals.setXYZ(i, Math.sqrt(1 - z * z), 0, z);
      }
      const c = new GeometryCollector(); c.add(patch, null, [0.3, 0.3, 0.3]);
      const geometry = c.build(), r = new PixelRenderer(document.createElement('canvas'), {
        staticGeometry: geometry, shadow: { center: new THREE.Vector3(), radius: 12 },
      }, { supersample: 3, shadowMapSize: 128 });
      const material = new THREE.MeshBasicMaterial();
      try {
        r.resize(80, 60); r.placeCamera(new THREE.Vector3(), 0, 0, 6); r.renderGeometry(0);
        const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(2 * 40.5 / 80 - 1, 1 - 2 * 30.5 / 60), r.camera);
        const expected = ray.intersectObject(new THREE.Mesh(geometry, material))[0], actual = r.pickPixel(40, 30)!;
        check(!!expected && actual.world !== null && // At this angle, SwiftShader's raster interpolation rounds depth by about 0.002 m; the old shortcut errs by >0.1 m.
          actual.world.distanceTo(expected.point) < 0.004,
          `Near-equal grazing normal: reconstructed ${actual.world?.toArray()} vs ${expected?.point.toArray()}`);
        const surface = new Float32Array(4);
        r.renderer.readRenderTargetPixels(r['gbuf'], 40, 29, 1, 1, surface, undefined, 2);
        check(surface[1] !== 0, 'Near-equal smooth normal must carry the geometric plane');
        check(actual.normal !== null && actual.normal.z > 0.0408, 'Grazing-plane pick keeps its shading normal');
        results.push(`Near-equal ${smooth ? 'smooth' : 'constant'} grazing normals: geometric centre depth and shading normal preserved`);
      } finally { r.dispose(); patch.dispose(); material.dispose(); }
    }
    grid.dispose();
    return results;
  });
  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.log(results.join('\n'));
} finally { await browser.close(); }
