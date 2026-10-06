// Construction-time budgets: default compatibility, custom shader capacities, fluid collection and shadow maps.
// Requires the dev server and pinned browser, like the other renderer checks.
import assert from 'node:assert/strict';
import type { BakedScene as PixelScene, PixelRendererOptions, RendererLimits } from '../src/renderer/index.ts';
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { PixelRenderer, GeometryCollector, FluidCollector, FLUIDS, DEFAULT_LIMITS, LIMITS,
      resolveLimits, DEFAULT_SETTINGS, lookAt, place, FLAG, dayCycle, DEFAULT_DAY_CYCLE, PRESETS, encodeScene, decodeScene } = await import('/src/renderer/index.ts');
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
    const rejects = (run: () => unknown, pattern: RegExp) => {
      try { run(); } catch (e) { check(pattern.test(String(e)), `Unexpected error: ${e}`); return; }
      throw new Error(`Expected rejection matching ${pattern}`);
    };
    // Snapshots of the original default cycle at its main presets; independent of the new keyframe table.
    for (const [hour, expected] of [
      [12, { sunAz: 0, sunEl: 60, sunI: 1, ambient: 0.34, expo: 1, chroma: 1, litTint: [0, 0.008],
        shadeTint: [0.006, -0.026], lampOn: 0, night: 0, skyTop: 0x79b6dc, skyBot: 0xf6e6c2 }],
      [17.5, { sunAz: -60, sunEl: 24, sunI: 1.05, ambient: 0.34, expo: 1.02, chroma: 1.05, litTint: [0.012, 0.032],
        shadeTint: [0.020, -0.054], lampOn: 0.15, night: 0, skyTop: 0x6fa3d8, skyBot: 0xffc78a }],
      [22, { sunAz: -50, sunEl: 38, sunI: 0.34, ambient: 0.30, expo: 0.58, chroma: 0.95, litTint: [-0.006, -0.044],
        shadeTint: [0.012, -0.070], lampOn: 1, night: 1, skyTop: 0x0d1838, skyBot: 0x2b4272 }],
    ] as const) {
      const actual = lookAt(hour), snapshot = { hour, ...expected,
        skyTop: new THREE.Color(expected.skyTop), skyBot: new THREE.Color(expected.skyBot) };
      check(JSON.stringify(actual) === JSON.stringify(snapshot), `Original look snapshot at ${hour}`);
    }
    check(DEFAULT_DAY_CYCLE.presets === PRESETS && DEFAULT_DAY_CYCLE.nearestPreset(19.5) === 'Dusk', 'Default presets stay compatible');
    const keys = [
      { ...DEFAULT_DAY_CYCLE.keys[4], hour: 8, expo: 0, litTint: [0, 0] as [number, number], skyTop: new THREE.Color(0) },
      { ...DEFAULT_DAY_CYCLE.keys[4], hour: 20, expo: 2, litTint: [0.2, 0.4] as [number, number], skyTop: new THREE.Color(0xffffff) },
    ];
    const presets = { First: 8, Last: 20 }, cycle = dayCycle(keys, presets);
    for (const h of [2, 14, 26, -22]) {
      const l = cycle.lookAt(h);
      check(l.expo === 1 && l.litTint[0] === 0.1 && l.skyTop.r === 0.5, `Custom linear colours and midpoint interpolation at ${h}`);
    }
    check(Math.abs(cycle.lookAt(11).expo - 0.3125) < 1e-12, 'Interpolation uses smoothstep between keys');
    const before = JSON.stringify(cycle.lookAt(11));
    keys[0].hour = 20; keys[0].expo = 99; keys[0].litTint[0] = 99; keys[0].skyTop.set(0xff0000); keys.reverse(); presets.First = 0;
    check(JSON.stringify(cycle.lookAt(11)) === before && cycle.presets.First === 8, 'Day cycle owns keys, tint tuples, colours and presets');
    const l0 = cycle.lookAt(8); l0.skyTop.set(0xff0000); l0.litTint[0] = 99;
    check(cycle.lookAt(8).skyTop.r === 0 && cycle.lookAt(8).litTint[0] === 0, 'Returned looks do not mutate the cycle');
    for (const hour of [0, 8, 24]) {
      const constant = dayCycle([{ ...DEFAULT_DAY_CYCLE.keys[4], hour }]);
      check(constant.lookAt(-10).expo === 1 && constant.lookAt(30).expo === 1 && constant.nearestPreset(12) === '',
        `Single-key cycle at ${hour} works with no presets`);
    }
    rejects(() => dayCycle([]), /at least one key/);
    rejects(() => dayCycle([{ ...DEFAULT_DAY_CYCLE.keys[4], hour: -1 }]), /outside 0-24/);
    rejects(() => dayCycle([DEFAULT_DAY_CYCLE.keys[4], DEFAULT_DAY_CYCLE.keys[4]]), /not after/);
    const midnight = dayCycle([DEFAULT_DAY_CYCLE.keys[0]], { Midnight: 0, Noon: 12 });
    for (const h of [23.5, -0.5, 47.5]) check(midnight.nearestPreset(h) === 'Midnight', `Preset names wrap at ${h}`);
    for (const hour of [-1, 25, NaN, Infinity]) rejects(() => dayCycle([DEFAULT_DAY_CYCLE.keys[0]], { Bad: hour }), /preset.*0.?24/i);
    check(LIMITS === DEFAULT_LIMITS && Object.isFrozen(DEFAULT_LIMITS), 'Default limits retain the alias and are immutable');
    const partial = { lamps: 2 }, limits = resolveLimits(partial);
    partial.lamps = 10;
    check(limits.lamps === 2 && limits.grooves === 8 && Object.isFrozen(limits), 'Resolved limits merge defaults and copy inputs');
    for (const key of Object.keys(DEFAULT_LIMITS) as (keyof RendererLimits)[]) {
      for (const value of [0, -1, 1.5, NaN, Infinity, 1e9]) {
        rejects(() => resolveLimits({ [key]: value }), /must be a positive integer/);
      }
    }

    const box = new THREE.BoxGeometry(1, 1, 1), pool = new THREE.PlaneGeometry(1, 1);
    const small = { lamps: 2, grooves: 2, fluidMaterials: 2, fluidSources: 2 };
    const minimum = { lamps: 1, grooves: 1, fluidMaterials: 1, fluidSources: 1 };
    const large = { lamps: 65, grooves: 10, fluidMaterials: 10, fluidSources: 10 };
    const scene = (budget: RendererLimits, fluids = true): PixelScene => {
      const s = new GeometryCollector();
      s.add(box, place(0, -0.15, 0, 0, 0, 0, 14, 0.3, 6), [0.5, 0.4, 0.3], FLAG.GROOVED);
      const f = new FluidCollector(budget);
      if (fluids) for (let i = 0; i < budget.fluidMaterials; i++) {
        f.add(pool, place((i - (budget.fluidMaterials - 1) / 2) * 1.2, 0.2, 0, -Math.PI / 2),
          { ...FLUIDS.water, deep: 0x203040 + i * 0x030100 });
      }
      if (fluids) for (let i = 0; i < budget.fluidSources; i++) f.source(i - 1, 0, { radius: 0.5 });
      return { staticGeometry: s.build(), dynamicGeometry: new GeometryCollector().build(), fluids: f.build(),
        lamps: Array.from({ length: budget.lamps }, (_, i) => ({ position: new THREE.Vector3(i - 1, 2, 0), color: [1, 0.5, 0.2], radius: 3 })),
        grooves: { axis: [1, 0, 0], positions: Array.from({ length: budget.grooves }, (_, i) => i * 0.3 - 1), yRange: [-1, 1] },
        shadow: { center: new THREE.Vector3(), radius: 15 }, stats: { triangles: 0, paletteColors: 0 } };
    };
    const discardScene = (s: PixelScene) => { s.staticGeometry.dispose(); s.dynamicGeometry.dispose(); s.fluids.geometry.dispose(); };
    const { testChart } = await import('/src/scenes/test-chart/index.ts');
    const originalPalette = testChart.paletteSize;
    try {
      testChart.paletteSize = 4;
      const defaultScene = await testChart.build(), overriddenScene = await testChart.build(12);
      try {
        check(defaultScene.stats.paletteColors === 4 && overriddenScene.stats.paletteColors === 12,
          'Scene palette default and explicit build override both reach quantization');
      } finally { discardScene(defaultScene); discardScene(overriddenScene); }
    } finally { testChart.paletteSize = originalPalette; }
    const make = (s: PixelScene, options?: PixelRendererOptions) => {
      const r = new PixelRenderer(document.createElement('canvas'), s, options);
      r.resize(128, 96); r.placeCamera(new THREE.Vector3(), 0, 0.7, 12); r.setLook(lookAt(22));
      return r;
    };
    const draw = (r: InstanceType<typeof PixelRenderer>) => {
      r.renderGeometry(8); r.renderStyle(DEFAULT_SETTINGS, 8);
      const pixels = new Uint8Array(128 * 96 * 4), gl = r.renderer.getContext();
      gl.readPixels(0, 0, 128, 96, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      check(gl.getError() === gl.NO_ERROR, 'Custom shader draw has no GL error');
      check(pixels.some((v, i) => i % 4 !== 3 && v > 0), 'Draw produces colour pixels');
      return pixels;
    };
    const minimalGeometry = new GeometryCollector(); minimalGeometry.add(box, null, [0.5, 0.3, 0.1]);
    const minimalScene = { staticGeometry: minimalGeometry.build(), shadow: { center: new THREE.Vector3(), radius: 4 } };
    const decodedMinimal = decodeScene(encodeScene(minimalScene));
    check(decodedMinimal.dynamicGeometry.attributes.position.count === 0 && decodedMinimal.fluids.geometry.attributes.position.count === 0 &&
      decodedMinimal.lamps.length === 0 && decodedMinimal.grooves === null, 'Minimal scenes bake with empty optional fields');
    const minimalRenderer = new PixelRenderer(document.createElement('canvas'), minimalScene, { shadowMapSize: 128, limits: small });
    try {
      minimalRenderer.resize(128, 96); minimalRenderer.placeCamera(new THREE.Vector3(), 0, 0.7, 4); minimalRenderer.setLook(lookAt(12));
      const expected = draw(minimalRenderer);
      minimalRenderer.renderStyle(8);
      const actual = new Uint8Array(expected.length), gl = minimalRenderer.renderer.getContext();
      gl.readPixels(0, 0, 128, 96, gl.RGBA, gl.UNSIGNED_BYTE, actual);
      check(expected.every((v, i) => actual[i] === v), 'renderStyle(time) matches explicit default settings');
    } finally {
      minimalRenderer.dispose(); discardScene(decodedMinimal);
      for (const t of [decodedMinimal.maps!.fluids.texture, decodedMinimal.maps!.fluids.height,
        decodedMinimal.maps!.windows.texture, decodedMinimal.maps!.windows.source]) t.dispose();
    }
    const a = make(scene(small)), b = make(scene(small), { limits: { ...DEFAULT_LIMITS }, supersample: 3,
      shadowMapSize: 4096, objectShadowMapSize: 4096, resolvePolicy: 1, resolveThinOnly: true });
    try {
      const pa = draw(a), pb = draw(b);
      check(pa.every((v, i) => v === pb[i]), 'Explicit defaults match the original constructor byte for byte');
    } finally { a.dispose(); b.dispose(); }

    const out: Record<string, unknown> = {};
    for (const [name, budget, ss] of [['minimum', minimum, 1], ['reduced', small, 1], ['raised', large, 3]] as const) {
      const options: PixelRendererOptions = { limits: { ...budget }, supersample: ss, shadowMapSize: 256,
        objectShadowMapSize: 128, resolvePolicy: 0, resolveThinOnly: false };
      const r = make(scene(budget), options), local = new GeometryCollector();
      local.add(box, null, [0.8, 0.2, 0.1]); const geometry = local.build();
      try {
        options.limits!.lamps = 99;
        check(r.limits.lamps === budget.lamps && Object.isFrozen(r.limits), 'Renderer takes an immutable limits snapshot');
        r.addObject(geometry).position.set(0, 1, 0);
        const pixels = draw(r);
        check(r['gbufHi'].width === 128 * ss, 'Supersample constructor option sets G-buffer allocation');
        check(r['resolveMat'].uniforms.uPolicy.value === 0 && r['resolveMat'].uniforms.uThinOnly.value === 0,
          'Resolve constructor options reach the resolve pass');
        check(r.light.shadow.map!.width === 256 && r['objectLight']!.shadow.map!.width === 128,
          'Independent sun/object shadow options set actual GPU allocations');
        const u = r['postMat'].uniforms;
        check(u.uLamp.value.length === budget.lamps && u.uGrooves.value.length === budget.grooves &&
          u.uFluidA.value.length === budget.fluidMaterials && u.uSources.value.length === budget.fluidSources,
          'Uniform uploads use the instance capacities');
        const fluidPixels = new Float32Array(128 * 96 * 4);
        r.renderer.readRenderTargetPixels(r['fluidBuf']!, 0, 0, 128, 96, fluidPixels, undefined, 1);
        check(fluidPixels.some((v, i) => i % 4 === 3 && v === budget.fluidMaterials), 'Highest fluid material slot is visible');
        r.pixelScene.lamps.forEach((l) => l.color.fill(0));
        u.uLampCol.value.forEach((v: { setScalar(n: number): void }) => v.setScalar(0));
        const unlit = draw(r);
        check(pixels.some((v, i) => v !== unlit[i]), 'Custom-capacity lamps affect the rendered image');
        out[name] = { budget, supersample: ss, sunMap: 256, objectMap: 128 };
      } finally { r.dispose(); geometry.dispose(); }
    }
    const fallback = make(scene(small, false), { shadowMapSize: 128 });
    const local = new GeometryCollector(); local.add(box, null, [0.5, 0.5, 0.5]); const geometry = local.build();
    try {
      fallback.addObject(geometry); draw(fallback);
      check(fallback['objectLight']!.shadow.map!.width === 128, 'Object map inherits a custom sun-map budget');
    } finally { fallback.dispose(); geometry.dispose(); }

    const invalid = scene(small);
    try {
      rejects(() => new PixelRenderer(document.createElement('canvas'), invalid, { limits: { lamps: 4096 } }),
        /fragment uniform vectors.*GPU supports/);
      // Invalid capacities must reject before any WebGL context or renderer resources are allocated.
      const canvas = document.createElement('canvas');
      canvas.getContext = (() => { throw new Error('Unexpected WebGL allocation'); }) as typeof canvas.getContext;
      for (const key of Object.keys(small) as (keyof RendererLimits)[]) {
        rejects(() => new PixelRenderer(canvas, invalid, { limits: { [key]: 1 } }), new RegExp(`Scene ${key}`));
      }
      for (const options of [{ shadowMapSize: 0 }, { objectShadowMapSize: -1 }, { supersample: 2 } as unknown as PixelRendererOptions,
        { resolvePolicy: 1.5 }, { resolvePolicy: 9 }]) {
        rejects(() => new PixelRenderer(canvas, invalid, options), /must be/);
      }
    } finally { discardScene(invalid); }
    const f = new FluidCollector({ fluidMaterials: 1, fluidSources: 1 });
    f.add(pool, null, FLUIDS.water); f.add(pool, null, { ...FLUIDS.water });
    rejects(() => f.add(pool, null, FLUIDS.acid), /At most 1 different fluid materials/);
    f.source(0, 0); rejects(() => f.source(1, 1), /At most 1 fluid sources/);
    f.build().geometry.dispose(); box.dispose(); pool.dispose();
    return out;
  });
  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.log('PASS: day cycles, default compatibility, immutable/validated limits, custom fluid/lamp shaders, resolve and GPU map sizes.', result);
} finally { await browser.close(); }
