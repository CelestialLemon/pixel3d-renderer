// Per-object tint, dithered opacity and castShadow (PixelObject.tint / tintStrength / opacity / castShadow): the G-buffer
// colours, the dither coverage, the shadow mask under a see-through object, which changes redraw the object shadow map,
// and pick seeing through see-through objects. Requires the dev server and the pinned browser, like the other checks.
//   node tools/object-look-check.ts
import assert from 'node:assert/strict';
import type * as Three from 'three';
import type { BakedScene as PixelScene, RGB } from '../src/renderer/index.ts';
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { PixelRenderer, GeometryCollector, FluidCollector, place, lookAt, motion, thin: thinFlag, FLAG } = await import('/src/renderer/index.ts');
    type R = InstanceType<typeof PixelRenderer>;
    const W = 160, H = 120, HEIGHT = 12;
    const RED: RGB = [0.8, 0.12, 0.07], BLUE: RGB = [0.1, 0.2, 0.7], GREY: RGB = [0.4, 0.4, 0.4];
    const box = new THREE.BoxGeometry(1, 1, 1);
    const solid = (color: RGB, spin = false) => {
      const c = new GeometryCollector(spin);
      c.add(box, null, color, undefined, false, spin ? motion.spin([0, 0, 0], [0, 1, 0], 1.3) : undefined);
      return c.build();
    };
    const red = solid(RED), blue = solid(BLUE), spinner = solid(BLUE, true);
    const thinBar = new GeometryCollector(); thinBar.add(box, place(0, 0, 0, 0, 0, 0, 0.045, 2.4, 0.045), [0.9, 0.8, 0.1], thinFlag(FLAG.NORMAL));
    const thin = thinBar.build();
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
    const scene = (ground = false, roof = false): PixelScene => {
      const s = new GeometryCollector();
      if (ground) s.add(box, place(0, -0.1, 0, 0, 0, 0, 24, 0.2, 24), GREY);
      if (roof) s.add(box, place(0, 4.5, -0.5, 0, 0, 0, 12, 0.1, 3), GREY);
      return { staticGeometry: s.build(), dynamicGeometry: new GeometryCollector(true).build(), lamps: [], grooves: null,
        fluids: new FluidCollector().build(), shadow: { center: new THREE.Vector3(), radius: 14 }, stats: { triangles: 0, paletteColors: 0 } };
    };
    const make = (s: PixelScene, elevation = 0, supersample: 1 | 3 = 3) => {
      const r = new PixelRenderer(document.createElement('canvas'), s, { supersample, shadowMapSize: 1024 });
      r.resize(W, H); r.setLook({ ...lookAt(12), sunAz: 90, sunEl: 45 }); r.placeCamera(new THREE.Vector3(), 0, elevation, HEIGHT);
      return r;
    };
    const read = (r: R) => {
      const albedo = r.readAlbedo(), shadow = new Float32Array(W * H * 4);
      r.renderer.readRenderTargetPixels(r['gbuf'], 0, 0, W, H, shadow, undefined, 2);
      return { albedo, shadow };
    };
    const differences = (a: ArrayLike<number>, b: ArrayLike<number>) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
    const isColor = (a: ArrayLike<number>, i: number, color: RGB, eps = 1e-5) => color.every((v, k) => Math.abs(a[i * 4 + k] - v) < eps);
    const count = (a: ArrayLike<number>, color: RGB) => { let n = 0; for (let i = 0; i < W * H; i++) if (isColor(a, i, color)) n++; return n; };
    // The G-buffer pixel (x, y from the top) of a world point.
    const pixelOf = (r: R, p: Three.Vector3) => {
      const q = p.clone().project(r.camera);
      return { x: Math.floor((q.x * 0.5 + 0.5) * W), y: H - 1 - Math.floor((q.y * 0.5 + 0.5) * H) };
    };
    const srgbToLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    const out: Record<string, unknown> = {};
    try {
      // Tint: per instance, mixed towards the colour by the strength (8-bit sRGB colour, 8-bit strength); none is exact.
      {
        const r = make(scene());
        try {
          const a = r.addObject(red).setTransform(new THREE.Vector3(-2, 0, 0), undefined, 3), b = r.addObject(red).setTransform(new THREE.Vector3(2, 0, 0), undefined, 3);
          r.renderGeometry(0); const base = read(r).albedo;
          const left = (i: number) => (i % W) < W / 2;
          check(a.tint === null && a.tintStrength === 0.5, 'tint defaults to null, tintStrength to 0.5');
          a.tint = new THREE.Color(0.2, 0.9, 0.05); a.tintStrength = 0.6;
          r.renderGeometry(0); const tinted = read(r).albedo;
          const s = Math.round(0.6 * 255) / 255;
          const t = [0.2, 0.9, 0.05].map((c) => srgbToLinear(Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)) / 255));
          const expected = RED.map((c, k) => c + (t[k] - c) * s) as RGB;
          let mixed = 0, wrong = 0, otherChanged = 0;
          for (let i = 0; i < W * H; i++) {
            if (!isColor(base, i, RED)) continue;
            if (left(i)) { if (isColor(tinted, i, expected, 1e-4)) mixed++; else wrong++; }
            else if ([0, 1, 2, 3].some((k) => tinted[i * 4 + k] !== base[i * 4 + k])) otherChanged++;
          }
          check(mixed > 400 && wrong === 0, `A tinted object mixes towards the tint (${mixed} px, ${wrong} wrong)`);
          check(otherChanged === 0, `Tinting one copy leaves the other unchanged (${otherChanged} px)`);
          a.tint.setRGB(1, 0, 0); a.tintStrength = 1; r.renderGeometry(0);
          check(count(read(r).albedo, [1, 0, 0]) > 400, 'The tint colour is read each frame (changed in place), full strength replaces the colour');
          a.tintStrength = 0; r.renderGeometry(0);
          check(differences(read(r).albedo, base) === 0, 'tintStrength 0 is exact');
          a.tintStrength = 1; a.tint = null; r.renderGeometry(0);
          check(differences(read(r).albedo, base) === 0, 'tint null is exact');
          b.tint = new THREE.Color(0, 0, 1); b.tintStrength = 1; r.renderGeometry(0);
          check(count(read(r).albedo, [0, 0, 1]) > 400 && count(read(r).albedo, RED) > 400, 'Either copy can be tinted alone');
          out.tint = { mixed };
        } finally { r.dispose(); }
      }

      // Opacity: ordered dither per art pixel; 0 draws nothing, 1 is exact; the motion shader dithers the same way.
      for (const S of [1, 3] as const) for (const geometry of [red, spinner]) {
        const color = geometry === red ? RED : BLUE;
        const r = make(scene(), 0, S);
        try {
          r.renderGeometry(0); const empty = read(r).albedo;
          const o = r.addObject(geometry); o.setTransform(new THREE.Vector3(0, 0, 0), undefined, 4);
          r.renderGeometry(0); const opaque = read(r).albedo, full = count(opaque, color);
          o.opacity = 0.5; r.renderGeometry(0); const half = count(read(r).albedo, color);
          check(full > 1000 && Math.abs(half / full - 0.5) < 0.08, `S=${S}: opacity 0.5 drops about half the pixels (${half} of ${full})`);
          o.opacity = 0.25; r.renderGeometry(0); const quarter = count(read(r).albedo, color);
          check(Math.abs(quarter / full - 0.25) < 0.06, `S=${S}: opacity 0.25 keeps about a quarter (${quarter} of ${full})`);
          o.opacity = 0; r.renderGeometry(0);
          check(differences(read(r).albedo, empty) === 0, `S=${S}: opacity 0 draws nothing`);
          o.opacity = 1; r.renderGeometry(0);
          check(differences(read(r).albedo, opaque) === 0, `S=${S}: opacity 1 is exact`);
          out[`opacity/S${S}/${geometry === red ? 'plain' : 'motion'}`] = { full, half, quarter };
        } finally { r.dispose(); }
      }

      // The shadow mask: a see-through object casts nothing, and where its dither drops a pixel the mask is the ground's.
      // A non-casting object casts nothing either, and still receives.
      for (const geometry of [red, spinner]) {
        const color = geometry === red ? RED : BLUE, name = geometry === red ? 'plain' : 'motion';
        const r = make(scene(true), 0.6);
        try {
          r.renderGeometry(0); const empty = read(r);
          const o = r.addObject(geometry); o.setTransform(new THREE.Vector3(-1, 0.5, 0), undefined, new THREE.Vector3(1.5, 2.5, 1.5));
          r.renderGeometry(0); const cast = read(r);
          let shadowed = 0;
          for (let i = 0; i < W * H; i++) if (isColor(cast.albedo, i, GREY) && cast.shadow[i * 4 + 3] > 0.5 && empty.shadow[i * 4 + 3] < 0.5) shadowed++;
          check(shadowed > 30, `${name}: the opaque object casts (${shadowed} px)`);
          o.opacity = 0.5; r.renderGeometry(0); const ghost = read(r);
          let ground = 0, groundDiff = 0, drawn = 0;
          for (let i = 0; i < W * H; i++) {
            if (isColor(ghost.albedo, i, color)) drawn++;
            else if (isColor(ghost.albedo, i, GREY)) { ground++; if (ghost.shadow[i * 4 + 3] !== empty.shadow[i * 4 + 3]) groundDiff++; }
          }
          check(drawn > 100 && ground > 1000 && groundDiff === 0, `${name}: a see-through object casts no shadow and its holes show the ground's mask (${groundDiff} of ${ground} differ)`);
          o.opacity = 1; o.castShadow = false; r.renderGeometry(0); const noCast = read(r);
          let noCastDiff = 0;
          for (let i = 0; i < W * H; i++) if (isColor(noCast.albedo, i, GREY) && noCast.shadow[i * 4 + 3] !== empty.shadow[i * 4 + 3]) noCastDiff++;
          check(noCastDiff === 0, `${name}: castShadow false casts nothing (${noCastDiff} px)`);
          out[`mask/${name}`] = { shadowed, drawn, ground };
        } finally { r.dispose(); }
      }
      {
        const r = make(scene(true, true), 0.6);
        try {
          const o = r.addObject(red); o.setTransform(new THREE.Vector3(0, 0.5, 0), undefined, 1.5); o.castShadow = false;
          r.renderGeometry(0); const under = read(r);
          let surface = 0, inShadow = 0;
          for (let i = 0; i < W * H; i++) if (isColor(under.albedo, i, RED)) { surface++; if (under.shadow[i * 4 + 3] > 0.5) inShadow++; }
          check(surface > 200 && inShadow > surface * 0.9, `A non-casting object still receives the roof's shadow (${inShadow} of ${surface})`);
          out.receiver = { surface, inShadow };
        } finally { r.dispose(); }
      }

      // Which changes redraw the object shadow map: a static caster's shadow draws count the redraws.
      {
        const r = make(scene(true), 0.6);
        try {
          const still = r.addObject(red); still.position.set(-3, 0, 0);
          const mover = r.addObject(blue); mover.castShadow = false; mover.position.set(2, 0, 0);
          const spin = r.addObject(spinner); spin.castShadow = false; spin.position.set(0, 0, 3);
          let redraws = 0;
          const watch = () => { still.batch.mesh.onBeforeShadow = () => { redraws++; }; };
          watch();
          r.renderGeometry(0); check(redraws === 1, `First frame draws the map (${redraws})`);
          for (let k = 1; k <= 5; k++) { mover.position.x = 2 + k * 0.37; r.renderGeometry(k); }
          check(redraws === 1, `Moving a non-caster and spinning a non-casting machine redraw nothing (${redraws})`);
          mover.castShadow = true; r.renderGeometry(5); check(redraws === 2, `Turning castShadow on redraws once (${redraws})`);
          mover.position.x += 0.5; r.renderGeometry(5); check(redraws === 3, `Moving a caster redraws (${redraws})`);
          mover.castShadow = false; r.renderGeometry(5); check(redraws === 4, `Turning castShadow off redraws once (${redraws})`);
          mover.castShadow = true; mover.opacity = 0.5; r.renderGeometry(5); r.renderGeometry(5);
          check(redraws === 4, `A see-through caster is not a caster (${redraws})`);
          mover.position.x += 0.5; r.renderGeometry(5); check(redraws === 4, `Moving it redraws nothing (${redraws})`);
          mover.opacity = 1; r.renderGeometry(5); check(redraws === 5, `Making it opaque again redraws once (${redraws})`);
          spin.castShadow = true; r.renderGeometry(5); r.renderGeometry(6); check(redraws === 7, `A casting spinner redraws with the clock (${redraws})`);
          spin.castShadow = false; mover.castShadow = false; r.renderGeometry(7); r.renderGeometry(8);
          check(redraws === 8, `Back to non-casting: one redraw, then none (${redraws})`);
          mover.remove(); r.renderGeometry(8); check(redraws === 8, `Removing a non-caster redraws nothing (${redraws})`);
          still.remove(); r.renderGeometry(8);
          out.redraws = redraws;
        } finally { r.dispose(); }
      }

      // Pick sees through see-through objects: it finds what is behind (an object, the ground or the sky).
      for (const S of [1, 3] as const) {
        const r = make(scene(), 0, S);
        try {
          const back = r.addObject(red); back.setTransform(new THREE.Vector3(0, 0, -2), undefined, 3);
          const ghost = r.addObject(blue); ghost.setTransform(new THREE.Vector3(0, 0, 0), undefined, 2); ghost.opacity = 0.5;
          const lone = r.addObject(blue); lone.setTransform(new THREE.Vector3(4.5, 3, 0), undefined, 1); lone.opacity = 0.5;
          r.renderGeometry(0); r.renderStyle(0);
          const before = read(r).albedo;
          const centre = pixelOf(r, new THREE.Vector3(0, 0, 1));
          let throughObject = 0, throughSky = 0;
          for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
            const x = centre.x + dx, y = centre.y + dy, i = (H - 1 - y) * W + x;
            const hit = r.pickPixel(x, y)!;
            if (isColor(before, i, BLUE)) {
              check(hit.object === back && hit.world !== null && Math.abs(hit.world.z - (-0.5)) < 2e-3 && Math.abs(hit.normal!.z - 1) < 1e-4,
                `S=${S}: pick through the ghost at ${x},${y} finds the box behind (${hit.object?.id}, ${hit.world?.toArray()})`);
              throughObject++;
            } else check(hit.object === back, `S=${S}: pick between the ghost's dots finds the box behind`);
          }
          const lp = pixelOf(r, new THREE.Vector3(4.5, 3, 0.5));
          for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            const x = lp.x + dx, y = lp.y + dy;
            if (!isColor(before, (H - 1 - y) * W + x, BLUE)) continue;
            const hit = r.pickPixel(x, y)!;
            check(hit.world === null && hit.normal === null && hit.object === null, `S=${S}: pick through a ghost against the sky finds the sky`);
            throughSky++;
          }
          check(throughObject > 20 && throughSky > 5, `S=${S}: the ghosts were under the picks (${throughObject}, ${throughSky})`);
          r.renderGeometry(0);
          check(differences(read(r).albedo, before) === 0, `S=${S}: picking through leaves the next frame unchanged`);
          // Through the ghost, pick finds exactly what a frame without it resolves to, also at edges and on a thin bar.
          const bar = r.addObject(thin); bar.setTransform(new THREE.Vector3(0.33, 0, 0.4));
          const edge = r.addObject(red); edge.setTransform(new THREE.Vector3(-0.75, -0.75, -0.2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.5), 1);
          r.renderGeometry(0);
          const seen = read(r).albedo, region: [number, number][] = [];
          for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
            const x = centre.x + dx, y = centre.y + dy;
            if (isColor(seen, (H - 1 - y) * W + x, BLUE)) region.push([x, y]);
          }
          const through = region.map(([x, y]) => r.pickPixel(x, y)!);
          // Growing the ghost's batch or removing the objects behind before the next frame doesn't change what pick sees.
          const extra = Array.from({ length: 20 }, () => r.addObject(blue));
          const sameWorld = (a: Three.Vector3 | null, b: Three.Vector3 | null) => a === b || (!!a && !!b && a.distanceTo(b) < 1e-4);
          region.forEach(([x, y], k) => {
            const h = r.pickPixel(x, y)!;
            check(h.object === through[k].object && sameWorld(h.world, through[k].world), `S=${S}: batch growth before the next frame changes pick at ${x},${y}`);
          });
          bar.remove(); edge.remove(); back.remove();
          region.forEach(([x, y], k) => {
            const h = r.pickPixel(x, y)!;
            check(h.object === null && sameWorld(h.world, through[k].world), `S=${S}: removal before the next frame changes pick's surface at ${x},${y}`);
          });
          const back2 = r.addObject(red); back2.setTransform(back.position, undefined, 3);
          const bar2 = r.addObject(thin); bar2.setTransform(bar.position);
          const edge2 = r.addObject(red); edge2.setTransform(edge.position, edge.quaternion, 1);
          extra.forEach((o) => o.remove());
          ghost.visible = false; lone.visible = false; r.renderGeometry(0);
          let barPixels = 0, edgePixels = 0;
          region.forEach(([x, y], k) => {
            const h = r.pickPixel(x, y)!, t = through[k];
            const same = (t.object === null ? h.object === null : h.object !== null && [back2, bar2, edge2].indexOf(h.object) === [back, bar, edge].indexOf(t.object));
            check(same && sameWorld(h.world, t.world), `S=${S}: pick through the ghost at ${x},${y} differs from the frame without it`);
            if (h.object === bar2) barPixels++; if (h.object === edge2) edgePixels++;
          });
          check((S === 1 || barPixels > 0) && edgePixels > 0, `S=${S}: the bar and the edge were behind the ghost (${barPixels}, ${edgePixels})`);
          ghost.visible = true; lone.visible = true;
          ghost.opacity = 1; r.renderGeometry(0);
          check(r.pickPixel(centre.x, centre.y)!.object === ghost, `S=${S}: an opaque object is picked again`);
          out[`pick/S${S}`] = { throughObject, throughSky };
        } finally { r.dispose(); }
      }
      return out;
    } finally { for (const g of [red, blue, spinner, thin, box]) g.dispose(); }
  });
  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.log('PASS: per-object tint, dithered opacity, castShadow and pick through see-through objects.', results);
} finally { await browser.close(); }

