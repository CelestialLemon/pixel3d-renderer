// Usage: node shot.mjs <name> [query e.g. "az=30&px=3"] [WxH]
import puppeteer from 'puppeteer-core';
const [name = 'shot', query = '', size = '1440x900', clipArg = ''] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: w, height: h, deviceScaleFactor: clipArg ? 2 : 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${process.env.DEMO_URL || 'http://127.0.0.1:5180'}/?auto=0&${query}`, { waitUntil: 'load' });
await page.waitForFunction('window.appReady === true', { timeout: 120000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 2500));
if (clipArg) { const [x, y, cw, ch] = clipArg.split(',').map(Number); await page.screenshot({ path: `out/${name}.png`, clip: { x, y, width: cw, height: ch } }); }
else await page.screenshot({ path: `out/${name}.png` });
const info = await page.evaluate(() => {
  const c = document.getElementById(`${app.mode === 'compare' ? 'pass2' : app.mode}-view`), t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
  const x = t.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, t.width, t.height).data; const set = new Set();
  for (let i = 0; i < d.length; i += 4) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return { res: `${c.width}x${c.height}`, uniqueColours: set.size, stats: document.getElementById('stats').textContent };
});
console.log(name, JSON.stringify(info));
if (logs.length) console.log(logs.slice(0, 15).join('\n'));
await browser.close();
