// End-to-end interaction checks of the single-renderer viewer (pass3.html).
//   node tools/check-viewer.mjs
import { launch, newPage, open } from './lib.mjs';

const browser = await launch();
let failed = 0;
const ok = (name, cond) => { console.log(cond ? 'PASS' : 'FAIL', name); if (!cond) failed++; };
try {
  const { page, errors } = await newPage(browser, { width: 1200, height: 800 });
  await open(page, 'pass3.html?auto=0');
  const st = () => page.evaluate(() => {
    const t = app3.orbit.target;
    return { az: +(t.az * 180 / Math.PI).toFixed(1), size: +t.size.toFixed(2), tx: +t.tx.toFixed(2), tz: +t.tz.toFixed(2), clock: document.getElementById('clock').value };
  });
  const s0 = await st();
  await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(800, 360, { steps: 6 }); await page.mouse.up();
  const s1 = await st(); ok('drag orbits', s1.az !== s0.az);
  await page.mouse.wheel({ deltaY: -300 }); const s2 = await st(); ok('wheel zooms in', s2.size < s1.size);
  await page.keyboard.down('Shift'); await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(700, 400, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Shift');
  const s3 = await st(); ok('shift-drag pans', s3.tx !== s2.tx || s3.tz !== s2.tz);
  await page.click('#view-presets button:nth-child(2)'); ok('Landscape preset zooms out', (await st()).size === 23);
  await page.click('#presets button:nth-child(5)'); ok('Night preset sets 22:00', (await st()).clock === '22:00');
  await page.evaluate(() => { const h = document.getElementById('hour'); h.value = '12'; h.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('time slider updates clock', (await st()).clock === '12:00');
  ok('scene picker hidden with one scene', await page.evaluate(() => document.getElementById('scene').closest('label').hidden === (document.getElementById('scene').options.length < 2)));
  await page.click('#compare'); await page.waitForFunction('document.body.classList.contains("compare")', { timeout: 120000 });
  ok('compare mode shows Pass 1', await page.evaluate(() => getComputedStyle(document.getElementById('p1-view')).display !== 'none'));
  ok('both renderers share one resolution', await page.evaluate(() => { const a = document.getElementById('p3-view'), b = document.getElementById('p1-view'); return a.width === b.width && a.height === b.height; }));
  await page.click('#compare'); ok('compare toggles off', await page.evaluate(() => !document.body.classList.contains('compare')));
  await page.click('#cycle'); await new Promise((r) => setTimeout(r, 1500)); await page.click('#cycle');
  ok('canvas exports PNG', (await page.evaluate(() => document.getElementById('p3-view').toDataURL('image/png').length)) > 5000);
  await page.setViewport({ width: 390, height: 780, deviceScaleFactor: 2 }); await new Promise((r) => setTimeout(r, 1500));
  ok('mobile viewport has no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  ok(`no console/page errors (${errors.length})`, errors.length === 0); if (errors.length) console.log(errors);
} finally { await browser.close(); }
process.exitCode = failed ? 1 : 0;
