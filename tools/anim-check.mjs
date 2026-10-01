// Motion check: renders the same camera at explicit clock times and reports how many pixels changed.
// Movement between t=2 and t=2.6 should be non-zero; the same time twice must be identical (determinism).
//   node tools/anim-check.mjs
import { launch, newPage, open } from './lib.mjs';

const browser = await launch();
try {
  const { page } = await newPage(browser, { width: 960, height: 600 });
  await open(page, 'pass3.html?auto=0&clean-ui=1&hour=12&anim=1&time=0');
  const grab = (t) => page.evaluate((t) => {
    const a = window.app3; a.p3.renderGeometry(t); a.p3.renderStyle(a.settings, t);
    const c = document.getElementById('p3-view'), k = document.createElement('canvas'); k.width = c.width; k.height = c.height;
    const x = k.getContext('2d'); x.drawImage(c, 0, 0); return Array.from(x.getImageData(0, 0, c.width, c.height).data);
  }, t);
  const diff = (p, q) => { let n = 0; for (let i = 0; i < p.length; i += 4) if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) n++; return [n, p.length / 4]; };
  const a = await grab(2), b = await grab(2.6), c = await grab(2);
  const [moved, total] = diff(a, b), [nondet] = diff(a, c);
  console.log(`moved t=2 vs t=2.6: ${moved}/${total} (${(100 * moved / total).toFixed(1)}%)`);
  console.log(`determinism t=2 vs t=2: ${nondet} pixels differ`);
  process.exitCode = moved > 0 && nondet === 0 ? 0 : 1;
} finally { await browser.close(); }
