// Render a smooth, deterministic video (or a still) of a scene: camera and hour keyframes, fixed simulated time steps,
// whole-multiple nearest-neighbour upscaling, encoded with ffmpeg. Writes out/timelapse/<name>.mp4 and <name>.camera.json.
//   node tools/timelapse.mjs day-to-night                      a preset from tools/timelapse-presets.mjs
//   node tools/timelapse.mjs my-clip.json                      a clip file in the same format as the presets
//   node tools/timelapse.mjs --view square --hour 8..22 --seconds 10   an ad-hoc clip (fixed camera, swept hour)
//   node tools/timelapse.mjs --still --view overview --hour 21  one PNG
// Options:
//   --url <base>        dev server (default $DEMO_URL or http://127.0.0.1:5180); --page <file> (default pass3.html)
//   --scene <id> --view <preset> --hour <h|a..b> --time <s>   ad-hoc clip, or overrides for a preset's scene / start clock
//   --query <a=1&b=2>   extra page parameters (any URL parameter the page understands, e.g. "az=40&zoom=20")
//   --res 1080p|4k|<WxH> (default 1080p)  --scale <n> (whole multiple; default 4 for 1080p, 8 for 4K, so 480x270 art)
//   --fps 30|60 (default 30)  --seconds <s>  --crf <n> (default 12)  --name <name>  --keep-frames  --still
//   --workers <n>       parallel headless browsers (default 1); the frames are identical whichever worker draws them
//   --tier hook|legacy|url  force a page driver (normally detected, see below)
// Drivers: `hook` uses app3.capture (this repo since the time-lapse tool). `legacy` drives app3's view, setHour and
// renderGeometry/renderStyle, which every version of the viewer has had. `url` reloads the page for every frame with the
// camera, hour and clock in the URL: slow, but it needs nothing from the page beyond its URL parameters.
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { launch } from './lib.mjs';
import { PRESETS } from './timelapse-presets.mjs';

const FFMPEG = process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg';
const CHANNELS = ['az', 'el', 'zoom', 'tx', 'tz', 'hour'];
const DEG = Math.PI / 180;

// ---- options ----
const fail = (msg) => { console.error(`timelapse: ${msg}`); process.exit(1); };
const FLAGS = ['keep-frames', 'still'];
const VALUES = ['url', 'page', 'scene', 'view', 'hour', 'time', 'query', 'res', 'scale', 'fps', 'seconds', 'crf', 'name', 'workers', 'tier'];
const argv = process.argv.slice(2), opts = {}, positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const eq = a.indexOf('='), key = a.slice(2, eq < 0 ? undefined : eq);
  if (FLAGS.includes(key)) opts[key] = true;
  else if (!VALUES.includes(key)) fail(`unknown option --${key}`);
  else if (eq >= 0) opts[key] = a.slice(eq + 1);
  else if (i + 1 < argv.length) opts[key] = argv[++i];
  else fail(`--${key} needs a value`);
}

const clipArg = positional[0];
let clip;
if (!clipArg) clip = { keys: [{ at: 0 }] };
else if (PRESETS[clipArg]) clip = structuredClone(PRESETS[clipArg]);
else if (clipArg.endsWith('.json')) clip = JSON.parse(await readFile(clipArg, 'utf8'));
else fail(`unknown preset "${clipArg}" (presets: ${Object.keys(PRESETS).join(', ')})`);
clip.keys ??= [{ at: 0 }];
if (opts.scene) clip.scene = opts.scene;
if (opts.view) clip.keys[0].view = opts.view;
if (opts.hour) {
  const [a, b] = opts.hour.split('..').map(Number);
  if (!Number.isFinite(a) || (b !== undefined && !Number.isFinite(b))) fail(`bad --hour "${opts.hour}"`);
  // --hour replaces the clip's own hours: a fixed hour stays fixed, a sweep goes exactly from a to b.
  for (const k of clip.keys) delete k.hour;
  clip.linear = (clip.linear ?? []).filter((c) => c !== 'hour');
  clip.keys[0].hour = a;
  if (b !== undefined) { clip.keys.push({ at: Infinity, hour: b }); clip.linear = [...(clip.linear ?? []), 'hour']; }
}
if (opts.seconds) {
  const s = +opts.seconds, old = clip.seconds;
  if (!(s > 0)) fail(`bad --seconds "${opts.seconds}"`);
  for (const k of clip.keys) k.at = old ? k.at * s / old : k.at;
  clip.seconds = s;
}
clip.seconds ??= 4;
// The canal town, unless the clip or --scene says otherwise (old pages without ?scene= ignore it).
clip.scene ??= 'village';
for (const k of clip.keys) if (k.at === Infinity || k.at > clip.seconds) k.at = clip.seconds;
clip.keys.sort((p, q) => p.at - q.at);

