// Diagnostics (#62): `setProfiling` counters and per-pass GPU timing. Off by default and leaves three untouched; on, it
// counts and times without changing a pixel; GPU timing degrades cleanly without the timer-query extension; the queue of
// frames waiting for results stays bounded. Requires the dev server and the pinned browser, like the other renderer checks.
//   node tools/profiling-check.ts
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { PixelRenderer, GeometryCollector, FluidCollector, place, lookAt } = await import('/src/renderer/index.ts');
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
    const box = new THREE.BoxGeometry(1, 1, 1);
    const g = new GeometryCollector(); g.add(box, null, [0.8, 0.12, 0.07]);
    const geometry = g.build();
    const s = new GeometryCollector(); s.add(box, place(0, -0.1, 0, 0, 0, 0, 24, 0.2, 24), [0.4, 0.4, 0.4]);
    const r = new PixelRenderer(document.createElement('canvas'), {
      staticGeometry: s.build(), dynamicGeometry: new GeometryCollector(true).build(), lamps: [], grooves: null,
      fluids: new FluidCollector().build(), shadow: { center: new THREE.Vector3(), radius: 14 }, stats: { triangles: 0, paletteColors: 0 },
    });
    r.resize(160, 120); r.setLook(lookAt(12)); r.placeCamera(new THREE.Vector3(), 0.6, 0.6, 12);
    const crate = r.addObject(geometry); crate.position.set(1, 0.5, 0);
    const three = r.renderer as unknown as { renderBufferDirect: unknown; shadowMap: { render: unknown } };
    const untouched = { renderBufferDirect: three.renderBufferDirect, shadowRender: three.shadowMap.render };
    const isUntouched = () => three.renderBufferDirect === untouched.renderBufferDirect && three.shadowMap.render === untouched.shadowRender
      && r.renderer.info.autoReset === true;
    const gl = r.renderer.getContext() as WebGL2RenderingContext;
    const image = () => { const out = new Uint8Array(160 * 120 * 4); gl.readPixels(0, 0, 160, 120, gl.RGBA, gl.UNSIGNED_BYTE, out); return out; };
    const frame = (t = 0) => { r.renderGeometry(t); r.renderStyle(t); };
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const out: Record<string, unknown> = {};

    // Off by default: nothing reported and three as it was.
    frame(); frame();
    check(r.frameStats === null && !r.gpuTiming && r.takeGpuTimings().length === 0, 'profiling is off by default');
    check(isUntouched(), 'off leaves three untouched');
    const off = image();

    // Counters: the first frame redraws the shadow maps, a repeat redraws none; picks are counted into the next frame.
    r.setProfiling({ counters: true });
    crate.position.x = 1.5;   // the object shadow map redraws
    frame();
    const first = r.frameStats!;
    check(first.frame === 1 && first.draws > 0 && first.triangles > 0 && first.meshVisits >= 4, `frame 1 counters ${JSON.stringify(first)}`);
    check(first.shadowMapRedraws === 1, `moving an object redraws one shadow map, got ${first.shadowMapRedraws}`);
    crate.position.x = 1;
    frame();
    const still = r.frameStats!;
    r.pickPixel(80, 60); r.pickPixel(10, 10); void r.requestPickPixel(80, 60);
    r.renderStyle(0);
    const styleOnly = r.frameStats!;
    check(still.frame === 2 && still.shadowMapRedraws === 1 && still.picks === 0, `frame 2 counters ${JSON.stringify(still)}`);
    check(styleOnly.frame === 3 && styleOnly.picks === 3 && styleOnly.shadowMapRedraws === 0 && styleOnly.draws < still.draws,
      `renderStyle-only frame with picks ${JSON.stringify(styleOnly)}`);
    frame();
    check(r.frameStats!.shadowMapRedraws === 0, 'an unchanged frame redraws no shadow map');
    check(r.renderer.info.autoReset === false, 'counters count the whole frame');
    // Exactly the same image as with profiling off.
    const on = image();
    check(on.every((v, i) => v === off[i]), 'counters change the image');
    out.counters = { first, still, styleOnly };

    // Without the timer-query extension GPU timing reports unsupported, records nothing, and the counters still work.
    const getExtension = gl.getExtension, real = getExtension.bind(gl) as (name: string) => unknown;
    gl.getExtension = ((name: string) => name === 'EXT_disjoint_timer_query_webgl2' ? null : real(name)) as typeof gl.getExtension;
    r.setProfiling({ counters: true, gpu: true });
    gl.getExtension = getExtension;
    for (let i = 0; i < 3; i++) { frame(); await nextFrame(); }
    check(!r.gpuTiming && r.takeGpuTimings().length === 0 && r.frameStats?.frame === 3, 'no extension: no GPU timing, counters on');

    // Switching off gives three back.
    r.setProfiling(null);
    check(r.frameStats === null && isUntouched(), 'off again restores three');

    // GPU timing where the browser supports it.
    r.setProfiling({ gpu: true });
    out.gpuTiming = r.gpuTiming;
    if (r.gpuTiming) {
      check(r.frameStats === null, 'gpu alone keeps no counters');
      // Frames drawn in one task can't get results back yet: the pending queue stays bounded.
      for (let i = 0; i < 20; i++) frame();
      const pending = (r as unknown as { profiler: { pending: unknown[] } }).profiler.pending.length;
      check(pending === 8, `pending frames bounded at 8, got ${pending}`);
      const timings: ReturnType<typeof r.takeGpuTimings> = [];
      // The crate moves every frame, so every frame redraws the object shadow map.
      for (let i = 0; i < 120 && timings.length < 12; i++) { crate.position.x = 1 + (i % 2) / 2; frame(); await nextFrame(); timings.push(...r.takeGpuTimings()); }
      check(timings.length > 0, 'GPU timings come back');
      for (const t of timings) {
        const sum = Object.values(t.passes).reduce((a, b) => a + b!, 0);
        check(Math.abs(sum - t.total) < 1e-6 && Object.values(t.passes).every((ms) => ms! >= 0), `timing sums ${JSON.stringify(t)}`);
        for (const p of ['gbuffer', 'shadowMask', 'resolve', 'post0', 'cleanup']) check(p in t.passes, `${p} timed in ${JSON.stringify(t)}`);
      }
      check(timings.every((t, i) => i === 0 || t.frame > timings[i - 1].frame), 'timings arrive in frame order');
      // The burst's frames held the crate still; the loop's after the first move it.
      check(timings.filter((t) => t.frame > 21).every((t) => 'shadowMaps' in t.passes), 'a redrawn object shadow map is timed');
      out.timing = timings[timings.length - 1];
      crate.position.x = 1; frame();
      const timed = image();
      check(timed.every((v, i) => v === off[i]), 'GPU timing changes the image');

      const profiler = () => (r as unknown as { profiler: { pending: unknown[]; stack: unknown[] } }).profiler;
      const resumes = async (label: string) => {
        for (let i = 0; i < 120; i++) { frame(); await nextFrame(); if (r.takeGpuTimings().length) return; }
        throw new Error(`${label}: no GPU timings afterwards`);
      };
      // A disjoint report drops every frame still waiting, and timing goes on.
      r.takeGpuTimings(); frame(); frame();
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { GPU_DISJOINT_EXT: number };
      const getParameter = gl.getParameter;
      gl.getParameter = ((p: number) => p === ext.GPU_DISJOINT_EXT ? true : getParameter.call(gl, p)) as typeof gl.getParameter;
      frame();
      gl.getParameter = getParameter;
      check(profiler().pending.length === 1, `disjoint drops the waiting frames (${profiler().pending.length} left)`);
      await resumes('after disjoint');
      // A pass that throws leaves no query running, and timing goes on.
      const three = r.renderer as unknown as { render: (...a: unknown[]) => void };
      const render = three.render;
      let calls = 0;
      three.render = (...a: unknown[]) => { if (++calls === 2) throw new Error('boom'); render.apply(r.renderer, a); };
      let threw = false;
      try { r.renderStyle(0); } catch { threw = true; }
      three.render = render;
      check(threw && profiler().stack.length === 0, 'a throwing pass ends its query');
      frame();
      check(gl.getError() === gl.NO_ERROR, 'no GL error after a throwing pass');
      await resumes('after a throw');
    }
    r.setProfiling(null);
    check(isUntouched(), 'off at the end');

    // A lost and restored context: three makes a new shadow map and info, which the profiler wraps in turn and gives back.
    r.setProfiling({ counters: true, gpu: true });
    const lose = gl.getExtension('WEBGL_lose_context')!;
    const event = (name: string) => new Promise((resolve, reject) => {
      r.canvas.addEventListener(name, resolve, { once: true });
      setTimeout(() => reject(new Error(`no ${name}`)), 10000);
    });
    const lost = event('webglcontextlost'); lose.loseContext(); await lost;
    check(isUntouched(), 'a lost context gives three back');
    await nextFrame();
    const restored = event('webglcontextrestored'); lose.restoreContext(); await restored;
    check(three.shadowMap.render !== untouched.shadowRender && r.renderer.info.autoReset === false, 'the restored context is profiled');
    crate.position.x = 2; frame();
    check(r.frameStats!.shadowMapRedraws >= 1 && r.frameStats!.draws > 0, `counters after a restore ${JSON.stringify(r.frameStats)}`);
    const restoredRender = three.shadowMap.render;
    r.setProfiling(null);
    check(three.shadowMap.render !== restoredRender && three.shadowMap.render !== untouched.shadowRender && r.renderer.info.autoReset === true,
      'off after a restore gives back the new shadow map');
    frame();
    r.dispose();
    return out;
  });
  console.log(JSON.stringify(results));
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
