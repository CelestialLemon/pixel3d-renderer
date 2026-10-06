// Smoke check of the example game (examples/walker) against the built package: it starts, walks, stops at walls, and
// places and removes things by clicking. Serves the example itself (on a free port); run `npm run build:lib` first, which
// `npm run example-check` does. Screenshots go to out/example/.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch, newPage, writePng } from './lib.ts';

interface Walker { player: { position: { x: number; z: number } }; placed: Map<string, unknown>; renderer: { camera: unknown; canvas: HTMLCanvasElement } }
declare global { interface Window { walker: Walker } }

// Any free port: the example's usual 5181 may be taken by someone's `npm run example`.
const server = await createServer({ configFile: new URL('../examples/walker/vite.config.ts', import.meta.url).pathname, logLevel: 'error', server: { port: 5190, strictPort: false } });
await server.listen();
const url = server.resolvedUrls!.local[0];
const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 960, height: 600 });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.walker !== undefined, { timeout: 60000 });
  const frames = () => page.evaluate(() => new Promise<void>((r) => { let n = 0; const f = () => (++n > 10 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
  const position = () => page.evaluate(() => ({ ...window.walker.player.position }));
  const shot = async (name: string) => writePng(`out/example/${name}.png`, await page.$eval('#view', (c) => (c as HTMLCanvasElement).toDataURL('image/png')));
  const hold = async (key: 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD', ms: number) => {
    await page.keyboard.down(key); await new Promise((r) => setTimeout(r, ms)); await page.keyboard.up(key); await frames();
  };
  await frames();
  await shot('start');

  const start = await position();
  await hold('KeyW', 700);
  const walked = await position();
  assert.ok(Math.hypot(walked.x - start.x, walked.z - start.z) > 0.5, `W moves the walker (${JSON.stringify(start)} -> ${JSON.stringify(walked)})`);

  // Long walks in every direction end against the garden wall (1 m thick around the 20 x 14 m map), never inside it.
  for (const key of ['KeyA', 'KeyS', 'KeyD', 'KeyW'] as const) {
    await hold(key, 4500);
    const p = await position();
    assert.ok(p.x > 1.2 && p.x < 18.8 && p.z > 1.2 && p.z < 12.8, `${key}: the walker stays inside the walls (${JSON.stringify(p)})`);
  }
  await shot('walked');

  // Click the tile two metres from the walker that is free, and check something appears there; click it again to remove it.
  const target = await page.evaluate(() => {
    const { player, renderer } = window.walker;
    const cam = renderer.camera as { projectionMatrix: { elements: number[] }; matrixWorldInverse: { elements: number[] } };
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]]) {
      const col = Math.floor(player.position.x) + dx, row = Math.floor(player.position.z) + dz;
      // Project the tile centre (orthographic: one matrix multiply each) to the canvas.
      const v = [col + 0.5, 0, row + 0.5, 1], mul = (m: number[], p: number[]) => [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * p[3]);
      const ndc = mul(cam.projectionMatrix.elements, mul(cam.matrixWorldInverse.elements, v));
      const rect = renderer.canvas.getBoundingClientRect();
      const x = rect.left + (ndc[0] + 1) / 2 * rect.width, y = rect.top + (1 - ndc[1]) / 2 * rect.height;
      if (x > 20 && y > 20 && x < rect.width - 20 && y < rect.height - 20) return { x, y, col, row };
    }
    return null;
  });
  assert.ok(target, 'a tile near the walker is on screen');
  let placedAt = '';
  for (const dy of [0, 3, -3, 6]) {   // the projected centre can fall on a flower or tuft: nudge it if nothing was placed
    await page.mouse.click(target.x, target.y + dy);
    await frames();
    const keys = await page.evaluate(() => [...window.walker.placed.keys()]);
    if (keys.length) { placedAt = keys[0]; break; }
  }
  assert.ok(placedAt, `clicking a free tile places something (${JSON.stringify(target)})`);
  await shot('placed');
  await page.mouse.click(target.x, target.y - 4);   // on the placed thing, a little above the ground
  await frames();
  assert.equal(await page.evaluate(() => window.walker.placed.size), 0, 'clicking the placed thing removes it');

  assert.deepEqual(errors, [], 'no page errors');
  console.log(`example-check: ok (walked, walls hold, placed at ${placedAt} and removed). Screenshots in out/example/.`);
} finally {
  await browser.close();
  await server.close();
}
