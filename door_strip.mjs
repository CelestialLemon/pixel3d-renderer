// Contact sheet of the door at several tiny camera steps (native low-res pixels, enlarged 6x with no smoothing).
import puppeteer from 'puppeteer-core';
import { writeFile } from 'node:fs/promises';
const px = process.argv[2] || '3', tag = process.argv[3] || 'strip';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
await page.goto(`http://127.0.0.1:5180/pass3.html?auto=0&clean-ui=1&time=8&hour=12&px=${px}&az=38`); await page.waitForFunction('window.appReady', { timeout: 180000 });
const url = await page.evaluate(() => {
  const a = window.app3, c = document.getElementById('p3-view'), W = c.width, H = c.height;
  const frames = 8, S = 6, out = document.createElement('canvas'), tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
  const tctx = tmp.getContext('2d');
  let bw = 0, bh = 0;
  for (let i = 0; i < frames; i++) {
    const az = (38 + i * 0.4) * Math.PI / 180; Object.assign(a.view, { az }); Object.assign(a.target, { az }); a.redraw(); a.render();
    const pts = [];
    for (const [x, y] of [[-0.6, 0.7], [0.6, 0.7], [-0.6, 2.8], [0.6, 2.8]]) { const v = new a.p3.camera.position.constructor(x, y, 2.33).project(a.p3.camera); pts.push([(v.x * 0.5 + 0.5) * W, (1 - (v.y * 0.5 + 0.5)) * H]); }
    const x0 = Math.floor(Math.min(...pts.map((p) => p[0]))) - 2, y0 = Math.floor(Math.min(...pts.map((p) => p[1]))) - 2;
    const w = 32, h = 62; bw = w * S + 6; bh = h * S;
    if (i === 0) { out.width = bw * frames; out.height = bh; }
    tctx.clearRect(0, 0, W, H); tctx.drawImage(c, 0, 0);
    const octx = out.getContext('2d'); octx.imageSmoothingEnabled = false;
    octx.drawImage(tmp, x0, y0, w, h, i * bw, 0, w * S, h * S);
  }
  return out.toDataURL();
});
await writeFile(`out/${tag}.png`, Buffer.from(url.split(',')[1], 'base64'));
await browser.close();
