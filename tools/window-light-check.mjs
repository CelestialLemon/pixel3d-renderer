// Window extraction / map regressions, plus scene counts, build times and top-down debug PNGs.
// Requires the dev server: node tools/window-light-check.mjs [output-directory]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launch, newPage, open, writePng } from './lib.mjs';

const output = process.argv[2] ?? 'out/window-light';
const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { GeometryCollector, PixelRenderer, FLAG, linearColor } = await import('/src/renderer/index.ts');
    const { lookAt } = await import('/src/renderer/look.ts');
    const { buildWindowLight } = await import('/src/renderer/windowLight.ts');
    const { mergeGeometries } = await import('/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js');
    const pane = (x = 0, y = 1, z = 0) => {
      const g = new THREE.PlaneGeometry(1, 1).translate(x, y, z);
      const count = g.attributes.position.count;
      g.setAttribute('aFlag', new THREE.BufferAttribute(new Float32Array(count).fill(FLAG.EMISSIVE), 1));
      g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(Array.from({ length: count }, () => [0.7, 0.3, 0.1]).flat()), 3));
      return g;
    };
    const sample = (map, x, z) => {
      const { width, height, data } = map.texture.image, [x0, z0, x1, z1] = map.bounds;
      const ix = Math.max(0, Math.min(width - 1, Math.floor((x - x0) / (x1 - x0) * width)));
      const iz = Math.max(0, Math.min(height - 1, Math.floor((z - z0) / (z1 - z0) * height)));
      return Array.from(data.slice((iz * width + ix) * 4, (iz * width + ix) * 4 + 4), THREE.DataUtils.fromHalfFloat);
    };
    const maps = [], geometries = [];
    const build = (g, lamps = []) => { geometries.push(g); const m = buildWindowLight(g, lamps); maps.push(m); return m; };
    const indexed = build(pane());
    const separated = build(mergeGeometries([pane(-2), pane(2)]));
    const fixture = build(pane(), [{ position: new THREE.Vector3(0, 1, 0), clearance: 0.45 }]);
    const upward = build(pane().rotateX(-Math.PI / 2));
    const tiny = build(pane().scale(0.1, 0.1, 0.1));
    const collector = new GeometryCollector();
    const source = pane().toNonIndexed(); source.deleteAttribute('uv'); collector.pushPrepared(source);
    collector.add(new THREE.PlaneGeometry(2, 2).translate(0, 1, 0.2), null, linearColor(0x888888));
    const blocked = build(collector.build());
    const belowZero = build(pane(0, -2, 0));
    const empty = build(new GeometryCollector().build());
    const translated = build(pane(120.25, 1, -93.75));
    // At a half-texel rim sample, any of the four filter taps may be empty. Height must remain the
    // original source height while RGB fades; test every mixed-coverage footprint on this isolated pane.
    const rimHeights = [];
    const rimSourceErrors = [];
    const { width: mw, height: mh, data: md } = indexed.texture.image;
    for (let z = 0; z < mh - 1; z++) for (let x = 0; x < mw - 1; x++) {
      const taps = [z * mw + x, z * mw + x + 1, (z + 1) * mw + x, (z + 1) * mw + x + 1];
      const covered = taps.filter((i) => md[i * 4] > 0).length;
      if (covered > 0 && covered < 4) {
        rimHeights.push(taps.reduce((sum, i) => sum + THREE.DataUtils.fromHalfFloat(md[i * 4 + 3]), 0) / 4);
        const [x0, z0, x1, z1] = indexed.bounds, sd = indexed.source.image.data;
        for (const c of [0, 1]) {
          const lo = c === 0 ? x0 : z0, span = c === 0 ? x1 - x0 : z1 - z0, size = c === 0 ? mw : mh;
          const centre = lo + ((c === 0 ? x : z) + 1) * span / size;
          rimSourceErrors.push(Math.abs(centre + taps.reduce((sum, i) => sum + THREE.DataUtils.fromHalfFloat(sd[i * 2 + c]), 0) / 4));
        }
      }
    }
    const sourceErrors = (map) => {
      const { width, height, data } = map.source.image, [x0, z0, x1, z1] = map.bounds;
      let error = 0;
      for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
        const i = z * width + x;
        if (!map.texture.image.data[i * 4]) continue;
        error = Math.max(error,
          Math.abs(x0 + (x + 0.5) * (x1 - x0) / width + THREE.DataUtils.fromHalfFloat(data[i * 2]) - map.panes[0].center.x),
          Math.abs(z0 + (z + 0.5) * (z1 - z0) / height + THREE.DataUtils.fromHalfFloat(data[i * 2 + 1]) - map.panes[0].center.z));
      }
      return error;
    };
    const synthetic = {
      indexed: indexed.panes.length, separated: separated.panes.length, fixture: fixture.panes.length,
      upward: upward.panes.length, tiny: tiny.panes.length, blocked: blocked.panes.length,
      outward: sample(indexed, 0, 0.4), inward: sample(indexed, 0, -0.4), signedHeight: sample(belowZero, 0, 0.4)[3],
      empty: { panes: empty.panes.length, size: [empty.texture.image.width, empty.texture.image.height], data: [...empty.texture.image.data] },
      rimHeights, rimSourceErrors, translatedSourceError: sourceErrors(translated),
      emptySource: [...empty.source.image.data],
    };
    for (const m of maps) { m.texture.dispose(); m.source.dispose(); }
    for (const g of geometries) g.dispose();

    // Actual renderer: a recessed window and the wall around its opening. No lamps, glow or dither can
    // disguise a missing window pool. Compare the same scene with its map enabled and zeroed, preserving
    // emissive geometry and the night look; distant/upper walls and day pixels must remain unchanged.
    const walls = new GeometryCollector(), WALL = [0.32, 0.4, 0.45], UNDERSIDE = [0.25, 0.33, 0.41], W = 128, H = 128;
    const panel = (x, y, z, w, h, color = WALL, flag = FLAG.NORMAL) =>
      walls.add(new THREE.PlaneGeometry(w, h).translate(x, y, z), null, color, flag);
    panel(0, 1, 0, 4, 2); panel(0, 4.5, 0, 4, 3);
    panel(-1.25, 2.5, 0, 1.5, 1); panel(1.25, 2.5, 0, 1.5, 1);
    panel(0, 2.5, -0.17, 1, 1, [1, 0.48, 0.15], FLAG.EMISSIVE);
    walls.add(new THREE.PlaneGeometry(4, 1.5).rotateX(Math.PI / 2).translate(0, 1.9, 0.4), null, UNDERSIDE);
    const scene = { staticGeometry: walls.build(), dynamicGeometry: new GeometryCollector(true).build(), lamps: [], ripples: [], grooves: null,
      shadow: { center: new THREE.Vector3(), radius: 6 }, stats: { triangles: 0, paletteColors: 2 } };
    const pr = new PixelRenderer(document.createElement('canvas'), scene);
    const wallRender = { panes: pr.windowLight.panes.length };
    try {
      pr.supersample = 1; pr.resize(W, H); pr.placeCamera(new THREE.Vector3(0, 3, 0), 0, 0, 6);
      const settings = { outlines: false, dither: false, cleanup: false, clouds: false, contacts: false, glow: false, vignette: false };
      const mapData = pr.windowLight.texture.image.data, original = mapData.slice();
      const capture = (on) => {
        if (on) mapData.set(original); else mapData.fill(0);
        pr.windowLight.texture.needsUpdate = true; pr.renderStyle(settings, 8);
        const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d'); ctx.drawImage(pr.canvas, 0, 0);
        return { pixels: ctx.getImageData(0, 0, W, H).data, png: canvas.toDataURL('image/png') };
      };
      for (const [name, hour] of [['night', 22], ['day', 12]]) {
        pr.setLook(lookAt(hour)); pr.renderGeometry(8);
        const albedo = pr.readAlbedo(), on = capture(true), off = capture(false);
        const stats = { wallPixels: 0, changed: 0, below: 0, above: 0, distant: 0, nonWall: 0 };
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const k = (y * W + x) * 4, j = ((H - 1 - y) * W + x) * 4;
          const isWall = WALL.every((v, c) => Math.abs(albedo[k + c] - v) < 0.001);
          if (isWall) stats.wallPixels++;
          if (![0, 1, 2].some((c) => on.pixels[j + c] !== off.pixels[j + c])) continue;
          stats.changed++;
          if (!isWall) { stats.nonWall++; continue; }
          const wx = pr.camera.position.x + (x + 0.5 - W / 2) * 6 / H;
          const wy = pr.camera.position.y + (y + 0.5 - H / 2) * 6 / H;
          if (wy < 2.5) stats.below++;
          if (wy >= 2.5) stats.above++;
          if (Math.abs(wx) > 1.6 || wy < 0.8) stats.distant++;
        }
        wallRender[name] = stats;
        if (name === 'night') { wallRender.onPng = on.png; wallRender.offPng = off.png; }
      }
      // Look up at the canopy under the window: its downward-facing side must not receive light
      // from a pane above it. From the frontal view above it is back-facing and does not hide the wall.
      pr.setLook(lookAt(22)); pr.placeCamera(new THREE.Vector3(0, 1.9, 0.4), 0, -0.6, 5); pr.renderGeometry(8);
      const albedo = pr.readAlbedo(), on = capture(true), off = capture(false);
      const underside = { pixels: 0, changed: 0 };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 4, j = ((H - 1 - y) * W + x) * 4;
        if (!UNDERSIDE.every((v, c) => Math.abs(albedo[k + c] - v) < 0.001)) continue;
        underside.pixels++;
        if ([0, 1, 2].some((c) => on.pixels[j + c] !== off.pixels[j + c])) underside.changed++;
      }
      wallRender.underside = underside;
    } finally { pr.dispose(); }
    // Two sides of an obstacle in front of the pane: the away face must stay dark even in the pool
    // core, while the side facing the pane must retain useful light. Rotate the whole arrangement to
    // catch axis assumptions. Receivers stop below the emissive pane, avoiding extraction blockers.
    const facing = [];
    for (const [distance, angle, away, slope = false] of [[0.05, 0, true], [0.12, 0, true], [0.35, 0, true], [0.55, 0, true], [0.9, 0, false], [0.12, Math.PI / 4, true], [0.9, Math.PI / 2, false], [0.7, 0, true, true]]) {
      const g = new GeometryCollector(), RECEIVER = [0.29, 0.37, 0.43];
      const transform = new THREE.Matrix4().makeRotationY(angle);
      g.add(new THREE.PlaneGeometry(1, 1).translate(0, 2.5, 0), transform, [1, 0.48, 0.15], FLAG.EMISSIVE);
      const receiver = new THREE.PlaneGeometry(1.2, 1);
      if (slope) receiver.rotateX(-Math.PI / 2 + Math.PI / 15);
      else receiver.rotateY(away ? 0 : Math.PI);
      g.add(receiver.translate(0, slope ? 1.4 : 1.8, distance), transform, RECEIVER);
      const probeScene = { ...scene, staticGeometry: g.build(), dynamicGeometry: new GeometryCollector(true).build() };
      const renderer = new PixelRenderer(document.createElement('canvas'), probeScene);
      try {
        renderer.supersample = 1; renderer.resize(W, H); renderer.setLook(lookAt(22));
        const target = new THREE.Vector3(0, slope ? 1.4 : 1.8, distance).applyMatrix4(transform);
        renderer.placeCamera(target, angle + (away ? 0 : Math.PI), slope ? 0.6 : 0, 3); renderer.renderGeometry(8);
        const albedo = renderer.readAlbedo(), mapData = renderer.windowLight.texture.image.data, original = mapData.slice();
        const capture = (on) => {
          if (on) mapData.set(original); else mapData.fill(0);
          renderer.windowLight.texture.needsUpdate = true;
          renderer.renderStyle({ outlines: false, dither: false, cleanup: false, clouds: false, contacts: false, glow: false, vignette: false }, 8);
          const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
          const ctx = canvas.getContext('2d'); ctx.drawImage(renderer.canvas, 0, 0);
          return ctx.getImageData(0, 0, W, H).data;
        };
        const on = capture(true), off = capture(false);
        // Positive control: move the directional source in front of this receiver while keeping the
        // colour/height map identical. This permits the full pool, equivalent to disabling the gate.
        const sourceData = renderer.windowLight.source.image.data, sourceOriginal = sourceData.slice();
        const front = new THREE.Vector3(0, 0, away ? 10 : -10).applyMatrix4(transform);
        for (let i = 0; i < sourceData.length; i += 2) {
          sourceData[i] = THREE.DataUtils.toHalfFloat(front.x); sourceData[i + 1] = THREE.DataUtils.toHalfFloat(front.z);
        }
        renderer.windowLight.source.needsUpdate = true;
        const control = capture(true);
        sourceData.set(sourceOriginal); renderer.windowLight.source.needsUpdate = true;
        const stats = { distance, angle, away, slope, panes: renderer.windowLight.panes.length, pixels: 0, changed: 0, controlChanged: 0, controlDiff: 0 };
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const k = (y * W + x) * 4, j = ((H - 1 - y) * W + x) * 4;
          if (!RECEIVER.every((v, c) => Math.abs(albedo[k + c] - v) < 0.001)) continue;
          stats.pixels++;
          if ([0, 1, 2].some((c) => on[j + c] !== off[j + c])) stats.changed++;
          if ([0, 1, 2].some((c) => control[j + c] !== off[j + c])) stats.controlChanged++;
          if ([0, 1, 2].some((c) => control[j + c] !== on[j + c])) stats.controlDiff++;
        }
        facing.push(stats);
      } finally { renderer.dispose(); }
    }
    // Thick, flush and slightly proud panes must still light their actual facade with strict facing.
    wallRender.facades = [];
    for (const [recess, strips = false] of [[0.30], [0], [-0.03], [0.12, true]]) {
      const thickGeometry = scene.staticGeometry.clone(), positions = thickGeometry.attributes.position, flags = thickGeometry.attributes.aFlag;
      for (let i = 0; i < positions.count; i++) if (Math.round(flags.getX(i)) === FLAG.EMISSIVE) positions.setZ(i, -recess);
      let geometry = thickGeometry;
      if (strips) {
        // Keep only the surrounding walls/canopy; replace the full pane with disconnected glass strips.
        const keep = [];
        for (let i = 0; i < positions.count; i++) if (Math.round(flags.getX(i)) !== FLAG.EMISSIVE) keep.push(i);
        geometry = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(thickGeometry.attributes)) {
          const data = new Float32Array(keep.length * attr.itemSize);
          for (let i = 0; i < keep.length; i++) for (let c = 0; c < attr.itemSize; c++) data[i * attr.itemSize + c] = attr.array[keep[i] * attr.itemSize + c];
          geometry.setAttribute(name, new THREE.BufferAttribute(data, attr.itemSize));
        }
        const collector = new GeometryCollector(); collector.pushPrepared(geometry);
        for (const x of [-0.3, 0, 0.3]) collector.add(new THREE.PlaneGeometry(0.25, 1).translate(x, 2.5, -recess), null, [1, 0.48, 0.15], FLAG.EMISSIVE);
        geometry = collector.build(); thickGeometry.dispose();
      }
      const thick = new PixelRenderer(document.createElement('canvas'), { ...scene, staticGeometry: geometry, dynamicGeometry: new GeometryCollector(true).build() });
      try {
        thick.supersample = 1; thick.resize(W, H); thick.setLook(lookAt(22)); thick.placeCamera(new THREE.Vector3(0, 3, 0), 0, 0, 6); thick.renderGeometry(8);
        const albedo = thick.readAlbedo(), data = thick.windowLight.texture.image.data;
        const read = () => {
          thick.renderStyle({ outlines: false, dither: false, cleanup: false, clouds: false, contacts: false, glow: false, vignette: false }, 8);
          const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
          const ctx = canvas.getContext('2d'); ctx.drawImage(thick.canvas, 0, 0); return ctx.getImageData(0, 0, W, H).data;
        };
        const on = read(); data.fill(0); thick.windowLight.texture.needsUpdate = true; const off = read();
        const stats = { recess, strips, panes: thick.windowLight.panes.length, sourceZ: thick.windowLight.panes[0]?.source.z, pixels: 0, changed: 0 };
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const k = (y * W + x) * 4, j = ((H - 1 - y) * W + x) * 4;
          if (!WALL.every((v, c) => Math.abs(albedo[k + c] - v) < 0.001)) continue;
          stats.pixels++;
          if ([0, 1, 2].some((c) => on[j + c] !== off[j + c])) stats.changed++;
        }
        wallRender.facades.push(stats);
      } finally { thick.dispose(); }
    }
    const scenes = [];
    for (const [path, key] of [['cookie-co', 'cookieCo'], ['test-chart', 'testChart'], ['village', 'village']]) {
      const scene = await (await import(`/src/scenes/${path}/index.ts`))[key].build();
      const before = scene.lamps.length, start = performance.now();
      const map = buildWindowLight(scene.staticGeometry, scene.lamps), ms = performance.now() - start;
      const { width, height, data } = map.texture.image;
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'), img = ctx.createImageData(width, height);
      let finite = true, peak = 0, litTexels = 0;
      for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
        const i = (z * width + x) * 4, dest = ((height - 1 - z) * width + x) * 4;
        const rgba = Array.from(data.slice(i, i + 4), THREE.DataUtils.fromHalfFloat);
        finite &&= rgba.every(Number.isFinite);
        const strength = Math.max(...rgba.slice(0, 3)); peak = Math.max(peak, strength);
        if (strength > 0) litTexels++;
        for (let c = 0; c < 3; c++) img.data[dest + c] = Math.round(255 * Math.sqrt(rgba[c]));
        img.data[dest + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      scenes.push({ scene: path, panes: map.panes.length, ms, width, height, bounds: map.bounds, before, after: scene.lamps.length,
        finite, peak, litTexels, sourceFinite: Array.from(map.source.image.data, THREE.DataUtils.fromHalfFloat).every(Number.isFinite),
        sourceSize: [map.source.image.width, map.source.image.height], debugPng: canvas.toDataURL('image/png') });
      map.texture.dispose(); map.source.dispose(); scene.staticGeometry.dispose(); scene.dynamicGeometry.dispose();
    }
    return { synthetic, wallRender, facing, scenes };
  });
  const s = result.synthetic;
  assert.equal(s.indexed, 1, 'Indexed triangles form one pane');
  assert.equal(s.separated, 2, 'Disconnected coplanar windows stay separate');
  for (const key of ['fixture', 'upward', 'tiny', 'blocked']) assert.equal(s[key], 0, `${key} does not emit a window pool`);
  assert.ok(s.outward[0] > 0.3 && s.outward[0] > s.outward[1] && s.outward[1] > s.outward[2], 'Outward pool preserves warm linear colour');
  assert.equal(s.outward[3], 1, 'Source height survives half-float encoding');
  assert.deepEqual(s.inward, [0, 0, 0, 0], 'Window pools do not cross the inward half-plane');
  assert.equal(s.signedHeight, -2, 'World heights can be negative');
  assert.deepEqual(s.empty, { panes: 0, size: [1, 1], data: [0, 0, 0, 0] }, 'Empty geometry gives a small zero texture');
  assert.ok(s.rimHeights.length > 0 && s.rimHeights.every((h) => h === 1), 'Bilinear pool rims keep source height as RGB fades to zero');
  assert.ok(s.rimSourceErrors.length > 0 && Math.max(...s.rimSourceErrors) < 0.002, 'Filtered pool rims keep their source position');
  assert.ok(s.translatedSourceError < 0.002, 'Local source offsets retain precision far from the origin');
  assert.deepEqual(s.emptySource, [0, 0], 'Empty geometry has a zero source map');
  const wr = result.wallRender;
  assert.equal(wr.panes, 1, 'The render probe extracts its recessed window');
  assert.ok(wr.night.wallPixels > 5000 && wr.night.below > 15, 'An isolated window visibly lights the wall below it without lamps/glow/dither');
  assert.ok(wr.night.below < wr.night.wallPixels / 4, 'Wall pool remains compact');
  assert.equal(wr.night.above, 0, 'Window pool does not light the wall above its pane');
  assert.equal(wr.night.distant, 0, 'Distant wall and wall far below the window remain unchanged');
  assert.equal(wr.night.nonWall, 0, 'The map does not change the emissive pane or background');
  assert.equal(wr.day.changed, 0, 'Window map changes no day pixels');
  assert.ok(wr.underside.pixels > 100, 'The render probe sees a downward-facing receiver below the window');
  assert.equal(wr.underside.changed, 0, 'An underside facing away from the window receives no pool');
  console.log('Facing probe:', JSON.stringify(result.facing));
  for (const r of result.facing) {
    assert.equal(r.panes, 1, 'Facing probe retains its unblocked pane');
    assert.ok(r.pixels > 500, 'Facing probe has a visible receiver');
    assert.ok(r.controlChanged > 15, 'A front-directed source demonstrably lights this receiver');
    if (r.slope) assert.equal(r.controlDiff, 0, 'Gentle sloped ground keeps the full ungated window pool');
    else if (r.away) assert.equal(r.changed, 0, `Away-facing wall ${r.distance} m from its pane receives no pool`);
    else assert.ok(r.changed > 15, 'Wall facing its pane retains visible window spill');
  }
  for (const r of wr.facades) {
    assert.equal(r.panes, r.strips ? 3 : 1, 'Facade keeps its panes');
    assert.ok(r.pixels > 5000 && r.changed > 15, `Pane with ${r.recess} m recess lights its surrounding facade`);
    assert.ok(Math.abs(r.sourceZ - Math.max(0.02, -r.recess)) < 0.001, 'Directional source sits outside the facade and never behind the pane');
  }
  await mkdir(output, { recursive: true });
  await writePng(`${output}/isolated-wall-on.png`, wr.onPng); await writePng(`${output}/isolated-wall-off.png`, wr.offPng);
  delete wr.onPng; delete wr.offPng;
  for (const r of result.scenes) {
    assert.equal(r.before, r.after, `${r.scene}: no lamps added`);
    assert.ok(r.finite && r.peak <= 1, `${r.scene}: finite, bounded light map`);
    assert.ok(r.sourceFinite, `${r.scene}: finite source-position map`);
    assert.deepEqual(r.sourceSize, [r.width, r.height], `${r.scene}: source map uses the light map grid`);
    assert.ok(r.width <= 1024 && r.height <= 1024, `${r.scene}: bounded texture dimensions`);
    if (r.scene === 'village') assert.ok(r.panes > 50 && r.litTexels > 0, 'Village has substantial window coverage');
    await writePng(`${output}/${r.scene}.png`, r.debugPng); delete r.debugPng;
    console.log(`${r.scene}: ${r.panes} panes, ${r.width}×${r.height}, ${r.ms.toFixed(1)} ms, ${r.before} lamps unchanged`);
  }
  assert.deepEqual(errors, [], 'No browser or shader errors');
  await writeFile(`${output}/stats.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(`PASS: extraction, fixture/wall rejection, outward pools, filtered source positions/heights, isolated wall spill, receiver facing and scene maps. Debug views: ${output}/`);
} finally { await browser.close(); }
