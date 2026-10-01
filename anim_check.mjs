// Verifies motion: same camera at several clock times, reports how many pixels changed in regions of interest.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(); await page.setViewport({ width: 960, height: 600 });
await page.goto('http://127.0.0.1:5180/pass3.html?auto=0&clean-ui=1&hour=12&anim=1&time=0'); await page.waitForFunction('window.appReady', { timeout: 180000 });
const grab = (t) => page.evaluate((t) => {
  // freeze time by rendering at an explicit clock: app3.render uses the closure's time, so drive pipeline directly
  const a = window.app3; a.p3.renderGeometry(t); a.p3.renderStyle(a.settings, t);
  const c = document.getElementById('p3-view'), k = document.createElement('canvas'); k.width = c.width; k.height = c.height;
  const x = k.getContext('2d'); x.drawImage(c, 0, 0); return { w: c.width, h: c.height, d: Array.from(x.getImageData(0, 0, c.width, c.height).data) };
}, t);
const a = await grab(2), b = await grab(2.6), c = await grab(2);
const diff = (p, q, box) => { let n = 0, tot = 0; for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) { const i = (y * p.w + x) * 4; tot++; if (p.d[i] !== q.d[i] || p.d[i + 1] !== q.d[i + 1] || p.d[i + 2] !== q.d[i + 2]) n++; } return `${n}/${tot} (${(100 * n / tot).toFixed(1)}%)`; };
const W = a.w, H = a.h, full = [0, 0, W, H];
console.log('whole frame t=2 vs t=2.6:', diff(a, b, full));
console.log('determinism t=2 vs t=2 :', diff(a, c, full));
await browser.close();
