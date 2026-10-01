// Arrange all four native captures at an exact 2x scale, without interpolation.
import { readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const images = await Promise.all([0, 1, 2, 3].map(async (pass) => ({
  pass, data: 'data:image/png;base64,' + (await readFile(`out/pass${pass}-native.png`)).toString('base64'),
})));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  const data = await page.evaluate(async (images) => {
    const decoded = await Promise.all(images.map(async ({ data }) => { const image = new Image(); image.src = data; await image.decode(); return image; }));
    const w = decoded[0].width * 2, h = decoded[0].height * 2;
    const c = document.createElement('canvas'); c.width = 32 + (w + 16) * 4; c.height = h + 100;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#fff9e9'; ctx.fillRect(0, 0, c.width, c.height);
    const descriptions = ['Original renderer, preserved', 'Refined shadows, colors, contacts and edges', 'Flat shading, soft contours and distance haze', 'Living world, time of day, lamp light, leaf clumps'];
    for (let i = 0; i < images.length; i++) {
      const x = 16 + i * (w + 16);
      ctx.fillStyle = '#493c32'; ctx.font = 'bold 20px monospace'; ctx.fillText(`PASS ${i}`, x, 30);
      ctx.font = '12px monospace'; ctx.fillStyle = '#857762'; ctx.fillText(descriptions[i], x, 51);
      ctx.drawImage(decoded[i], x, 64, w, h);
    }
    ctx.font = '11px monospace'; ctx.fillStyle = '#857762';
    ctx.fillText('COOKIE CO. / Same model, meadow, camera, sun and art-pixel size. / 2x nearest-neighbor enlargement.', 16, c.height - 14);
    return c.toDataURL();
  }, images);
  await writeFile('out/four-passes.png', Buffer.from(data.split(',')[1], 'base64'));
} finally { await browser.close(); }
