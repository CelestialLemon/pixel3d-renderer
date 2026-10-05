// Dynamic-object GPU regression: transformed geometry, pixel snapping, runtime lifecycle and real moving sun shadows.
// Requires the dev server and the pinned browser, like the other renderer checks.
//   node tools/object-check.ts
import assert from 'node:assert/strict';
import type * as Three from 'three';
import type { PixelScene, PixelObject, RGB } from '../src/renderer/index.ts';
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { PixelRenderer, GeometryCollector, FluidCollector, place, lookAt, motion } = await import('/src/renderer/index.ts');
    const W = 160, H = 120, HEIGHT = 12, TEXEL = HEIGHT / H;
    const RED: RGB = [0.8, 0.12, 0.07], GREY: RGB = [0.4, 0.4, 0.4];
    const box = new THREE.BoxGeometry(1, 1, 1);
    const local = new GeometryCollector(); local.add(box, null, RED);
    const geometry = local.build();
    let disposed = 0; geometry.addEventListener('dispose', () => disposed++);
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
    const scene = (ground = false, baked?: Three.Matrix4, rigid = false, roof = false): PixelScene => {
      const s = new GeometryCollector(), d = new GeometryCollector(true);
      if (ground) s.add(box, place(0, -0.1, 0, 0, 0, 0, 24, 0.2, 24), GREY);
      if (baked) s.add(box, baked, RED);
      if (roof) s.add(box, place(0, 4.5, -0.5, 0, 0, 0, 12, 0.1, 3), GREY);
      if (rigid) d.add(box, place(3, 2, 0, 0, 0, 0, 1.5, 1, 0.2), [0.2, 0.3, 0.7], undefined, false, motion.spin([3, 2, 0], [0, 0, 1], 1));
      return { staticGeometry: s.build(), dynamicGeometry: d.build(), lamps: [], grooves: null,
        fluids: new FluidCollector().build(), shadow: { center: new THREE.Vector3(), radius: 14 }, stats: { triangles: 0, paletteColors: 0 } };
    };
    const make = (s: PixelScene, elevation = 0) => {
      const r = new PixelRenderer(document.createElement('canvas'), s);
      r.resize(W, H); r.setLook(lookAt(12)); r.placeCamera(new THREE.Vector3(), 0, elevation, HEIGHT);
      return r;
    };
    const read = (r: InstanceType<typeof PixelRenderer>) => {
      const albedo = r.readAlbedo(), normal = new Float32Array(W * H * 4), shadow = new Float32Array(W * H * 4);
      r.renderer.readRenderTargetPixels(r['gbuf'], 0, 0, W, H, normal, undefined, 1);
      r.renderer.readRenderTargetPixels(r['gbuf'], 0, 0, W, H, shadow, undefined, 2);
      return { albedo, normal, shadow };
    };
    const differences = (a: ArrayLike<number>, b: ArrayLike<number>, epsilon = 0) => {
      let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > epsilon) n++; return n;
    };
    const isColor = (a: ArrayLike<number>, i: number, color: RGB) => color.every((v, k) => Math.abs(a[i * 4 + k] - v) < 1e-5);
    const snapPosition = (r: InstanceType<typeof PixelRenderer>, p: Three.Vector3) => {
      const right = new THREE.Vector3().setFromMatrixColumn(r.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(r.camera.matrixWorld, 1);
      const texel = r.viewHeight / r.height;
      const snapped = p.clone().addScaledVector(right, Math.round(p.dot(right) / texel) * texel - p.dot(right))
        .addScaledVector(up, Math.round(p.dot(up) / texel) * texel - p.dot(up));
      const fwd = new THREE.Vector3().setFromMatrixColumn(r.camera.matrixWorld, 2);
      if (Math.abs(fwd.y) > 0.05) snapped.addScaledVector(fwd, (p.y - snapped.y) / fwd.y);
      return snapped;
    };
    const drawnPosition = (o: PixelObject) => {
      const matrix = new THREE.Matrix4(); o.batch.mesh.getMatrixAt(0, matrix);
      return new THREE.Vector3().setFromMatrixPosition(matrix);
    };
    const out: Record<string, unknown> = {};
    try {
      // Axis-aligned, rotated and non-uniformly scaled objects match geometry baked at the same on-grid transform.
      for (const [name, euler, scale] of [
        ['identity', [0, 0, 0], [1, 1, 1]],
        ['quarter-turn', [0, 0, Math.PI / 2], [1.6, 0.8, 1.2]],
        ['nonuniform', [0.23, 0.41, 0.17], [1.6, 0.8, 1.2]],
        ['mirrored', [0.23, 0.41, 0.17], [-1.6, 0.8, 1.2]],
      ] as const) {
        const p = new THREE.Vector3(1.2, 1.8, 0), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler));
        const sc = new THREE.Vector3(...scale), m = new THREE.Matrix4().compose(p, q, sc);
        const moving = make(scene()), baked = make(scene(false, m));
        try {
          const object = moving.addObject(geometry); object.setTransform(p, q, sc);
          p.set(100, 100, 100); q.identity(); sc.setScalar(10);
          moving.renderGeometry(0); baked.renderGeometry(0);
          const a = read(moving), b = read(baked);
          const albedo = differences(a.albedo, b.albedo), normalDepth = differences(a.normal, b.normal, 2e-5);
          check(albedo === 0, `${name}: object/baked albedo differs in ${albedo} channels`);
          check(normalDepth === 0, `${name}: object/baked normal/depth differs in ${normalDepth} channels`);
          check(object.position.x === 1.2 && object.scale.x === scale[0],
            `${name}: setTransform must copy caller inputs`);
          out[name] = { albedo, normalDepth };
        } finally { moving.dispose(); baked.dispose(); }
      }

      const r = make(scene());
      try {
        r.renderGeometry(0); const empty = read(r);
        const object = r.addObject(geometry);
        object.setTransform(new THREE.Vector3(0, 1, 0), undefined, new THREE.Vector3(1.2, 1, 1));
        r.renderGeometry(0); const first = read(r);
        object.position.x = TEXEL * 0.49; r.renderGeometry(0); const subpixel = read(r);
        check(differences(first.albedo, subpixel.albedo) === 0, 'A move within a snap cell changes no silhouette pixel');
        check(differences(first.normal, subpixel.normal) === 0, 'A move within a snap cell changes no geometry pixel');
        check(object.position.x === TEXEL * 0.49, 'Snapping must preserve the unsnapped game position');
        object.position.x = TEXEL * 0.51; r.renderGeometry(0); const stepped = read(r);
        let shifted = 0, covered = 0;
        for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) {
          const i = y * W + x, prev = i - 1;
          if (isColor(first.albedo, prev, RED)) covered++;
          if (isColor(stepped.albedo, i, RED) !== isColor(first.albedo, prev, RED)) shifted++;
        }
        check(covered > 80 && shifted === 0, `Crossing a snap boundary translates the silhouette one art pixel (${shifted} mismatches)`);
        object.visible = false; r.renderGeometry(0);
        check(differences(read(r).albedo, empty.albedo) === 0, 'Hiding an object restores the empty scene');
        object.visible = true; r.renderGeometry(0);
        check(differences(read(r).albedo, stepped.albedo) === 0, 'Showing an object restores its silhouette');
        object.snap = false; object.position.x = TEXEL * 0.27; r.renderGeometry(0);
        check(Math.abs(drawnPosition(object).x - object.position.x) < 1e-8,
          'snap=false draws the requested continuous position');
        object.remove(); object.remove(); r.renderGeometry(0);
        check(differences(read(r).albedo, empty.albedo) === 0, 'remove is idempotent and restores the empty scene');
        const shared = r.addObject(geometry); shared.position.y = 1;
        const shared2 = r.addObject(geometry); shared2.position.set(2, 1, 0);
        shared.remove(); r.renderGeometry(0);
        const remaining = read(r).albedo;
        const pixelAt = (p: Three.Vector3) => {
          const projected = p.clone().project(r.camera);
          return Math.floor((projected.y * 0.5 + 0.5) * H) * W + Math.floor((projected.x * 0.5 + 0.5) * W);
        };
        check(isColor(remaining, pixelAt(shared2.position), RED) && !isColor(remaining, pixelAt(shared.position), RED),
          'Shared-geometry removal preserves the survivor at its own position and removes the requested one');
        out.snapping = { covered, shifted };
      } finally { r.dispose(); }

      const planeSource = new THREE.PlaneGeometry(2, 2), planeCollector = new GeometryCollector();
      planeCollector.add(planeSource, null, RED);
      const planeGeometry = planeCollector.build(), planeRenderer = make(scene());
      try {
        const o = planeRenderer.addObject(planeGeometry);
        for (const sign of [1, -1, 1]) {
          o.scale.x = sign; planeRenderer.renderGeometry(0);
          const collector = new GeometryCollector(); collector.add(planeSource, place(0, 0, 0, 0, 0, 0, sign, 1, 1), RED);
          const s = scene(); s.staticGeometry.dispose(); s.staticGeometry = collector.build();
          const reference = make(s);
          try {
            reference.renderGeometry(0);
            const a = read(planeRenderer), b = read(reference);
            check(differences(a.albedo, b.albedo) === 0 && differences(a.normal, b.normal, 2e-5) === 0,
              `Plane scale sign ${sign} matches baked winding, including sign changes`);
            let pixels = 0; for (let i = 0; i < W * H; i++) if (isColor(a.albedo, i, RED)) pixels++;
            check(pixels === 400, `Mirrored plane remains visible (${pixels} px)`);
          } finally { reference.dispose(); }
        }
        out.mirroredPlane = { pixels: 400, signs: [1, -1, 1] };
        o.remove(); planeRenderer.renderGeometry(0); const empty = read(planeRenderer);
        const yzCollector = new GeometryCollector(); yzCollector.add(planeSource, place(0, 0, 0, 0, Math.PI / 2, 0), RED);
        const yzGeometry = yzCollector.build();
        try {
          const yz = planeRenderer.addObject(yzGeometry);
          yz.quaternion.setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0));
          yz.scale.x = 0; planeRenderer.renderGeometry(0);
          check(differences(read(planeRenderer).albedo, empty.albedo) === 0, 'Zero-scale components hide even a plane that would otherwise still rasterize');
          yz.scale.x = 1; planeRenderer.renderGeometry(0);
          check(differences(read(planeRenderer).albedo, empty.albedo) > 100, 'Restoring a zero-scale component shows the plane again');
          yz.remove();
        } finally { yzGeometry.dispose(); }
      } finally { planeRenderer.dispose(); planeGeometry.dispose(); planeSource.dispose(); }

      // Growth replaces the InstancedMesh; hiding/removing arbitrary entries must pack surviving transforms correctly.
      const batchRenderer = make(scene());
      try {
        const objects = Array.from({ length: 33 }, (_, i) => {
          const o = batchRenderer.addObject(geometry);
          o.setTransform(new THREE.Vector3(i % 11 - 5, Math.floor(i / 11) - 1, 0), undefined, 0.4);
          if (i % 2) o.scale.x *= -1;
          return o;
        });
        const compareBatch = (excluded: number[]) => {
          const baked = scene(), collector = new GeometryCollector();
          for (let i = 0; i < objects.length; i++) if (!excluded.includes(i)) {
            const p = objects[i].position;
            const scale = objects[i].scale;
            collector.add(box, place(p.x, p.y, p.z, 0, 0, 0, scale.x, scale.y, scale.z), RED);
          }
          baked.staticGeometry.dispose(); baked.staticGeometry = collector.build();
          const reference = make(baked);
          try {
            batchRenderer.renderGeometry(0); reference.renderGeometry(0);
            const a = read(batchRenderer), b = read(reference);
            check(differences(a.albedo, b.albedo) === 0 && differences(a.normal, b.normal, 2e-5) === 0,
              'Mixed-sign batch growth/repacking matches baked surviving objects');
          } finally { reference.dispose(); }
        };
        compareBatch([]);
        objects[2].visible = false; objects[8].remove(); objects[24].remove();
        compareBatch([2, 8, 24]);
        objects[7].scale.x *= -1; compareBatch([2, 8, 24]);
        out.batch = { added: 33, remainingVisible: 30 };
      } finally { batchRenderer.dispose(); }

      // Both a new frame and a camera/zoom/resize change must pose the object before its shadow is drawn.
      const rShadow = make(scene(true, undefined, true), 0.6);
      try {
        const shadowLook = { ...lookAt(12), sunAz: 90, sunEl: 45 };
        rShadow.setLook(shadowLook);
        let staticDraws = 0;
        rShadow['staticMesh'].onBeforeShadow = () => staticDraws++;
        rShadow.renderGeometry(0); const empty = read(rShadow);
        const object = rShadow.addObject(geometry); object.position.set(-2, 1.4, 0); object.scale.set(1.5, 2.8, 1.5);
        rShadow.renderGeometry(0); const first = read(rShadow);
        let shadowPixels = 0;
        for (let i = 0; i < W * H; i++) if (isColor(first.albedo, i, GREY) && first.shadow[i * 4 + 3] > 0.5 && empty.shadow[i * 4 + 3] < 0.5) shadowPixels++;
        const diagnostic = { ground: 0, shadow: 0, max: 0, changed: 0 };
        for (let i = 0; i < W * H; i++) if (isColor(first.albedo, i, GREY)) {
          diagnostic.ground++; if (first.shadow[i * 4 + 3] > 0.5) diagnostic.shadow++;
          diagnostic.max = Math.max(diagnostic.max, first.shadow[i * 4 + 3]);
          if (Math.abs(first.shadow[i * 4 + 3] - empty.shadow[i * 4 + 3]) > 0.01) diagnostic.changed++;
        }
        check(shadowPixels > 30, `Object casts a real sun shadow on the static ground (${shadowPixels} px; ${JSON.stringify(diagnostic)})`);
        object.position.x += 4; rShadow.renderGeometry(0); const moved = read(rShadow);
        let changedGround = 0;
        for (let i = 0; i < W * H; i++) if (isColor(first.albedo, i, GREY) && isColor(moved.albedo, i, GREY) && Math.abs(first.shadow[i * 4 + 3] - moved.shadow[i * 4 + 3]) > 0.5) changedGround++;
        check(changedGround > 30, `Direct position mutation moves the ground shadow (${changedGround} px)`);
        check(staticDraws === 1, `Object moves must preserve the cached static sun map (${staticDraws} static draws)`);
        const changedLook = { ...shadowLook, sunAz: -90 };
        rShadow.setLook(changedLook); rShadow.renderGeometry(0); const changedSun = read(rShadow);
        let sunMovedGround = 0;
        for (let i = 0; i < W * H; i++) if (isColor(moved.albedo, i, GREY) && isColor(changedSun.albedo, i, GREY)
          && Math.abs(moved.shadow[i * 4 + 3] - changedSun.shadow[i * 4 + 3]) > 0.5) sunMovedGround++;
        check(sunMovedGround > 30, `Changing the sun moves the object's shadow (${sunMovedGround} px)`);
        const fresh = make(scene(true, undefined, true), 0.6);
        try {
          fresh.setLook(changedLook);
          fresh.addObject(geometry).setTransform(object.position, object.quaternion, object.scale);
          fresh.renderGeometry(0);
          check(differences(changedSun.shadow, read(fresh).shadow) === 0, 'A changed-sun object map matches a fresh renderer at the same look');
        } finally { fresh.dispose(); }
        const assertPose = (o: PixelObject) => {
          rShadow.renderGeometry(0);
          const drawn = drawnPosition(o);
          check(drawn.distanceTo(snapPosition(rShadow, o.position)) < 1e-6, 'Object re-snaps after camera/zoom/resize');
          const up = new THREE.Vector3().setFromMatrixColumn(rShadow.camera.matrixWorld, 1);
          const right = new THREE.Vector3().setFromMatrixColumn(rShadow.camera.matrixWorld, 0);
          const texel = rShadow.viewHeight / rShadow.height;
          check([right, up].every((axis) => Math.abs(drawn.dot(axis) / texel - Math.round(drawn.dot(axis) / texel)) < 1e-5),
            'The object origin lands on both art-pixel grid axes');
          check(Math.abs(drawn.y - o.position.y) < 1e-6, 'Snapping preserves world height away from the near-level fallback');
        };
        rShadow.placeCamera(new THREE.Vector3(), 0.7, 0.43, 9); assertPose(object);
        rShadow.resize(W, H); assertPose(object);
        rShadow.setLook(lookAt(17.5)); assertPose(object);
        check(staticDraws === 3, 'Each sun change redraws the static sun map exactly once');
        rShadow.setLook(shadowLook); rShadow.placeCamera(new THREE.Vector3(), 0, 0.6, HEIGHT);
        object.visible = false; rShadow.renderGeometry(0);
        check(differences(read(rShadow).shadow, empty.shadow) === 0, 'Hidden objects leave no stale sun shadows');
        object.visible = true; rShadow.renderGeometry(0); object.remove(); rShadow.renderGeometry(0);
        check(differences(read(rShadow).shadow, empty.shadow) === 0, 'Removed objects leave no stale sun shadows');
        out.shadows = { shadowPixels, changedGround, sunMovedGround, staticDraws };
      } finally { rShadow.dispose(); }

      // A receiver under a static roof must keep the roof's shadow. Quantify PCF differences from one baked map.
      for (const roof of [false, true]) {
        const moving = make(scene(true, undefined, false, roof), 0.6);
        let baked: InstanceType<typeof PixelRenderer> | undefined;
        try {
          const shadowLook = { ...lookAt(12), sunAz: 90, sunEl: 45 };
          moving.setLook(shadowLook);
          const o = moving.addObject(geometry); o.position.set(0, 1.6, 0); o.scale.set(1.5, 2.8, 1.5);
          const matrix = new THREE.Matrix4().compose(snapPosition(moving, o.position), o.quaternion, o.scale);
          baked = make(scene(true, matrix, false, roof), 0.6); baked.setLook(shadowLook);
          moving.renderGeometry(0); baked.renderGeometry(0);
          const a = read(moving), b = read(baked);
          let surface = 0, shadowed = 0, shadowDiff = 0, largeDiff = 0;
          for (let i = 0; i < W * H; i++) if (isColor(a.albedo, i, RED) && isColor(b.albedo, i, RED)) {
            surface++; if (a.shadow[i * 4 + 3] > 0.5) shadowed++;
            const delta = Math.abs(a.shadow[i * 4 + 3] - b.shadow[i * 4 + 3]);
            if (delta > 1e-6) shadowDiff++; if (delta > 0.5) largeDiff++;
          }
          check(surface > 250, 'The shadow receiver is visible');
          if (roof) check(shadowed > 150, `An object receives the static roof's sun shadow (${shadowed} px)`);
          check(largeDiff === 0, `Object/baked shadow classification differs on ${largeDiff} receiver pixels`);
          out[roof ? 'roofReceiver' : 'selfReceiver'] = { surface, shadowed, shadowDiff, largeDiff };
        } finally { moving.dispose(); baked?.dispose(); }
      }
      check(disposed === 0, 'Object removal and renderer disposal must preserve caller-owned geometry');
      return out;
    } finally { geometry.dispose(); box.dispose(); }
  });
  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.log('PASS: dynamic object transforms, copied inputs, snapping, visibility/removal, shared geometry and moving sun shadows.', results);
} finally { await browser.close(); }
