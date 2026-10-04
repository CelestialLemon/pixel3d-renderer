// End-to-end checks of the comparison page (index.html): pass preservation, modes, layouts, wipe dividers,
// shared camera/sun/resolution, PNG exports, mobile, time of day, animation, and no browser errors.
//   node tools/verify.ts          (DEMO_URL / CHROME_PATH to override)
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { launch, newPage, open, settle, canvasPng, writePng } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser);
  const ids = ['pass0', 'pass1', 'pass3'];
  const all = (fn: string) => page.evaluate(`Object.values(app.passes).every(${fn})`);

  // Pass 0 on the comparison page must match its own standalone page exactly.
  const query = '?auto=0&az=38&el=38&px=3&clouds=0&time=8&clean-ui=1&sun=-62&sunEl=42&layout=wipe';
  await open(page, 'pass0.html' + query);
  const original = await canvasPng(page, 'view');
  await open(page, query);
  assert.equal(await canvasPng(page, 'pass0-view'), original, 'Pass 0 matches the standalone original');
  const shots = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await canvasPng(page, `${id}-view`)])));
  assert.notEqual(shots.pass1, shots.pass0, 'Pass 1 differs from Pass 0');
  assert.notEqual(shots.pass3, shots.pass1, 'Pass 3 differs from Pass 1');
  for (const id of ids) await writePng(`out/${id}-native.png`, shots[id]);
  console.log('PASS: Pass 0 preserved; passes are distinct (pixel-exact history is checked by tools/golden.ts).');

  // Modes
  await page.evaluate(() => document.body.classList.remove('clean'));
  for (const id of ids) {
    await page.click(`#mode-${id}`);
    assert.equal(await page.evaluate(() => app.mode), id);
    assert.equal(await page.$eval(`#${id}-pane`, (e) => getComputedStyle(e).visibility), 'visible');
    for (const other of ids.filter((o) => o !== id)) assert.equal(await page.$eval(`#${other}-pane`, (e) => getComputedStyle(e).visibility), 'hidden');
  }
  await page.click('#mode-compare');

  // Wipe: ordered sliders and dividers that cannot cross, and divider arrow keys that do not orbit.
  for (const [id, value] of [['split0', '25'], ['split1', '70']]) await page.$eval('#' + id, (e, v) => { (e as HTMLInputElement).value = v; e.dispatchEvent(new Event('input')); }, value);
  assert.deepEqual(await page.evaluate(() => app.splits), [25, 70]);
  assert.equal(await page.$eval('#pass0-pane', (e) => (e as HTMLElement).style.getPropertyValue('--clip')), '75%', 'Pass 0 is clipped at its boundary');
  await page.focus('#divider0'); const az = await page.evaluate(() => app.orbit.target.az);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => app.orbit.target.az), az, 'Divider arrows do not orbit');
  assert.equal(await page.$eval('#split0', (e) => +(e as HTMLInputElement).value), 27);
  await page.mouse.move(389, 450); await page.mouse.down(); await page.mouse.move(600, 450); await page.mouse.up();
  assert.ok(Math.abs(await page.$eval('#split0', (e) => +(e as HTMLInputElement).value) - 600 / 1440 * 100) < 1, 'Dragging a divider moves it');
  await page.$eval('#split0', (e) => { (e as HTMLInputElement).value = '99'; e.dispatchEvent(new Event('input')); });
  assert.equal(await page.$eval('#split0', (e) => +(e as HTMLInputElement).value), 70, 'Wipe boundaries cannot cross');
  assert.equal(await page.$eval('#divider1', (e) => e.getAttribute('aria-valuenow')), '70', 'Second divider is wired');
  await page.$eval('#split0', (e) => { (e as HTMLInputElement).value = '33'; e.dispatchEvent(new Event('input')); });

  // Shared resolution, sun and camera
  await page.select('#pixel', '4'); await settle(page);
  assert.ok(await all('(p) => p.width === 360 && p.height === 225'), 'Pixel size resizes every pass');
  await page.$eval('#sun', (e) => { (e as HTMLInputElement).value = '25'; e.dispatchEvent(new Event('input')); });
  assert.ok(await all('(p) => p.sun.distanceTo(app.passes.pass3.sun) < 1e-8'), 'Sun slider moves one shared sun');
  const start = await page.evaluate(() => ({ ...app.orbit.target }));
  await page.mouse.move(800, 500); await page.mouse.down(); await page.mouse.move(870, 530, { steps: 4 }); await page.mouse.up();
  await page.mouse.wheel({ deltaY: -180 });
  await page.keyboard.down('Shift'); await page.mouse.down(); await page.mouse.move(920, 530, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Shift');
  await page.waitForFunction((s) => app.orbit.target.az !== s.az && app.orbit.target.size < s.size && app.orbit.target.tx !== s.tx, {}, start);
  await page.evaluate(() => { app.orbit.snap(); app.redraw(); app.render(); });
  assert.ok(await all('(p) => p.camera.position.distanceTo(app.passes.pass3.camera.position) < 1e-8'), 'Orbit, zoom and pan move every camera together');

  // Side by side: panes do not overlap, all buffers equal, even at odd viewport sizes.
  type Rect = { x: number; y: number; w: number; h: number };
  const rects = (): Promise<Rect[]> => page.$$eval('.pane', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
  await page.select('#layout', 'grid'); await settle(page);
  let r = await rects();
  assert.ok(r.every((a, i) => r.every((b, j) => i === j || !overlap(a, b))), 'Grid panes do not overlap');
  assert.ok(r.every((a) => a.w > 100 && a.h > 100), 'Every grid pane is visible');
  assert.ok(await all('(p) => p.width === app.passes.pass3.width && p.height === app.passes.pass3.height'), 'Equal grid render sizes');
  await page.screenshot({ path: 'out/compare-grid.png' });
  await page.setViewport({ width: 1457, height: 901 }); await settle(page);
  assert.ok(await all('(p) => p.width === app.passes.pass3.width && p.height === app.passes.pass3.height && p.camera.projectionMatrix.equals(app.passes.pass3.camera.projectionMatrix)'), 'Odd viewport sizes keep identical buffers and projections');
  await page.evaluate(() => (document.activeElement as HTMLElement).blur()); await page.keyboard.press('h'); await settle(page);
  assert.ok(await page.$eval('body', (e) => e.classList.contains('clean')), 'H hides the controls');
  await page.keyboard.press('h'); await page.setViewport({ width: 1440, height: 900 }); await settle(page);
  console.log('PASS: modes, ordered wipe dividers, shared camera/sun/resolution, side-by-side layout.');

  // Exports: check the real downloaded PNG dimensions.
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: `${process.cwd()}/out` });
  // Switch layout, export, and return the PNG size plus the size it should have.
  const exportCheck = async (layout: string) => {
    await page.select('#layout', layout); await settle(page);
    const [cols, rows, w, h] = await page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('stage')!);
      return [s.gridTemplateColumns.split(' ').length / 2, s.gridTemplateRows.split(' ').length, app.passes.pass3.width, app.passes.pass3.height];
    });
    const expected = layout === 'grid' ? [w * cols, h * rows] : [w, h];
    const path = `out/cookie-co-compare-${layout}.png`; await rm(path, { force: true });
    await page.click('#shot');
    for (let attempt = 0; attempt < 50; attempt++) {
      const file = await readFile(path).catch(() => null);
      if (file && file.length > 1000) return { actual: [file.readUInt32BE(16), file.readUInt32BE(20)], expected };
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no ${layout} export downloaded`);
  };
  let e = await exportCheck('grid'); assert.deepEqual(e.actual, e.expected, 'Grid export holds every pane');
  e = await exportCheck('wipe'); assert.deepEqual(e.actual, e.expected, 'Wipe export is one frame');
  console.log('PASS: PNG exports.');

  // Mobile: no horizontal scroll, every pane on screen without overlap.
  await page.select('#layout', 'grid');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 }); await settle(page);
  assert.ok(await page.$eval('body', (e) => e.scrollWidth <= 390), 'No horizontal scroll on mobile');
  r = await rects();
  assert.ok(r.every((a, i) => a.x >= 0 && a.x + a.w <= 391 && a.w > 80 && r.every((b, j) => i === j || !overlap(a, b))), 'Mobile panes fit without overlap');
  e = await exportCheck('grid'); assert.deepEqual(e.actual, e.expected, 'Mobile export holds every pane');
  await page.screenshot({ path: 'out/compare-mobile.png' });
  console.log('PASS: mobile layout and export.');

  // Time of day moves one shared sun; the living world animates and can be frozen.
  await page.setViewport({ width: 1440, height: 900 });
  await open(page, '?layout=wipe&auto=0&clean-ui=1&px=4');
  const before = await canvasPng(page, 'pass3-view');
  await page.evaluate(() => app.setHour(22)); await settle(page);
  assert.notEqual(await canvasPng(page, 'pass3-view'), before, 'Night looks different from golden hour');
  assert.ok(await all('(p) => p.sun.distanceTo(app.passes.pass3.sun) < 1e-8'), 'Time of day drives one shared sun');
  assert.equal(await page.evaluate(() => app.settings.sunEl), 38, 'Night uses the moon elevation');
  await page.evaluate(() => app.setHour(12)); await settle(page);
  const t0 = await canvasPng(page, 'pass3-view'); await new Promise((r) => setTimeout(r, 900)); await settle(page);
  assert.notEqual(await canvasPng(page, 'pass3-view'), t0, 'Living world animates Pass 3');
  await page.$eval('#animate', (e) => (e as HTMLElement).click()); await settle(page);
  const f0 = await canvasPng(page, 'pass3-view'); await new Promise((r) => setTimeout(r, 700)); await settle(page);
  assert.equal(await canvasPng(page, 'pass3-view'), f0, 'Turning off Living world freezes Pass 3');
  console.log('PASS: time-of-day sun sync and animation toggle.');

  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.log('PASS: no JS/shader errors.');
} finally { await browser.close(); }
