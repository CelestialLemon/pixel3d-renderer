// Inspect imported props at game scale in the existing renderer, without editing it.
// Requires the dev server: node assets/props/gallery-check.mjs [prop-id ...]
import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launch, newPage, open } from '../../tools/lib.ts';

const names = process.argv.slice(2);
const all = names.length ? names : (await readdir(new URL('../../public/props/', import.meta.url)))
  .filter(n => n.endsWith('.glb')).map(n => n.slice(0,-4)).sort();
const shots = [
  ...(!names.length ? [{ id: 'overview', zoom: 30, hour: 12 }] : []),
  ...all.map(id => ({ id, zoom: 11.5, hour: 12 })),
  ...all.filter(id => ['market_stall','well','villagers','snow_hut'].includes(id)).map(id => ({ id, zoom: 6, hour: 12 })),
  ...all.filter(id => ['street_lamp','street_lamp_cool','shop_front'].includes(id)).map(id => ({ id, zoom: 6, hour: 22 })),
];
const output = fileURLToPath(new URL('review/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 1000, height: 800 });
  page.on('response', response => {
    if (new URL(response.url()).pathname.startsWith('/props/') && response.status() >= 400)
      errors.push(`Asset HTTP ${response.status()}: ${response.url()}`);
  });
  for (const shot of shots) {
    const view = shot.id === 'overview' ? '' : `&view=${shot.id}`;
    await open(page, `pass3.html?scene=props${view}&zoom=${shot.zoom}&hour=${shot.hour}&px=3&time=8&auto=0&clean-ui=1`);
    const status = await page.evaluate(() => ({ stats: document.getElementById('stats')?.textContent,
      width: document.getElementById('p3-view')?.width, height: document.getElementById('p3-view')?.height }));
    assert(status.width > 0 && status.height > 0, 'Renderer canvas initialized');
    assert.match(status.stats ?? '', /tris.*base colors/, 'Scene built and palette quantized');
    assert.equal(errors.length, 0, errors.join('\n'));
    const filename = `${shot.id}-hour${shot.hour}-zoom${shot.zoom}.png`;
    await page.screenshot({ path: `${output}/${filename}` });
    console.log(filename, status.stats);
  }
  console.log(`Captured ${shots.length} renderer views with no browser/shader/asset errors.`);
} finally {
  await browser.close();
}
