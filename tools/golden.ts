// Golden-image regression check: renders a fixed set of views with a frozen clock and compares them
// pixel for pixel against images saved earlier.
//   node tools/golden.ts --update   save the current output as the reference (golden/<set>/)
//   node tools/golden.ts            compare against the reference; exits 1 on any difference
//   node tools/golden.ts pass3      only the shots whose name contains "pass3"
// Output is only pixel-identical on the same platform, CPU architecture, GL backend, GPU and browser, so each combination keeps
// its own set of references in golden/<set>/ (`goldenSet` in lib.ts).
// The new render of each failed shot goes to golden/diff/<set>/; each run first removes the diffs of the shots it renders.
// Use this to prove a refactor changed nothing, and to see exactly which views a deliberate renderer change affects.
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launch, newPage, open, canvasPng, writePng, pixelDiff, glRenderer, goldenSet } from './lib.ts';

const VIEW = 'auto=0&clean-ui=1&time=8&px=3';
// Pass 0/1 references must never change; Pass 3 shots cover the times of day and the main camera framings.
const COMPARE = 'auto=0&az=38&el=38&px=3&clouds=0&time=8&clean-ui=1&sun=-62&sunEl=42&layout=wipe';
const SHOTS = [
  { name: 'pass0-standalone', path: `pass0.html?${COMPARE}`, canvas: 'view' },
  { name: 'compare-pass0', path: `?${COMPARE}`, canvas: 'pass0-view' },
  { name: 'compare-pass1', path: `?${COMPARE}`, canvas: 'pass1-view' },
  { name: 'compare-pass3', path: `?${COMPARE}`, canvas: 'pass3-view' },
  ...[8, 12, 17.5, 19.5, 22].map((h) => ({ name: `pass3-hour${h}`, path: `pass3.html?${VIEW}&hour=${h}`, canvas: 'p3-view' })),
  { name: 'pass3-landscape', path: `pass3.html?${VIEW}&hour=17.5&zoom=23&el=32`, canvas: 'p3-view' },
  { name: 'pass3-side', path: `pass3.html?${VIEW}&hour=12&az=120&el=50&zoom=12`, canvas: 'p3-view' },
  { name: 'pass3-door', path: `pass3.html?${VIEW}&hour=19.5&zoom=6&px=2`, canvas: 'p3-view' },
  { name: 'pass3-flat', path: `pass3.html?${VIEW}&hour=12&outline=0&dither=0&clean=0&contacts=0&clouds=0&glow=0&vignette=0`, canvas: 'p3-view' },
  // Test chart (src/scenes/test-chart): the overview at three times of day, then each bay's camera preset.
  ...[12, 17.5, 22].map((h) => ({ name: `chart-overview-hour${h}`, path: `pass3.html?${VIEW}&scene=test-chart&hour=${h}`, canvas: 'p3-view' })),
  ...['thin', 'curves', 'ink', 'ao', 'palette', 'lamps'].map((v) => ({ name: `chart-${v}`, path: `pass3.html?${VIEW}&scene=test-chart&view=${v}&hour=12`, canvas: 'p3-view' })),
  { name: 'chart-lamps-night', path: `pass3.html?${VIEW}&scene=test-chart&view=lamps&hour=22`, canvas: 'p3-view' },
  { name: 'chart-curves-golden', path: `pass3.html?${VIEW}&scene=test-chart&view=curves&hour=17.5`, canvas: 'p3-view' },
  // Lantern Row (night canal town): the default street view at night and golden hour, and six presets at night (water
  // reflections, the mill wheel, the relic glow, terrain and gardens).
  ...[22, 17.5].map((h) => ({ name: `village-street-hour${h}`, path: `pass3.html?${VIEW}&scene=village&hour=${h}`, canvas: 'p3-view' })),
  ...['overview', 'square', 'canal', 'mill', 'ruins', 'gardens'].map((v) => ({ name: `village-${v}`, path: `pass3.html?${VIEW}&scene=village&view=${v}&hour=22`, canvas: 'p3-view' })),
  // Water by day and the fountain's falling water, close up.
  { name: 'village-canal-hour12', path: `pass3.html?${VIEW}&scene=village&view=canal&hour=12`, canvas: 'p3-view' },
  { name: 'village-fountain', path: `pass3.html?${VIEW}&scene=village&view=fountain&hour=12`, canvas: 'p3-view' },
  // Fluids (src/scenes/fluids): every preset side by side, by day and at night.
  ...[12, 22].map((h) => ({ name: `fluids-hour${h}`, path: `pass3.html?${VIEW}&scene=fluids&hour=${h}`, canvas: 'p3-view' })),
  // The props gallery: every batch-1 prop, so a loader change that breaks a prop shows up here.
  { name: 'props-overview', path: `pass3.html?${VIEW}&scene=props&hour=12`, canvas: 'p3-view' },
  // Rigid game objects: shared crop instances, transformed normals, moving sun shadows and runtime visibility.
  ...['yard', 'field', 'balls'].map((v) => ({ name: `objects-${v}`, path: `pass3.html?${VIEW}&scene=objects&view=${v}&hour=12`, canvas: 'p3-view' })),
  { name: 'objects-yard-time2', path: `pass3.html?auto=0&clean-ui=1&time=2&px=3&scene=objects&view=yard&hour=12`, canvas: 'p3-view' },
  { name: 'objects-yard-night', path: `pass3.html?${VIEW}&scene=objects&view=yard&hour=22`, canvas: 'p3-view' },
];

process.chdir(fileURLToPath(new URL('..', import.meta.url)));   // golden/ paths are relative to the repo root
const args = process.argv.slice(2), update = args.includes('--update'), filter = args.find((a) => !a.startsWith('--'));
const shots = SHOTS.filter((s) => !filter || s.name.includes(filter));
const browser = await launch();
let failed = 0;
try {
  const { page, errors } = await newPage(browser);
  const renderer = await glRenderer(page), set = goldenSet(renderer);
  console.log(`golden set ${set} (${await browser.version()}, ${renderer})`);
  const noSet = !update && !existsSync(`golden/${set}`);
  if (noSet) {
    console.log(`No golden images for ${set} yet. Create them with \`npm run golden:update\` on a branch, from a commit whose output is known good.`);
    failed++;
  }
  let loaded = '';
  for (const shot of noSet ? [] : shots) {
    if (shot.path !== loaded) { await open(page, shot.path); loaded = shot.path; }
    const png = await canvasPng(page, shot.canvas);
    const ref = `golden/${set}/${shot.name}.png`, diff = `golden/diff/${set}/${shot.name}.png`;
    await rm(diff, { force: true });   // a stale diff from an earlier run must not outlive a now-identical shot
    if (update) { await writePng(ref, png); console.log('saved', shot.name); continue; }
    const saved = await readFile(ref).catch(() => null);
    if (!saved) { console.log('MISSING', shot.name, '(run with --update first)'); failed++; continue; }
    const result = await pixelDiff(page, 'data:image/png;base64,' + saved.toString('base64'), png);
    if (result.sizeMismatch || result.pixels > 0) {
      failed++;
      await writePng(diff, png);
      console.log('DIFF', shot.name, JSON.stringify(result));
    } else console.log('same', shot.name);
  }
  if (errors.length) { console.log(errors.join('\n')); failed++; }
} finally { await browser.close(); }
if (!update) console.log(failed ? `${failed} golden check(s) failed` : 'All golden images identical.');
process.exitCode = failed ? 1 : 0;