const still = !!opts.still;
const fps = still ? 1 : +(opts.fps ?? 30);
if (!(fps > 0)) fail(`bad --fps "${opts.fps}"`);
const res = (opts.res ?? '1080p').toLowerCase();
const [outW, outH] = res === '1080p' ? [1920, 1080] : res === '4k' ? [3840, 2160] : res.split('x').map(Number);
const scale = +(opts.scale ?? (res === '4k' ? 8 : 4));
if (!Number.isInteger(scale) || scale < 1) fail('--scale must be a whole number of at least 1');
if (!(outW > 0 && outH > 0) || outW % scale || outH % scale) fail(`${outW}x${outH} is not a whole multiple of --scale ${scale}`);
// H.264 in 4:2:0 needs even dimensions; a still can be any size.
if (!still && (outW % 2 || outH % 2)) fail(`video size ${outW}x${outH} must be even in both dimensions`);
const artW = outW / scale, artH = outH / scale;
const frameCount = still ? 1 : Math.max(1, Math.round(clip.seconds * fps));
const startTime = +(opts.time ?? clip.time ?? 0);
const workers = Math.max(1, Math.min(+(opts.workers ?? 1) | 0, frameCount));
const base = (opts.url ?? process.env.DEMO_URL ?? 'http://127.0.0.1:5180').replace(/\/$/, '');
const pageName = opts.page ?? 'pass3.html';
const name = opts.name ?? (clipArg ? clipArg.replace(/^.*\//, '').replace(/\.json$/, '') : 'clip') + (still ? '-still' : '');
const outDir = 'out/timelapse', framesDir = `${outDir}/${name}-frames`;

// The page always gets: no auto-orbit, hidden UI, one canvas pixel per art pixel, and a frozen clock (so its own
// animation loop never runs ahead of the frames we ask for).
const pageQuery = (extra = {}) => {
  const q = new URLSearchParams(opts.query ?? clip.query ?? '');
  if (clip.scene) q.set('scene', clip.scene);
  const firstView = clip.keys[0].view;
  if (firstView && !q.has('view')) q.set('view', firstView);
  for (const [k, v] of Object.entries({ auto: 0, 'clean-ui': 1, px: 1, time: startTime, ...extra })) q.set(k, String(v));
  return `${base}/${pageName}?${q}`;
};

// ---- keyframes -> per-frame camera and hour ----
/** Resolve keys into per-channel point lists. `start` is the page's own camera and hour; `presets` the scene's views. */
function tracks(start, presets) {
  const points = Object.fromEntries(CHANNELS.map((c) => [c, []]));
  const last = { ...start };
  for (const key of clip.keys) {
    const values = {};
    if (key.view) {
      const p = presets.find((v) => v.name.toLowerCase() === String(key.view).toLowerCase());
      if (!p) fail(`scene has no view "${key.view}" (views: ${presets.map((v) => v.name).join(', ') || 'none'})`);
      Object.assign(values, { el: p.el, zoom: p.size });
      if (p.tx !== undefined) values.tx = p.tx;
      if (p.tz !== undefined) values.tz = p.tz;
      // A preset's azimuth is a direction, so take the turn nearest to where the camera already is.
      if (p.az !== undefined) values.az = p.az + 360 * Math.round((last.az - p.az) / 360);
    }
    for (const c of CHANNELS) if (key[c] !== undefined) values[c] = key[c];
    for (const [c, v] of Object.entries(values)) {
      // A later key at the same time replaces the earlier one (a zero-length segment has no slope).
      const list = points[c];
      if (list.length && list[list.length - 1][0] === key.at) list.pop();
      list.push([key.at, v]); last[c] = v;
    }
  }
  for (const c of CHANNELS) if (!points[c].length || points[c][0][0] > 0) points[c].unshift([0, start[c]]);
  return points;
}

/** Piecewise cubic through the points: still at both ends, monotone (no overshoot) through the middle. */
function sample(pts, t, linear) {
  if (t <= pts[0][0]) return pts[0][1];
  const n = pts.length;
  if (t >= pts[n - 1][0]) return pts[n - 1][1];
  let i = 0;
  while (t > pts[i + 1][0]) i++;
  const [t0, p0] = pts[i], [t1, p1] = pts[i + 1], h = t1 - t0, u = (t - t0) / h;
  if (linear) return p0 + (p1 - p0) * u;
  const slope = (j) => (pts[j + 1][1] - pts[j][1]) / (pts[j + 1][0] - pts[j][0]);
  const tangent = (j) => {
    if (j === 0 || j === n - 1) return 0;
    const a = slope(j - 1), b = slope(j);
    if (a * b <= 0) return 0;
    const m = (pts[j + 1][1] - pts[j - 1][1]) / (pts[j + 1][0] - pts[j - 1][0]);
    return Math.sign(m) * Math.min(Math.abs(m), 3 * Math.abs(a), 3 * Math.abs(b));
  };
  const m0 = tangent(i) * h, m1 = tangent(i + 1) * h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
}

function plan(start, presets) {
  const pts = tracks(start, presets), linear = new Set(clip.linear ?? []);
  // Zoom eases in log space, so zooming in and out feel equally fast.
  pts.zoom = pts.zoom.map(([t, v]) => [t, Math.log(v)]);
  return Array.from({ length: frameCount }, (_, i) => {
    // The camera spans the whole clip (the last frame lands on the last key); the clock steps exactly 1/fps per frame.
    const at = frameCount > 1 ? i / (frameCount - 1) * clip.seconds : 0;
    const v = Object.fromEntries(CHANNELS.map((c) => [c, sample(pts[c], at, linear.has(c))]));
    v.zoom = Math.exp(v.zoom);
    v.el = Math.min(Math.max(v.el, 5), 89);
    return { i, at: +at.toFixed(6), time: +(startTime + i / fps).toFixed(6), hour: ((v.hour % 24) + 24) % 24,
      view: { az: v.az, el: v.el, zoom: v.zoom, tx: v.tx, tz: v.tz } };
  });
}

// ---- page drivers ----
const toOrbit = (v) => ({ az: v.az * DEG, el: v.el * DEG, size: v.zoom, tx: v.tx, tz: v.tz });

async function openPage(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: artW, height: artH, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  // Every version of the viewer sets appReady; give pages without it a moment to draw instead.
  await page.waitForFunction(() => window.appReady === true, { timeout: 180000 }).catch(() => new Promise((r) => setTimeout(r, 5000)));
  if (errors.length) console.warn(`page errors:\n  ${errors.slice(0, 5).join('\n  ')}`);
  return page;
}

/** The page's current camera (degrees), hour, scene views and which driver it supports. */
const probe = (page) => page.evaluate(() => {
  const a = window.app3, o = a && (a.orbit ?? a), DEG = Math.PI / 180;
  const hourEl = document.getElementById('hour');
  const tier = typeof a?.capture === 'function' ? 'hook' : a?.p3?.renderGeometry && o?.view && o?.target && a.setHour ? 'legacy' : 'url';
  const v = o?.view;
  return {
    tier, presets: (a?.orbit?.scene ?? a?.scene?.view)?.presets?.map(({ name, size, el, az, tx, tz }) => ({ name, size, el, az, tx, tz })) ?? [],
    start: v ? { az: v.az / DEG, el: v.el / DEG, zoom: v.size, tx: v.tx, tz: v.tz, hour: a.hour ?? (hourEl ? +hourEl.value : 17.5) } : null,
  };
});

/** Draw one frame and return its pixels as base64 RGBA at art resolution. */
const drawFrame = (page, tier, f) => page.evaluate((tier, f) => {
  const a = window.app3;
  if (tier === 'hook') a.capture({ time: f.time, hour: f.hour, view: f.view });
  else if (tier === 'legacy') {
    const o = a.orbit ?? a;
    a.setHour(f.hour);
    Object.assign(o.target, Object.assign(o.view, f.view));
    // render() places the camera (and draws at the page's frozen clock); then redraw at this frame's clock.
    a.redraw?.(); a.render();
    a.p3.renderGeometry(f.time); a.p3.renderStyle(a.settings, f.time);
  }
  const c = document.getElementById('p3-view') ?? document.getElementById('pass3-view') ?? document.querySelector('canvas');
  const k = document.createElement('canvas'); k.width = c.width; k.height = c.height;
  const x = k.getContext('2d'); x.drawImage(c, 0, 0);
  const bytes = new Uint8Array(x.getImageData(0, 0, c.width, c.height).data.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { w: c.width, h: c.height, data: btoa(s) };
}, tier, { ...f, view: tier === 'url' ? null : toOrbit(f.view) });

const urlForFrame = (f) => pageQuery({ time: f.time, hour: +f.hour.toFixed(4), az: f.view.az, el: f.view.el, zoom: f.view.zoom, tx: f.view.tx, tz: f.view.tz, anim: 1 });

/** RGBA base64 -> RGB buffer, checking the canvas really is art-sized (an old page may ignore ?px=). */
function toRgb({ w, h, data }) {
  if (w !== artW || h !== artH) fail(`the page drew ${w}x${h}, expected ${artW}x${artH} (does it support ?px=1?)`);
  const rgba = Buffer.from(data, 'base64'), rgb = Buffer.alloc(w * h * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
  return rgb;
}

// ---- ffmpeg ----
function encoder() {
  // Nearest-neighbour upscale by a whole multiple, then BT.709 limited-range YUV (what players and YouTube expect).
  const up = `scale=iw*${scale}:ih*${scale}:flags=neighbor`;
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${artW}x${artH}`, '-r', String(fps), '-i', '-'];
  if (still) args.push('-vf', up, '-frames:v', '1', `${outDir}/${name}.png`);
  else {
    args.push('-vf', `${up}:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709`, '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation',
      '-crf', String(opts.crf ?? 12), '-movflags', '+faststart', `${outDir}/${name}.mp4`);
    if (opts['keep-frames']) args.push('-vf', up, `${framesDir}/%05d.png`);
  }
  const proc = spawn(FFMPEG, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => { proc.on('error', reject); proc.on('close', (code) => (code ? reject(new Error(`ffmpeg exited with ${code}`)) : resolve())); });
  return { stdin: proc.stdin, done };
}

// ---- main ----
await mkdir(outDir, { recursive: true });
if (opts['keep-frames'] && !still) { await rm(framesDir, { recursive: true, force: true }); await mkdir(framesDir, { recursive: true }); }

const browsers = await Promise.all(Array.from({ length: workers }, launch));
try {
  const t0 = Date.now();
  const pages = await Promise.all(browsers.map((b) => openPage(b, pageQuery())));
  const info = await probe(pages[0]);
  const tier = opts.tier ?? info.tier;
  if (tier !== 'url' && !info.start) fail(`the page has no app3 view, so it can only use --tier url`);
  // Without a view to read, the url tier starts from the scene's first preset, or the keys must give every channel.
  const start = info.start ?? { az: 30, el: 38, zoom: 22, tx: 0, tz: 0, hour: 17.5, ...(info.presets[0] && { el: info.presets[0].el, zoom: info.presets[0].size }) };
  const frames = plan(start, info.presets);
  console.log(`${name}: ${frameCount} frame${frameCount > 1 ? 's' : ''} at ${fps} fps, art ${artW}x${artH} x${scale} = ${outW}x${outH}, driver ${tier}, ${workers} worker${workers > 1 ? 's' : ''}`);
  await writeFile(`${outDir}/${name}.camera.json`, JSON.stringify({
    name, tier, url: pageQuery(), fps, art: [artW, artH], scale, output: [outW, outH], seconds: clip.seconds, startTime, clip,
    frames: frames.map(({ i, at, time, hour, view }) => ({ i, at, time, hour, view })),
  }, null, 1));

  const enc = encoder();
  // Workers take every n-th frame; frames are written to ffmpeg in order, and a worker that gets too far ahead waits.
  const pending = new Map();
  let next = 0, wake = () => {};
  const ahead = 4 * workers;
  const writer = (async () => {
    while (next < frameCount) {
      if (!pending.has(next)) { await new Promise((r) => (wake = r)); continue; }
      const buf = pending.get(next); pending.delete(next); next++;
      if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
      if (next % Math.max(1, Math.round(fps)) === 0 || next === frameCount) {
        const s = (Date.now() - t0) / 1000;
        process.stdout.write(`\r  ${next}/${frameCount} frames, ${s.toFixed(0)} s elapsed, ~${(s / next * (frameCount - next)).toFixed(0)} s left   `);
      }
      wake = () => {}; releaseAll();
    }
    enc.stdin.end();
  })();
  let waiters = [];
  const releaseAll = () => { const w = waiters; waiters = []; w.forEach((r) => r()); };
  await Promise.all(pages.map(async (page, w) => {
    for (let i = w; i < frameCount; i += workers) {
      while (i >= next + ahead) await new Promise((r) => waiters.push(r));
      const f = frames[i];
      if (tier === 'url') await page.goto(urlForFrame(f), { waitUntil: 'load' }).then(() => page.waitForFunction(() => window.appReady === true, { timeout: 180000 }).catch(() => {}));
      pending.set(i, toRgb(await drawFrame(page, tier, f)));
      wake();
    }
  }));
  await writer;
  await enc.done;
  process.stdout.write('\n');
  console.log(`wrote ${outDir}/${name}.${still ? 'png' : 'mp4'}${opts['keep-frames'] && !still ? ` and ${framesDir}/` : ''} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
} finally {
  await Promise.all(browsers.map((b) => b.close()));
}
