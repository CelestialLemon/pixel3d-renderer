// Thin-feature stability on the test chart's thin bay: renders small orbit steps and, for every rail and pole width,
// samples points along the feature's centre line in the G-buffer the post shader reads.
//   gap    = share of samples where the feature is missing (broken into dots or gone)
//   toggle = share of samples that appear or disappear between consecutive frames (flicker)
// A stable feature has toggle 0. It may have gap 0 (always drawn) or 100 (consistently dropped).
//   node tools/thin-check.ts [frames=16] [stepDeg=0.25] [query]      e.g. query "zoom=14" (visible world height)
import type { Vector3 } from 'three';
import { launch, newPage, open } from './lib.ts';

const frames = Number(process.argv[2] || 16), step = Number(process.argv[3] || 0.25), extra = process.argv[4] || '';
const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 1200, height: 800 });
  await open(page, `pass3.html?auto=0&clean-ui=1&time=8&hour=12&scene=test-chart&view=thin&${extra}`);
  const rows = await page.evaluate((frames, step) => {
    const a = window.app3, p3 = a.p3, V3 = p3.camera.position.constructor as typeof Vector3;
    const WIDTHS = [0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.12, 0.16], cx = -8, cz = -4.5;
    // [label, width, from, to]; endpoints trimmed away from posts and occluders. The palette shifts colours, so each
    // label's reference colour is read from its widest instance in the first frame.
    type Vec = [number, number, number];
    const feats: [label: string, width: number, from: Vec, to: Vec][] = [];
    WIDTHS.forEach((w, i) => {
      const y = 0.3 + i * 0.24, x = cx - 3 + i * 0.42;
      feats.push(['rail-x', w, [cx + 0.7, y, cz - 2.4], [cx + 2.9, y, cz - 2.4]]);
      feats.push(['rail-z', w, [cx - 3, y, cz - 1.0], [cx - 3, y, cz + 0.8]]);
      feats.push(['pole', w, [x, 1.55, cz - 2.7], [x, 2.1, cz - 2.7]]);
      // Below y ~ 1 the front poles are partly hidden behind the wire-support pole at the default view.
      feats.push(['pole-front', w, [x, 1.0, cz - 2.1], [x, 1.3, cz - 2.1]]);
    });
    const N = 40, hits = feats.map((): boolean[][] => []), ref: Record<string, number[]> = {};
    const az0 = a.orbit.target.az;
    for (let f = 0; f < frames; f++) {
      a.orbit.target.az = az0 + (f * step * Math.PI) / 180; a.orbit.snap(); a.redraw(); a.render();
      const W = p3.width, H = p3.height, buf = p3.readAlbedo();
      const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? null : buf.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
      const proj = (p: Vec) => { const v = new V3(...p).project(p3.camera); return [(v.x * 0.5 + 0.5) * W, (v.y * 0.5 + 0.5) * H]; };
      if (f === 0) for (const [label, w, A, B] of feats) if (w === WIDTHS.at(-1)) {
        const m = proj(A.map((v, i) => (v + B[i]) / 2) as Vec); ref[label] = Array.from(at(Math.floor(m[0]), Math.floor(m[1]))!);
      }
      feats.forEach(([label, , A, B], k) => {
        const col = ref[label];
        const pa = proj(A), pb = proj(B), dx = pb[0] - pa[0], dy = pb[1] - pa[1], len = Math.hypot(dx, dy) || 1;
        const px = -dy / len, py = dx / len;
        const row: boolean[] = [];
        for (let s = 0; s < N; s++) {
          const t = (s + 0.5) / N, X = pa[0] + dx * t, Y = pa[1] + dy * t;
          let hit = false;
          for (const o of [0, 1, -1]) {
            const q = at(Math.floor(X + px * o), Math.floor(Y + py * o));
            if (q && q[3] > 0.5 && Math.abs(q[0] - col[0]) + Math.abs(q[1] - col[1]) + Math.abs(q[2] - col[2]) < 0.002) { hit = true; break; }
          }
          row.push(hit);
        }
        hits[k].push(row);
      });
    }
    a.orbit.target.az = az0; a.orbit.snap(); a.redraw();
    window.__texel = p3.viewHeight / p3.height;
    return feats.map(([label, w], k) => {
      const fr = hits[k]; let miss = 0, tog = 0, tot = 0, ttot = 0;
      fr.forEach((row, f) => row.forEach((h, s) => { tot++; if (!h) miss++; if (f > 0) { ttot++; if (h !== fr[f - 1][s]) tog++; } }));
      return { label, w, gap: Math.round((100 * miss) / tot), toggle: Math.round((100 * tog) / Math.max(ttot, 1)) };
    });
  }, frames, step);
  console.log(`texel ${(await page.evaluate(() => window.__texel)).toFixed(4)} world units per art pixel`);
  const labels = [...new Set(rows.map((r) => r.label))], widths = [...new Set(rows.map((r) => r.w))];
  console.log('gap% / toggle%   ' + widths.map((w) => String(w).padStart(9)).join(''));
  for (const l of labels) console.log(l.padEnd(17) + widths.map((w) => { const r = rows.find((x) => x.label === l && x.w === w)!; return `${r.gap}/${r.toggle}`.padStart(9); }).join(''));
  const t = rows.reduce((s, r) => s + r.toggle, 0) / rows.length, g = rows.reduce((s, r) => s + r.gap, 0) / rows.length;
  console.log(`mean gap ${g.toFixed(1)}%  mean toggle ${t.toFixed(1)}%`);
  if (errors.length) console.log(errors.join('\n'));
} finally { await browser.close(); }
