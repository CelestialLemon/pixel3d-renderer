// GPU regression for the sun-shadow mask on rigid moving parts (SPIN and SWING motion: sails, wheels, signs).
// A moving part must get the mask of its own posed surface: the same as if it were static geometry at that pose, not the
// shadow pattern of whatever lies behind it (the windmill-sail stripes) and not "always sunlit" (a sign under eaves).
// Two scenarios, each rendered with the panel as a moving part, as static geometry at the same pose, and absent, for three
// poses: at rest, spun 90 degrees, and mid-swing (so the shadow pass must really pose the part, with the shared clock):
//   stripes: a pergola stripes the ground behind the panel, and a shadowed box under a roof stands in front of part of it;
//   roof:    the panel stands under a broad roof, so it is in shadow itself.
// Requires the dev server, like the other checks.
//   npm run moving-shadow-check
import assert from 'node:assert/strict';
import type { GeometryCollector as Collector, Motion, RGB, Vec3 } from '../src/renderer/index.ts';
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { PixelRenderer, GeometryCollector, FluidCollector, motion, place } = await import('/src/renderer/index.ts');
    const { lookAt } = await import('/src/renderer/look.ts');
    const BOX = new THREE.BoxGeometry(1, 1, 1);
    const box = (c: Collector, x: number, y: number, z: number, w: number, h: number, d: number, color: RGB, mo?: Motion) => c.add(BOX, place(x, y + h / 2, z, 0, 0, 0, w, h, d), color, undefined, false, mo);
    const GREY: RGB = [0.5, 0.5, 0.5], DARK: RGB = [0.3, 0.3, 0.3], PANEL: RGB = [0.9, 0.85, 0.7], OCCLUDER: RGB = [0.8, 0.1, 0.1];
    const W = 160, H = 120;

    const scenery = {
      stripes: (s: Collector) => {
        for (let z = -7; z < -0.5; z += 0.6) box(s, 0, 4, z, 14, 0.1, 0.3, DARK);   // pergola slats: ground stripes behind the panel
        box(s, -1, 0, 4.5, 2, 2.2, 0.6, OCCLUDER);                                  // in front of the panel's lower left
        box(s, -1, 3, 4.5, 4, 0.1, 3, DARK);                                        // roof that shadows the occluder
      },
      // A broad roof at 6 m reaching to z = 4.4: the noon sun (from +z, 60 degrees) puts the panel's upper half in its shadow,
      // while the camera (34 degrees) still sees all of the panel under its edge.
      roof: (s: Collector) => box(s, 0, 6, 1.2, 12, 0.1, 6.4, DARK),
    };
    // The panel: a 4 x 2.4 m board facing the camera (not square, so a quarter turn changes its outline), centred at PIVOT.
    // Each pose gives its motion, the time to render at, and the same pose as a static transform.
    const PIVOT: Vec3 = [0, 3, 2], HINGE: Vec3 = [0, 4.2, 2];
    const swingAngle = (t: number, anchor: Vec3, amp: number) => amp * Math.sin(t * 1.3 + anchor[0] * 1.7 + anchor[1] * 0.3 + anchor[2] * 2.1);   // as in POSE
    const poses = {
      rest: { motion: motion.spin(PIVOT, [0, 0, 1], 0), time: 0, at: place(...PIVOT, 0, 0, 0, 4, 2.4, 0.05) },
      spun: { motion: motion.spin(PIVOT, [0, 0, 1], Math.PI / 2), time: 1, at: place(...PIVOT, 0, 0, Math.PI / 2, 4, 2.4, 0.05) },
      swung: (() => {
        const a = swingAngle(0.9, HINGE, 0.5);   // about +x through the hinge at the panel's top edge
        return { motion: motion.swing(HINGE, [1, 0, 0], 0.5), time: 0.9, at: place(0, HINGE[1] - 1.2 * Math.cos(a), HINGE[2] - 1.2 * Math.sin(a), a, 0, 0, 4, 2.4, 0.05) };
      })(),
    };
    const render = (name: keyof typeof scenery, pose: keyof typeof poses, panel: 'moving' | 'static' | 'none') => {
      const s = new GeometryCollector(false), d = new GeometryCollector(true);
      box(s, 0, -0.1, 0, 30, 0.1, 30, GREY);
      scenery[name](s);
      if (panel === 'moving') d.add(BOX, place(...PIVOT, 0, 0, 0, 4, 2.4, 0.05), PANEL, undefined, false, poses[pose].motion);
      if (panel === 'static') s.add(BOX, poses[pose].at, PANEL);
      const scene = { staticGeometry: s.build(), dynamicGeometry: d.build(), lamps: [], fluids: new FluidCollector().build(), grooves: null,
        shadow: { center: new THREE.Vector3(), radius: 14 }, stats: { triangles: 0, paletteColors: 0 } };
      const pr = new PixelRenderer(document.createElement('canvas'), scene);
      try {
        pr.resize(W, H);
        pr.setLook(lookAt(12));
        pr.placeCamera(new THREE.Vector3(0, 1.5, 0), 0, 0.6, 12);
        pr.renderGeometry(poses[pose].time);
        const albedo = pr.readAlbedo(), mask = new Float32Array(W * H * 4);
        pr.renderer.readRenderTargetPixels(pr['gbuf'], 0, 0, W, H, mask, undefined, 2);
        return { albedo, mask };
      } finally { pr.dispose(); }
    };
    const is = (a: ArrayLike<number>, i: number, c: RGB) => Math.abs(a[i * 4] - c[0]) < 1e-3 && Math.abs(a[i * 4 + 1] - c[1]) < 1e-3 && Math.abs(a[i * 4 + 2] - c[2]) < 1e-3;

    const out: Record<string, Record<string, number>> = {};
    for (const name of Object.keys(scenery) as (keyof typeof scenery)[]) for (const pose of Object.keys(poses) as (keyof typeof poses)[]) {
      const moving = render(name, pose, 'moving'), still = render(name, pose, 'static'), none = render(name, pose, 'none');
      const r = { panel: 0, panelShadowed: 0, differsFromStatic: 0, differsFromBehind: 0, behindLit: 0, behindShadowed: 0, othersChanged: 0, occluderShadowed: 0 };
      for (let i = 0; i < W * H; i++) {
        const m = moving.mask[i * 4 + 3], st = still.mask[i * 4 + 3], bg = none.mask[i * 4 + 3];
        // Compare the panel where the moving and static renders both show it (a posed vertex in float32 may land a
        // sample either side of an edge).
        if (is(moving.albedo, i, PANEL) && is(still.albedo, i, PANEL)) {
          r.panel++;
          if (m > 0.5) r.panelShadowed++;
          if (Math.abs(m - st) > 1e-6) r.differsFromStatic++;
          if (Math.abs(st - bg) > 0.5) r.differsFromBehind++;
          if (bg > 0.5) r.behindShadowed++; else r.behindLit++;
        } else if (!is(moving.albedo, i, PANEL)) {
          // A moving part casts no sun shadow, so wherever the same surface shows without it, the mask must match; that
          // includes the occluder in front of the panel, which a mask pass without the depth test would paint over. (On the
          // panel's silhouette the resolve's majority vote may pick another surface, so those pixels aren't comparable.)
          const same = [0, 1, 2, 3].every((k) => moving.albedo[i * 4 + k] === none.albedo[i * 4 + k]);
          if (same && Math.abs(m - bg) > 1e-6) r.othersChanged++;
          if (is(moving.albedo, i, OCCLUDER) && m > 0.5) r.occluderShadowed++;
        }
      }
      out[`${name}/${pose}`] = r;
    }
    return out;
  });

  for (const [name, r] of Object.entries(results)) {
    assert.ok(r.panel > 300, `${name}: the panel covers a large area (${r.panel} px)`);
    assert.equal(r.differsFromStatic, 0, `${name}: the moving panel's mask matches the same panel as static geometry (${r.differsFromStatic} px differ)`);
    assert.equal(r.othersChanged, 0, `${name}: the moving panel changes no other surface's mask (${r.othersChanged} px changed)`);
  }
  const stripes = results['stripes/rest'], roof = results['roof/rest'];
  assert.ok(stripes.behindLit > 100 && stripes.behindShadowed > 50, `stripes: the ground behind the panel is striped (lit ${stripes.behindLit}, shadowed ${stripes.behindShadowed} px)`);
  for (const pose of ['rest', 'spun', 'swung']) {
    const r = results[`stripes/${pose}`];
    assert.ok(r.differsFromBehind > 50, `stripes/${pose}: the panel's own mask differs from the ground behind it (${r.differsFromBehind} px), so borrowing it would fail`);
  }
  assert.ok(stripes.occluderShadowed > 50, `stripes: the shadowed occluder in front of the panel keeps its shadow (${stripes.occluderShadowed} px)`);
  for (const pose of ['rest', 'spun']) {
    const r = results[`roof/${pose}`];
    assert.ok(r.panelShadowed > 100, `roof/${pose}: the panel under the roof is partly in shadow (${r.panelShadowed} px), so "always sunlit" would fail`);
  }
  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.log(`PASS: a moving panel at rest, spun 90 degrees and mid-swing gets the sun-shadow mask of its own posed surface, identical
      to static geometry at that pose, over striped ground (${stripes.differsFromBehind} px would have borrowed the background at rest) and
      under a roof (${roof.panelShadowed} px in shadow at rest); the occluder in front keeps its shadow and nothing else changes.`);
} finally { await browser.close(); }
