// Lantern Row (the village scene) regressions that the golden images cannot catch on their own:
// - layout: tree and bush canopies clear every building, backdrop house, street, quay and the water; buildings don't overlap
//   each other or stand in the water;
// - alignment: models tied to a layout feature (bridges, jetty, fountain, statue, boats, villagers) follow it;
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
    collectGltf(root, s, d, M.villageRule());
    const flags = [...new Set(s.build().attributes.aFlag.array)];

    // Moving parts: a wheel node turned to face +z, with a child primitive, spins about the node's own x axis through its origin.
    const wheel = new THREE.Group(); wheel.name = 'move_spin_wheel'; wheel.position.set(3, 0.5, 0); wheel.rotation.y = Math.PI / 2;
    wheel.userData.speed = 0.4;
    const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 0.1), mat); paddle.name = 'paddle'; wheel.add(paddle);
    const placedWheel = new THREE.Group().add(wheel); placedWheel.position.set(10, 0, -2); placedWheel.updateMatrixWorld(true);
    const ws = new GeometryCollector(false), wd = new GeometryCollector(true);
    collectGltf(placedWheel, ws, wd, M.villageRule(undefined, true));
    const wg = wd.build();
    const spin = { statics: ws.build().attributes.position.count, anchor: [...wg.attributes.aAnchor.array.slice(0, 3)], anim: [...wg.attributes.aAnim.array.slice(0, 4)], mode: wg.attributes.aMode.array[0] };
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
      bridge: find('bridge_stone'), footbridge: find('footbridge'), jetty: find('jetty'), BRIDGE: L.BRIDGE, FOOTBRIDGE: L.FOOTBRIDGE,
      JETTY: L.JETTY, CANAL: L.CANAL, FOUNTAIN: L.FOUNTAIN, STATUE: L.STATUE, fountain: find('fountain'), statue: find('guardian_statue'),
      boats: [...find('rowboat'), ...find('barge')], villagers: M.VILLAGERS,
      inWater: M.PROPS.filter((p) => /boat|barge/.test(p.id)).map((p) => L.inWater(p.x, p.z)),
      ripplesInWater: L.CANAL_RIPPLES.map(([x, z]) => L.inWater(x, z) || Math.hypot(x - L.POND.x, z - L.POND.z) < L.POND.r),
      // Every mesh in the figure, nested ones included: a recursive copy would show the badge twice.
      figure0: (() => { const n = []; figures[0].traverse((m) => m.isMesh && n.push(m.name)); return n; })(),
      figure1: figures[1].children.map((m) => m.name),
      badgeWorld: badgeWorld.toArray(), ropeFlags: flags, THIN_MARK, spin, MODE: (await import('/src/renderer/index.ts')).MODE,
    };
  });

  assert.deepEqual(r.problems, [], `Layout problems:\n  ${r.problems.join('\n  ')}`);
  const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} != ${b}`);
  for (const [label, model, at] of [['bridge', r.bridge, r.BRIDGE], ['footbridge', r.footbridge, r.FOOTBRIDGE], ['jetty', r.jetty, r.JETTY],
    ['fountain', r.fountain, r.FOUNTAIN], ['statue', r.statue, r.STATUE]]) {
    assert.equal(model.length, 1, `one ${label}`);
    near(model[0].x, at.x, `${label} x`); near(model[0].z, at.z, `${label} z`);
  }
  near(r.BRIDGE.z, (r.CANAL.z0 + r.CANAL.z1) / 2, 'bridge spans the middle of the canal');
  near(r.FOOTBRIDGE.z, (r.CANAL.z0 + r.CANAL.z1) / 2, 'footbridge spans the middle of the canal');
  near(r.JETTY.z, r.CANAL.z1, 'jetty starts at the south quay edge');
  for (const b of r.boats) near(b.y, r.CANAL.waterY, `${b.id} floats on the water`);
  assert.ok(r.inWater.every(Boolean), 'every boat is on the water');
  for (const v of r.villagers.slice(0, 2)) {
    assert.ok(Math.abs(v.x - r.STATUE.x) > 1.1 || Math.abs(v.z - r.STATUE.z) > 1.1, 'statue villagers stand off the plinth');
  }
  assert.ok(r.ripplesInWater.every(Boolean), `every ripple lies on the canal, the basin or the pond: ${JSON.stringify(r.ripples)}`);
  const sh = r.shadow;
  assert.ok(sh.worst.extent < sh.radius, `Sun shadow square ${sh.radius} m clips geometry ${sh.worst.extent.toFixed(2)} m out at ${sh.worst.hour}:00`);
  assert.ok(sh.depth[0] > sh.near && sh.depth[1] < sh.far, `Shadow depth range ${sh.depth.map((d) => d.toFixed(1))} within ${sh.near}..${sh.far}`);
  assert.deepEqual(r.figure0.sort(), ['badge', 'body'], 'A nested mesh is split out once, not cloned with its parent and again on its own');
  // Figures are re-centred on the real model's figure positions, which sit 0.0039 m off the round numbers used here.
  assert.ok(Math.abs(r.badgeWorld[0]) < 0.01 && Math.abs(r.badgeWorld[1] - 1.1) < 1e-6 && Math.abs(r.badgeWorld[2] - 0.16) < 1e-6, `Nested mesh keeps its world transform: ${r.badgeWorld}`);
  assert.deepEqual(r.figure1, ['thin_rope', 'thin_rope'], 'Primitives of a prefixed node keep the prefix');
  assert.deepEqual(r.ropeFlags, [r.THIN_MARK], 'The thin_ prefix reaches the collected geometry');
  assert.equal(r.spin.statics, 0, 'A moving part goes to the dynamic collector only');
  assert.equal(r.spin.mode, r.MODE.SPIN, 'move_spin_ spins');
  r.spin.anchor.forEach((v, i) => near(v, [13, 0.5, -2][i], `spin pivot ${i}`));
  r.spin.anim.forEach((v, i) => assert.ok(Math.abs(v - [0, 0, -1, 0.4][i]) < 1e-6, `spin axis/speed ${i}: ${r.spin.anim}`));
  assert.deepEqual(errors, [], 'No browser errors');
  console.log(`PASS: canopies clear buildings, streets and water; buildings don't overlap; bridges, jetty, fountain, statue, boats, ripples and villagers follow the layout;
      villager splitting keeps nested meshes single and parent prefixes intact; moving parts spin about their node's x axis;
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
