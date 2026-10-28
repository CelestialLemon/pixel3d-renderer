// End-to-end interaction checks of the single-renderer viewer (pass3.html).
//   node tools/check-viewer.ts
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
let failed = 0;
const ok = (name: string, cond: boolean) => { console.log(cond ? 'PASS' : 'FAIL', name); if (!cond) failed++; };
try {
  const { page, errors } = await newPage(browser, { width: 1200, height: 800 });
  await open(page, 'pass3.html?auto=0');
  const st = () => page.evaluate(() => {
    const t = app3.orbit.target;
    return { az: +(t.az * 180 / Math.PI).toFixed(1), size: +t.size.toFixed(2), tx: +t.tx.toFixed(2), tz: +t.tz.toFixed(2), clock: (document.getElementById('clock') as HTMLInputElement).value };
  });
  const s0 = await st();
  await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(800, 360, { steps: 6 }); await page.mouse.up();
  const s1 = await st(); ok('drag orbits', s1.az !== s0.az);
  await page.mouse.wheel({ deltaY: -300 }); const s2 = await st(); ok('wheel zooms in', s2.size < s1.size);
  await page.keyboard.down('Shift'); await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(700, 400, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Shift');
  const s3 = await st(); ok('shift-drag pans', s3.tx !== s2.tx || s3.tz !== s2.tz);
  await page.click('#view-presets button:nth-child(2)'); ok('Landscape preset zooms out', (await st()).size === 23);
  await page.click('#presets button:nth-child(5)'); ok('Night preset sets 22:00', (await st()).clock === '22:00');
  await page.evaluate(() => { const h = document.getElementById('hour') as HTMLInputElement; h.value = '12'; h.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('time slider updates clock', (await st()).clock === '12:00');
  ok('scene picker hidden with one scene', await page.evaluate(() => { const s = document.getElementById('scene') as HTMLSelectElement; return s.closest('label')!.hidden === (s.options.length < 2); }));
  await page.click('#compare'); await page.waitForFunction('document.body.classList.contains("compare")', { timeout: 120000 });
  ok('compare mode shows Pass 1', await page.evaluate(() => getComputedStyle(document.getElementById('p1-view')!).display !== 'none'));
  ok('both renderers share one resolution', await page.evaluate(() => { const a = document.getElementById('p3-view') as HTMLCanvasElement, b = document.getElementById('p1-view') as HTMLCanvasElement; return a.width === b.width && a.height === b.height; }));
  await page.click('#compare'); ok('compare toggles off', await page.evaluate(() => !document.body.classList.contains('compare')));
  await page.click('#cycle'); await new Promise((r) => setTimeout(r, 1500)); await page.click('#cycle');
  ok('canvas exports PNG', (await page.evaluate(() => (document.getElementById('p3-view') as HTMLCanvasElement).toDataURL('image/png').length)) > 5000);
  await page.setViewport({ width: 390, height: 780, deviceScaleFactor: 2 }); await new Promise((r) => setTimeout(r, 1500));
  ok('mobile viewport has no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewport({ width: 1200, height: 800 });
  await open(page, 'pass3.html?auto=0&scene=test-chart&view=ink');
  ok('?view= starts on a bay preset', (await st()).tx === 8);
  await page.click('#view-presets button:nth-child(2)'); ok('bay preset moves the orbit target', (await st()).tx === -8);
  // Hover highlights the object under a still pointer while the scene animates (requestPick answers arrive frames later).
  await open(page, 'pass3.html?auto=0&scene=objects');
  const target = await page.evaluate(async () => {
    const r = app3.p3, rect = r.canvas.getBoundingClientRect(), frames = () => new Promise((res) => setTimeout(res, 200));
    for (let y = 2; y < r.height; y += 4) for (let x = 2; x < r.width; x += 4) {
      const o = r.pickPixel(x, y)?.object;
      if (!o) continue;
      await frames();   // a still object: the same one under the pixel a few frames later
      if (r.pickPixel(x, y)?.object !== o) continue;
      (window as any).hoverTarget = o;
      return { x: rect.left + (x + 0.5) * rect.width / r.width, y: rect.top + (y + 0.5) * rect.height / r.height, animate: app3.settings.animate };
    }
    return null;
  });
  ok('objects scene has a still object to hover, animating', !!target && target.animate);
  if (target) {
    await page.mouse.move(target.x, target.y);
    ok('hover highlights the object under a still pointer while animating',
      await page.waitForFunction('window.hoverTarget.highlight === true', { timeout: 5000 }).then(() => true, () => false));
    await page.mouse.move(1, 1);
    ok('leaving it clears the highlight',
      await page.waitForFunction('window.hoverTarget.highlight === false', { timeout: 5000 }).then(() => true, () => false));
  }
  ok(`no console/page errors (${errors.length})`, errors.length === 0); if (errors.length) console.log(errors);
} finally { await browser.close(); }
process.exitCode = failed ? 1 : 0;
