// End-to-end GPU/image and interaction checks. DEMO_URL can select another local port.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const base = process.env.DEMO_URL || 'http://127.0.0.1:5180';
await mkdir('out', { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const ready = async (path) => {
    await page.goto(base + '/' + path, { waitUntil: 'load' });
    await page.waitForFunction(() => window.appReady, { timeout: 120000 });
    await settle();
  };
  const canvasData = (id) => page.$eval('#' + id, (c) => c.toDataURL());
  const png = async (name, id) => writeFile(`out/${name}.png`, Buffer.from((await canvasData(id)).split(',')[1], 'base64'));
  const query = '?auto=0&az=38&el=38&px=3&clouds=0&time=8&clean-ui=1&sun=-62&sunEl=42&layout=wipe';
  await ready('pass0.html' + query);
  const original = await canvasData('view');
  await ready(query + '&compare=1');
  assert.equal(await canvasData('pass0-view'), original, 'Pass 0 exactly preserves the original standalone output');
  const pass1 = await canvasData('pass1-view');
  // Compare against the refined reference captured before this change, if available.
  const previous = await readFile('out/after-native.png').catch(() => null);
  if (previous) {
    const mismatch = await page.evaluate(async (data) => {
      const image = new Image(); image.src = data; await image.decode();
      const current = document.getElementById('pass1-view');
      const c = document.createElement('canvas'); c.width = current.width; c.height = current.height;
      const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
      const ref = ctx.getImageData(0, 0, c.width, c.height).data;
      ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(current, 0, 0);
      const actual = ctx.getImageData(0, 0, c.width, c.height).data;
      return { dimensions: image.width === c.width && image.height === c.height, count: actual.reduce((n, v, i) => n + (v !== ref[i] ? 1 : 0), 0) };
    }, 'data:image/png;base64,' + previous.toString('base64'));
    assert.ok(mismatch.dimensions, 'Pass 1 reference dimensions');
    assert.equal(mismatch.count, 0, 'Pass 1 preserves the previous refined pixels');
  }
  assert.notEqual(await canvasData('pass2-view'), pass1, 'Pass 2 is visually different from Pass 1');
  const pass3 = await canvasData('pass3-view');
  assert.notEqual(pass3, pass1, 'Pass 3 is visually different from Pass 1');
  assert.notEqual(pass3, await canvasData('pass2-view'), 'Pass 3 is visually different from Pass 2');
  for (let i = 0; i < 4; i++) await png(`pass${i}-native`, `pass${i}-view`);
  console.log('PASS: original and refined pixel preservation; distinct Pass 2 and Pass 3 output.');

  await page.evaluate(() => document.body.classList.remove('clean'));
  for (let i = 0; i < 4; i++) {
    await page.click(`#mode-pass${i}`);
    assert.equal(await page.$eval('body', (e) => e.dataset.mode), `pass${i}`);
    assert.equal(await page.$eval(`#pass${i}-pane`, (e) => getComputedStyle(e).visibility), 'visible');
  }
  await page.click('#mode-compare');
  const beforeFog = await canvasData('pass2-view');
  await page.click('#fog'); await settle();
  assert.notEqual(await canvasData('pass2-view'), beforeFog, 'Fog toggle changes Pass 2');
  assert.equal(await canvasData('pass1-view'), pass1, 'Fog settings do not modify Pass 1');
  assert.equal(await canvasData('pass0-view'), original, 'Fog settings do not modify Pass 0');
  assert.equal(await canvasData('pass3-view'), pass3, 'Fog settings do not modify Pass 3');
  await page.click('#fog');
  await page.$eval('#haze', (e) => { e.value = '0.6'; e.dispatchEvent(new Event('input')); });
  assert.equal(await page.evaluate(() => app.atmosphere.strength), 0.6);
  for (const [id, value] of [['split0', '25'], ['split1', '70'], ['split2', '85']]) await page.$eval('#' + id, (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, value);
  assert.equal(await page.$eval('body', (e) => e.style.getPropertyValue('--split0')), '25%');
  await page.focus('#divider0'); const az = await page.evaluate(() => app.target.az);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => app.target.az), az, 'Divider arrows do not orbit');
  assert.equal(await page.$eval('#split0', (e) => +e.value), 27);
  await page.mouse.move(389, 450); await page.mouse.down(); await page.mouse.move(600, 450); await page.mouse.up();
  assert.ok(Math.abs(await page.$eval('#split0', (e) => +e.value) - 600 / 1440 * 100) < 1);
  await page.$eval('#split0', (e) => { e.value = '99'; e.dispatchEvent(new Event('input')); });
  assert.equal(await page.$eval('#split0', (e) => +e.value), 70, 'Wipe boundaries cannot cross');
  assert.equal(await page.$eval('#divider2', (e) => e.getAttribute('aria-valuenow')), '85', 'Third divider is wired');
  await page.$eval('#split0', (e) => { e.value = '25'; e.dispatchEvent(new Event('input')); });
  await page.select('#pixel', '4'); await settle();
  assert.ok(await page.evaluate(() => Object.values(app.passes).every((p) => p.width === 360 && p.height === 225)));
  await page.$eval('#sun', (e) => { e.value = '25'; e.dispatchEvent(new Event('input')); });
  assert.ok(await page.evaluate(() => Object.values(app.passes).every((p) => p.sun.distanceTo(app.passes.pass2.sun) < 1e-8)));
  const start = await page.evaluate(() => ({ az: app.target.az, size: app.target.size, tx: app.target.tx }));
  await page.mouse.move(800, 500); await page.mouse.down(); await page.mouse.move(870, 530, { steps: 4 }); await page.mouse.up();
  await page.mouse.wheel({ deltaY: -180 });
  await page.keyboard.down('Shift'); await page.mouse.down(); await page.mouse.move(920, 530, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Shift');
  await page.waitForFunction((s) => app.target.az !== s.az && app.target.size < s.size && app.target.tx !== s.tx, {}, start);
  await page.evaluate(() => { Object.assign(app.view, app.target); app.redraw(); app.render(); });
  assert.ok(await page.evaluate(() => Object.values(app.passes).every((p) => p.camera.position.distanceTo(app.passes.pass2.camera.position) < 1e-8)));
  assert.ok(await page.evaluate(() => Math.abs(app.passes.pass2.focusDepth - 100) < 1e-6), 'Fog reference follows actual focus depth');
  await page.select('#layout', 'panels'); await settle();
  assert.ok(await page.evaluate(() => Object.values(app.passes).every((p) => p.width === app.passes.pass2.width && p.height === app.passes.pass2.height)), 'Equal panel render dimensions');
  const rects = await page.$$eval('.pane', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  assert.ok(rects[0].x + rects[0].w <= rects[1].x && rects[1].x + rects[1].w <= rects[2].x && rects[2].x + rects[2].w <= rects[3].x, 'All four complete scenes visible side by side');
  await page.screenshot({ path: 'out/four-pass-panels.png' });
  await page.select('#layout', 'grid'); await settle();
  const grid = await page.$$eval('.pane', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  assert.ok(grid[0].x + grid[0].w <= grid[1].x + 1 && grid[2].x + grid[2].w <= grid[3].x + 1 && grid[0].y + grid[0].h <= grid[2].y + 1 && grid[1].y + grid[1].h <= grid[3].y + 1, 'Grid layout shows a 2 x 2 arrangement');
  assert.ok(await page.evaluate(() => Object.values(app.passes).every((p) => p.width === app.passes.pass2.width && p.height === app.passes.pass2.height)), 'Equal grid render dimensions');
  await page.screenshot({ path: 'out/four-pass-grid.png' });
  await page.select('#layout', 'panels'); await settle();
  await page.setViewport({ width: 1457, height: 901 }); await settle();
  assert.ok(await page.evaluate(() => Object.values(app.passes).every((p) => p.width === app.passes.pass2.width && p.height === app.passes.pass2.height && p.camera.projectionMatrix.equals(app.passes.pass2.camera.projectionMatrix))), 'Odd viewport widths retain identical buffers and projections');
  await page.evaluate(() => document.activeElement.blur()); await page.keyboard.press('h'); await settle();
  assert.ok(await page.$eval('body', (e) => e.classList.contains('clean')), 'H expands the unobstructed comparison');
  await page.keyboard.press('h'); await settle();
  await page.setViewport({ width: 1440, height: 900 }); await settle();
  console.log('PASS: view modes, atmosphere isolation, ordered draggable dividers, synchronized camera/sun/resolution, four-column and 2 x 2 layouts.');

  // Export every comparison layout and check the real downloaded dimensions.
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: `${process.cwd()}/out` });
  const exportCheck = async (layout, expectedFor) => {
    await page.select('#layout', layout); await settle();
    const dims = await page.evaluate(() => [app.passes.pass2.width, app.passes.pass2.height]);
    const expected = expectedFor(dims);
    const path = `out/cookie-co-compare-${layout}.png`; await rm(path, { force: true });
    await page.click('#shot');
    let file;
    for (let attempt = 0; attempt < 50; attempt++) {
      file = await readFile(path).catch(() => null);
      if (file) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(file?.length > 1000, 'PNG downloaded');
    assert.equal(file.readUInt32BE(16), expected[0], `${layout} export width`); assert.equal(file.readUInt32BE(20), expected[1], `${layout} export height`);
  };
  await exportCheck('panels', ([w, h]) => [w * 4, h]);
  await exportCheck('grid', ([w, h]) => [w * 2, h * 2]);
  await exportCheck('wipe', () => [360, 225]);

  // Verify fog changes the distant interior more than the near interior using actual GPU depth.
  await ready('?compare=1&zoom=23&el=32&time=8&clouds=0&clean=0&layout=wipe');
  const fogStats = await page.evaluate(() => {
    const p = app.passes.pass2, c = document.getElementById('pass2-view');
    const capture = () => { const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const ctx = t.getContext('2d'); ctx.drawImage(c, 0, 0); return ctx.getImageData(0, 0, t.width, t.height).data; };
    app.atmosphere.enabled = false; app.render(); const clear = capture();
    app.atmosphere.enabled = true; app.render(); const fog = capture();
    const depth = new Float32Array(p.width * p.height * 4);
    p.renderer.readRenderTargetPixels(p.gbuf, 0, 0, p.width, p.height, depth, undefined, 1);
    let near = 0, far = 0, nearCount = 0, farCount = 0;
    for (let y = 1; y < p.height - 1; y++) for (let x = 1; x < p.width - 1; x++) {
      const d = depth[(y * p.width + x) * 4 + 3];
      if (d <= 0) continue;
      const i = ((p.height - 1 - y) * p.width + x) * 4;
      const diff = Math.abs(fog[i] - clear[i]) + Math.abs(fog[i+1] - clear[i+1]) + Math.abs(fog[i+2] - clear[i+2]);
      if (d < 96) { near += diff; nearCount++; }
      if (d > 110) { far += diff; farCount++; }
    }
    return { near: near / nearCount, far: far / farCount, nearCount, farCount };
  });
  assert.ok(fogStats.nearCount > 100 && fogStats.farCount > 100);
  assert.ok(fogStats.far > fogStats.near + 20, JSON.stringify(fogStats));
  await page.screenshot({ path: 'out/four-pass-landscape.png' });
  console.log('PASS: PNG exports; GPU-depth test confirms distant detail fades while foreground remains clear.', fogStats);

  for (const [name, az, el, zoom] of [['front', 38, 38, 11.5], ['side', 120, 50, 12], ['wide', 38, 32, 23], ['close', 38, 38, 8]]) {
    await page.evaluate(([az, el, size]) => { Object.assign(app.target, { az: az * Math.PI / 180, el: el * Math.PI / 180, size }); Object.assign(app.view, app.target); app.redraw(); app.render(); }, [az, el, zoom]);
    for (const id of ['pass2', 'pass3']) { await page.click(`#mode-${id}`); await settle(); await page.screenshot({ path: `out/${name}-${id}.png` }); }
  }
  await page.click('#mode-compare'); await page.select('#layout', 'panels');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 }); await settle();
  assert.equal(await page.$eval('body', (e) => e.scrollWidth), 390);
  const mobile = await page.$$eval('.pane', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { y: r.y, h: r.height }; }));
  assert.ok(mobile.every((m, i) => i === 0 || mobile[i - 1].y + mobile[i - 1].h <= m.y + 1), 'Mobile panels stack');
  const mobileDims = await page.evaluate(() => [app.passes.pass2.width, app.passes.pass2.height]);
  await exportCheck('panels', ([w, h]) => [w, h * 4]);
  await page.screenshot({ path: 'out/four-pass-mobile.png' });
  await page.select('#layout', 'wipe'); await settle();
  await page.screenshot({ path: 'out/four-pass-mobile-wipe.png' });
  console.log('PASS: four camera views, high-DPI mobile, stacked export.');

  // Pass 3: the hour moves the sun for every pass, and the living world really moves.
  await page.setViewport({ width: 1440, height: 900 });
  await ready('?compare=1&layout=wipe&auto=0&clean-ui=1&px=4');
  const before = await canvasData('pass3-view');
  await page.evaluate(() => app.setHour(22)); await settle();
  assert.notEqual(await canvasData('pass3-view'), before, 'Night looks different from golden hour');
  assert.ok(await page.evaluate(() => Object.values(app.passes).every((p) => p.sun.distanceTo(app.passes.pass3.sun) < 1e-8)), 'Time of day drives one shared sun');
  assert.equal(await page.evaluate(() => app.settings.sunEl), 38, 'Night uses the moon elevation');
  await page.evaluate(() => app.setHour(12)); await settle();
  const t0 = await canvasData('pass3-view'); await new Promise((r) => setTimeout(r, 900)); await settle();
  assert.notEqual(await canvasData('pass3-view'), t0, 'Living world animates Pass 3');
  await page.$eval('#animate', (e) => e.click()); await settle(); const f0 = await canvasData('pass3-view'); await new Promise((r) => setTimeout(r, 700)); await settle();
  assert.equal(await canvasData('pass3-view'), f0, 'Turning off Living world freezes Pass 3');
  console.log('PASS: Pass 3 time-of-day sun sync and animation toggle.');
  assert.deepEqual(errors, [], 'No browser or shader compilation errors');
  console.log('PASS: no JS/shader errors.');
} finally { await browser.close(); }
