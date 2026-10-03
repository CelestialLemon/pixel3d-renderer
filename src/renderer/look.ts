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

type Key = [hour: number, az: number, el: number, sunI: number, ambient: number, expo: number, chroma: number,
  litA: number, litB: number, shA: number, shB: number, lamp: number, night: number, top: number, bot: number];

// The default day cycle, smoothly interpolated between keys.
const KEYS: Key[] = [
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
];

export const PRESETS = { Morning: 8, Noon: 12, 'Golden hour': 17.5, Dusk: 19.5, Night: 22 } as const;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const hexMix = (a: number, b: number, t: number, out: THREE.Color) => {
  const ca = new THREE.Color(a), cb = new THREE.Color(b); // linear working space, blended in linear
  return out.copy(ca).lerp(cb, t);
};

/** The look at `hour` (0-24, wraps). */
export function lookAt(hour: number): Look {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && h >= KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t0 = (h - a[0]) / (b[0] - a[0]), t = t0 * t0 * (3 - 2 * t0);
  const m = (k: number) => mix(a[k] as number, b[k] as number, t);
  return {
    hour: h, sunAz: m(1), sunEl: m(2), sunI: m(3), ambient: m(4), expo: m(5), chroma: m(6),
    litTint: [m(7), m(8)], shadeTint: [m(9), m(10)], lampOn: m(11), night: m(12),
    skyTop: hexMix(a[13] as number, b[13] as number, t, new THREE.Color()),
    skyBot: hexMix(a[14] as number, b[14] as number, t, new THREE.Color()),
  };
}

/** Name of the preset closest to `hour`. */
export const nearestPreset = (hour: number) =>
  Object.entries(PRESETS).sort((a, b) => Math.abs(a[1] - hour) - Math.abs(b[1] - hour))[0][0];

export const hourLabel = (h: number) => {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
