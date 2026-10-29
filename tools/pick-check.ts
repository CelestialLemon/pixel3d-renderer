// GPU picking regression: known surfaces, per-instance identity and the exact resolve representative.
// Requires the dev server and pinned browser, like the other renderer checks. Goldens are checked separately.
import assert from 'node:assert/strict';
import type { BakedScene as PixelScene } from '../src/renderer/index.ts';
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 640, height: 480 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { PixelRenderer, GeometryCollector, FluidCollector, place, lookAt, motion } = await import('/src/renderer/index.ts');
    const { RESOLVE_FRAG } = await import('/src/renderer/shaders/resolve.ts');
    const { POST_VERT } = await import('/src/renderer/shaders/common.ts');
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
    const close = (a: number, b: number) => Math.abs(a - b) < 2e-4;
    type Pick = ReturnType<InstanceType<typeof PixelRenderer>['pickPixel']>;
    const sameVector = (a: { equals(v: unknown): boolean } | null, b: unknown) => a === null ? b === null : b !== null && a.equals(b);
    const samePick = (a: Pick, b: Pick) => a === null ? b === null
      : b !== null && a.x === b.x && a.y === b.y && a.object === b.object && sameVector(a.world, b.world) && sameVector(a.normal, b.normal);
    // Frames go by (renderStyle polls the pending picks) until `promise` settles.
    const settle = async <T,>(r: InstanceType<typeof PixelRenderer>, promise: Promise<T>, name: string) => {
      let done = false, value: T | undefined;
      promise.then((v) => { done = true; value = v; });
      for (let k = 0; k < 60 && !done; k++) { await new Promise((res) => setTimeout(res, 16)); r.renderStyle(0); await Promise.resolve(); }
      check(done, `${name}: requestPick never settled`);
      return value as T;
    };
    const W = 80, H = 60, HEIGHT = 6;
    const box = new THREE.BoxGeometry(1, 1, 1), local = new GeometryCollector();
    local.add(box, null, [0.8, 0.12, 0.07]);
    const geometry = local.build(), out: string[] = [];
    const scene = (): PixelScene => {
      const s = new GeometryCollector(), d = new GeometryCollector(true);
      s.add(box, place(-2, 1, 0), [0.4, 0.4, 0.4]);
      d.add(box, place(2, 1, 0), [0.2, 0.3, 0.7], undefined, false, motion.spin([2, 1, 0], [0, 1, 0], 1));
      return { staticGeometry: s.build(), dynamicGeometry: d.build(), lamps: [], grooves: null,
        fluids: new FluidCollector().build(), shadow: { center: new THREE.Vector3(), radius: 8 }, stats: { triangles: 0, paletteColors: 0 } };
    };
    for (const S of [1, 3]) {
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;left:23px;top:31px;width:240px;height:180px;';
      document.body.append(canvas);
      const r = new PixelRenderer(canvas, scene());
      r.supersample = S; r.resize(W, H); r.setLook(lookAt(12)); r.placeCamera(new THREE.Vector3(), 0, 0, HEIGHT);
      try {
        check(r.pickPixel(40, 19) === null, `S=${S}: pick before first render`);
        const objects = Array.from({ length: 20 }, () => r.addObject(geometry));
        objects.forEach((o) => { o.snap = false; o.position.set(100, 100, 0); });
        const a = objects[0], b = objects[19];
        a.position.set(0, 1, 0); b.position.set(1, 1, 0); b.scale.x = -1;
        r.renderGeometry(0);
        check(a.batch.mesh.instanceMatrix.count >= 20, `S=${S}: batch did not grow`);
        const hit = r.pickPixel(40, 19)!;
        check(r.pickPixel(40.75, 19.25)!.object === a, `S=${S}: fractional art coordinate flooring`);
        for (const [x, y] of [[-1, 19], [W, 19], [40, H], [NaN, 19], [40, Infinity]])
          check(r.pickPixel(x, y) === null, `S=${S}: invalid art coordinate ${x},${y}`);
        check(hit.object === a, `S=${S}: normal mesh identity`);
        check(hit.world !== null && close(hit.world.x, 0.05) && close(hit.world.y, 1.05) && close(hit.world.z, 0.5),
          `S=${S}: known front plane position ${hit.world?.toArray()}`);
        check(hit.normal !== null && close(hit.normal.x, 0) && close(hit.normal.y, 0) && close(hit.normal.z, 1), `S=${S}: front normal`);
        check(r.pickPixel(50, 19)!.object === b, `S=${S}: mirrored mesh identity`);
        for (const x of [20, 60]) {
          const h = r.pickPixel(x, 19)!;
          check(h.object === null && h.world !== null && close(h.world.z, 0.5), `S=${S}: baked/dynamic surface ${x}`);
        }
        const sky = r.pickPixel(40, 0)!;
        check(sky.world === null && sky.normal === null && sky.object === null, `S=${S}: sky`);
        const rect = canvas.getBoundingClientRect();
        const css = r.pick(rect.left + 40.75 * rect.width / W, rect.top + 19.25 * rect.height / H)!;
        check(css.x === 40 && css.y === 19 && css.object === a, `S=${S}: CSS scale and canvas offset`);
        check(r.pick(rect.left - 0.1, rect.top) === null && r.pick(rect.right, rect.top) === null && r.pick(rect.left, rect.bottom) === null,
          `S=${S}: outside canvas`);
        // requestPick: exactly pick's answer for the same frame, with no blocking readback and no pack buffer left bound.
        const gl = r.renderer.getContext() as WebGL2RenderingContext, three = r.renderer;
        const points = [[40, 19], [40.75, 19.25], [50, 19], [20, 19], [60, 19], [40, 0], [-1, 19], [W, 19], [NaN, 19]];
        const expected = points.map(([x, y]) => r.pickPixel(x, y));
        const syncRead = three.readRenderTargetPixels, readPixels = gl.readPixels;
        let blocking = 0;
        three.readRenderTargetPixels = (...args) => { blocking++; return syncRead.apply(three, args); };
        gl.readPixels = ((...args: unknown[]) => {
          if (typeof args[6] !== 'number') blocking++;   // into an array, not a pack buffer
          return (readPixels as (...a: unknown[]) => void).apply(gl, args);
        }) as typeof gl.readPixels;
        let requests: Promise<Pick>[];
        try { requests = points.map(([x, y]) => r.requestPickPixel(x, y)); } finally { three.readRenderTargetPixels = syncRead; gl.readPixels = readPixels; }
        check(blocking === 0, `S=${S}: requestPick read back synchronously (${blocking})`);
        check(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) === null, `S=${S}: requestPick left a pack buffer bound`);
        const answers = await settle(r, Promise.all(requests), `S=${S}`);
        answers.forEach((a, k) => check(samePick(a, expected[k]), `S=${S}: requestPick at ${points[k]} differs from pick`));
        const viaCss = await settle(r, r.requestPick(rect.left + 40.75 * rect.width / W, rect.top + 19.25 * rect.height / H), `S=${S} CSS`);
        check(samePick(viaCss, css), `S=${S}: requestPick CSS mapping`);
        check(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) === null, `S=${S}: delivering a pick left a pack buffer bound`);
        // A new camera request must not reinterpret the old G-buffer.
        r.placeCamera(new THREE.Vector3(3, 2, 1), 0.6, 0.5, 9);
        check(r.pickPixel(40, 19)!.world!.distanceTo(hit.world!) < 1e-5, `S=${S}: camera snapshot`);
        // Nor a later frame a pending requestPick, delivered by renderGeometry.
        const pending = r.requestPickPixel(40, 19);
        let delivered: Pick | undefined;
        pending.then((v) => { delivered = v; });
        for (let k = 0; k < 60 && delivered === undefined; k++) {
          await new Promise((res) => setTimeout(res, 16)); r.renderGeometry(k); await Promise.resolve();
        }
        check(delivered !== undefined && samePick(delivered, hit), `S=${S}: requestPick camera snapshot across renderGeometry`);
        r.placeCamera(new THREE.Vector3(), 0, 0, HEIGHT);
        a.visible = false; b.scale.x = 1; b.position.set(0, 1, 0);
        r.renderGeometry(0);
        check(r.pickPixel(40, 19)!.object === b, `S=${S}: hidden slot compaction and mirror-to-normal`);
        const beforeRemoval = r.requestPickPixel(40, 19);
        b.remove();
        const removed = await settle(r, beforeRemoval, `S=${S} removal`);
        check(removed !== null && removed.object === null && removed.world !== null, `S=${S}: requestPick of an object removed before delivery`);
        check(r.pickPixel(40, 19)!.object === null && r.pickPixel(40, 19)!.world !== null, `S=${S}: removed handle before rerender`);
        const replacement = r.addObject(geometry); replacement.snap = false; replacement.position.set(0, 1, 0);
        check(replacement.id > b.id, `S=${S}: ids reused`);
        r.renderGeometry(0);
        check(r.pickPixel(40, 19)!.object === replacement, `S=${S}: replacement identity`);
        // A CPU ray/triangle intersection independently checks the reconstructed point and inverse-transpose normal.
        replacement.snap = true; replacement.position.set(0.035, 1.027, 0.021);
        replacement.quaternion.setFromEuler(new THREE.Euler(0.23, 0.41, 0.17));
        r.placeCamera(new THREE.Vector3(0, 1, 0), 0.45, 0.35, HEIGHT);
        const material = new THREE.MeshBasicMaterial(), oracle = new THREE.Mesh(geometry, material);
        oracle.matrixAutoUpdate = false;
        try {
          for (const sx of [1.6, -1.6]) {
            replacement.scale.set(sx, 0.8, 1.2); r.renderGeometry(0);
            oracle.matrixWorld.copy(replacement.drawn);
            const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(2 * 40.5 / W - 1, 1 - 2 * 30.5 / H), r.camera);
            const expected = ray.intersectObject(oracle)[0], actual = r.pickPixel(40, 30)!;
            check(!!expected && actual.object === replacement && actual.world !== null && actual.world.distanceTo(expected.point) < 2e-4,
              `S=${S}, scale=${sx}: angled surface position ${actual.world?.toArray()} vs ${expected?.point.toArray()}`);
            const normal = expected.face!.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(replacement.drawn));
            check(actual.normal !== null && actual.normal.distanceTo(normal) < 2e-4, `S=${S}, scale=${sx}: transformed normal`);
          }
        } finally { material.dispose(); }
        replacement.scale.x = 0; r.renderGeometry(0);
        check(r.pickPixel(40, 30)!.object === null, `S=${S}: zero-scale object still pickable`);
        r.resize(W, H);
        check(r.pickPixel(40, 19) === null, `S=${S}: pick after resize before rendering`);
        check(await r.requestPickPixel(40, 19) === null, `S=${S}: requestPick after resize before rendering`);
        r.renderGeometry(0);
        const orphanCalls: Pick[] = [];
        const orphan = r.requestPickPixel(40, 19, (p) => orphanCalls.push(p));
        r.dispose();
        check(orphanCalls.length === 1 && orphanCalls[0] === null, `S=${S}: onPicked pending at dispose (${orphanCalls.length})`);
        check(await orphan === null, `S=${S}: requestPick pending at dispose`);
        out.push(`S=${S}: position, transformed normal, sky, baked/animated world, CSS mapping, growth, mirroring, compaction, removal, camera snapshot, guards, requestPick`);
      } finally { r.dispose(); canvas.remove(); }
    }
    // collectPicks and onPicked: synchronous delivery, once per request on every path, oldest first, errors and reentrancy.
    {
      const canvas = document.createElement('canvas');
      const r = new PixelRenderer(canvas, scene());
      r.resize(W, H); r.setLook(lookAt(12)); r.placeCamera(new THREE.Vector3(), 0, 0, HEIGHT);
      const gl = r.renderer.getContext() as WebGL2RenderingContext;
      const internals = r as unknown as { freePackBuffers: unknown[]; pendingPicks: { onPicked?: unknown }[] };
      // Fences signal only in a later task, so let the GPU finish and yield until `ready()` (collecting each time).
      const collectUntil = async (ready: () => boolean, name: string) => {
        for (let k = 0; k < 60 && !ready(); k++) { gl.finish(); await new Promise((res) => setTimeout(res, 16)); r.collectPicks(); }
        check(ready(), `${name}: never delivered`);
      };
      const reported: string[] = [];
      const onError = (e: ErrorEvent) => { reported.push(e.message); e.preventDefault(); };
      window.addEventListener('error', onError);
      try {
        const a = r.addObject(geometry); a.snap = false; a.position.set(0, 1, 0);
        r.renderGeometry(0);
        const points = [[40, 19], [20, 19], [40, 0], [60, 19]], expected = points.map(([x, y]) => r.pickPixel(x, y));
        // Delivered inside collectPicks, with the promise's answer, oldest first, and detached with its GL work done.
        let deletes = 0;
        const deleteSync = gl.deleteSync;
        gl.deleteSync = ((s: WebGLSync | null) => { deletes++; deleteSync.call(gl, s); }) as typeof gl.deleteSync;
        const got: [number, Pick, number, number, boolean][] = [];   // index, answer, deletes, pooled buffers, still pending
        const callbacks = points.map((_, k) => (p: Pick) => {
          const queued = internals.pendingPicks.some((e) => e.onPicked === callbacks[k]);
          got.push([k, p, deletes, internals.freePackBuffers.length, queued]);
          check(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) === null, 'onPicked: a pack buffer is bound');
        });
        const promises = points.map(([x, y], k) => r.requestPickPixel(x, y, callbacks[k]));
        check(got.length === 0, 'onPicked called inside requestPick');
        try { await collectUntil(() => got.length === points.length, 'onPicked'); } finally { gl.deleteSync = deleteSync; }
        check(got.map(([k]) => k).join() === '0,1,2,3', `onPicked order ${got.map(([k]) => k)}`);
        got.forEach(([k, p]) => check(samePick(p, expected[k]), `onPicked at ${points[k]} differs from pick`));
        check(got.every(([k, , d, pooled, pending]) => d >= k + 1 && pooled >= 1 && !pending), `onPicked before GL cleanup / detach ${JSON.stringify(got.map(([k, , d, f, p]) => [k, d, f, p]))}`);
        const viaPromise = await Promise.all(promises);
        viaPromise.forEach((p, k) => check(p === got[k][1], `promise and onPicked answers differ at ${k}`));
        r.collectPicks();
        check(got.length === points.length, 'onPicked called twice');

        // An answer known at once (not pickable): the promise settles now, onPicked at the next collectPicks, in turn.
        const order: string[] = [];
        r.requestPickPixel(40, 19, () => order.push('ok'));
        let early: Pick | undefined = undefined;
        const outside = r.requestPickPixel(-1, 19, (p) => { order.push('outside'); early = p; });
        check(await outside === null && order.length === 0, 'immediate null: promise or onPicked');
        await collectUntil(() => order.length === 2, 'immediate null');
        check(order.join() === 'ok,outside' && early === null, `immediate null order ${order}`);

        // A throwing callback: reported, and every other delivery and promise still happens.
        reported.length = 0;
        const calls: number[] = [];
        const thrown = [0, 1, 2].map((k) => r.requestPickPixel(40, 19, () => { calls.push(k); if (k !== 2) throw new Error(`boom ${k}`); }));
        await collectUntil(() => calls.length === 3, 'throwing onPicked');
        const settled = await Promise.all(thrown);
        check(calls.join() === '0,1,2' && settled.every((p) => p?.object === a), `throwing onPicked: ${calls}`);
        check(reported.length === 2, `throwing onPicked reported: ${reported}`);   // muted ("Script error."): evaluated code

        // Reentrancy: a callback's own request waits for a later collectPicks; a nested collectPicks keeps the order.
        const seen: string[] = [];
        let inner: Promise<Pick> | undefined;
        r.requestPickPixel(40, 19, () => {
          seen.push('A');
          inner = r.requestPickPixel(20, 19, () => seen.push('inner'));
          r.collectPicks();   // goes on with B and C, but not with `inner`
          seen.push('A done');
        });
        r.requestPickPixel(40, 19, () => seen.push('B'));
        r.requestPickPixel(-1, 19, () => seen.push('C'));
        await collectUntil(() => seen.includes('A done'), 'reentrant');
        check(seen.join() === 'A,B,C,A done', `reentrant order ${seen}`);
        await collectUntil(() => seen.includes('inner'), 'request from onPicked');
        check(seen.join() === 'A,B,C,A done,inner' && (await inner!)?.object === null, `request from onPicked ${seen}`);

        // WAIT_FAILED: null, once, and the pack buffer is deleted rather than pooled.
        const waitSync = gl.clientWaitSync;
        let failedAnswer: Pick | undefined, failedCalls = 0;
        const failing = r.requestPickPixel(40, 19, (p) => { failedCalls++; failedAnswer = p; });
        gl.clientWaitSync = (() => gl.WAIT_FAILED) as typeof gl.clientWaitSync;
        try { r.collectPicks(); } finally { gl.clientWaitSync = waitSync; }
        r.collectPicks();
        check(failedCalls === 1 && failedAnswer === null && await failing === null, `WAIT_FAILED: ${failedCalls} calls, ${failedAnswer}`);

        // Dispose, also from inside a callback: pending ones get null once, in order; later requests at the next collectPicks.
        const last: string[] = [];
        r.requestPickPixel(40, 19, (p) => { last.push(`first ${p?.object === a}`); r.dispose(); });
        r.requestPickPixel(40, 19, (p) => last.push(`second ${p?.object === a}`));   // already collected with A, or dropped
        r.requestPickPixel(-1, 19, (p) => last.push(`third ${p}`));
        await collectUntil(() => last.length === 3, 'dispose from onPicked');
        check(/^first true,second (true|false),third null$/.test(last.join()), `dispose from onPicked: ${last}`);
        r.collectPicks();
        check(last.length === 3, `dispose from onPicked: delivered again ${last}`);
        let afterDispose = 0;
        const late = r.requestPickPixel(40, 19, () => afterDispose++);
        check(await late === null && afterDispose === 0, 'request after dispose: called inside requestPick');
        r.collectPicks(); r.collectPicks();
        check(afterDispose === 1, `request after dispose: ${afterDispose} calls`);
        out.push('collectPicks / onPicked: synchronous, once, oldest first, after GL cleanup; immediate null, throwing callbacks, reentrancy, WAIT_FAILED, dispose');
      } finally { window.removeEventListener('error', onError); r.dispose(); }
      // Disposed by an onPicked that renderGeometry / renderStyle delivers: that call draws nothing and picks stay null.
      for (const entry of ['renderGeometry', 'renderStyle'] as const) {
        const r = new PixelRenderer(document.createElement('canvas'), scene());
        r.resize(W, H); r.setLook(lookAt(12)); r.placeCamera(new THREE.Vector3(), 0, 0, HEIGHT);
        try {
          r.renderGeometry(0);
          let calls = 0;
          r.requestPickPixel(-1, 19, () => { calls++; r.dispose(); });   // known at once: the next collection delivers it
          r[entry](0);
          check(calls === 1 && r.pickPixel(40, 19) === null, `${entry}: disposed by onPicked (${calls} calls)`);
          r.renderGeometry(0); r.renderStyle(0);
          check(calls === 1 && r.pickPixel(40, 19) === null, `${entry}: render after dispose by onPicked`);
        } finally { r.dispose(); }
      }
    }
    // A lost context settles pending requestPicks with null and drops the pack buffers, which the restored context can't use.
    {
      const canvas = document.createElement('canvas');
      const r = new PixelRenderer(canvas, scene());
      r.resize(W, H); r.setLook(lookAt(12)); r.placeCamera(new THREE.Vector3(), 0, 0, HEIGHT);
      try {
        const a = r.addObject(geometry); a.snap = false; a.position.set(0, 1, 0);
        r.renderGeometry(0);
        const first = await settle(r, r.requestPickPixel(40, 19), 'before loss');   // its pack buffer is now pooled
        check(first?.object === a, `requestPick before context loss (${first?.object?.id})`);
        const lose = r.renderer.getContext().getExtension('WEBGL_lose_context')!;
        const pending = r.requestPickPixel(40, 19);
        const lostCalls: Pick[] = [];
        r.requestPickPixel(40, 19, (p) => lostCalls.push(p));
        const restored = new Promise((res) => canvas.addEventListener('webglcontextrestored', res, { once: true }));
        lose.loseContext();
        await new Promise((res) => setTimeout(res, 50));
        check(await Promise.race([pending, new Promise((res) => setTimeout(() => res('pending'), 1000))]) === null, 'requestPick pending at context loss');
        check(lostCalls.length === 1 && lostCalls[0] === null, `onPicked pending at context loss: ${lostCalls}`);
        check(r.pickPixel(40, 19) === null && await r.requestPickPixel(40, 19) === null, 'pick after context loss');
        r.requestPickPixel(40, 19, (p) => lostCalls.push(p));
        check(lostCalls.length === 1, 'onPicked in a lost context: called inside requestPick');
        r.collectPicks();
        check(lostCalls.length === 2 && lostCalls[1] === null, `onPicked in a lost context: ${lostCalls}`);
        lose.restoreContext(); await restored;
        r.renderGeometry(0);
        const sync = r.pickPixel(40, 19), after = await settle(r, r.requestPickPixel(40, 19), 'after restore');
        check(sync?.object === a && samePick(after, sync), `requestPick after context restore (${after?.object?.id}, ${sync?.object?.id})`);
        out.push('context loss: pending requests settle with null (onPicked too), picks work again after restore');
      } finally { r.dispose(); }
    }
    geometry.dispose(); box.dispose();

    // Synthetic 3×3 input isolates majority/near-priority selection and same-plane grouping with different ids.
    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
    const texture = (rows: number[][]) => {
      const t = new THREE.DataTexture(new Float32Array(rows.flat()), 3, 3, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
    };
    const resolve = (name: string, sample: (x: number, y: number) => { id: number; flag: number; depth: number; color: number }, expectedId: number, expectedColor: number, S = 3) => {
      const a: number[][] = [], nd: number[][] = [], ids: number[][] = [], shadows: number[][] = [];
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        const s = sample(x, y); a.push([s.color, 0.3, 0.4, s.flag]); nd.push([0, 0, 1, s.depth]);
        ids.push([s.id, 0, 0, 0]); shadows.push([0, 0, 0, 0.625]);
      }
      const inputs = [texture(a), texture(nd), texture(ids), texture(shadows)];
      const material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
        vertexShader: POST_VERT, fragmentShader: RESOLVE_FRAG, uniforms: {
          tAlbedo: { value: inputs[0] }, tNormal: { value: inputs[1] }, tObjectId: { value: inputs[2] }, tShadow: { value: inputs[3] },
          uS: { value: S }, uPolicy: { value: 1 }, uThinOnly: { value: 1 }, uTexel: { value: 0.1 },
          uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uFwd: { value: new THREE.Vector3(0, 0, -1) },
        } });
      const target = new THREE.WebGLRenderTarget(1, 1, { count: 3, type: THREE.FloatType });
      const scene = new THREE.Scene(), plane = new THREE.PlaneGeometry(2, 2);
      scene.add(new THREE.Mesh(plane, material));
      try {
        renderer.setRenderTarget(target); renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
        const shadow = new Float32Array(4), albedo = new Float32Array(4);
        renderer.readRenderTargetPixels(target, 0, 0, 1, 1, shadow, undefined, 2);
        renderer.readRenderTargetPixels(target, 0, 0, 1, 1, albedo, undefined, 0);
        check(shadow[0] === expectedId && close(albedo[0], expectedColor) && close(shadow[3], 0.625),
          `${name}: id=${shadow[0]}, colour=${albedo[0]}, shadow=${shadow[3]}`);
        out.push(name);
      } finally { target.dispose(); plane.dispose(); material.dispose(); inputs.forEach((t) => t.dispose()); }
    };
    try {
      resolve('majority copies off-centre representative', (x) => ({ id: x === 1 ? 11 : x === 0 ? 22 : 33, flag: 1, depth: x === 1 ? 9 : 10, color: x === 1 ? 0.2 : 0.8 }), 22, 0.8);
      resolve('thin near-priority copies foreground representative', (x, y) => ({ id: x === 0 && y !== 1 ? 44 : 55, flag: x === 0 && y !== 1 ? 1.25 : 1, depth: x === 0 && y !== 1 ? 8 : 10, color: x === 0 && y !== 1 ? 0.2 : 0.8 }), 44, 0.2);
      resolve('ids do not split same-colour coplanar surfaces', (x, y) => ({ id: x === 1 && y === 1 ? 16777216 : 66, flag: 1, depth: 10, color: 0.8 }), 16777216, 0.8);
      resolve('S=1 carries id', () => ({ id: 77, flag: 1, depth: 10, color: 0.8 }), 77, 0.8, 1);
      resolve('sky carries zero id', () => ({ id: 0, flag: 0, depth: 0, color: 0 }), 0, 0);
    } finally { renderer.dispose(); }
    return out;
  });
  assert.deepEqual(errors, [], 'No browser or shader errors');
  results.forEach((r) => console.log('PASS:', r));
} finally { await browser.close(); }
