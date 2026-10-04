// Inspect an encoded capture; diagnostics are evidence, not proof of perceptual quality.
// node tools/video-check.ts out/timelapse/overview.mp4 [--log file.camera.json]
//   [--art 480x270] [--tolerance 12] [--static x,y,w,h] [--reference frames/%05d.png]
// --static uses ART pixels and is valid only for a fixed camera/hour and an unanimated region.
// --reference is an ffmpeg image sequence of original PNGs (art-size or nearest-upscaled; starting at 0 or 1).
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const FFMPEG = process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || join(dirname(FFMPEG), 'ffprobe');

// The fields read from a capture's camera log (tools/timelapse.ts) and from ffprobe's JSON; both are checked as they are read.
interface CameraLog { fps: number; art?: number[]; output?: number[]; scale?: number; frames: { i: number; time: number; hour: number; view?: Record<string, number> }[] }
interface Probe { streams?: { width: number; height: number; avg_frame_rate: string; pix_fmt: string }[]; frames?: { best_effort_timestamp_time: string }[] }
interface CameraStats { maxStep: number; maxSecondDifference: number; meanSecondDifference: number; spikes?: { i: number; value: number }[] }

function command(name: string, args: string[]) {
  const p = spawnSync(name, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (p.error || p.status !== 0) throw new Error(`${name}: ${p.error?.message ?? p.stderr}`);
  return p.stdout;
}
async function* rgbFrames(args: string[], size: number) {
  const p = spawn(FFMPEG, ['-v', 'error', ...args, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let error = '', failure: Error | undefined;
  p.stderr.on('data', b => { error += b; });
  const done = new Promise(resolve => {
    p.on('error', e => { failure = e; resolve(-1); });
    p.on('close', resolve);
  });
  const frame = Buffer.allocUnsafe(size);
  let used = 0;
  try {
    for await (const chunk of p.stdout) {
      let offset = 0;
      while (offset < chunk.length) {
        const n = Math.min(size - used, chunk.length - offset);
        chunk.copy(frame, used, offset, offset + n); used += n; offset += n;
        if (used === size) { yield Buffer.from(frame); used = 0; }
      }
    }
    const code = await done;
    if (code !== 0 || used) throw new Error(`ffmpeg decode: ${failure?.message ?? error ?? ''} (exit ${code}, trailing bytes ${used})`);
  } finally { if (p.exitCode === null) p.kill(); }
}
const max = (a: number[]) => a.reduce((m, x) => Math.max(m, x), 0);
const average = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const rounded = (n: number) => Math.round(n * 1e6) / 1e6;

async function main() {
  const args = process.argv.slice(2), file = args.shift();
  if (!file || file === '--help') {
    console.log('Usage: node tools/video-check.ts VIDEO [--log JSON] [--art WxH] [--tolerance 12] [--static x,y,w,h] [--reference frames/%05d.png]');
    return;
  }
  const opts: Record<string, string | undefined> = {};
  while (args.length) {
    const key = args.shift()!;
    if (!['--log', '--art', '--tolerance', '--static', '--reference'].includes(key) || !args.length) throw new Error(`Unknown/incomplete option ${key}`);
    opts[key.slice(2)] = args.shift();
  }
  const tolerance = Number(opts.tolerance ?? 12);
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 255) throw new Error('Tolerance must be between 0 and 255');
  let log: CameraLog | undefined;
  try { log = JSON.parse(await readFile(opts.log ?? file.replace(/\.[^.]+$/, '.camera.json'), 'utf8')); }
  catch (e) { if (opts.log || (e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const probe: Probe = JSON.parse(command(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-show_frames', '-show_entries', 'stream=width,height,avg_frame_rate,pix_fmt:frame=best_effort_timestamp_time', '-of', 'json', file]));
  const stream = probe.streams?.[0];
  if (!stream) throw new Error('No video stream');
  const [w, h] = [stream.width, stream.height];
  const art = opts.art ? opts.art.split('x').map(Number) : log?.art;
  if (!art || art.length !== 2 || art.some(n => !Number.isInteger(n) || n < 1)) throw new Error('Supply --art WxH or a capture camera log');
  const [aw, ah] = art, scale = w / aw;
  if (!Number.isInteger(scale) || scale < 1 || h / ah !== scale) throw new Error(`Output ${w}x${h} is not a whole uniform multiple of art ${aw}x${ah}`);
  const [num, den] = stream.avg_frame_rate.split('/').map(Number), fps = num / den;
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('Invalid video frame rate');
  const failures: string[] = [], warnings: string[] = [];
  if (log && (!Number.isFinite(log.fps) || log.fps <= 0)) throw new Error('Camera log has invalid fps');
  if (log && (!Array.isArray(log.frames) || log.frames.length === 0)) throw new Error('Camera log has no frames');
  if (log && (log.art?.[0] !== aw || log.art?.[1] !== ah || log.output?.[0] !== w || log.output?.[1] !== h || log.scale !== scale)) failures.push('Log dimensions/scale differ from the video');
  if (log && Math.abs(log.fps - fps) > 1e-5) failures.push('Log fps differs from the video');
  const timestamps = (probe.frames ?? []).map(f => Number(f.best_effort_timestamp_time));
  const badTiming: number[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (!Number.isFinite(timestamps[i]) || (i && Math.abs(timestamps[i] - timestamps[i - 1] - 1 / fps) > 1e-4)) badTiming.push(i);
  }
  if (badTiming.length) failures.push('Missing, repeated or irregular video timestamps');
  let roi: number[] | undefined;
  if (opts.static) {
    roi = opts.static.split(',').map(Number);
    if (roi.length !== 4 || roi.some(n => !Number.isInteger(n)) || roi[0] < 0 || roi[1] < 0 || roi[2] < 1 || roi[3] < 1 || roi[0] + roi[2] > aw || roi[1] + roi[3] > ah) throw new Error('Static region must fit within the art dimensions');
  }
  const ref = opts.reference ? rgbFrames(['-framerate', String(fps), '-start_number', '0', '-i', opts.reference, '-vf', `scale=${aw}:${ah}:flags=neighbor`, '-vsync', '0'], aw * ah * 3)[Symbol.asyncIterator]() : null;
  let count = 0, previous: Buffer | undefined, gridBad = 0, gridSamples = 0, refBad = 0, refSamples = 0, refError = 0, flicker = 0, flickerSamples = 0;
  const diffs: { i: number; changedFraction: number; meanAbsoluteDifference: number }[] = [], duplicates: number[] = [], gridByFrame: number[] = [];
  try {
    for await (const frame of rgbFrames(['-i', file, '-map', '0:v:0', '-vsync', '0'], w * h * 3)) {
      const source = ref ? await ref.next() : null;
      if (source?.done) throw new Error(`Reference sequence ends before video frame ${count}`);
      const centers = Buffer.allocUnsafe(aw * ah * 3);
      let bad = 0;
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        const center = ((y * scale + Math.floor(scale / 2)) * w + x * scale + Math.floor(scale / 2)) * 3;
        const c = (y * aw + x) * 3;
        centers[c] = frame[center]; centers[c + 1] = frame[center + 1]; centers[c + 2] = frame[center + 2];
        if (source) {
          let delta = 0;
          for (let k = 0; k < 3; k++) { const d = Math.abs(frame[center + k] - source.value[c + k]); delta = Math.max(delta, d); refError += d; }
          if (delta > tolerance) refBad++;
          refSamples++;
        }
        // Any within-block variation is introduced after the art render: interpolation,
        // chroma resampling or codec ringing. A lossy encode usually has small variations.
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
          const offset = ((y * scale + dy) * w + x * scale + dx) * 3;
          if (Math.max(Math.abs(frame[offset] - frame[center]), Math.abs(frame[offset + 1] - frame[center + 1]), Math.abs(frame[offset + 2] - frame[center + 2])) > tolerance) bad++;
        }
      }
      gridBad += bad; gridSamples += w * h; gridByFrame.push(rounded(bad / (w * h)));
      if (previous) {
        let changed = 0, sum = 0;
        for (let i = 0; i < centers.length; i += 3) {
          let delta = 0;
          for (let k = 0; k < 3; k++) { const d = Math.abs(centers[i + k] - previous[i + k]); sum += d; delta = Math.max(delta, d); }
          if (delta > tolerance) changed++;
        }
        diffs.push({ i: count, changedFraction: rounded(changed / (aw * ah)), meanAbsoluteDifference: rounded(sum / centers.length) });
        if (centers.equals(previous)) duplicates.push(count);
        if (roi) for (let y = roi[1]; y < roi[1] + roi[3]; y++) for (let x = roi[0]; x < roi[0] + roi[2]; x++) {
          const c = (y * aw + x) * 3;
          if (Math.max(...[0, 1, 2].map(k => Math.abs(centers[c + k] - previous![c + k]))) > tolerance) flicker++;
          flickerSamples++;
        }
      }
      previous = centers; count++;
    }
    if (ref && !(await ref.next()).done) failures.push('Reference sequence has more frames than the video');
  } finally { if (ref) await ref.return(); }
  if (!count) failures.push('Video has no decoded frames');
  if (count !== timestamps.length) failures.push('Decoded frame count differs from timestamp count');
  if (log && count !== log.frames.length) failures.push('Decoded frame count differs from camera log');
  const camera: { badTimingFrames?: number[] } & Record<string, CameraStats | number[] | undefined> = {};
  if (log) {
    const badLogTiming: number[] = [];
    for (let i = 0; i < log.frames.length; i++) {
      const f = log.frames[i], prev = log.frames[i - 1];
      if (f.i !== i || !Number.isFinite(f.time) || (prev && Math.abs(f.time - prev.time - 1 / log.fps) > 1.1e-6)) badLogTiming.push(i);
    }
    if (badLogTiming.length) failures.push('Camera log has irregular indices/simulated time steps');
    camera.badTimingFrames = badLogTiming;
    for (const key of ['az', 'el', 'zoom', 'tx', 'tz', 'hour']) {
      const values = log.frames.map(f => key === 'hour' ? f.hour : f.view?.[key]) as number[];   // checked just below
      if (values.some(v => !Number.isFinite(v))) { failures.push(`Missing/nonfinite camera log ${key}`); continue; }
      // Capture logs wrap hours into [0, 24). Choose the nearest continuous step
      // across midnight; already-unwrapped external logs need no adjustment.
      if (key === 'hour' && values.every(v => v >= 0 && v < 24)) {
        let offset = 0, previous = values[0];
        for (let i = 1; i < values.length; i++) {
          const raw = values[i], step = raw - previous;
          if (step > 12) offset -= 24;
          else if (step < -12) offset += 24;
          previous = raw; values[i] = raw + offset;
        }
      }
      const velocity = values.slice(1).map((v, i) => v - values[i]);
      const accel = velocity.slice(1).map((v, i) => Math.abs(v - velocity[i]));
      const stats: CameraStats = camera[key] = { maxStep: rounded(max(velocity.map(Math.abs))), maxSecondDifference: rounded(max(accel)), meanSecondDifference: rounded(average(accel)) };
      const mean = average(accel);
      const spikes = accel.map((v, i) => ({ i: i + 1, value: v })).filter(v => v.value > Math.max(mean * 10, 1e-6));
      if (spikes.length) { stats.spikes = spikes; warnings.push(`${key}: camera acceleration spikes; inspect keyframe transitions`); }
    }
  }
  if (duplicates.length) warnings.push('Identical decoded art frames: can be legitimate for static/subpixel motion; inspect the frame differences');
  if (gridBad) warnings.push('Within-art-pixel colour variation exceeds tolerance: inspect interpolation/chroma/codec artifacts');
  if (refBad) warnings.push('Decoded art centres differ from source PNG colours beyond tolerance (includes lossy colour conversion)');
  if (flicker) warnings.push('Selected static region flickers beyond tolerance');
  console.log(JSON.stringify({ file, output: [w, h], art, scale, fps, pixelFormat: stream.pix_fmt, frames: count, tolerance, failures, warnings,
    timing: { badFrames: badTiming }, duplicates,
    grid: { badFraction: rounded(gridSamples ? gridBad / gridSamples : 0), perFrame: gridByFrame },
    reference: ref ? { beyondToleranceFraction: rounded(refSamples ? refBad / refSamples : 0), meanAbsoluteError: rounded(refSamples ? refError / (refSamples * 3) : 0) } : null,
    staticRegion: roi ? { region: roi, flickerFraction: rounded(flickerSamples ? flicker / flickerSamples : 0) } : null,
    camera, differences: diffs,
    limits: 'Timing/count/log errors fail. Visual metrics warn: per-frame differences cannot prove dropped render states, codec colour changes are expected, and static-region shimmer requires a genuinely static region. Reference PNGs measure source-colour preservation; human playback review is still required.' }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
