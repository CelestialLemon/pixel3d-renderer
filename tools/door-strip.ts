// Sub-pixel flicker check: the front door at 8 tiny camera steps (0.4 degrees apart), as native art pixels
// enlarged 6x. Every frame should show the same plank grooves.
//   node tools/door-strip.ts [px=3] [name=strip]   ->  out/<name>.png
import type { Vector3 } from 'three';
import { launch, newPage, open, writePng } from './lib.ts';

const px = process.argv[2] || '3', name = process.argv[3] || 'strip';
const browser = await launch();
try {
  const { page } = await newPage(browser);
  await open(page, `pass3.html?auto=0&clean-ui=1&time=8&hour=12&px=${px}&az=38`);
  const url = await page.evaluate(() => {
    const a = window.app3, c = document.getElementById('p3-view') as HTMLCanvasElement, W = c.width, H = c.height;
    const frames = 8, S = 6, w = 32, h = 62, out = document.createElement('canvas'), tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H; out.width = (w * S + 6) * frames; out.height = h * S;
    const tctx = tmp.getContext('2d')!, octx = out.getContext('2d')!; octx.imageSmoothingEnabled = false;
    const V3 = a.p3.camera.position.constructor as typeof Vector3;
    for (let i = 0; i < frames; i++) {
      a.orbit.target.az = (38 + i * 0.4) * Math.PI / 180; a.orbit.snap(); a.redraw(); a.render();
      // door corners (world space) -> screen
      const pts = [[-0.6, 0.7], [0.6, 0.7], [-0.6, 2.8], [0.6, 2.8]].map(([x, y]) => {
        const v = new V3(x, y, 2.33).project(a.p3.camera); return [(v.x * 0.5 + 0.5) * W, (1 - (v.y * 0.5 + 0.5)) * H];
      });
      const x0 = Math.floor(Math.min(...pts.map((p) => p[0]))) - 2, y0 = Math.floor(Math.min(...pts.map((p) => p[1]))) - 2;
      tctx.clearRect(0, 0, W, H); tctx.drawImage(c, 0, 0);
      octx.drawImage(tmp, x0, y0, w, h, i * (w * S + 6), 0, w * S, h * S);
    }
    return out.toDataURL();
  });
  await writePng(`out/${name}.png`, url);
  console.log(`wrote out/${name}.png`);
} finally { await browser.close(); }
