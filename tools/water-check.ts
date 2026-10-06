// Fluid map and rendered reflection / flow regressions. Requires the dev server.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import type { BufferGeometry, Vector3 } from 'three';
import type { FluidCollector as Fluids, RGB } from '../src/renderer/index.ts';
import type { FluidMap } from '../src/renderer/fluidMap.ts';
import { launch, newPage, open, writePng } from './lib.ts';

// Kept as one browser function so the same probes can run in a browser preview during development.
export async function waterChecks() {
  const T = await import('/node_modules/three/build/three.module.js');
  const { FluidCollector, FLUIDS, GeometryCollector, PixelRenderer, FLAG, flip } = await import('/src/renderer/index.ts');
  const { buildFluidMap } = await import('/src/renderer/fluidMap.ts');
  const { lookAt } = await import('/src/renderer/look.ts');
  const maps: FluidMap[] = [], geometries: BufferGeometry[] = [];
  const build = (f: Fluids, g = new GeometryCollector()) => {
    const fluid = f.build(), solid = g.build(); geometries.push(fluid.geometry, solid);
    const m = buildFluidMap(fluid, solid); maps.push(m); return m;
  };
  const pool = (flow: [number, number] = [0, 0], width = 8, depth = 4) => {
    const f = new FluidCollector(); f.add(new T.PlaneGeometry(width, depth).rotateX(-Math.PI / 2), null, FLUIDS.water, flow); return f;
  };
  const decoded = (m: FluidMap) => Array.from(m.texture.image.data as Uint16Array, (v) => T.DataUtils.fromHalfFloat(v));
  const sample = (m: FluidMap, x: number, z: number) => {
    const { width, height, data } = m.texture.image, [x0, z0, x1, z1] = m.bounds;
    const ix = Math.max(0, Math.min(width - 1, Math.floor((x - x0) / (x1 - x0) * width)));
    const iz = Math.max(0, Math.min(height - 1, Math.floor((z - z0) / (z1 - z0) * height)));
    const i = iz * width + ix;
    return { rgba: Array.from((data as Uint16Array).slice(i * 4, i * 4 + 4), (v) => T.DataUtils.fromHalfFloat(v)), height: m.height.image.data[i] };
  };
  const solids = new GeometryCollector();
  solids.add(new T.BoxGeometry(1, 2, 1), null, [.3, .3, .3]);
  solids.add(new T.BoxGeometry(1, 1, 4).translate(2, 2, 0), null, [.3, .3, .3]);
  const pier = new GeometryCollector(); pier.add(new T.BoxGeometry(1, 2, 1), null, [.3, .3, .3]);
  const obstacle = build(pool([1, 0]), solids), bridgeControl = build(pool([1, 0]), pier);
  const cavityGeometry = new T.BoxGeometry(8, 2, 4).toNonIndexed(); flip(cavityGeometry);
  const cavitySolids = new GeometryCollector(); cavitySolids.add(cavityGeometry, null, [.3, .3, .3]);
  cavitySolids.add(new T.BoxGeometry(1, 2, 1), null, [.3, .3, .3]);
  const cavity = build(pool([1, 0]), cavitySolids); cavityGeometry.dispose();
  const smallCavityGeometry = new T.BoxGeometry(2, 2, 2).toNonIndexed(); flip(smallCavityGeometry);
  const smallCavitySolids = new GeometryCollector(); smallCavitySolids.add(smallCavityGeometry, null, [.3, .3, .3]);
  const exteriorCavity = build(pool([1, 0]), smallCavitySolids); smallCavityGeometry.dispose();
  const hollowSolids = new GeometryCollector(); hollowSolids.add(new T.BoxGeometry(4, 2, 3), null, [.3, .3, .3]);
  const inner = new T.BoxGeometry(2, 2, 1.5).toNonIndexed(); flip(inner); hollowSolids.add(inner, null, [.3, .3, .3]); inner.dispose();
  const hollow = build(pool([1, 0]), hollowSolids);
  const overlappingSolids = new GeometryCollector();
  for (const x of [-.5, .5]) overlappingSolids.add(new T.BoxGeometry(2, 2, 1.5).translate(x, 0, 0), null, [.3, .3, .3]);
  const overlapping = build(pool([1, 0]), overlappingSolids);
  const straddlingSolids = new GeometryCollector();
  const inward = new T.BoxGeometry(2, 2, 2).toNonIndexed(); flip(inward);
  straddlingSolids.add(inward, null, [.3, .3, .3]); inward.dispose();
  straddlingSolids.add(new T.BoxGeometry(1.5, 2, 1).translate(1.25, 0, 0), null, [.3, .3, .3]);
  const straddling = build(pool([1, 0]), straddlingSolids);
  const twoCavitySolids = new GeometryCollector();
  for (const x of [-2, 2]) {
    const g = new T.BoxGeometry(1, 2, 2).translate(x, 0, 0).toNonIndexed(); flip(g);
    twoCavitySolids.add(g, null, [.3, .3, .3]); g.dispose();
  }
  const twoCavities = build(pool([1, 0]), twoCavitySolids);
  const nestedSolids = new GeometryCollector();
  for (const [width, depth, reversed] of [[6, 3.5, false], [4, 2.5, true], [2, 1.5, false], [.8, .8, true]] as [number, number, boolean][]) {
    const g = new T.BoxGeometry(width, 2, depth).toNonIndexed(); if (reversed) flip(g);
    nestedSolids.add(g, null, [.3, .3, .3]); g.dispose();
  }
  const nested = build(pool([1, 0]), nestedSolids);
  const openSolids = new GeometryCollector(); openSolids.add(new T.PlaneGeometry(4, 2).rotateY(Math.PI / 2), null, [.3, .3, .3]);
  const openWall = build(pool([1, 0]), openSolids);
  const touchingSolids = new GeometryCollector();
  for (const x of [-1, 1]) touchingSolids.add(new T.BoxGeometry(2, 2, 1.5).translate(x, 0, 0), null, [.3, .3, .3]);
  const touching = build(pool([1, 0]), touchingSolids);
  const duplicateSolids = new GeometryCollector();
  for (let i = 0; i < 2; i++) duplicateSolids.add(new T.BoxGeometry(2, 2, 1.5), null, [.3, .3, .3]);
  const duplicate = build(pool([1, 0]), duplicateSolids);
  const vertexSolids = new GeometryCollector(); vertexSolids.add(new T.BoxGeometry(2, 2, 1.5).translate(0, 1, 0), null, [.3, .3, .3]);
  const vertexSlice = build(pool([1, 0]), vertexSolids);
  const calm = build(pool());
  const sourceFluid = pool(); sourceFluid.source(1, 0, { radius: .6, strength: .8 }); const source = build(sourceFluid);
  const fallFluid = pool(); fallFluid.add(new T.PlaneGeometry(.2, 1).translate(1, .5, 0), null, FLUIDS.water); const fall = build(fallFluid);
  const submergedFluid = pool(); submergedFluid.add(new T.PlaneGeometry(.2, 1).translate(1, 0, 0), null, FLUIDS.water);
  submergedFluid.add(new T.PlaneGeometry(.2, .2).rotateX(-Math.PI / 2).translate(1, 2, 0), null, FLUIDS.water);
  const submerged = build(submergedFluid);
  const stackedFluid = pool(); stackedFluid.add(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 2, 0), null, FLUIDS.water); const stacked = build(stackedFluid);
  const scopedFluid = pool();
  scopedFluid.add(new T.PlaneGeometry(2, 2).rotateX(-Math.PI / 2).translate(0, .2, 0), null, FLUIDS.water);
  scopedFluid.source(0, 0, { y: 0, radius: 2, strength: 1 });
  const scoped = build(scopedFluid);
  const unscopedFluid = pool();
  unscopedFluid.add(new T.PlaneGeometry(2, 2).rotateX(-Math.PI / 2).translate(0, .2, 0), null, FLUIDS.water);
  unscopedFluid.source(0, 0, { radius: 2, strength: 1 });
  const unscoped = build(unscopedFluid);
  const empty = build(new FluidCollector()), big = build(pool([1, 0], 2000, 2));
  const separatedFluid = pool([1, 0], 2, 2);
  separatedFluid.add(new T.PlaneGeometry(2, 2).rotateX(-Math.PI / 2).translate(2.4, 0, 0), null, FLUIDS.water);
  const smallPier = new GeometryCollector(); smallPier.add(new T.BoxGeometry(.6, 2, .6), null, [.3, .3, .3]);
  const separated = build(separatedFluid, smallPier);
  let stillNeighbourTurbulence = 0;
  const { width: nw, height: nh } = separated.texture.image, [nx0, nz0, nx1, nz1] = separated.bounds;
  for (let z = 0; z < nh; z++) for (let x = 0; x < nw; x++) {
    const wx = nx0 + (x + .5) * (nx1 - nx0) / nw, wz = nz0 + (z + .5) * (nz1 - nz0) / nh;
    if (wx > 1.5 && wx < 3.3 && Math.abs(wz) < .9) stillNeighbourTurbulence = Math.max(stillNeighbourTurbulence, sample(separated, wx, wz).rgba[2]);
  }
  const highY = 300.03, highFluid = new FluidCollector();
  highFluid.add(new T.PlaneGeometry(8, 4).rotateX(-Math.PI / 2).translate(0, highY, 0), null, FLUIDS.water, [.75, .25]);
  const high = build(highFluid);
  // Exercise actual texture uploads/sampling without the optional 32-bit float linear extension.
  const gpuCanvas = document.createElement('canvas'), gl = gpuCanvas.getContext('webgl2')!;
  const getExtension = gl.getExtension.bind(gl);
  gl.getExtension = (name: string) => name === 'OES_texture_float_linear' ? null : getExtension(name);
  const gpu = new T.WebGLRenderer({ canvas: gpuCanvas, context: gl });
  const target = new T.WebGLRenderTarget(1, 1), quad = new T.PlaneGeometry(2, 2);
  const mat = new T.ShaderMaterial({
    uniforms: { flow: { value: high.texture }, heightMap: { value: high.height }, expectedY: { value: highY } },
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `uniform sampler2D flow; uniform sampler2D heightMap; uniform float expectedY;
      void main(){vec4 f=texture2D(flow,vec2(0.5)); float h=texture2D(heightMap,vec2(0.5)).r;
      gl_FragColor=vec4(f.r>0.5?1.0:0.0, abs(h-expectedY)<0.01?1.0:0.0, f.g>0.1?1.0:0.0,1.0);}`,
  });
  const gpuScene = new T.Scene(); gpuScene.add(new T.Mesh(quad, mat));
  const gpuPixel = new Uint8Array(4);
  try { gpu.setRenderTarget(target); gpu.render(gpuScene, new T.Camera()); gpu.readRenderTargetPixels(target, 0, 0, 1, 1, gpuPixel); }
  finally { target.dispose(); mat.dispose(); quad.dispose(); gpu.dispose(); }
  const mapStats = {
    upstream: sample(obstacle, -.7, 0), side: sample(obstacle, -.7, .7), downstream: sample(obstacle, 1, 0),
    bridge: sample(obstacle, 2, 0), bridgeControl: sample(bridgeControl, 2, 0),
    cavity: sample(cavity, 2, 0), cavityUpstream: sample(cavity, -.7, 0),
    cavityExterior: [-2, 2, 3].map((x) => sample(exteriorCavity, x, 0)),
    hollowInside: sample(hollow, 0, 0), hollowWall: sample(hollow, 1.5, 0), hollowOutside: sample(hollow, 2.5, 0),
    overlappingInside: sample(overlapping, 0, 0), overlappingOutside: sample(overlapping, 2.5, 0),
    straddlingInside: [.85, 1.25, 1.7].map((x) => sample(straddling, x, 0)),
    straddlingOutside: [-2, 0, 3].map((x) => sample(straddling, x, 0)),
    betweenCavities: sample(twoCavities, 0, 0),
    nested: [0, .75, 1.5, 2.5].map((x) => sample(nested, x, 0)),
    openWall: [-2, 2].map((x) => sample(openWall, x, 0)),
    touching: [-1, 0, 1].map((x) => sample(touching, x, 0)),
    duplicate: sample(duplicate, 0, 0), vertexSlice: sample(vertexSlice, 0, 0),
    submerged: sample(submerged, 1.4, 0), aboveSubmerged: sample(submerged, 1, 0),
    calmTurbulence: Math.max(...decoded(calm).filter((_, i) => i % 4 === 2)),
    source: sample(source, 1, 0), fall: sample(fall, 1, 0), upper: sample(stacked, 0, 0), lower: sample(stacked, 1, 0),
    scopedUpper: sample(scoped, 0, 0), scopedLower: sample(scoped, 1.2, 0), unscopedUpper: sample(unscoped, 0, 0),
    empty: { size: [empty.texture.image.width, empty.texture.image.height], data: decoded(empty), heights: [...empty.height.image.data] },
    high: sample(high, 0, 0), gpuWithoutFloatLinear: [...gpuPixel], stillNeighbourTurbulence,
    big: [big.texture.image.width, big.texture.image.height],
    finite: maps.every((m) => [...decoded(m), ...m.height.image.data].every(Number.isFinite)),
    bounded: maps.every((m) => decoded(m).every((v, i) => i % 4 !== 2 || (v >= 0 && v <= 1))),
  };
  for (const m of maps) { m.texture.dispose(); m.height.dispose(); }
  for (const g of geometries) g.dispose();

  const repeated = new FluidCollector(), unit = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  for (let i = 0; i < 12; i++) repeated.add(unit, null, { ...FLUIDS.water });
  repeated.add(unit, null, { ...FLUIDS.water, clarity: 2 });
  const repeatedBuilt = repeated.build(), materialStats = { equivalentSlots: new Set(Array.from(repeatedBuilt.geometry.getAttribute('aFluid').array).slice(0, 12 * 6)).size, distinctMaterials: repeatedBuilt.materials.length };
  unit.dispose(); repeatedBuilt.geometry.dispose();

  const { propsGallery } = await import('/src/scenes/props/index.ts');
  const gallery = await propsGallery.build();
  const propsStats = { fluidVertices: gallery.fluids.geometry.attributes.position.count, triangles: gallery.stats.triangles };
  for (const g of [gallery.staticGeometry, gallery.dynamicGeometry, gallery.fluids.geometry]) g.dispose();

  // Use the real meadow builder: a synthetic red bed does not catch the base plane occluding this pond.
  const { buildMeadow } = await import('/src/scenes/cookie-co/meadow.ts');
  const { GROUND_Y, POND, pondD } = await import('/src/scenes/cookie-co/layout.ts');
  const { mulberry32 } = await import('/src/scenes/shared/random.ts');
  const meadow = new GeometryCollector(), grass = new GeometryCollector(true), pondFluids = new FluidCollector();
  buildMeadow(meadow, grass, pondFluids, mulberry32(11));
  const meadowGeometry = meadow.build(), grassGeometry = grass.build(), pondGeometry = pondFluids.build().geometry;
  const x = Math.floor(POND.x / .25) * .25 + .125, z = Math.floor(POND.z / .25) * .25 + .125;
  const material = new T.MeshBasicMaterial(), mesh = new T.Mesh(meadowGeometry, material);
  const ray = new T.Raycaster(new T.Vector3(x, GROUND_Y + 2, z), new T.Vector3(0, -1, 0));
  const hit = ray.intersectObject(mesh)[0];
  const pondBed = { hitY: hit?.point.y ?? null, expectedY: GROUND_Y - .12 - .4 * (1 - pondD(x, z)), oldPlaneY: GROUND_Y - .1 };
  for (const g of [meadowGeometry, grassGeometry, pondGeometry]) g.dispose(); material.dispose();

  const settings = { outlines: false, dither: false, cleanup: false, clouds: false, contacts: false, glow: false, vignette: false };
  const W = 160, H = 160, V = 8;
  type Options = { bedY?: number; bedColor?: RGB; markerHeight?: number; markerZ?: number; occluder?: boolean; sheet?: boolean; poolY?: number;
    reflectivity?: number; clarity?: number; foamAmount?: number; sourceStrength?: number; sourceRings?: boolean; sourceY?: number };
  // `png` and `pixels` are deleted once used, to keep the result that crosses back to Node small.
  type Shot = { expected: number[]; bounds: number[]; center: number[]; red: number; outside: number; centerPixel: number[]; png?: string; pixels?: number[] };
  const render = (roughness = 0, az = 0, el = .6, time = 8, flow: [number, number] = [0, 0], withMarker = true, options: Options = {}): Shot => {
    const s = new GeometryCollector(), f = new FluidCollector();
    s.add(new T.PlaneGeometry(12, 12).rotateX(-Math.PI / 2).translate(0, options.bedY ?? -1, 0), null, options.bedColor ?? [.02, .02, .02]);
    const rotation = new T.Matrix4().makeRotationY(az);
    const markerHeight = options.markerHeight ?? 1, markerZ = options.markerZ ?? -2;
    if (withMarker) s.add(new T.PlaneGeometry(.6, markerHeight).translate(0, 2, markerZ), rotation, [1, .01, .01], FLAG.EMISSIVE);
    if (options.occluder) s.add(new T.BoxGeometry(1.2, .8, 2).translate(0, .2, -2 + 2 / Math.tan(el)), rotation, [.3, .3, .3]);
    const surface = new T.PlaneGeometry(12, 12); if (!options.sheet) surface.rotateX(-Math.PI / 2);
    surface.translate(0, options.poolY ?? 0, 0);
    f.add(surface, null,
      { ...FLUIDS.water, shallow: 0x101820, deep: 0x101820, roughness, reflectivity: options.reflectivity ?? 1,
        clarity: options.clarity ?? .01, foamAmount: options.foamAmount ?? 0, foam: 0xff0000 }, flow);
    if (options.sourceStrength) f.source(0, 0, { radius: 1.5, strength: options.sourceStrength, rings: options.sourceRings ?? false, y: options.sourceY });
    const scene = { staticGeometry: s.build(), dynamicGeometry: new GeometryCollector(true).build(), fluids: f.build(), lamps: [], grooves: null,
      shadow: { center: new T.Vector3(), radius: 8 }, stats: { triangles: 0, paletteColors: 2 } };
    const pr = new PixelRenderer(document.createElement('canvas'), scene);
    try {
      pr.supersample = 1; pr.resize(W, H); pr.placeCamera(new T.Vector3(), az, el, V); pr.setLook(lookAt(12));
      pr.renderGeometry(time); pr.renderStyle(settings, time);
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(pr.canvas, 0, 0);
      const pixels = ctx.getImageData(0, 0, W, H).data;
      const project = (p: Vector3) => { const q = p.applyMatrix4(rotation).project(pr.camera); return [(q.x + 1) * W / 2, (1 - q.y) * H / 2]; };
      const expected = project(new T.Vector3(0, -2, markerZ));
      const corners = [-.3, .3].flatMap((x) => [-2 + markerHeight / 2, -2 - markerHeight / 2].map((y) => project(new T.Vector3(x, y, markerZ))));
      const bounds = [Math.min(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[1]))];
      const red: [number, number][] = [];
      for (let y = Math.max(0, Math.floor(bounds[2] - 12)); y <= Math.min(H - 1, Math.ceil(bounds[3] + 12)); y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (pixels[i] > pixels[i + 1] * 1.7 && pixels[i] > pixels[i + 2] * 1.7 && pixels[i] > 60) red.push([x, y]);
      }
      const center = red.length ? [red.reduce((a, p) => a + p[0] + .5, 0) / red.length, red.reduce((a, p) => a + p[1] + .5, 0) / red.length] : [0, 0];
      const outside = red.filter(([x, y]) => x + .5 < bounds[0] - 1 || x + .5 > bounds[1] + 1 || y + .5 < bounds[2] - 1 || y + .5 > bounds[3] + 1).length;
      return { expected, bounds, center, red: red.length, outside, centerPixel: [...pixels.slice((100 * W + 80) * 4, (100 * W + 80) * 4 + 3)],
        png: canvas.toDataURL('image/png'), pixels: [...pixels] };
    } finally { pr.dispose(); }
  };
  const reflections: (Shot & { az: number; el: number })[] = [];
  for (const [az, el] of [[0, .4], [0, .6], [Math.PI / 3, .6], [Math.PI * .75, .85]]) {
    const r = render(0, az, el); delete r.pixels; reflections.push({ az, el, ...r });
  }
  const rough = render(.85), mirror = render(), miss = render(0, 0, .6, 8, [0, 0], false);
  const thin = render(0, 0, .6, 8, [0, 0], true, { markerHeight: .08, markerZ: -4 });
  const occluded = render(0, 0, .6, 8, [0, 0], true, { occluder: true });
  const foaming = render(0, 0, .6, 8, [0, 0], false, { reflectivity: 0, foamAmount: .6, sourceStrength: 1 });
  const noFoam = render(0, 0, .6, 8, [0, 0], false, { reflectivity: 0, foamAmount: .6 });
  const clear = render(0, 0, .6, 8, [0, 0], false, { reflectivity: 0, clarity: 10, bedColor: [1, .01, .01] });
  const opaque = render(0, 0, .6, 8, [0, 0], false, { reflectivity: 0, clarity: .01, bedColor: [1, .01, .01] });
  const movingA = render(.3, 0, .6, 8, [.5, 0], false), movingB = render(.3, 0, .6, 8.5, [.5, 0], false), movingAgain = render(.3, 0, .6, 8, [.5, 0], false);
  const diff = (a: Shot, b: Shot) => a.pixels!.filter((v, i) => i % 4 !== 3 && v !== b.pixels![i]).length;
  type Shift = { shift: number; error: number };
  const animation = { changed: diff(movingA, movingB), repeat: diff(movingA, movingAgain) } as { changed: number; repeat: number; advection: Shift[]; reverse: Shift[] };
  const ringOptions = { reflectivity: 0, sourceStrength: 1 };
  const ringsOn = render(0, 0, .6, 2.5, [0, 0], false, { ...ringOptions, sourceRings: true });
  const ringsOff = render(0, 0, .6, 2.5, [0, 0], false, { ...ringOptions, sourceRings: false });
  const sourceRings = { changed: diff(ringsOn, ringsOff) }; delete ringsOn.pixels; delete ringsOff.pixels;
  const upperOptions = { reflectivity: 0, foamAmount: .6, poolY: .2, sourceRings: true };
  const upperControl = render(0, 0, .6, 2.5, [0, 0], false, upperOptions);
  const upperWrongSource = render(0, 0, .6, 2.5, [0, 0], false, { ...upperOptions, sourceY: 0, sourceStrength: 1 });
  const upperRightSource = render(0, 0, .6, 2.5, [0, 0], false, { ...upperOptions, sourceY: .2, sourceStrength: 1 });
  const sheetOptions = { reflectivity: 0, foamAmount: .6, sheet: true, sourceRings: true };
  const sheetControl = render(0, 0, .6, 2.5, [0, 0], false, sheetOptions);
  const sheetSource = render(0, 0, .6, 2.5, [0, 0], false, { ...sheetOptions, sourceY: 0, sourceStrength: 1 });
  const sourceScope = { wrongHeight: diff(upperControl, upperWrongSource), rightHeight: diff(upperControl, upperRightSource), sheet: diff(sheetControl, sheetSource) };
  for (const r of [upperControl, upperWrongSource, upperRightSource, sheetControl, sheetSource]) delete r.pixels;
  const advection = (first: Shot, second: Shot) => {
    const shifts: Shift[] = [];
    for (let shift = -10; shift <= 10; shift++) {
      let error = 0;
      for (let y = 75; y < 125; y++) for (let x = 40; x < 120; x++) for (let c = 0; c < 3; c++) {
        const a = first.pixels![(y * W + x) * 4 + c], b = second.pixels![(y * W + x + shift) * 4 + c];
        error += (a - b) ** 2;
      }
      shifts.push({ shift, error });
    }
    return shifts.sort((a, b) => a.error - b.error).slice(0, 3);
  };
  animation.advection = advection(movingA, movingB);
  const reverseA = render(.3, 0, .6, 8, [-.5, 0], false), reverseB = render(.3, 0, .6, 8.5, [-.5, 0], false);
  animation.reverse = advection(reverseA, reverseB);
  for (const r of [rough, mirror, thin, miss, occluded, foaming, noFoam, clear, opaque, movingA, movingB, movingAgain, reverseA, reverseB]) delete r.pixels;
  return { mapStats, materialStats, propsStats, sourceScope, sourceRings, ringsOn, ringsOff, pondBed, reflections, rough, mirror, thin, miss, occluded, foaming, noFoam, clear, opaque, animation };
}

