// GPU regression for lamp occluders that the thick-wall test chart does not cover.
// Uses the actual distance pass and reads its atlas; requires the dev server like the other checks.
//   npm run lamp-shadow-check  (DEMO_URL / CHROME_PATH to override)
import assert from 'node:assert/strict';
import { launch, newPage, open } from './lib.mjs';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const cases = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { LampShadows, LAMP_TILE } = await import('/src/renderer/lampShadows.ts');
    const { mergeGeometries } = await import('/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js');
    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
    const solid = (geometry) => {
      geometry.setAttribute('aFlag', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
      return geometry;
    };
    const sample = (geometry, position = [0, 0, 0]) => {
      const shadow = new LampShadows([{ position: new THREE.Vector3(...position), clearance: 0.1 }], geometry);
      try {
        shadow.render(renderer);
        const atlas = new Float32Array(shadow.size.x * shadow.size.y);
        renderer.readRenderTargetPixels(shadow.target, 0, 0, shadow.size.x, shadow.size.y, atlas);
        return Array.from({ length: 6 }, (_, face) => atlas[(LAMP_TILE / 2) * shadow.size.x + face * LAMP_TILE + LAMP_TILE / 2]);
      } finally { shadow.dispose(); geometry.dispose(); }
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
      return { shell, panel, exterior, clearance };
    } finally { renderer.dispose(); }
  });

  // The centre texel is slightly off-axis; the expected 2 m blocker differs by < 0.001 m.
  const blockedAtTwoMetres = (distance, label) => assert.ok(Math.abs(distance - 2) < 0.001, `${label}: expected 2 m blocker, got ${distance}`);
  cases.shell.forEach((distance, face) => blockedAtTwoMetres(distance, `enclosed lamp, face ${face}`));
  blockedAtTwoMetres(cases.panel[0], 'back-facing panel');
  assert.deepEqual(cases.panel.slice(1), [0, 0, 0, 0, 0], 'Uncovered panel directions stay clear');
  blockedAtTwoMetres(cases.exterior[0], 'lamp outside the box');
  cases.clearance.forEach((distance, face) => blockedAtTwoMetres(distance, `clearance skips fixture but records enclosure, face ${face}`));
  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.log('PASS: lamp shadows block enclosed shells and back-facing panels; exterior occlusion and fixture clearance preserved.');
} finally { await browser.close(); }
