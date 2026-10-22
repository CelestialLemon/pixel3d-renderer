// Weather the game sets (`PixelRenderer.setWeather`): falling rain or snow, the cloud shadows' cover and speed, the wind
// in sway, and a haze (fog, dust). The renderer draws it; the game decides what the weather is and when it changes. The
// defaults draw exactly what the renderer drew before it had weather: no rain, the same passing clouds, the same gusts, no haze.

/** What falls from the sky. */
export type Precipitation = 'none' | 'rain' | 'snow';

export interface Weather {
  /** What falls. Default 'none'. */
  precipitation: Precipitation;
  /**
   * How hard it falls, 0 to 1: about 0.2 a light shower or light snow, 0.5 steady rain, 1 a heavy storm or blizzard.
   * 0 draws nothing. Default 0.5.
   */
  intensity: number;
  /**
   * How much of the ground the passing cloud shadows cover, 0 to 1: 0 a clear sky (no cloud shadows), 0.2 the scattered
   * clouds the renderer has always drawn (the default), 0.6 mostly cloudy, 1 overcast (every upward-facing surface shaded).
   * On a grey day, also dim the sun in the `Look` you pass to `setLook`: cloud cover only moves the shadows.
   */
  cloudCover: number;
  /** How fast the cloud shadows drift, 0 to 10, as a multiple of the default (1, about 0.3 m/s). 0 holds them still. */
  cloudSpeed: number;
  /**
   * Steady wind, 0 to 3: how far grass, crops and trees (`motion.sway`) lean downwind on average. 0 (the default) is no
   * lean, 1 a strong breeze, 3 a gale. It also slants falling rain and snow.
   */
  wind: number;
  /**
   * Gusts, 0 to 3: how far the sway swings back and forth around that lean as gusts travel across the ground. 1 (the
   * default) is the sway the renderer has always drawn; 0 holds every plant still at its lean.
   */
  gusts: number;
  /**
   * Haze, 0 to 1: 0 (the default) none, about 0.3 a thin morning mist, 0.6 a fog, 1 the thickest. A layer of fog lying on
   * the ground: ground, fields and roads are veiled in `hazeColor`, in drifting patches, and the things that stand up
   * (roofs, tree tops, silos, poles) rise out of it, thinner with height until `hazeTop`. It never hides the world: at 1
   * every surface still shows through (it keeps at least a fifth of its own colour). Ease it down to make a fog lift.
   * Drawn in a few dithered steps, so it keeps the pixel look, and moves with the clock.
   */
  haze: number;
  /** The haze's colour by day (sRGB hex): a cool grey for fog, a warm brown for dust. It darkens at night. Default 0xcfd6d8. */
  hazeColor: number;
  /**
   * The world height (y, in metres) where the haze ends: surfaces below it are veiled, more the lower they are, and
   * anything above it is clear. Set it a few metres above the ground the player looks at (a low fog 2 or 3 m above it, a
   * thick one 6 or more, which fogs the roofs too). Lowering it lifts the fog off the ground. Default 4.
   */
  hazeTop: number;
}

export const DEFAULT_WEATHER: Readonly<Weather> = Object.freeze({
  precipitation: 'none', intensity: 0.5, cloudCover: 0.2, cloudSpeed: 1, wind: 0, gusts: 1,
  haze: 0, hazeColor: 0xcfd6d8, hazeTop: 4,
});

const RANGES = { intensity: [0, 1], cloudCover: [0, 1], cloudSpeed: [0, 10], wind: [0, 3], gusts: [0, 3], haze: [0, 1], hazeTop: [-1000, 1000] } as const;
const PRECIPITATION: readonly Precipitation[] = ['none', 'rain', 'snow'];

/**
 * `current` with the fields of `change` applied, after checking every one: a value outside its range, NaN or an unknown
 * precipitation throws a `RangeError`, and nothing changes. Unknown keys are ignored; an `undefined` field keeps its value.
 */
export function mergeWeather(current: Readonly<Weather>, change: Partial<Weather>): Weather {
  const next: Weather = { ...current };
  if (change.precipitation !== undefined) {
    if (!PRECIPITATION.includes(change.precipitation)) {
      throw new RangeError(`setWeather: precipitation must be ${PRECIPITATION.map((p) => `'${p}'`).join(', ')}, got ${String(change.precipitation)}`);
    }
    next.precipitation = change.precipitation;
  }
  for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
    const value = change[key];
    if (value === undefined) continue;
    const [lo, hi] = RANGES[key];
    if (typeof value !== 'number' || !(value >= lo && value <= hi)) throw new RangeError(`setWeather: ${key} must be from ${lo} to ${hi}, got ${String(value)}`);
    next[key] = value;
  }
  if (change.hazeColor !== undefined) {
    if (!Number.isInteger(change.hazeColor) || change.hazeColor < 0 || change.hazeColor > 0xffffff) {
      throw new RangeError(`setWeather: hazeColor must be an sRGB hex colour from 0 to 0xffffff, got ${String(change.hazeColor)}`);
    }
    next.hazeColor = change.hazeColor;
  }
  return next;
}

