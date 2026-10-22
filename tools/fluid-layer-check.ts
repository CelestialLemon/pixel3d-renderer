// Runtime fluid layers (PixelRenderer.addFluid): a layer with no surfaces draws nothing, a flood's cells show where the ground is
// lower than its level and its level (`y`) moves it, hiding, clearing and removing a layer restore the image exactly, ice is
// a material change that holds still with the clock where water doesn't, a full material table throws without changing
// anything, and a scene with no fluids at all can still get a layer. Requires the dev server and pinned browser.
import assert from 'node:assert/strict';
import type { ViewerApp } from '../src/app/viewer/main.ts';
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 480, height: 300 });
  await open(page, 'pass3.html?scene=floodplain&auto=0&anim=0&time=8&hour=12&clean-ui=1&px=3');
  const result = await page.evaluate(async () => {
    const { FLUIDS } = await import('/src/renderer/index.ts');
    const app = (window as unknown as { app3: ViewerApp }).app3, p3 = app.p3;
    const canvas = document.getElementById('p3-view') as HTMLCanvasElement;
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
    const frame = (time: number) => {
      app.capture({ time });
      const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
      const ctx = c.getContext('2d')!; ctx.drawImage(canvas, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height).data;
    };
    const differing = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
      return n;
    };
    const out: Record<string, number> = {};
    // The floodplain: the plain is at y = 0 from x = -12 to the levee at x = 4, z from -1 to 5; the hill beyond is at 0.7.
    const plain = { x: -12, z: -1, cell: 1, cols: 16, rows: 6, heights: new Float32Array(16 * 6) };
    const base8 = frame(8), base9 = frame(9);

    const flood = p3.addFluid(FLUIDS.flood);
    check(differing(frame(8), base8) === 0, 'A layer with no surfaces draws nothing');
    flood.setCells(plain);
    flood.y = -0.5;
    check(differing(frame(8), base8) === 0, 'Water below the ground is hidden by it');
    let last = 0;
    for (const y of [0.1, 0.35, 0.6]) {
      flood.y = y;
      const n = out[`y${y}`] = differing(frame(8), base8);
      check(n > last, `A higher level covers more of the plain (${y}: ${n} after ${last})`);
      last = n;
    }
    flood.y = 0.35;
    const flooded = frame(8);
    check(differing(frame(8), flooded) === 0, 'A layer is a function of the clock');

    flood.visible = false;
    check(differing(frame(8), base8) === 0, 'A hidden layer draws nothing');
    flood.visible = true;
    check(differing(frame(8), flooded) === 0, 'Showing it again restores it');
    flood.clear();
    check(differing(frame(8), base8) === 0, 'A cleared layer draws nothing');
    flood.setCells(plain);
    check(differing(frame(8), flooded) === 0, 'Setting the same cells again draws the same');

    // Ice over the same cells: a different look, and it holds still where water moves.
    const waterFlood = frame(8), waterFlood9 = frame(9);
    flood.material = FLUIDS.ice;
    const iced = frame(8), iced9 = frame(9);
    out.iceVsWater = differing(iced, waterFlood);
    check(out.iceVsWater > 500, `Ice looks different from water (${out.iceVsWater})`);
    out.waterMoves = differing(waterFlood, waterFlood9) - differing(base8, base9);
    out.iceMoves = differing(iced, iced9) - differing(base8, base9);
    check(out.waterMoves > 200, `Water ripples with the clock (${out.waterMoves})`);
    check(out.iceMoves < 0.15 * out.waterMoves, `Ice holds still with the clock (${out.iceMoves} against ${out.waterMoves})`);
    flood.setCells(plain, [3, 0]);   // a strong current does not stir ice
    check(differing(frame(8), iced) === 0 && differing(frame(9), iced9) === 0, 'Ice ignores the flow it is given');
    flood.setCells(plain);
    flood.material = FLUIDS.flood;
    check(differing(frame(8), waterFlood) === 0, 'Back to water restores the image');

    // Removing a layer restores the image exactly.
    flood.remove();
    check(differing(frame(8), base8) === 0, 'A removed layer draws nothing');
    flood.setCells(plain);
    flood.y = 0.35;
    check(differing(frame(8), base8) === 0, 'A removed layer stays removed');

    // The material table: the scene's one water plus the viewer's flood and ice layers, then more, to the limit.
    const limit = p3.limits.fluidMaterials, layers = [] as ReturnType<typeof p3.addFluid>[];
    const held = p3.addFluid(FLUIDS.flood); held.setCells(plain); held.y = 0.35;
    const before = frame(8);
    let threw = 0;
    try {
      for (let i = 0; i < limit + 2; i++) layers.push(p3.addFluid({ ...FLUIDS.water, deep: 0x112233 + i * 0x10 }));
    } catch (e) { threw = e instanceof RangeError ? 1 : -1; }
    out.layersAdded = layers.length;
    check(threw === 1, 'A full material table throws a RangeError');
    check(layers.length === limit - 3, `The table held the scene's water, the viewer's two layers and ${limit - 3} more (${layers.length})`);
    check(differing(frame(8), before) === 0, 'A refused layer changes nothing');
    let refused = false;
    try { held.material = { ...FLUIDS.acid }; } catch (e) { refused = e instanceof RangeError; }
    check(refused && held.material === FLUIDS.flood && differing(frame(8), before) === 0, 'A refused material change changes nothing');
    layers[0].remove();
    held.material = { ...FLUIDS.acid };
    check(differing(frame(8), before) > 100, 'Removing a layer frees its slot');
    for (const l of layers) l.remove();
    held.remove();
    check(differing(frame(8), base8) === 0, 'Everything removed, the image is the scene again');
    return out;
  });

  // A scene with no fluids at all gets its targets when its first layer arrives, and gives the same image back after.
  await open(page, 'pass3.html?scene=objects&auto=0&anim=0&time=8&hour=12&clean-ui=1&px=3');
  const none = await page.evaluate(async () => {
    const { FLUIDS } = await import('/src/renderer/index.ts');
    const app = (window as unknown as { app3: ViewerApp }).app3, p3 = app.p3;
    const canvas = document.getElementById('p3-view') as HTMLCanvasElement;
    const frame = (time: number) => {
      app.capture({ time });
      const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
      const ctx = c.getContext('2d')!; ctx.drawImage(canvas, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height).data;
    };
    const differing = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
      return n;
    };
    const base = frame(8), fluids = p3.pixelScene.fluids.geometry.attributes.position.count;
    const layer = p3.addFluid(FLUIDS.flood);
    layer.setCells({ x: -6, z: -6, cell: 1, cols: 12, rows: 12, heights: new Float32Array(144).fill(0.05) });
    layer.y = 0.2;
    const shown = frame(8);
    layer.remove();
    return { fluids, shown: differing(shown, base), restored: differing(frame(8), base) };
  });
  assert.equal(none.fluids, 0, 'The objects scene has no fluids');
  assert.ok(none.shown > 500, `A layer in a scene with no fluids is drawn (${none.shown})`);
  assert.equal(none.restored, 0, 'And removing it gives the image back exactly');
  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.log('PASS: runtime fluid layers: level, hiding, ice, material table, removal, a scene with no fluids.', { ...result, none });
} finally { await browser.close(); }
