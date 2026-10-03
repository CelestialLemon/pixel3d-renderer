// Palette diagnostics on unquantised copies of every registered scene.
// Requires the dev server. DEMO_URL / CHROME_PATH select server/browser (tools/lib.ts).
// K=80 REPORT_THRESHOLD=0.05 MAX_ERROR=0.10
// ΔE_OK is Euclidean OKLab distance on linear RGB, without the quantizer's chroma multiplier.
// MAX_ERROR limits the worst input -> output error, including gamut clipping. Pair spread
// measures the widest separation of original colours assigned to the same output colour.
import assert from 'node:assert/strict';
import type { BufferAttribute, InterleavedBufferAttribute } from 'three';
import { launch, newPage, open } from './lib.ts';

const number = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  assert.ok(Number.isFinite(value) && value >= 0, `${name} must be a finite non-negative number`);
  return value;
};
const K = number('K', 80);
assert.ok(Number.isInteger(K) && K > 0, 'K must be a positive integer');
const threshold = number('REPORT_THRESHOLD', 0.05), limit = number('MAX_ERROR', 0.10);

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0');
  const reports = await page.evaluate(async ({ K, threshold }) => {
    const { SCENES } = await import('/src/scenes/index.ts');
    const { quantizePalette } = await import('/src/renderer/palette.ts');
    type Rgb = [number, number, number];
    const lab = ([r, g, b]: Rgb): Rgb => {
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
    };
    const delta = (a: Rgb, b: Rgb) => Math.hypot(...a.map((v, i) => v - b[i]));
    const rgbAt = (col: BufferAttribute | InterleavedBufferAttribute, i: number): Rgb => [col.getX(i), col.getY(i), col.getZ(i)];
    // Exact sRGB transfer for display labels; never group by these rounded labels.
    const hex = (rgb: Rgb) => '#' + rgb.map((v) => {
      v = Math.min(1, Math.max(0, v));
      return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))
        .toString(16).padStart(2, '0');
    }).join('');
    const reports = [];
    for (const scene of SCENES) {
      const raw = await scene.build(1e6);
      const original = [raw.staticGeometry, raw.dynamicGeometry];
      const inputs = new Map();
      for (const geometry of original) {
        const col = geometry.attributes.aColor;
        for (let i = 0; i < col.count; i++) {
          const rgb = rgbAt(col, i), key = rgb.join(',');
          if (!inputs.has(key)) inputs.set(key, { rgb, lab: lab(rgb), hex: hex(rgb) });
        }
      }
      try {
        const copies = original.map((geometry) => geometry.clone());
        try {
          const used = quantizePalette(copies, K);
          const groups = new Map();
          let worst = { error: 0, input: null, output: null }, valid = true;
          original.forEach((geometry, g) => {
            const before = geometry.attributes.aColor, after = copies[g].attributes.aColor;
            for (let i = 0; i < before.count; i++) {
              const inputKey = rgbAt(before, i).join(','), input = inputs.get(inputKey);
              const rgb = rgbAt(after, i), outputKey = rgb.join(',');
              valid &&= rgb.every((v) => Number.isFinite(v) && v >= 0 && v <= 1);
              if (!groups.has(outputKey)) groups.set(outputKey, { hex: hex(rgb), lab: lab(rgb), inputs: new Map() });
              const group = groups.get(outputKey);
              group.inputs.set(inputKey, (group.inputs.get(inputKey) ?? 0) + 1);
              const error = delta(input.lab, group.lab);
              if (error > worst.error) worst = { error, input: input.hex, output: group.hex };
            }
          });
          let worstSpread = 0;
          const merges = [];
          for (const group of groups.values()) {
            const members = [...group.inputs].map(([key, vertices]) => ({ ...inputs.get(key), vertices }));
            let spread = 0, error = 0;
            for (let i = 0; i < members.length; i++) {
              error = Math.max(error, delta(members[i].lab, group.lab));
              for (let j = i + 1; j < members.length; j++) spread = Math.max(spread, delta(members[i].lab, members[j].lab));
            }
            worstSpread = Math.max(worstSpread, spread);
            if (members.length > 1 && Math.max(error, spread) >= threshold) {
              merges.push({ output: group.hex, error, spread,
                inputs: members.map(({ hex, vertices }) => ({ hex, vertices })) });
            }
          }
          merges.sort((a, b) => b.spread - a.spread || b.error - a.error);
          reports.push({ scene: scene.id, inputs: inputs.size, used,
            outputColours: groups.size, valid, worst, worstSpread, merges });
        } finally { copies.forEach((geometry) => geometry.dispose()); }
      } finally { original.forEach((geometry) => geometry.dispose()); }
    }
    return reports;
  }, { K, threshold });

  const failures = [];
  for (const r of reports) {
    console.log(`\n${r.scene}: ${r.inputs} inputs -> ${r.outputColours} output colours (${r.used} clusters, K=${K})`);
    console.log(`  worst ΔE_OK input -> output: ${r.worst.error.toFixed(5)} (${r.worst.input ?? 'none'} -> ${r.worst.output ?? 'none'}); widest merged pair: ${r.worstSpread.toFixed(5)}`);
    for (const m of r.merges) console.log(`  ${m.output} <= ${m.inputs.map((c) => `${c.hex}(${c.vertices})`).join(' ')}; error=${m.error.toFixed(5)}, spread=${m.spread.toFixed(5)}`);
    if (!r.valid) failures.push(`${r.scene}: output colour is non-finite or outside [0, 1]`);
    if (r.outputColours > K) failures.push(`${r.scene}: ${r.outputColours} colours exceeds K=${K}`);
    if (r.worst.error > limit) failures.push(`${r.scene}: worst ΔE_OK ${r.worst.error.toFixed(5)} exceeds MAX_ERROR=${limit}`);
  }
  assert.deepEqual(errors, [], 'No browser or shader errors');
  assert.deepEqual(failures, [], 'Palette quality limits');
  console.log(`\nPASS: ${reports.length} scene checks; worst input error <= ${limit}.`);
} finally { await browser.close(); }
