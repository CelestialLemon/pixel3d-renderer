// GPU regression for lamp occluders that the thick-wall test chart does not cover, and for fitting the atlas to small
// device limits (WebGL2 only guarantees 2048 px textures and renderbuffers).
// Uses the actual distance pass and reads its atlas; requires the dev server like the other checks.
//   npm run lamp-shadow-check  (DEMO_URL / CHROME_PATH to override)
import assert from 'node:assert/strict';
import type { BufferGeometry } from 'three';
import type { AtlasLayout } from '../src/renderer/lampShadows.ts';
import type { Lamp } from '../src/renderer/scene.ts';
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const cases = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { LampShadows, atlasLayout } = await import('/src/renderer/lampShadows.ts');
    const { mergeGeometries } = await import('/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js');
    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
    const solid = (geometry: BufferGeometry) => {
      geometry.setAttribute('aFlag', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
      return geometry;
    };
    const deviceMax = renderer.capabilities.maxTextureSize;
    // Centre texel of each of the lamp's six faces, wherever the layout put them.
    const sample = (geometry: BufferGeometry, position: [number, number, number] = [0, 0, 0], maxSize = deviceMax) => {
      const shadow = new LampShadows([{ position: new THREE.Vector3(...position), clearance: 0.1 } as Lamp], geometry, maxSize);   // the distance pass reads only these
      try {
        shadow.render(renderer);
        const atlas = new Float32Array(shadow.size.x * shadow.size.y), t = shadow.tile, cols = shadow.size.x / t;
        renderer.readRenderTargetPixels(shadow.target, 0, 0, shadow.size.x, shadow.size.y, atlas);
        return Array.from({ length: 6 }, (_, face) => atlas[(Math.floor(face / cols) * t + t / 2) * shadow.size.x + (face % cols) * t + t / 2]);
      } finally { shadow.dispose(); geometry.dispose(); }
    };
    let tooMany: string | null = null;
    try { atlasLayout(1000, 2048); } catch (e) { tooMany = (e as Error).message; }
    const layouts = {
      old16: atlasLayout(16, 16384), village22: atlasLayout(22, 16384), max32: atlasLayout(32, 16384), max64: atlasLayout(64, 16384),
      min32: atlasLayout(32, 2048), min64: atlasLayout(64, 2048), min22: atlasLayout(22, 2048), tiny1: atlasLayout(1, 512), tooMany,
    };
    try {
      const shell = sample(solid(new THREE.BoxGeometry(4, 4, 4)));
      // Plane front points +X, away from the lamp at the origin.
      const panel = sample(solid(new THREE.PlaneGeometry(4, 4).rotateY(Math.PI / 2).translate(2, 0, 0)));
      const exterior = sample(solid(new THREE.BoxGeometry(4, 4, 4)), [-4, 0, 0]);
      const fixture = solid(new THREE.BoxGeometry(0.1, 0.1, 0.1));
      const enclosure = solid(new THREE.BoxGeometry(4, 4, 4));
      const geometry = mergeGeometries([fixture, enclosure]);
      fixture.dispose(); enclosure.dispose();
      const clearance = sample(geometry);
      // A 512 px device limit forces 128 px faces in rows of four: the addressing must still find each face.
      const smallDevice = sample(solid(new THREE.BoxGeometry(4, 4, 4)), [0, 0, 0], 512);
      const ranged = (indexed: boolean, start: number, count: number) => {
        const box = new THREE.BoxGeometry(4, 4, 4), geometry = indexed ? box : box.toNonIndexed();
        if (!indexed) box.dispose();
        geometry.setDrawRange(start, count);
        return sample(solid(geometry));
      };
      return { shell, panel, exterior, clearance, smallDevice, layouts,
        indexedRange: ranged(true, 6, 6), nonIndexedRange: ranged(false, 6, 6), emptyRange: ranged(true, 0, 0) };
    } finally { renderer.dispose(); }
  });

  // The centre texel is slightly off-axis; the expected 2 m blocker differs by < 0.001 m.
  const blockedAtTwoMetres = (distance: number, label: string) => assert.ok(Math.abs(distance - 2) < 0.001, `${label}: expected 2 m blocker, got ${distance}`);
  cases.shell.forEach((distance, face) => blockedAtTwoMetres(distance, `enclosed lamp, face ${face}`));
  blockedAtTwoMetres(cases.panel[0], 'back-facing panel');
  assert.deepEqual(cases.panel.slice(1), [0, 0, 0, 0, 0], 'Uncovered panel directions stay clear');
  blockedAtTwoMetres(cases.exterior[0], 'lamp outside the box');
  cases.clearance.forEach((distance, face) => blockedAtTwoMetres(distance, `clearance skips fixture but records enclosure, face ${face}`));
  cases.smallDevice.forEach((distance, face) => blockedAtTwoMetres(distance, `512 px device limit, face ${face}`));
  for (const range of [cases.indexedRange, cases.nonIndexedRange]) {
    blockedAtTwoMetres(range[1], 'Restricted draw range keeps only the -X face');
    assert.deepEqual(range.filter((_, face) => face !== 1), [0, 0, 0, 0, 0], 'Excluded triangles cast no lamp shadows');
  }
  assert.deepEqual(cases.emptyRange, [0, 0, 0, 0, 0, 0], 'An empty draw range casts no lamp shadows');
  const L = cases.layouts;
  assert.deepEqual(L.old16, { tile: 256, cols: 12, width: 3072, height: 2048 }, 'Default layout unchanged for 16 lamps');
  assert.deepEqual(L.village22, { tile: 256, cols: 12, width: 3072, height: 2816 }, 'Default layout for 22 lamps');
  assert.deepEqual(L.max32, { tile: 256, cols: 12, width: 3072, height: 4096 }, 'Default layout for 32 lamps');
  assert.deepEqual(L.max64, { tile: 256, cols: 12, width: 3072, height: 8192 }, 'Default layout for 64 lamps (LIMITS.lamps) fits 8192');
  for (const [name, l, lamps, limit] of [['min32', L.min32, 32, 2048], ['min64', L.min64, 64, 2048], ['min22', L.min22, 22, 2048], ['tiny1', L.tiny1, 1, 512]] as [string, AtlasLayout, number, number][]) {
    assert.ok(l.width <= limit && l.height <= limit, `${name}: ${l.width}x${l.height} fits ${limit}`);
    assert.ok((l.width / l.tile) * (l.height / l.tile) >= lamps * 6, `${name}: room for all ${lamps * 6} faces`);
  }
  assert.equal(L.min32.tile, 128, '32 lamps at the WebGL2 minimum use 128 px faces');
  assert.match(L.tooMany ?? '', /do not fit/, 'An impossible layout fails loudly');
  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.log('PASS: lamp shadows block enclosed shells and back-facing panels; exterior occlusion and fixture clearance preserved;\n      the atlas fits small device limits (2048, 512) with smaller faces, keeps the default layout otherwise, and fails loudly when nothing fits.');
} finally { await browser.close(); }
