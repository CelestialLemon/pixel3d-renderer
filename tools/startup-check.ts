/// <reference path="../src/baked-env.d.ts" />
// Exact binary roundtrips and first-frame parity for every default scene; report live versus decoded startup work.
import assert from 'node:assert/strict';
import { launch, newPage, BASE } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await page.goto(`${BASE}/tools/bake.html`);
  const reports = await page.evaluate(async () => {
    const { SCENES } = await import('/src/scenes/index.ts');
    const { encodeScene, decodeScene, PixelRenderer, DEFAULT_SETTINGS, DEFAULT_DAY_CYCLE } = await import('/src/renderer/index.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
    const reports = [];
    for (const def of SCENES) {
      const start = performance.now(), scene = await def.build(), built = performance.now();
      const encoded = encodeScene(scene), decodeStart = performance.now(), decoded = decodeScene(encoded), decodedAt = performance.now();
      const again = encodeScene(decoded), words = new Uint32Array(encoded), other = new Uint32Array(again);
      check(encoded.byteLength === again.byteLength && words.every((v, i) => v === other[i]), `${def.id}: exact byte roundtrip`);
      const draw = (s: typeof scene) => {
        const r = new PixelRenderer(document.createElement('canvas'), s, { limits: def.limits, shadowMapSize: 512 });
        try {
          r.resize(128, 96); r.placeCamera(new THREE.Vector3(def.view.target.x, def.view.target.height, def.view.target.z), 0.66, 0.7, 18);
          r.setLook((def.look ?? DEFAULT_DAY_CYCLE).lookAt(22));
          r.renderGeometry(8); r.renderStyle(DEFAULT_SETTINGS, 8);
          const gl = r.renderer.getContext(), pixels = new Uint8Array(128 * 96 * 4);
          gl.readPixels(0, 0, 128, 96, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          check(gl.getError() === gl.NO_ERROR, `${def.id}: no GL errors`);
          return { pixels, occluders: r['lampShadows'].occluderTriangles };
        } finally { r.dispose(); }
      };
      // Objects' behavior is tested by the built-app golden suite; compare baked world geometry here without moving objects.
      const savedPopulate = scene.populate; delete scene.populate;
      const live = draw(scene), baked = draw(decoded); scene.populate = savedPopulate;
      check(live.pixels.every((v, i) => v === baked.pixels[i]), `${def.id}: decoded and live first frames match`);
      const compressed = await new Response(new Blob([encoded]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      const unpacked = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      check(new Uint32Array(unpacked).every((v, i) => v === words[i]), `${def.id}: gzip preserves bytes`);
      for (const g of Object.values(scene.objectGeometries ?? {})) g.dispose();
      for (const g of Object.values(decoded.objectGeometries ?? {})) g.dispose();
      for (const t of [decoded.maps!.fluids.texture, decoded.maps!.fluids.height, decoded.maps!.windows.texture, decoded.maps!.windows.source]) t.dispose();
      reports.push({ scene: def.id, liveBuildMs: Math.round(built - start), decodeMs: Math.round(decodedAt - decodeStart),
        bytes: encoded.byteLength, compressedBytes: compressed.byteLength, triangles: scene.stats.triangles, occluders: live.occluders });
    }
    for (const buffer of [new ArrayBuffer(0), new ArrayBuffer(16)]) {
      let rejected = false; try { decodeScene(buffer); } catch { rejected = true; }
      check(rejected, 'Invalid baked headers fail loudly');
    }
    return reports;
  });
  assert.deepEqual(errors, [], 'No browser/shader errors');
  console.log('PASS: exact binary/gzip roundtrips and live/decoded first frames for all scenes.', reports);
} finally { await browser.close(); }