async function main() {
  const output = process.argv[2] ?? 'out/water-check';
  const browser = await launch();
  try {
    const { page, errors } = await newPage(browser, { width: 64, height: 64 });
    await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
    const result = await page.evaluate(waterChecks);
    const m = result.mapStats;
    assert.ok(m.finite && m.bounded, 'Finite maps with bounded turbulence');
    assert.ok(m.upstream.rgba[0] < .35, 'Pier slows upstream flow');
    assert.ok(m.side.rgba[1] > .1, 'Current bends around the pier');
    assert.ok(m.downstream.rgba[2] > .1, 'Pier leaves a downstream wake');
    assert.equal(m.bridge.rgba[0], m.bridgeControl.rgba[0], 'Raised bridge does not block current');
    assert.equal(m.cavity.rgba[0], m.bridgeControl.rgba[0], 'Inward basin walls leave the liquid cavity open');
    assert.equal(m.cavityUpstream.rgba[0], m.upstream.rgba[0], 'A pier inside an inward basin still blocks current');
    assert.ok(m.cavityExterior.every((p) => p.height === 0 && p.rgba[0] > .2), 'Water on both sides of an inward cavity retains map coverage');
    assert.equal(m.hollowInside.height, 0, 'A hollow solid leaves its interior water open');
    assert.equal(m.hollowWall.height, -10000, 'A hollow solid still blocks its wall thickness');
    assert.equal(m.hollowOutside.height, 0, 'Water outside a hollow solid retains coverage');
    assert.equal(m.overlappingInside.height, -10000, 'Overlapping solids remain solid in their shared region');
    assert.equal(m.overlappingOutside.height, 0, 'Overlapping solids do not block exterior water');
    assert.ok(m.straddlingInside.every((p) => p.height === -10000), 'Solid crossing an inward cavity boundary remains solid');
    assert.ok(m.straddlingOutside.every((p) => p.height === 0), 'Crossing solid does not block nearby exterior/cavity water');
    assert.equal(m.betweenCavities.height, 0, 'Separate inward cavities do not create a phantom solid between them');
    assert.deepEqual(m.nested.map((p) => p.height), [0, -10000, 0, -10000], 'Nested ponds belong to the smallest enclosing solid');
    assert.ok(m.openWall.every((p) => p.height === 0), 'Unclosed slice chains cannot fill either side of an open wall');
    assert.ok(m.touching.every((p) => p.height === -10000), 'Touching closed contours retain their solid interiors');
    assert.equal(m.duplicate.height, -10000, 'Coincident solid contours retain their interior');
    assert.equal(m.vertexSlice.height, -10000, 'A slice through mesh vertices stitches a closed footprint');
    assert.ok(m.submerged.rgba[2] > .05, 'A sheet ending underwater stirs the receiving surface at its crossing');
    assert.equal(m.aboveSubmerged.rgba[2], 0, 'A submerged impact cannot disturb a pool above the sheet');
    assert.equal(m.calmTurbulence, 0, 'Still water does not foam from shore distance alone');
    assert.ok(m.source.rgba[2] > .5 && m.fall.rgba[2] > .5, 'Sources and falling sheets disturb their receiving pool');
    assert.equal(m.scopedUpper.rgba[2], 0, 'Source for a lower pool leaves a pool only 0.2m above unstirred');
    assert.ok(m.scopedLower.rgba[2] > .2 && m.unscopedUpper.rgba[2] > .8, 'Scoped source reaches its own height; unspecified height preserves local broadcast');
    assert.equal(m.upper.height, 2, 'Highest overlapping pool owns the map');
    assert.ok(Math.abs(m.lower.height) < 1e-5, 'Lower pool retains its height away from overlap');
    assert.deepEqual(m.empty, { size: [1, 1], data: [0, 0, 0, 0], heights: [-10000] }, 'Empty fluids return valid textures');
    assert.ok(m.big.every((v) => v <= 1024), 'Large geometry has bounded texture dimensions');
    assert.deepEqual(result.materialStats, { equivalentSlots: 1, distinctMaterials: 2 }, 'Equal inline materials reuse one slot; a changed optical value uses another');
    assert.ok(result.propsStats.fluidVertices > 0 && result.propsStats.triangles > 0, 'Real props gallery builds with its routed water mesh');
    assert.ok(Math.abs(m.high.height - 300.03) < .001, 'High pool height keeps precision within the shader gate');
    assert.deepEqual(m.gpuWithoutFloatLinear, [255, 255, 255, 255], 'Map flow and high pool height sample without float-linear support');
    assert.equal(m.stillNeighbourTurbulence, 0, 'Pier wakes cannot jump dry ground into a separate still pool');
    assert.ok(result.pondBed.hitY !== null && result.pondBed.hitY < result.pondBed.oldPlaneY &&
      Math.abs(result.pondBed.hitY - result.pondBed.expectedY) < 1e-5, 'Real pond opaque hit reaches the sandy terrace below the base plane');
    await mkdir(output, { recursive: true });
    for (let i = 0; i < result.reflections.length; i++) {
      const r = result.reflections[i];
      assert.ok(r.red > 50, `Mirror visible at az=${r.az}, el=${r.el}`);
      assert.ok(Math.hypot(r.center[0] - r.expected[0], r.center[1] - r.expected[1]) < 2, 'Reflection matches projected virtual marker');
      assert.ok(r.outside / r.red < .1, 'Calm reflection has a sharp boundary');
      await writePng(`${output}/reflection-${i}.png`, r.png!); delete r.png;
    }
    assert.ok(result.rough.outside / Math.max(1, result.rough.red) > result.mirror.outside / result.mirror.red + .05, 'Rough surface breaks the mirror boundary');
    assert.ok(result.thin.red >= 8 && Math.hypot(result.thin.center[0] - result.thin.expected[0], result.thin.center[1] - result.thin.expected[1]) < 2,
      'Distant one-pixel emitter survives reflection marching');
    assert.equal(result.miss.red, 0, 'SSR miss never invents a red reflection');
    assert.equal(result.occluded.red, 0, 'Solid in front of water hides the reflected marker');
    assert.ok(result.foaming.red > 5 && result.noFoam.red === 0, 'A source renders actual foam with canal foamAmount');
    assert.ok(result.clear.centerPixel[0] > result.opaque.centerPixel[0] + 50, 'Clear fluid reveals the bed; opaque fluid absorbs it');
    assert.ok(result.animation.changed > 100 && result.animation.repeat === 0, 'Flowing ripples animate deterministically');
    assert.ok(result.sourceRings.changed > 10, 'Source ring flag changes visible rings without disabling the disturbance');
    assert.equal(result.sourceScope.wrongHeight, 0, 'Lower source adds no rings, turbulence or foam to an upper rendered pool');
    assert.ok(result.sourceScope.rightHeight > 100, 'Source still visibly stirs a matching rendered pool');
    assert.equal(result.sourceScope.sheet, 0, 'Pool sources cannot alter a falling sheet at the same XZ');
    assert.ok(Math.abs(result.animation.advection[0].shift - 5) <= 2, 'Ripple patterns travel downstream at their authored current');
    assert.ok(Math.abs(result.animation.reverse[0].shift + 5) <= 2, 'Reversing the current reverses ripple travel');
    for (const key of ['rough', 'mirror', 'thin', 'miss', 'occluded', 'foaming', 'noFoam', 'clear', 'opaque', 'ringsOn', 'ringsOff'] as const) { await writePng(`${output}/${key}.png`, result[key].png!); delete result[key].png; }
    assert.deepEqual(errors, [], 'No browser / shader errors');
    await writeFile(`${output}/stats.json`, JSON.stringify(result, null, 2) + '\n');
    console.log(`PASS: fluid map, mirror projection, rough reflection, SSR miss and deterministic animation. ${output}/`);
  } finally { await browser.close(); }
}
if (process.argv[1]?.endsWith('water-check.ts')) await main();
