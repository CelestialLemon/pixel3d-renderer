// Screenshot a demo page and report the art resolution and colour count.
//   node tools/shot.mjs <name> [query] [WxH] [clip x,y,w,h]          pass3.html (the current renderer)
//   PAGE=index.html node tools/shot.mjs <name> [query] ...         the comparison page
// Example: node tools/shot.mjs golden "hour=17.5&clean-ui=1&time=8"   ->  out/golden.png
import { launch, newPage, BASE } from './lib.mjs';

const [name = 'shot', query = '', size = '1440x900', clipArg = ''] = process.argv.slice(2);
const pageName = process.env.PAGE || 'pass3.html';
const [width, height] = size.split('x').map(Number);
const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width, height, scale: clipArg ? 2 : 1 });
  await page.goto(`${BASE}/${pageName}?auto=0&${query}`, { waitUntil: 'load' });
  await page.waitForFunction('window.appReady === true', { timeout: 180000 }).catch(() => errors.push('[timeout] app never became ready'));
  await new Promise((r) => setTimeout(r, 2500));
  const clip = clipArg ? (([x, y, w, h]) => ({ x, y, width: w, height: h }))(clipArg.split(',').map(Number)) : undefined;
  await page.screenshot({ path: `out/${name}.png`, clip });
  const info = await page.evaluate(() => {
    const c = document.getElementById('p3-view') ?? document.getElementById('pass3-view'), t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
    const x = t.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, t.width, t.height).data; const set = new Set();
    for (let i = 0; i < d.length; i += 4) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return { res: `${c.width}x${c.height}`, uniqueColours: set.size, stats: document.getElementById('stats')?.textContent };
  });
  console.log(name, JSON.stringify(info));
  if (errors.length) console.log(errors.slice(0, 20).join('\n'));
} finally { await browser.close(); }