// Cloud cover to the cloud field's threshold. The field (cloudField in shaders/post.ts) is value noise; these are its
// measured quantiles, so a cover of c shades about that fraction of the ground. The shadow fades in over 0.06 of the field
// above the threshold. 0.2 maps to 0.60 exactly: the cloud shadows the renderer drew before cover could be set. At 0 the
// threshold is above the field's maximum (0.98), at 1 the fade ends below its minimum (0.01).
const COVER: readonly [number, number][] = [
  [0, 1.0], [0.05, 0.727], [0.1, 0.676], [0.2, 0.6], [0.3, 0.557], [0.4, 0.512], [0.5, 0.47], [0.6, 0.427], [0.7, 0.382],
  [0.8, 0.331], [0.9, 0.264], [0.95, 0.213], [1, -0.06],
];

/** The field values where the cloud shadow starts and is full, for `cover` from 0 to 1. */
export function cloudEdges(cover: number): [number, number] {
  let i = 1;
  while (i < COVER.length - 1 && cover > COVER[i][0]) i++;
  const [c0, t0] = COVER[i - 1], [c1, t1] = COVER[i];
  const lo = cover <= c0 ? t0 : cover >= c1 ? t1 : t0 + (t1 - t0) * (cover - c0) / (c1 - c0);
  return [lo, lo + 0.06];
}

/** The cloud field's drift at speed 1, in field units per second (the field is sampled at 0.1 x world x/z). */
export const CLOUD_DRIFT: readonly [number, number] = [0.028, 0.011];

/**
 * Where the cloud field has drifted to at a given clock time, with a speed that can change: a change of speed changes how
 * fast the clouds move from then on, never where they are, so they don't jump. At a constant speed the offset is
 * time x speed x CLOUD_DRIFT, a pure function of the clock.
 */
export class CloudDrift {
  private t0 = 0;
  private offset0: [number, number] = [0, 0];
  private lastTime = 0;
  private speed: number;
  constructor(speed = 1) { this.speed = speed; }

  /** The offset at `time` seconds. */
  at(time: number): [number, number] {
    this.lastTime = time;
    const dt = time - this.t0, k = this.speed;
    // At speed 1 from the start, exactly time x drift (rounded to float32 like the shader's uTime * 0.028 was).
    if (k === 1 && this.t0 === 0 && this.offset0[0] === 0 && this.offset0[1] === 0) {
      return [Math.fround(time) * Math.fround(CLOUD_DRIFT[0]), Math.fround(time) * Math.fround(CLOUD_DRIFT[1])];
    }
    return [this.offset0[0] + dt * k * CLOUD_DRIFT[0], this.offset0[1] + dt * k * CLOUD_DRIFT[1]];
  }

  /** Change the speed from the last time asked for on. */
  setSpeed(speed: number) {
    if (speed === this.speed) return;
    this.offset0 = this.at(this.lastTime);
    this.t0 = this.lastTime;
    this.speed = speed;
  }
}

/**
 * Packs the weather for the post shaders: `x` 0 none, 1 rain, 2 snow; `y` intensity; `z` the screen slant of the fall (art
 * pixels across per pixel down, + right), from the wind and the camera's right vector (`rightX`, `rightZ`: its world x and z).
 */
export function precipitationUniform(w: Readonly<Weather>, rightX: number, rightZ: number): [number, number, number, number] {
  const kind = w.intensity > 0 ? PRECIPITATION.indexOf(w.precipitation) : 0;
  // The wind blows along WIND_DIR (as the sway leans); its share across the screen slants the fall. Snow, slower, drifts more.
  const across = WIND_DIR[0] * rightX + WIND_DIR[1] * rightZ;
  const strength = 0.12 + 0.3 * w.wind + 0.06 * w.gusts;
  const slant = Math.max(-1.5, Math.min(1.5, across * strength * (kind === 2 ? 2.2 : 1)));
  return [kind, w.intensity, slant, 0];
}

/** The direction the wind blows along the ground (world x, z), normalised: the sway's lean direction. */
export const WIND_DIR: readonly [number, number] = [1 / Math.hypot(1, 0.35), 0.35 / Math.hypot(1, 0.35)];

/** Packs the haze for the post shaders: its amount and the world height where it ends (the colour has a uniform of its own). */
export function hazeUniform(w: Readonly<Weather>): [number, number] { return [w.haze, w.hazeTop]; }
