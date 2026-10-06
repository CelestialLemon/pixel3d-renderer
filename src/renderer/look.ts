import * as THREE from 'three';

// Time-of-day look. Everything the renderer needs to feel like a different hour:
// where the sun is, how warm the lit bands and how cool the shadow bands are, how
// bright the world is, whether the windows and lantern glow, and the sky colours.
export interface Look {
  hour: number;
  /** Sun (or moon at night) direction in degrees. */
  sunAz: number; sunEl: number; sunI: number;
  ambient: number; expo: number; chroma: number;
  /** OKLab (a, b) tints added to the lit and shadow bands. */
  litTint: [number, number]; shadeTint: [number, number];
  /** 0..1: lamp light strength, and how "night" the scene is (fireflies, darker water). */
  lampOn: number; night: number;
  skyTop: THREE.Color; skyBot: THREE.Color;
}

/**
 * One keyframe of a day cycle: the look at `hour` (0-24). Sky colours given as a number or CSS string are sRGB (e.g. `0x79b6dc`);
 * a `THREE.Color` is taken as it is, i.e. already linear (`new THREE.Color(0x79b6dc)` converts; `setRGB` does not).
 */
export interface LookKey extends Omit<Look, 'skyTop' | 'skyBot'> {
  skyTop: THREE.ColorRepresentation; skyBot: THREE.ColorRepresentation;
}

