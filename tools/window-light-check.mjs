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
    // At a half-texel rim sample, any of the four filter taps may be empty. Height must remain the
    // original source height while RGB fades; test every mixed-coverage footprint on this isolated pane.
    const rimHeights = [];
    const { width: mw, height: mh, data: md } = indexed.texture.image;
    for (let z = 0; z < mh - 1; z++) for (let x = 0; x < mw - 1; x++) {
      const taps = [z * mw + x, z * mw + x + 1, (z + 1) * mw + x, (z + 1) * mw + x + 1];
      const covered = taps.filter((i) => md[i * 4] > 0).length;
      if (covered > 0 && covered < 4) rimHeights.push(taps.reduce((sum, i) => sum + THREE.DataUtils.fromHalfFloat(md[i * 4 + 3]), 0) / 4);
    }
    const synthetic = {
      indexed: indexed.panes.length, separated: separated.panes.length, fixture: fixture.panes.length,
      upward: upward.panes.length, tiny: tiny.panes.length, blocked: blocked.panes.length,
      outward: sample(indexed, 0, 0.4), inward: sample(indexed, 0, -0.4), signedHeight: sample(belowZero, 0, 0.4)[3],
      empty: { panes: empty.panes.length, size: [empty.texture.image.width, empty.texture.image.height], data: [...empty.texture.image.data] },
      rimHeights,
    };
    for (const m of maps) m.texture.dispose();
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
        finite, peak, litTexels, debugPng: canvas.toDataURL('image/png') });
      map.texture.dispose(); scene.staticGeometry.dispose(); scene.dynamicGeometry.dispose();
    }
    return { synthetic, wallRender, scenes };
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
  await mkdir(output, { recursive: true });
  await writePng(`${output}/isolated-wall-on.png`, wr.onPng); await writePng(`${output}/isolated-wall-off.png`, wr.offPng);
  delete wr.onPng; delete wr.offPng;
  for (const r of result.scenes) {
    assert.equal(r.before, r.after, `${r.scene}: no lamps added`);
    assert.ok(r.finite && r.peak <= 1, `${r.scene}: finite, bounded light map`);
    assert.ok(r.width <= 1024 && r.height <= 1024, `${r.scene}: bounded texture dimensions`);
    if (r.scene === 'village') assert.ok(r.panes > 50 && r.litTexels > 0, 'Village has substantial window coverage');
    await writePng(`${output}/${r.scene}.png`, r.debugPng); delete r.debugPng;
    console.log(`${r.scene}: ${r.panes} panes, ${r.width}×${r.height}, ${r.ms.toFixed(1)} ms, ${r.before} lamps unchanged`);
  }
  assert.deepEqual(errors, [], 'No browser or shader errors');
  await writeFile(`${output}/stats.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(`PASS: extraction, fixture/wall rejection, outward pools, filtered source heights, isolated wall spill and scene maps. Debug views: ${output}/`);
} finally { await browser.close(); }
