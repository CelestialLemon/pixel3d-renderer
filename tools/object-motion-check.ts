// Runtime ambient-motion GPU regression. Run with the dev server and tools/lib.ts's pinned browser.
import assert from 'node:assert/strict';
import type * as Three from 'three';
import type { BakedScene, Motion, RGB } from '../src/renderer/index.ts';
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { PixelRenderer, GeometryCollector, FluidCollector, motion, place, lookAt } = await import('/src/renderer/index.ts');
    const W = 144, H = 108, RED: RGB = [0.8, 0.15, 0.08], GREY: RGB = [0.4, 0.4, 0.4];
    const BOX = new THREE.BoxGeometry(1, 1, 1);
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
    const diff = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 0) => {
      let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > eps) n++; return n;
    };
    // CPU matrices/trigonometry use doubles; shaders use floats. At view depths near 100 m,
    // permit <0.2 mm depth error and 1e-4 normal error. Reference linear colours allow
    // 1e-6 interpolation error; any silhouette/flag change still fails.
    const surfaceDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => {
      let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > (i % 4 === 3 ? 2e-4 : 1e-4)) n++; return n;
    };
    const phase = (id: number) => (Math.imul(id, 2654435761) >>> 8) / 16777216;
    const scene = (roof = false): BakedScene => {
      const s = new GeometryCollector();
      s.add(BOX, place(0, -0.1, 0, 0, 0, 0, 24, 0.2, 24), GREY);
      if (roof) s.add(BOX, place(0, 6, 1.2, 0, 0, 0, 12, 0.1, 6.4), GREY);
      return { staticGeometry: s.build(), dynamicGeometry: new GeometryCollector(true).build(), lamps: [], grooves: null,
        fluids: new FluidCollector().build(), shadow: { center: new THREE.Vector3(), radius: 14 }, stats: { triangles: 0, paletteColors: 0 } };
    };
    const make = (roof = false, baked = scene(roof)) => {
      const r = new PixelRenderer(document.createElement('canvas'), baked, { shadowMapSize: 256, objectShadowMapSize: 256, supersample: 1 });
      r.resize(W, H); r.setLook(lookAt(12)); r.placeCamera(new THREE.Vector3(0, 1.5, 0), 0, 0.6, 10);
      const dispose = r.dispose.bind(r);
      r.dispose = () => { dispose(); r.renderer.forceContextLoss(); };
      return r;
    };
    const geometry = (mo?: Motion, at = place(0, 2.5, 1, 0, 0, 0, 3, 0.55, 0.3), dynamic = !!mo) => {
      const c = new GeometryCollector(dynamic); c.add(BOX, at, RED, undefined, false, mo); return c.build();
    };
    const read = (r: InstanceType<typeof PixelRenderer>) => {
      const albedo = r.readAlbedo(), normal = new Float32Array(W * H * 4), mask = new Float32Array(W * H * 4);
      r.renderer.readRenderTargetPixels(r['gbuf'], 0, 0, W, H, normal, undefined, 1);
      r.renderer.readRenderTargetPixels(r['gbuf'], 0, 0, W, H, mask, undefined, 2);
      return { albedo, normal, mask };
    };
    const objectShadow = (r: InstanceType<typeof PixelRenderer>) => {
      const target = r['objectLight']!.shadow.map!, bytes = new Uint8Array(target.width * target.height * 4);
      r.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, bytes); return bytes;
    };
    const shadowDepth = (r: InstanceType<typeof PixelRenderer>) => {
      const bytes = objectShadow(r), depths = new Float64Array(bytes.length / 4);
      for (let i = 0; i < depths.length; i++) depths[i] = bytes[i * 4] / 256 + bytes[i * 4 + 1] / 65536
        + bytes[i * 4 + 2] / 16777216 + bytes[i * 4 + 3] / (255 * 16777216);
      return depths;
    };
    const out: Record<string, unknown> = {};

    // A partial attribute set fails before allocating an id or sun map; caller geometry remains owned by the game.
    {
      const r = make(), g = geometry(motion.sway(0, 1, 0, 0.6)); let disposed = 0;
      g.addEventListener('dispose', () => disposed++);
      try {
        const bad = g.clone(); bad.deleteAttribute('aAnchor'); let rejected = false;
        try { r.addObject(bad); } catch (error) { rejected = String(error).includes('aAnchor'); }
        check(rejected && !r['objectLight'], 'Partial motion attributes must fail before allocating renderer state'); bad.dispose();
        for (const [name, size] of [['aMode', 1], ['aAnchor', 3], ['aAnim', 4]] as const) {
          const malformed = g.clone();
          malformed.setAttribute(name, new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * (size + 1)), size + 1));
          let rejected = false;
          try { r.addObject(malformed); } catch (error) { rejected = String(error).includes(name); }
          check(rejected && !r['objectLight'], `${name}: invalid component count must fail before allocating state`);
          malformed.dispose();
        }
        const o = r.addObject(g); check(o.id === 1, 'Rejected motion geometry must not consume an object id');
        o.remove(); r.dispose(); check(disposed === 0, 'Motion geometry remains caller-owned');
        out.validation = 'partial/wrong-sized attributes rejected atomically, caller ownership retained';
      } finally { g.dispose(); }
    }

    // All modes take the caller's clock, repeat exactly and retain identity at both resolve scales.
    for (const [name, mo] of [
      ['sway', motion.sway(0, 1, 0, 0.6)], ['spin', motion.spin([0.6, 2.5, 1], [0, 0, 1], 0.8)],
      ['swing', motion.swing([0.6, 2.5, 1], [0, 0, 1], 0.8)],
      ['conveyor', motion.conveyor([0, 2.5, 1], -2, 4, 0.7)],
      ['smoke', motion.smoke([0, 1, 1], 0.15, 0.4)],
      ['butterfly', motion.butterfly([0, 1, 1], 0.15, 0.4)],
      ['firefly', motion.firefly([0, 1, 1], 0.15, 0.4)],
    ] as const) {
      const g = geometry(mo, name === 'smoke' || name === 'butterfly' || name === 'firefly'
        ? place(0, 0, 0, 0, 0, 0, 0.5, 0.25, 0.25) : undefined);
      const r = make();
      try {
        r.setLook(lookAt(name === 'firefly' ? 22 : 12));
        const a = r.addObject(g), b = r.addObject(g); a.snap = b.snap = false; a.visible = b.visible = false;
        r.renderGeometry(1.2); const emptyMap = objectShadow(r); a.visible = true;
        for (const S of [1, 3]) {
          r.supersample = S; r.resize(W, H);
          r.renderGeometry(1.2); const first = read(r);
          if (['smoke', 'butterfly', 'firefly', 'conveyor'].includes(name))
            check(diff(emptyMap, objectShadow(r)) === 0, `${name}: small moving parts cast shadows`);
          let visible = 0;
          for (let i = 0; i < W * H; i++) if (first.mask[i * 4] === a.id) {
            visible++;
            if (visible <= 12) check(r.pickPixel(i % W, H - 1 - Math.floor(i / W))?.object === a, `${name}/S=${S}: pick loses animated object`);
          }
          // Fireflies blink: visibility at this specific clock is not required, but their later frames must appear.
          if (name !== 'firefly') check(visible > 2, `${name}/S=${S}: motion object is visible (${visible})`);
          r.renderGeometry(3.7); const later = read(r);
          check(diff(first.normal, later.normal) + diff(first.albedo, later.albedo) > 0, `${name}/S=${S}: clock does not move geometry`);
          r.renderGeometry(1.2); const repeat = read(r);
          check(diff(first.normal, repeat.normal) === 0 && diff(first.albedo, repeat.albedo) === 0, `${name}/S=${S}: same time is not deterministic`);
        }
        a.visible = false; b.visible = true; r.renderGeometry(1.2); const other = read(r);
        a.visible = true; b.visible = false; r.renderGeometry(1.2); const original = read(r);
        check(diff(original.normal, other.normal) + diff(original.albedo, other.albedo) > 0, `${name}: coincident copies animate in lockstep`);
        out[name] = 'clock, deterministic repeat, instance phase and S=1/S=3 identity';
      } finally { r.dispose(); g.dispose(); }
    }

    // Local pivots must compose with rotations/non-uniform scale/mirroring, including both shadow passes.
    for (const mode of ['spin', 'swing'] as const) for (const mirrored of [false, true])
      for (const id of mode === 'spin' && !mirrored ? [1, 2 ** 23 + 1, 2 ** 24] : [1]) {
        const anchor: [number, number, number] = [0.6, 2.5, 1], t = 1.7;
        const mo = mode === 'spin' ? motion.spin(anchor, [0, 0, 1], 0.8) : motion.swing(anchor, [0, 0, 1], 0.8);
        const tf = Math.fround(Math.fround(t) + Math.fround(phase(id) * 97));
        const angle = mode === 'spin' ? Math.fround(tf * Math.fround(0.8))
          : Math.fround(Math.fround(0.8) * Math.sin(Math.fround(Math.fround(tf * Math.fround(1.3))
            + Math.fround(anchor[0] * 1.7 + anchor[1] * 0.3 + anchor[2] * 2.1))));
        const pose = new THREE.Matrix4().makeTranslation(...anchor).multiply(new THREE.Matrix4().makeRotationZ(angle))
          .multiply(new THREE.Matrix4().makeTranslation(...anchor.map(v => -v) as [number, number, number]));
        const rest = place(0, 2.5, 1, 0, 0, 0, 3, 0.55, 0.3);
        const g = geometry(mo, rest), ref = geometry(undefined, pose.multiply(rest));
        const moving = make(true), still = make(true);
        try {
          for (const r of [moving, still]) {
            r.supersample = 1; r.resize(W, H);
            r['nextObjectId'] = id;
            const o = r.addObject(r === moving ? g : ref); o.snap = false;
            o.setTransform(new THREE.Vector3(0.7, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0.25, 0.3)), new THREE.Vector3(mirrored ? -1.2 : 1.2, 0.8, 1.4));
            r.renderGeometry(t);
          }
          const a = read(moving), b = read(still);
          check(diff(a.albedo, b.albedo, 1e-6) === 0, `${mode}/${mirrored}/id=${id}: local pivot silhouette differs from static reference (${diff(a.albedo, b.albedo)} channels)`);
          const delta = Array.from(a.normal, (v, i) => Math.abs(v - b.normal[i]));
          check(surfaceDiff(a.normal, b.normal) === 0, `${mode}/${mirrored}/id=${id}: posed normals/depth differ from reference (${surfaceDiff(a.normal, b.normal)} channels; max ${Math.max(...delta)})`);
          let common = 0, shadowed = 0, bad = 0;
          for (let i = 0; i < W * H; i++) if (a.mask[i * 4] === id && b.mask[i * 4] === id) {
            common++; if (b.mask[i * 4 + 3] > 0.5) shadowed++;
            // As in object-check, compare lit/shadowed classification; PCF edge weights can differ after float rounding.
            if (Math.abs(a.mask[i * 4 + 3] - b.mask[i * 4 + 3]) > 0.5) bad++;
          }
          check(common > 40 && shadowed > 5 && bad === 0, `${mode}/${mirrored}/id=${id}: posed receiver mask (${common} px, ${shadowed} in shadow, ${bad} wrong)`);
          const ca = shadowDepth(moving), cb = shadowDepth(still), side = moving['objectLight']!.shadow.map!.width;
          let casterErrors = 0, rasterEdges = 0, groundErrors = 0;
          for (let i = 0; i < ca.length; i++) {
            const error = Math.abs(ca[i] - cb[i]); if (error <= 1e-6) continue;
            // Tiny positional rounding has amplified depth error on grazing faces. Accept it only
            // where a 3x3 reference neighbourhood has >10 times that depth range; interiors stay strict.
            const x = i % side, y = Math.floor(i / side), neighbours: number[] = [];
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
              if (x + dx >= 0 && x + dx < side && y + dy >= 0 && y + dy < side) neighbours.push(cb[(y + dy) * side + x + dx]);
            if (Math.max(...neighbours) - Math.min(...neighbours) > error * 10) rasterEdges++; else casterErrors++;
          }
          for (let i = 0; i < W * H; i++) if (a.mask[i * 4] === 0 && b.mask[i * 4] === 0
            && Math.abs(a.mask[i * 4 + 3] - b.mask[i * 4 + 3]) > 0.5) groundErrors++;
          check(ca.filter(v => v < 0.999).length > 20, 'Rigid part must cast a visible shadow-map footprint');
          check(casterErrors === 0 && groundErrors === 0, `${mode}/${mirrored}/id=${id}: posed caster differs from reference (${casterErrors} interior texels, ${groundErrors} ground pixels)`);
          out[`${mode}/${mirrored ? 'mirror' : 'scale'}/${id}`] = { common, shadowed, rasterEdges };
        } finally { moving.dispose(); still.dispose(); g.dispose(); ref.dispose(); }
      }

    // World gust displacement still uses each plant's local height weights after a rotated/mirrored transform.
    for (const mirrored of [false, true]) {
      const t = 1.7, transform = place(0.7, 0.1, 0, 0.2, 0.6, 0.15, mirrored ? -1.2 : 1.2, 1.3, 0.8);
      const g = geometry(motion.sway(0, 1, 0, 0.6));
      const ref = geometry(motion.sway(0, 1, 0, 0.6));
      const p = ref.getAttribute('position') as Three.BufferAttribute, n = ref.getAttribute('normal') as Three.BufferAttribute;
      const anim = ref.getAttribute('aAnim') as Three.BufferAttribute;
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(transform), base = new THREE.Vector3(0, 0, 1).applyMatrix4(transform);
      const clock = t + phase(1) * 97;
      const gust = Math.sin(base.x * 0.42 + base.z * 0.27 + clock * 1.5) * 0.6
        + Math.sin(base.x * 0.91 - base.z * 0.63 + clock * 2.6) * 0.4;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(transform), weight = anim.getX(i);
        v.x += gust * 0.13 * weight; v.z += gust * 0.13 * 0.35 * weight; v.y -= Math.abs(gust) * 0.025 * weight;
        p.setXYZ(i, v.x, v.y, v.z);
        const norm = new THREE.Vector3().fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize(); n.setXYZ(i, norm.x, norm.y, norm.z);
      }
      // Reverse triangle winding for the mirrored, world-baked reference.
      if (mirrored) for (const attr of Object.values(ref.attributes)) {
        const a = attr as Three.BufferAttribute;
        for (let i = 0; i < a.count; i += 3) for (let k = 0; k < a.itemSize; k++) {
          const tmp = a.array[(i + 1) * a.itemSize + k];
          a.array[(i + 1) * a.itemSize + k] = a.array[(i + 2) * a.itemSize + k]; a.array[(i + 2) * a.itemSize + k] = tmp;
        }
      }
      for (const name of ['aMode', 'aAnchor', 'aAnim']) ref.deleteAttribute(name);
      const moving = make(), still = make();
      try {
        const o = moving.addObject(g); o.snap = false; transform.decompose(o.position, o.quaternion, o.scale);
        const b = still.addObject(ref); b.snap = false; moving.renderGeometry(t); still.renderGeometry(t);
        const a = read(moving), expected = read(still);
        check(diff(a.albedo, expected.albedo, 1e-6) === 0 && surfaceDiff(a.normal, expected.normal) === 0,
          `sway/${mirrored}: transformed plant differs from world-wind reference`);
        out[`sway/${mirrored ? 'mirror' : 'scale'}`] = 'world wind, local weights';
      } finally { moving.dispose(); still.dispose(); g.dispose(); ref.dispose(); }
    }

    // Smoke ignores emitter orientation/scale after transforming its local emitter, and casts/receives no puff mask.
    {
      const emitter: [number, number, number] = [0.4, 1, 0.3];
      const transform = place(0.8, 0.2, 0, 0.3, 0.4, 1.2, -1.5, 0.7, 1.2);
      const world = new THREE.Vector3(...emitter).applyMatrix4(transform);
      const g = geometry(motion.smoke(emitter, 0.15, 0.4), place(0.18, 0, 0, 0, 0, 0, 0.5, 0.25, 0.25));
      const ref = geometry(motion.smoke(world.toArray() as [number, number, number], 0.15, 0.4), place(-0.18, 0, 0, 0, 0, 0, -0.5, 0.25, 0.25));
      const moving = make(), still = make();
      try {
        const a = moving.addObject(g), b = still.addObject(ref); a.snap = b.snap = false;
        transform.decompose(a.position, a.quaternion, a.scale);
        for (const t of [1.2, 3.7]) {
          moving.renderGeometry(t); still.renderGeometry(t);
          check(diff(read(moving).albedo, read(still).albedo, 1e-6) === 0 && surfaceDiff(read(moving).normal, read(still).normal) === 0,
            `smoke/${t}: tilted/scaled emitter changes world-up puff shape`);
        }
        const shown = read(moving), cast = objectShadow(moving);
        a.visible = false; moving.renderGeometry(3.7); const hidden = read(moving);
        check(diff(cast, objectShadow(moving)) === 0, 'Smoke casts into the object shadow map');
        let unchangedGround = 0;
        for (let i = 0; i < W * H; i++) if (shown.mask[i * 4] === 0 && hidden.mask[i * 4] === 0) {
          unchangedGround++; check(shown.mask[i * 4 + 3] === hidden.mask[i * 4 + 3], 'Smoke changes a background shadow pixel');
        }
        out.smokeTransform = { unchangedGround };
      } finally { moving.dispose(); still.dispose(); g.dispose(); ref.dispose(); }
    }

    // Single-sided asymmetric wings keep outward faces in the mirrored mesh, after world-space flight posing.
    {
      const wing = new THREE.PlaneGeometry(0.8, 0.4), home: [number, number, number] = [0, 1, 0];
      const c = new GeometryCollector(true), refc = new GeometryCollector(true);
      c.add(wing, place(0.3, 0, 0), RED, undefined, false, motion.butterfly(home, 0.15, 0.4));
      refc.add(wing, place(-0.3, 0, 0, 0, 0, 0, -1, 1, 1), RED, undefined, false, motion.butterfly(home, 0.15, 0.4));
      const g = c.build(), ref = refc.build(), moving = make(), still = make();
      try {
        const a = moving.addObject(g), b = still.addObject(ref); a.snap = b.snap = false; a.scale.x = -1;
        let pixels = 0;
        for (const t of [1.2, 3.7]) {
          moving.renderGeometry(t); still.renderGeometry(t); const x = read(moving), y = read(still);
          pixels += x.mask.filter((v, i) => i % 4 === 0 && v === a.id).length;
          check(diff(x.albedo, y.albedo, 1e-6) === 0 && surfaceDiff(x.normal, y.normal) === 0, 'Mirrored single-sided wing differs from reflected-shape reference');
        }
        check(pixels > 3, 'Single-sided mirrored wing must remain visible');
        out.mirroredWing = { pixels };
      } finally { moving.dispose(); still.dispose(); g.dispose(); ref.dispose(); wing.dispose(); }
    }

    // A single shared machine geometry mixes a solid body and smoke. Only the body casts, at any clock.
    {
      const bodyAt = place(0, 0.8, 0, 0, 0, 0, 1.5, 1.6, 1);
      const c = new GeometryCollector(true); c.add(BOX, bodyAt, RED);
      c.add(BOX, place(0, 0, 0, 0, 0, 0, 0.5, 0.25, 0.25), GREY, undefined, false, motion.smoke([0, 1.8, 0], 0.15, 0.4));
      const g = c.build(), body = geometry(undefined, bodyAt);
      const moving = make(), still = make();
      try {
        const a = moving.addObject(g), b = still.addObject(body); a.snap = b.snap = false;
        a.scale.x = b.scale.x = -1;
        for (const t of [1.2, 3.7]) {
          moving.renderGeometry(t); still.renderGeometry(t);
          check(diff(shadowDepth(moving), shadowDepth(still), 1e-6) === 0, `Mixed body/smoke casts a puff or loses the body at ${t}`);
          const x = read(moving), y = read(still); let bodyPixels = 0;
          for (let i = 0; i < W * H; i++) if (RED.every((v, k) => Math.abs(x.albedo[i * 4 + k] - v) < 1e-5)) {
            bodyPixels++;
            check(diff(x.normal.subarray(i * 4, i * 4 + 4), y.normal.subarray(i * 4, i * 4 + 4), 2e-5) === 0,
              'Mode STATIC inside motion geometry changes body normals/depth');
            check(x.mask[i * 4 + 3] === y.mask[i * 4 + 3], 'Mixed smoke changes the body receiver mask');
          }
          check(bodyPixels > 50, 'Mixed machine body is visible');
        }
        out.mixedMachine = 'static body and noncasting smoke in one mirrored batch';
      } finally { moving.dispose(); still.dispose(); g.dispose(); body.dispose(); }
    }

    // Opting a smooth static body into a motion batch preserves interpolated normals under nonuniform scale.
    {
      const sphere = new THREE.SphereGeometry(1, 12, 8), c = new GeometryCollector(true), refc = new GeometryCollector();
      c.add(sphere, place(0, 2, 1), RED); refc.add(sphere, place(0, 2, 1), RED);
      const g = c.build(), ref = refc.build(), moving = make(), still = make();
      try {
        for (const r of [moving, still]) {
          const o = r.addObject(r === moving ? g : ref); o.snap = false; o.scale.set(2, 0.8, 1.2); r.renderGeometry(1.7);
        }
        const a = read(moving), b = read(still);
        check(diff(a.albedo, b.albedo, 1e-6) === 0 && surfaceDiff(a.normal, b.normal) === 0,
          'Smooth STATIC body in motion geometry changes lighting under nonuniform scale');
        out.smoothBody = 'motion opt-in preserves smooth normals under nonuniform scale';
      } finally { moving.dispose(); still.dispose(); g.dispose(); ref.dispose(); sphere.dispose(); }
    }

    // The third mask pass for baked rigid parts must depth-test against posed runtime objects in front.
    {
      const s = new GeometryCollector(), d = new GeometryCollector(true), BAKED: RGB = [0.2, 0.6, 0.8];
      s.add(BOX, place(0, -0.1, 0, 0, 0, 0, 24, 0.2, 24), GREY);
      // Sun at 60 degrees reaches this roof from the foreground; the lower camera ray passes underneath.
      // The baked panel behind stays lit, making an incorrect depth overwrite observable.
      s.add(BOX, place(-1, 6, 7, 0, 0, 0, 4, 0.1, 2), GREY);
      d.add(BOX, place(0, 1.5, 2, 0, 0, 0, 4, 2.4, 0.05), BAKED, undefined, false, motion.spin([0, 1.5, 2], [0, 0, 1], 0.8));
      const baked = scene(), plain = scene();
      baked.staticGeometry.dispose(); plain.staticGeometry.dispose(); baked.dynamicGeometry.dispose();
      baked.staticGeometry = s.build(); plain.staticGeometry = baked.staticGeometry.clone(); baked.dynamicGeometry = d.build();
      const moving = make(false, baked), still = make(false, plain);
      const g = geometry(motion.spin([-1, 1.1, 4.5], [0, 0, 1], 0.08), place(-1, 1.1, 4.5, 0, 0, 0, 2, 2.2, 0.6));
      try {
        const a = moving.addObject(g), b = still.addObject(g); a.snap = b.snap = false;
        let front = 0, overlap = 0, contrast = 0;
        for (const t of [0.9, 1.7]) {
          moving.renderGeometry(t); still.renderGeometry(t); const x = read(moving), y = read(still);
          check(moving['hasRigidParts'], 'Baked rigid fixture must exercise the third mask pass');
          a.visible = false; moving.renderGeometry(t); const behind = read(moving); a.visible = true;
          for (let i = 0; i < W * H; i++) if (x.mask[i * 4] === a.id && y.mask[i * 4] === b.id) {
            front++;
            check(Math.abs(x.mask[i * 4 + 3] - y.mask[i * 4 + 3]) < 1e-6,
              'Baked rigid mask paints over the posed object in front');
            if (BAKED.every((v, k) => Math.abs(behind.albedo[i * 4 + k] - v) < 1e-6)) {
              overlap++;
              if (Math.abs(x.mask[i * 4 + 3] - behind.mask[i * 4 + 3]) > 0.5) contrast++;
            }
          }
        }
        check(front > 40 && overlap > 10 && contrast > 5,
          `Baked/object fixture needs diagnostic overlap (${front} front, ${overlap} behind, ${contrast} contrast)`);
        out.bakedRigidOcclusion = { front, overlap, contrast };
      } finally { moving.dispose(); still.dispose(); g.dispose(); }
    }

    // Sway's rest-pose caster must not turn a sun-facing upper surface into its own shadow.
    {
      const g = geometry(motion.sway(0, 1, 0, 0.6)), r = make();
      try {
        const o = r.addObject(g); o.snap = false; let lit = 0;
        for (const t of [1.2, 3.7]) {
          r.renderGeometry(t); const a = read(r); let top = 0, shadowed = 0;
          for (let i = 0; i < W * H; i++) if (a.mask[i * 4] === o.id && a.normal[i * 4 + 1] > 0.99) {
            top++; if (a.mask[i * 4 + 3] > 0.5) shadowed++;
          }
          check(top > 10 && shadowed === 0, `Sway sun-facing surface self-shadows (${top} top, ${shadowed} shadowed)`); lit += top;
        }
        out.swaySunlit = { lit };
      } finally { r.dispose(); g.dispose(); }
    }

    // Batch growth and compaction retain ids, phase, and the custom depth material. Cached shadows redraw only if needed.
    {
      const r = make(), g = geometry(motion.spin([0, 2.5, 1], [0, 0, 1], 0.8));
      try {
        const dummy = r.addObject(g); dummy.visible = false;
        const a = r.addObject(g); a.snap = false;
        r.renderGeometry(1.2); const first = read(r), shadow = objectShadow(r);
        const far = Array.from({ length: 18 }, () => { const o = r.addObject(g); o.position.x = 100; o.snap = false; return o; });
        dummy.remove(); r.renderGeometry(1.2);
        check(diff(first.normal, read(r).normal) === 0 && diff(first.mask, read(r).mask) === 0, 'Growth/compaction changes existing phase/id/shadows');
        check(!!a.batch.mesh.customDepthMaterial && !!a.batch.mirrored.customDepthMaterial, 'Growth loses a custom depth material');
        for (const o of far) o.remove();
        let redraws = 0; a.batch.mesh.onBeforeShadow = () => { redraws++; };
        r.renderGeometry(1.2); redraws = 0; r.renderGeometry(1.2);
        check(redraws === 0, 'Same time redraws the rigid object shadow map');
        r.renderGeometry(3.7);
        check(redraws > 0 && diff(shadow, objectShadow(r)) > 0, 'Changed clock does not redraw the posed caster');
        a.visible = false; r.renderGeometry(4); redraws = 0; r.renderGeometry(5);
        check(redraws === 0, 'Hidden rigid objects force shadow redraws');
        a.visible = true; let draws = 0; a.batch.mesh.onBeforeRender = () => { draws++; };
        r.renderGeometry(6); const singleDraws = draws;
        for (let i = 0; i < 24; i++) { const o = r.addObject(g); o.position.x = 100 + i; }
        draws = 0; a.batch.mesh.onBeforeRender = () => { draws++; }; r.renderGeometry(6);
        check(draws === singleDraws && draws === 2, `Shared geometry loses instancing (${singleDraws} -> ${draws} main/mask draws)`);
        out.lifecycle = 'phase/id/depth survive growth and compaction; clock-aware shadow cache; one draw per geometry/pass';
      } finally { r.dispose(); g.dispose(); }
    }
    for (const [name, g] of [['static', geometry()], ['sway', geometry(motion.sway(0, 1, 0, 0.6))]] as const) {
      const r = make();
      try {
        const o = r.addObject(g); o.snap = false; r.renderGeometry(1.2); const before = objectShadow(r);
        let redraws = 0; o.batch.mesh.onBeforeShadow = () => { redraws++; };
        r.renderGeometry(3.7);
        check(redraws === 0 && diff(before, objectShadow(r)) === 0, `${name}: clock redraws rest-pose shadows`);
        if (name === 'static') check(!(o.batch.mesh.material as Three.ShaderMaterial).uniforms.uTime, 'Static objects use an animated shader');
        out[`${name}ShadowCache`] = 'unchanged';
      } finally { r.dispose(); g.dispose(); }
    }
    BOX.dispose();
    return out;
  }).catch(error => {
    if (errors.length) console.error(errors.join("\n"));
    throw error;
  });
  assert.deepEqual(errors, [], 'No browser/shader errors');
  console.log('PASS: runtime object motion', JSON.stringify(results));
} finally { await browser.close(); }