/** A game's or scene's looks through the day: keyframes smoothly interpolated, plus named hours for its UI. */
export interface DayCycle<P extends Readonly<Record<string, number>> = Readonly<Record<string, number>>> {
  readonly keys: readonly LookKey[];
  /** Named hours (e.g. `{ Noon: 12 }`), in display order. */
  readonly presets: Readonly<P>;
  /** The look at `hour` (wraps around 24). */
  lookAt(hour: number): Look;
  /** Name of the preset closest to `hour` around the clock (23:30 is nearer midnight than 20:00), or '' if there are none. */
  nearestPreset(hour: number): string;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const colorMix = (a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, t: number) =>
  new THREE.Color(a).lerp(new THREE.Color(b), t); // linear working space, blended in linear

/**
 * A day cycle from keyframes at strictly increasing hours in [0, 24]. Between the last key and the first the look
 * wraps around midnight, so a cycle may give as few as one key, or keys only at the hours it cares about.
 */
export function dayCycle<const P extends Readonly<Record<string, number>> = {}>(keys: readonly LookKey[], presets: P = {} as P): DayCycle<P> {
  if (keys.length === 0) throw new Error('A day cycle needs at least one key');
  for (const [name, h] of Object.entries(presets)) if (!(h >= 0 && h <= 24)) throw new Error(`Day cycle preset "${name}" is at hour ${h}, outside 0-24`);
  keys.forEach((k, i) => {
    if (!(k.hour >= 0 && k.hour <= 24)) throw new Error(`Day cycle key ${i} is at hour ${k.hour}, outside 0-24`);
    if (i > 0 && !(k.hour > keys[i - 1].hour)) throw new Error(`Day cycle key ${i} (hour ${k.hour}) is not after the one before it`);
  });
  // Own copies, so changing the caller's keys later doesn't change the cycle.
  // `isColor`, not `instanceof`: the caller's Color may come from another copy of three.js.
  const own = (c: THREE.ColorRepresentation) => (typeof c === 'object' && (c as THREE.Color).isColor ? new THREE.Color().copy(c as THREE.Color) : c);
  const frozen = Object.freeze(keys.map((k) => Object.freeze({
    ...k, litTint: Object.freeze([...k.litTint]) as [number, number], shadeTint: Object.freeze([...k.shadeTint]) as [number, number],
    skyTop: own(k.skyTop), skyBot: own(k.skyBot),
  })));
  const named = Object.freeze({ ...presets });
  const wrap = (h: number) => ((h % 24) + 24) % 24;
  const first = frozen[0], last = frozen[frozen.length - 1];
  // The wrap keys make the list cover [0, 24], so every hour falls between two keys.
  const span = [...(first.hour > 0 ? [{ ...last, hour: last.hour - 24 }] : []), ...frozen, ...(last.hour < 24 ? [{ ...first, hour: first.hour + 24 }] : [])];

  const lookAt = (hour: number): Look => {
    const h = wrap(hour);
    let i = 0;
    while (i < span.length - 2 && h >= span[i + 1].hour) i++;
    const a = span[i], b = span[i + 1];
    const t0 = b.hour > a.hour ? (h - a.hour) / (b.hour - a.hour) : 0, t = t0 * t0 * (3 - 2 * t0);
    const m = (k: 'sunAz' | 'sunEl' | 'sunI' | 'ambient' | 'expo' | 'chroma' | 'lampOn' | 'night') => mix(a[k], b[k], t);
    return {
      hour: h, sunAz: m('sunAz'), sunEl: m('sunEl'), sunI: m('sunI'), ambient: m('ambient'), expo: m('expo'), chroma: m('chroma'),
      litTint: [mix(a.litTint[0], b.litTint[0], t), mix(a.litTint[1], b.litTint[1], t)],
      shadeTint: [mix(a.shadeTint[0], b.shadeTint[0], t), mix(a.shadeTint[1], b.shadeTint[1], t)],
      lampOn: m('lampOn'), night: m('night'),
      skyTop: colorMix(a.skyTop, b.skyTop, t), skyBot: colorMix(a.skyBot, b.skyBot, t),
    };
  };
  const distance = (a: number, b: number) => { const d = wrap(a - b); return Math.min(d, 24 - d); };
  const nearestPreset = (hour: number) =>
    Object.entries(named).sort((a, b) => distance(a[1], hour) - distance(b[1], hour))[0]?.[0] ?? '';
  return { keys: frozen, presets: named, lookAt, nearestPreset };
}

type Row = [hour: number, az: number, el: number, sunI: number, ambient: number, expo: number, chroma: number,
  litA: number, litB: number, shA: number, shB: number, lamp: number, night: number, top: number, bot: number];
const key = ([hour, sunAz, sunEl, sunI, ambient, expo, chroma, litA, litB, shA, shB, lampOn, night, skyTop, skyBot]: Row): LookKey =>
  ({ hour, sunAz, sunEl, sunI, ambient, expo, chroma, litTint: [litA, litB], shadeTint: [shA, shB], lampOn, night, skyTop, skyBot });

/** The renderer's own day: the Golden Hour look the demo scenes are tuned for. */
export const DEFAULT_DAY_CYCLE = dayCycle(([
  [0,    -50, 38, 0.34, 0.30, 0.58, 0.95, -0.006, -0.044, 0.012, -0.070, 1.00, 1.00, 0x0d1838, 0x2b4272],
  [5.5,  -50, 38, 0.34, 0.30, 0.58, 0.95, -0.006, -0.044, 0.012, -0.070, 1.00, 1.00, 0x0d1838, 0x2b4272],
  [6.4,   88,  9, 0.78, 0.34, 0.88, 1.04,  0.014,  0.030, 0.016, -0.040, 0.70, 0.35, 0x7d8fd0, 0xffc9a0],
  [8.0,   66, 26, 1.00, 0.34, 1.00, 1.02,  0.006,  0.022, 0.010, -0.030, 0.00, 0.00, 0x88c0e8, 0xfbe6c8],
  [12.0,   0, 60, 1.00, 0.34, 1.00, 1.00,  0.000,  0.008, 0.006, -0.026, 0.00, 0.00, 0x79b6dc, 0xf6e6c2],
  [15.5, -38, 38, 1.00, 0.34, 1.00, 1.02,  0.004,  0.014, 0.010, -0.032, 0.00, 0.00, 0x79b6dc, 0xf6e6c2],
  [17.5, -60, 24, 1.05, 0.34, 1.02, 1.05,  0.012,  0.032, 0.020, -0.054, 0.15, 0.00, 0x6fa3d8, 0xffc78a],
  [18.8, -80, 11, 0.95, 0.33, 0.93, 1.06,  0.022,  0.042, 0.022, -0.054, 0.60, 0.15, 0x5a6fc0, 0xff9f6e],
  [19.8, -92,  3, 0.40, 0.31, 0.74, 1.00, -0.004, -0.020, 0.012, -0.050, 1.00, 0.65, 0x24357a, 0x8a6aa8],
  [21.0, -50, 38, 0.34, 0.30, 0.58, 0.95, -0.006, -0.044, 0.012, -0.070, 1.00, 1.00, 0x0d1838, 0x2b4272],
  [24,   -50, 38, 0.34, 0.30, 0.58, 0.95, -0.006, -0.044, 0.012, -0.070, 1.00, 1.00, 0x0d1838, 0x2b4272],
] as Row[]).map(key), { Morning: 8, Noon: 12, 'Golden hour': 17.5, Dusk: 19.5, Night: 22 });

/** The default cycle's presets, look and preset names (`DEFAULT_DAY_CYCLE`). */
export const PRESETS = DEFAULT_DAY_CYCLE.presets;
export const lookAt = (hour: number) => DEFAULT_DAY_CYCLE.lookAt(hour);
export const nearestPreset = (hour: number) => DEFAULT_DAY_CYCLE.nearestPreset(hour);

export const hourLabel = (h: number) => {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
