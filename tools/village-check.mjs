// Lantern Row (the village scene) regressions that the golden images cannot catch on their own:
// - layout: tree and bush canopies clear every building, backdrop house and the road;
// - alignment: models tied to a layout feature (bridge, fountain, festoon, parapet flower boxes, villagers) follow it;
// - villager splitting: a nested mesh is added once and a naming prefix on a parent node survives;
// - sun shadows: every model and tree vertex stays inside the shadow map's light-space square at every quarter hour;
// - loading: a missing or corrupt model fails the scene loudly instead of being dropped or replaced.
// Requires the dev server, like the other checks.
//   npm run village-check
import assert from 'node:assert/strict';
import { BASE, launch, newPage, open } from './lib.mjs';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const r = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const L = await import('/src/scenes/village/layout.ts');
    const M = await import('/src/scenes/village/models.ts');
    const { GeometryCollector, collectGltf, THIN_MARK } = await import('/src/renderer/index.ts');
    const find = (id) => M.PROPS.filter((p) => p.id === id);

    // A stand-in for the villagers model: figure 0 is a body with a badge mesh parented to it; figure 1 is a
    // multi-material node `thin_rope` (a Group whose primitives carry plain names), the way GLTFLoader builds one.
    const model = new THREE.Group(), mat = new THREE.MeshStandardMaterial();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 0.3), mat); body.name = 'body'; body.position.set(-1.5, 0.8, 0);
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), mat); badge.name = 'badge'; badge.position.set(0, 0.3, 0.16);
    body.add(badge);
    const rope = new THREE.Group(); rope.name = 'thin_rope'; rope.position.set(-0.5, 1, 0);
    for (const n of ['rope_a', 'rope_b']) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1, 0.02), mat); m.name = n; rope.add(m); }
    model.add(body, rope);
    const figures = M.villagerFigures(model);
    const s = new GeometryCollector(false), d = new GeometryCollector(true);
    const root = new THREE.Group().add(figures[1].clone()); root.updateMatrixWorld(true);
    collectGltf(root, s, d, M.villageRule);
    const flags = [...new Set(s.build().attributes.aFlag.array)];
    const badgeWorld = new THREE.Vector3(); figures[0].children.find((m) => m.name === 'badge')?.updateMatrixWorld(true);
    figures[0].children.find((m) => m.name === 'badge')?.getWorldPosition(badgeWorld);

    // Sun shadows: project the real models and trees into the shadow camera the renderer builds (setLook) for every
    // quarter hour, and record the widest light-space extent and depth range.
    const { placeModels } = M, { buildTrees } = await import('/src/scenes/village/trees.ts');
    const { mulberry32 } = await import('/src/scenes/shared/random.ts');
    const { lookAt } = await import('/src/renderer/look.ts');
    const ms = new GeometryCollector(false), md = new GeometryCollector(true);
    buildTrees(ms, mulberry32(1));
    await placeModels(ms, md);
    const pos = [ms.build(), md.build()].flatMap((g) => [...g.attributes.position.array]);
    const R = L.SUN_SHADOW.radius, cam = new THREE.OrthographicCamera(-R, R, R, -R, 1, 140), v = new THREE.Vector3();
    let worst = { extent: 0, hour: 0 }, depth = [Infinity, -Infinity];
    for (let hour = 0; hour < 24; hour += 0.25) {
      const look = lookAt(hour), az = THREE.MathUtils.degToRad(look.sunAz), el = THREE.MathUtils.degToRad(look.sunEl);
      const sun = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
      cam.position.copy(sun).multiplyScalar(60); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      for (let i = 0; i < pos.length; i += 3) {
        v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(cam.matrixWorldInverse);
        const e = Math.max(Math.abs(v.x), Math.abs(v.y));
        if (e > worst.extent) worst = { extent: e, hour };
        depth = [Math.min(depth[0], -v.z), Math.max(depth[1], -v.z)];
      }
    }

    return {
      shadow: { radius: R, worst, depth, near: cam.near, far: cam.far },
      ripples: L.CANAL_RIPPLES,
      problems: L.layoutProblems(),
      bridge: find('stone_arch_bridge'), BRIDGE: L.BRIDGE, CANAL: L.CANAL, PARAPET: L.PARAPET, FOUNTAIN: L.FOUNTAIN,
      fountain: find('fountain'), festoon: find('festoon'), boxes: find('flower_box'), villagers: M.VILLAGERS,
      // Every mesh in the figure, nested ones included: a recursive copy would show the badge twice.
      figure0: (() => { const n = []; figures[0].traverse((m) => m.isMesh && n.push(m.name)); return n; })(),
      figure1: figures[1].children.map((m) => m.name),
      badgeWorld: badgeWorld.toArray(), ropeFlags: flags, THIN_MARK,
    };
  });

  assert.deepEqual(r.problems, [], `Layout problems:\n  ${r.problems.join('\n  ')}`);
  const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} != ${b}`);
  near(r.bridge[0].x, r.BRIDGE.x, 'bridge x'); near(r.bridge[0].z, r.BRIDGE.z, 'bridge z');
  near(r.BRIDGE.z, (r.CANAL.z0 + r.CANAL.z1) / 2, 'bridge spans the middle of the canal');
  near(r.fountain[0].x, r.FOUNTAIN.x, 'fountain x'); near(r.fountain[0].z, r.FOUNTAIN.z, 'fountain z');
  near(r.festoon[0].x, r.FOUNTAIN.x, 'festoon centred on the fountain');
  for (const b of r.boxes) {
    near(b.y, r.PARAPET.height + r.PARAPET.coping, 'flower box on the parapet coping');
    near(b.z, r.CANAL.z0 - r.PARAPET.inset, 'flower box on the parapet line');
  }
  for (const v of r.villagers.slice(0, 2)) {
    assert.ok(Math.hypot(v.x - r.FOUNTAIN.x, v.z - r.FOUNTAIN.z) > r.FOUNTAIN.r + 0.2, 'fountain villagers stand outside the basin');
  }
  for (const [x, z] of r.ripples) {
    assert.ok(x > r.CANAL.x0 && x < r.CANAL.x1 && z > r.CANAL.z0 && z < r.CANAL.z1, `canal ripple (${x}, ${z}) lies on the canal`);
  }
  const sh = r.shadow;
  assert.ok(sh.worst.extent < sh.radius, `Sun shadow square ${sh.radius} m clips geometry ${sh.worst.extent.toFixed(2)} m out at ${sh.worst.hour}:00`);
  assert.ok(sh.depth[0] > sh.near && sh.depth[1] < sh.far, `Shadow depth range ${sh.depth.map((d) => d.toFixed(1))} within ${sh.near}..${sh.far}`);
  assert.deepEqual(r.figure0.sort(), ['badge', 'body'], 'A nested mesh is split out once, not cloned with its parent and again on its own');
  // Figures are re-centred on the real model's figure positions, which sit 0.0039 m off the round numbers used here.
  assert.ok(Math.abs(r.badgeWorld[0]) < 0.01 && Math.abs(r.badgeWorld[1] - 1.1) < 1e-6 && Math.abs(r.badgeWorld[2] - 0.16) < 1e-6, `Nested mesh keeps its world transform: ${r.badgeWorld}`);
  assert.deepEqual(r.figure1, ['thin_rope', 'thin_rope'], 'Primitives of a prefixed node keep the prefix');
  assert.deepEqual(r.ropeFlags, [r.THIN_MARK], 'The thin_ prefix reaches the collected geometry');
  assert.deepEqual(errors, [], 'No browser errors');
  console.log(`PASS: canopies clear buildings and road; bridge, fountain, festoon, flower boxes, ripples and villagers follow the layout;
      villager splitting keeps nested meshes single and parent prefixes intact;
      sun shadows cover every model and tree all day (widest ${sh.worst.extent.toFixed(2)} m at hour ${sh.worst.hour}, square ${sh.radius} m).`);

  // Loading: a missing and a corrupt model must each stop the build with a visible failure.
  for (const [label, respond] of [
    ['missing', (req) => req.respond({ status: 404, body: 'not found' })],
    ['corrupt', (req) => req.respond({ status: 200, contentType: 'model/gltf-binary', body: Buffer.from('glTF but not really') })],
  ]) {
    const { page: p } = await newPage(browser, { width: 64, height: 64 });
    await p.setRequestInterception(true);
    p.on('request', (req) => (req.url().endsWith('/village/house_A.glb') ? respond(req) : req.continue()));
    await p.goto(`${BASE}/pass3.html?scene=village&auto=0&anim=0&time=8`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.appReady === true || /failed/.test(document.getElementById('loading')?.textContent ?? ''), { timeout: 180000 });
    const state = await p.evaluate(() => ({ ready: window.appReady === true, loading: document.getElementById('loading')?.textContent ?? '' }));
    assert.equal(state.ready, false, `${label} house_A.glb: the scene must not finish building`);
    assert.match(state.loading, /failed/, `${label} house_A.glb: the page shows the failure`);
    await p.close();
  }
  console.log('PASS: a missing or corrupt model fails the village build visibly.');
} finally { await browser.close(); }
