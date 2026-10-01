// Lay the native pass captures side by side at an exact 2x scale (no interpolation), labelled.
// Run tools/verify.mjs first: it writes out/<pass>-native.png.
//   node tools/comparison-sheet.mjs   ->  out/passes.png
import { readFile } from 'node:fs/promises';
import { launch, writePng } from './lib.mjs';

const PASSES = [
  ['pass0', 'PASS 0', 'Original renderer, preserved'],
  ['pass1', 'PASS 1', 'Refined shadows, colors, contacts and edges'],
  ['pass3', 'PASS 3', 'Living world, time of day, lamp light, leaf clumps'],
];
const images = await Promise.all(PASSES.map(async ([id, label, summary]) => ({
  label, summary, data: 'data:image/png;base64,' + (await readFile(`out/${id}-native.png`)).toString('base64'),
})));
const browser = await launch();
try {
  const page = await browser.newPage();
  const url = await page.evaluate(async (images) => {
    const decoded = await Promise.all(images.map(async ({ data }) => { const i = new Image(); i.src = data; await i.decode(); return i; }));
    const w = decoded[0].width * 2, h = decoded[0].height * 2;
    const c = document.createElement('canvas'); c.width = 16 + (w + 16) * images.length; c.height = h + 100;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#fff9e9'; ctx.fillRect(0, 0, c.width, c.height);
    images.forEach((img, i) => {
      const x = 16 + i * (w + 16);
      ctx.fillStyle = '#493c32'; ctx.font = 'bold 20px monospace'; ctx.fillText(img.label, x, 30);
      ctx.font = '12px monospace'; ctx.fillStyle = '#857762'; ctx.fillText(img.summary, x, 51);
      ctx.drawImage(decoded[i], x, 64, w, h);
    });
    ctx.font = '11px monospace'; ctx.fillStyle = '#857762';
    ctx.fillText('COOKIE CO. / Same model, camera, sun and art-pixel size. / 2x nearest-neighbor enlargement.', 16, c.height - 14);
    return c.toDataURL();
  }, images);
  await writePng('out/passes.png', url);
  console.log('wrote out/passes.png');
} finally { await browser.close(); }
