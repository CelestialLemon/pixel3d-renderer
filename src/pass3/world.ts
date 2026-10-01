import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Flags written to the G-buffer alpha (value = 1 + flag).
export const FLAG = { NORMAL: 0, EMISSIVE: 1, DECOR: 2, STEAM: 3, WATER: 4, GLOW: 5, DOOR: 6 } as const;
// Vertex animation modes of the dynamic mesh (see pipeline.ts GBUF_DYN_VERT).
export const MODE = { SWAY: 1, BELT: 2, SMOKE: 3, BUTTERFLY: 4, FIREFLY: 5 } as const;

export const GROUND_Y = 0.48;
const LAWN_CX = 0.8, LAWN_CZ = 0, LAWN_HX = 5.85, LAWN_HZ = 4.15;
export const CHIMNEY_TOP = new THREE.Vector3(1.92, 6.3, -0.74);
// Pond: centre, radii, rotation (all model space, y-up).
export const POND = { x: -5.4, z: 6.3, rx: 2.4, rz: 1.6, rot: 0.5 };
// Warm light sources that glow after dusk. Positions sit just in front of the glass.
export const LAMPS = [
  { pos: new THREE.Vector3(-1.86, 2.3, 2.7), color: [1.0, 0.62, 0.22] as [number, number, number], radius: 3.6 },
  { pos: new THREE.Vector3(1.86, 2.3, 2.7), color: [1.0, 0.62, 0.22] as [number, number, number], radius: 3.6 },
  { pos: new THREE.Vector3(0.93, 2.44, 2.75), color: [1.0, 0.7, 0.3] as [number, number, number], radius: 2.4 },
  { pos: new THREE.Vector3(3.8, 2.0, 0.35), color: [1.0, 0.5, 0.15] as [number, number, number], radius: 2.6 },
];

// --- helpers ------------------------------------------------------------------
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(11);
const hash2 = (x: number, y: number) => {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t: number) => t * t * (3 - 2 * t);
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
const fbm = (x: number, y: number) => vnoise(x, y) * 0.6 + vnoise(x * 2.1 + 17, y * 2.1 + 3) * 0.28 + vnoise(x * 4.3 + 5, y * 4.3 + 11) * 0.12;

type RGB = [number, number, number];
const lin = (hex: number): RGB => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V3 = new THREE.Vector3(), S3 = new THREE.Vector3();
const place = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  M.compose(V3.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S3.set(sx, sy, sz)).clone();

type AnimFn = (x: number, y: number, z: number) => [number, number, number, number];

// --- geometry collector --------------------------------------------------------
class Collector {
  parts: THREE.BufferGeometry[] = [];
  constructor(readonly dynamic = false) {}

  /** `g` must be non-indexed, in world space, with position + normal. */
  push(g: THREE.BufferGeometry, color: RGB, flag: number, mode: number = 0, anim?: AnimFn) {
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3), f = new Float32Array(n);
    for (let i = 0; i < n; i++) { c[i * 3] = color[0]; c[i * 3 + 1] = color[1]; c[i * 3 + 2] = color[2]; f[i] = flag; }
    g.setAttribute('aColor', new THREE.BufferAttribute(c, 3));
    g.setAttribute('aFlag', new THREE.BufferAttribute(f, 1));
    if (this.dynamic) {
      const md = new Float32Array(n).fill(mode), an = new Float32Array(n * 4);
      const p = g.attributes.position as THREE.BufferAttribute;
      if (anim) for (let i = 0; i < n; i++) { const a = anim(p.getX(i), p.getY(i), p.getZ(i)); an.set(a, i * 4); }
      g.setAttribute('aMode', new THREE.BufferAttribute(md, 1));
      g.setAttribute('aAnim', new THREE.BufferAttribute(an, 4));
    }
    this.parts.push(g);
  }

  add(src: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: RGB, flag: number = FLAG.NORMAL, flat = false, mode: number = 0, anim?: AnimFn) {
    const g = src.index ? src.toNonIndexed() : src.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (m) { g.applyMatrix4(m); if (m.determinant() < 0) flip(g); }
    if (flat || !g.attributes.normal) g.computeVertexNormals();
    this.push(g, color, flag, mode, anim);
  }
}

// swap two vertices of every triangle so mirrored meshes keep front faces outward
function flip(g: THREE.BufferGeometry) {
  for (const k of Object.keys(g.attributes)) {
    const a = g.attributes[k] as THREE.BufferAttribute, s = a.itemSize, arr = a.array as Float32Array;
    for (let t = 0; t < a.count; t += 3) for (let j = 0; j < s; j++) {
      const i1 = (t + 1) * s + j, i2 = (t + 2) * s + j, tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp;
    }
  }
}

// --- palette clustering (k-means in OKLab) over every geometry ----------------------
const toLab = ([r, g, b]: RGB): RGB => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const fromLab = ([L, a, b]: RGB): RGB => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
};

function quantizePalette(geos: THREE.BufferGeometry[], K: number): number {
  const key = (col: THREE.BufferAttribute, flag: THREE.BufferAttribute, i: number) => {
    const q = (v: number) => Math.round(v * 1023);
    return q(col.getX(i)) * 1048576 + q(col.getY(i)) * 1024 + q(col.getZ(i)) + flag.getX(i) * 1e10;
  };
  const uniq = new Map<number, { rgb: RGB; lab: RGB; w: number; idx: number }>();
  for (const g of geos) {
    const col = g.attributes.aColor as THREE.BufferAttribute, flag = g.attributes.aFlag as THREE.BufferAttribute;
    for (let i = 0; i < col.count; i++) {
      const k = key(col, flag, i), u = uniq.get(k);
      if (u) u.w++;
      else { const rgb: RGB = [col.getX(i), col.getY(i), col.getZ(i)]; uniq.set(k, { rgb, lab: toLab(rgb), w: 1, idx: 0 }); }
    }
  }
  const pts = [...uniq.values()];
  if (pts.length <= K) return pts.length;
  const w = (p: { w: number }) => Math.sqrt(p.w);
  const d2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + 3.2 * (a[1] - b[1]) ** 2 + 3.2 * (a[2] - b[2]) ** 2;
  const centers: RGB[] = [pts.reduce((a, b) => (b.w > a.w ? b : a)).lab];
  const dist = pts.map((p) => d2(p.lab, centers[0]));
  while (centers.length < K) {
    let tot = 0; for (let i = 0; i < pts.length; i++) tot += dist[i] * w(pts[i]);
    let r = rnd() * tot, pickI = 0;
    for (let i = 0; i < pts.length; i++) { r -= dist[i] * w(pts[i]); if (r <= 0) { pickI = i; break; } }
    centers.push(pts[pickI].lab);
    for (let i = 0; i < pts.length; i++) dist[i] = Math.min(dist[i], d2(pts[i].lab, pts[pickI].lab));
  }
  for (let it = 0; it < 24; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const p of pts) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) { const d = d2(p.lab, centers[c]); if (d < bd) { bd = d; best = c; } }
      p.idx = best;
      const ww = w(p); sum[best][0] += p.lab[0] * ww; sum[best][1] += p.lab[1] * ww; sum[best][2] += p.lab[2] * ww; sum[best][3] += ww;
    }
    for (let c = 0; c < centers.length; c++) if (sum[c][3] > 0) centers[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }
  const out = centers.map((c) => fromLab(c).map((v) => Math.min(1, Math.max(0, v))) as RGB);
  for (const g of geos) {
    const col = g.attributes.aColor as THREE.BufferAttribute, flag = g.attributes.aFlag as THREE.BufferAttribute;
    for (let i = 0; i < col.count; i++) { const c = out[uniq.get(key(col, flag, i))!.idx]; col.setXYZ(i, c[0], c[1], c[2]); }
  }
  return new Set(pts.map((p) => p.idx)).size;
}

// --- terrain helpers -------------------------------------------------------------
function lawnSdf(x: number, z: number) {
  const qx = Math.abs(x - LAWN_CX) - (LAWN_HX - 1.2), qz = Math.abs(z - LAWN_CZ) - (LAWN_HZ - 1.2);
  const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - 1.2;
  return out + (fbm(x * 0.55, z * 0.55) - 0.5) * 1.4;
}
// normalised elliptical distance from the pond centre: <1 is water
function pondD(x: number, z: number) {
  const c = Math.cos(POND.rot), s = Math.sin(POND.rot), dx = x - POND.x, dz = z - POND.z;
  const u = dx * c + dz * s, v = -dx * s + dz * c;
  return Math.hypot(u / POND.rx, v / POND.rz) + (fbm(x * 0.7 + 9, z * 0.7 - 4) - 0.5) * 0.3;
}
const pathX = (z: number) => -0.55 + 1.8 * Math.sin(z * 0.28) * Math.min(1, Math.max(0, (z - 4) / 6));
const onPath = (x: number, z: number, margin = 0.95) => z > 4 && Math.abs(x - pathX(z)) < margin;
const swayAnim = (bx: number, bz: number, k = 0.5): AnimFn => (_x, y) => [Math.pow(Math.min(Math.max((y - GROUND_Y) / k, 0), 1.6), 1.3), bx, bz, 0];

// --- scenery ---------------------------------------------------------------------
const flowerSpots: { x: number; z: number }[] = [];

function buildMeadow(s: Collector, d: Collector) {
  const C = {
    lawnA: lin(0x9ac15a), lawnB: lin(0x8db84f),
    dark: lin(0x6aa440), base: lin(0x79b04a), light: lin(0x89bb53), dry: lin(0x9fb85a), clover: lin(0x62a85a),
    dirt: lin(0xb98550), dirtDark: lin(0x9c6b40),
    bank: lin(0xcdb47c), bankWet: lin(0xa88d5c),
    deep: lin(0x2f86c4), water: lin(0x4db4e0), foam: lin(0xd2f0f2),
  };
  const R = 30, cs = 0.25, n = Math.round((R * 2) / cs);
  const pos: number[] = [], nor: number[] = [], col: number[] = [], flag: number[] = [];
  const quad = (x: number, z: number, sz: number, color: RGB, y: number, fl: number) => {
    const a = [x, y, z], b = [x, y, z + sz], dd = [x + sz, y, z + sz], e = [x + sz, y, z];
    for (const v of [a, b, dd, a, dd, e]) { pos.push(v[0], v[1], v[2]); nor.push(0, 1, 0); col.push(...color); flag.push(fl); }
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = -R + i * cs, z = -R + j * cs, cx = x + cs / 2, cz = z + cs / 2;
    const pd = pondD(cx, cz);
    if (pd < 1.0) {
      const color = pd > 0.86 ? C.foam : pd > 0.55 ? C.water : C.deep;
      quad(x, z, cs, color, GROUND_Y - 0.07, FLAG.WATER);
      continue;
    }
    let color: RGB;
    if (pd < 1.12) color = pd < 1.05 ? C.bankWet : C.bank;
    else if (lawnSdf(cx, cz) < 0) color = Math.floor((cx - LAWN_CX) / 1.3) % 2 === 0 ? C.lawnA : C.lawnB;
    else {
      const f = fbm(cx * 0.32, cz * 0.32);
      color = f < 0.4 ? C.dark : f > 0.64 ? C.light : C.base;
      if (fbm(cx * 0.2 + 40, cz * 0.2 - 9) > 0.66 && f > 0.45) color = C.dry;
      if (fbm(cx * 0.45 - 20, cz * 0.45 + 30) > 0.72) color = C.clover;
    }
    if (cz > 4.1 && Math.abs(cx - pathX(cz)) < 0.85 + (fbm(cx * 0.8, cz * 0.8) - 0.5) * 0.7) color = fbm(cx * 1.3, cz * 1.3) > 0.55 ? C.dirtDark : C.dirt;
    quad(x, z, cs, color, GROUND_Y - 0.004, FLAG.DECOR);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFlag', new THREE.Float32BufferAttribute(flag, 1));
  s.parts.push(g);
  s.add(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), place(0, GROUND_Y - 0.1, 0), C.base, FLAG.DECOR);

  // grass tufts (swaying)
  const blade = new THREE.ConeGeometry(0.045, 1, 3, 1).translate(0, 0.5, 0);
  const greens = [lin(0x5a9a3c), lin(0x4f9238), C.dark, lin(0x84bd50), C.light, lin(0x6bae44)];
  for (let i = 0; i < 4600; i++) {
    const x = (rnd() - 0.5) * 54, z = (rnd() - 0.5) * 54;
    if (lawnSdf(x, z) < 0.35 || pondD(x, z) < 1.18 || onPath(x, z)) continue;
    const f = fbm(x * 0.32, z * 0.32);
    if (rnd() > 0.35 + (0.5 - Math.abs(f - 0.5)) * 0.55) continue;
    const tint = pick(greens), tall = rnd() < 0.14 ? 1.7 : 1, h = (0.28 + rnd() * 0.3) * tall, nb = 3 + Math.floor(rnd() * 2);
    for (let b = 0; b < nb; b++) {
      const a = (b / nb) * Math.PI * 2 + rnd(), lean = 0.2 + rnd() * 0.3;
      d.add(blade, place(x + Math.cos(a) * 0.06, GROUND_Y, z + Math.sin(a) * 0.06, Math.sin(a) * lean, 0, -Math.cos(a) * lean, 1, h * (0.75 + rnd() * 0.5), 1), tint, FLAG.DECOR, true, MODE.SWAY, swayAnim(x, z, 0.5 * tall));
    }
  }

  // wildflower clusters (swaying)
  const petals = [lin(0xfff3da), lin(0xf3c02a), lin(0xe96a86), lin(0xa48be0), lin(0xff9a4d)];
  const stem = new THREE.CylinderGeometry(0.012, 0.012, 1, 3).translate(0, 0.5, 0);
  const head = new THREE.IcosahedronGeometry(1, 0);
  for (let k = 0; k < 30; k++) {
    let cx = 0, cz = 0, tries = 0;
    do { cx = (rnd() - 0.5) * 40; cz = (rnd() - 0.5) * 40; } while ((lawnSdf(cx, cz) < 1.1 || pondD(cx, cz) < 1.4) && ++tries < 50);
    flowerSpots.push({ x: cx, z: cz });
    const pc = pick(petals), nn = 7 + Math.floor(rnd() * 11);
    for (let i = 0; i < nn; i++) {
      const x = cx + (rnd() - 0.5) * 2.4, z = cz + (rnd() - 0.5) * 2.4;
      if (lawnSdf(x, z) < 0.5 || pondD(x, z) < 1.2 || onPath(x, z)) continue;
      const h = 0.22 + rnd() * 0.2, anim = swayAnim(x, z, 0.5);
      d.add(stem, place(x, GROUND_Y, z, 0, 0, 0, 1, h, 1), C.dark, FLAG.DECOR, true, MODE.SWAY, anim);
      d.add(head, place(x, GROUND_Y + h, z, 0, rnd() * 3, 0, 0.065, 0.05, 0.065), rnd() < 0.8 ? pc : pick(petals), FLAG.DECOR, true, MODE.SWAY, anim);
    }
  }
}

// A leaf mass built from many small spheres whose normals all point away from the mass
// centre: the shading reads as one smooth, banded sphere while the silhouette stays
// scalloped, like hand-drawn pixel foliage.
const CLUMP = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
function foliage(c: Collector, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, count: number, clumpR: number, cols: { dark: RGB; base: RGB; light: RGB }) {
  const pa = CLUMP.attributes.position as THREE.BufferAttribute, na = CLUMP.attributes.normal as THREE.BufferAttribute;
  const tmp = new THREE.Vector3(), nrm = new THREE.Vector3();
  const emit = (px: number, py: number, pz: number, r: number, color: RGB) => {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(pa.count * 3), nor = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      tmp.set(pa.getX(i) * r + px, pa.getY(i) * r + py, pa.getZ(i) * r + pz);
      nrm.set((tmp.x - cx) / rx, (tmp.y - cy) / ry, (tmp.z - cz) / rz).normalize()
        .multiplyScalar(0.88).addScaledVector(V3.set(na.getX(i), na.getY(i), na.getZ(i)), 0.12).normalize();
      pos.set([tmp.x, tmp.y, tmp.z], i * 3); nor.set([nrm.x, nrm.y, nrm.z], i * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    c.push(g, color, FLAG.NORMAL);
  };
  emit(cx, cy, cz, Math.min(rx, rz) * 0.8, cols.dark); // core so the mass is never hollow
  for (let i = 0; i < count; i++) {
    const y = 1 - ((i + 0.5) / count) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963 + rnd() * 0.45;
    const k = 0.74 + rnd() * 0.26;
    const t = y * 0.5 + 0.5 + (rnd() - 0.5) * 0.4;
    emit(cx + Math.cos(th) * r * rx * k, cy + y * ry * k, cz + Math.sin(th) * r * rz * k, clumpR * (0.75 + rnd() * 0.5), t < 0.34 ? cols.dark : t > 0.7 ? cols.light : cols.base);
  }
}

function buildTrees(s: Collector, d: Collector) {
  const trunkCol = lin(0x7a4a2a), trunkDark = lin(0x5e3a22), trunkLight = lin(0xa0693d);
  const leafSets = [
    { dark: lin(0x3f8f4f), base: lin(0x5fb556), light: lin(0x93d667) },
    { dark: lin(0x358a5c), base: lin(0x54ac62), light: lin(0x86cf74) },
    { dark: lin(0x4a8f3f), base: lin(0x70b94c), light: lin(0xa7de6a) },
  ];
  const pineSet = [lin(0x2b7456), lin(0x378a62), lin(0x2a6b52)];
  const trunk = new THREE.CylinderGeometry(0.18, 0.26, 1, 7).translate(0, 0.5, 0);
  const round = (x: number, z: number, sc: number) => {
    s.add(trunk, place(x, GROUND_Y, z, 0, rnd() * 6, 0, sc, 1.7 * sc, sc), trunkCol, FLAG.NORMAL, false);
    const set = pick(leafSets);
    foliage(s, x, GROUND_Y + 2.7 * sc, z, 1.5 * sc, 1.25 * sc, 1.5 * sc, 34, 0.5 * sc, set);
    for (const [ox, oy, oz, r] of [[0.95, -0.35, 0.3, 0.8], [-0.9, -0.25, -0.35, 0.85], [0.1, 0.8, -0.1, 0.8]]) {
      foliage(s, x + ox * sc, GROUND_Y + (2.7 + oy) * sc, z + oz * sc, r * sc, r * 0.85 * sc, r * sc, 14, 0.36 * sc, set);
    }
  };
  const fir = (x: number, z: number, sc: number) => {
    s.add(trunk, place(x, GROUND_Y, z, 0, 0, 0, sc * 0.7, sc * 0.9, sc * 0.7), trunkDark);
    for (let i = 0; i < 4; i++) {
      const tier = new THREE.ConeGeometry(1, 1, 9, 1).translate(0, 0.5, 0);
      s.add(tier, place(x, GROUND_Y + (0.6 + i * 0.85) * sc, z, 0, rnd() * 3, 0, (1.4 - i * 0.28) * sc, 1.3 * sc, (1.4 - i * 0.28) * sc), pick(pineSet));
    }
  };
  const T: [number, number, number, 'r' | 'f'][] = [
    [-11.5, -7.5, 1.0, 'r'], [-14.5, 0.5, 1.05, 'f'], [-12, 9.5, 0.95, 'r'],
    [12.5, -8.5, 1.05, 'f'], [15.5, -1.5, 1.0, 'r'], [14.5, 8, 1.1, 'f'],
    [2.5, -12, 1.0, 'r'], [-5, -13.5, 1.1, 'f'], [8, -14.5, 1.2, 'r'],
    [-19, -7, 1.3, 'f'], [20, 3, 1.3, 'r'], [-2, 17, 1.2, 'r'], [-16, 15, 1.3, 'f'], [17, 15, 1.2, 'r'],
  ];
  for (const [x, z, sc, k] of T) (k === 'r' ? round : fir)(x, z, sc);

  const bushSets = [
    { dark: lin(0x479a54), base: lin(0x6cc05a), light: lin(0xa2e070) },
    { dark: lin(0x3d9060), base: lin(0x5bb468), light: lin(0x93d97c) },
  ];
  for (let i = 0; i < 24; i++) {
    const a = rnd() * Math.PI * 2, dd = 8 + rnd() * 10;
    const x = LAWN_CX + Math.cos(a) * dd * 1.15, z = Math.sin(a) * dd * 0.85;
    if (lawnSdf(x, z) < 1.4 || pondD(x, z) < 1.6 || (z > 4 && Math.abs(x + 0.55) < 3)) continue;
    const sc = 0.4 + rnd() * 0.45;
    foliage(s, x, GROUND_Y + sc * 0.55, z, sc * 1.25, sc * 0.9, sc * 1.1, 11, sc * 0.5, pick(bushSets));
  }
  const rock = new THREE.DodecahedronGeometry(1, 0);
  const rockCols = [lin(0xb4a891), lin(0xa09784), lin(0xc8bda5)];
  for (let i = 0; i < 18; i++) {
    const x = (rnd() - 0.5) * 34, z = (rnd() - 0.5) * 30;
    if (lawnSdf(x, z) < 1.5 || pondD(x, z) < 1.2 || onPath(x, z, 2.6)) continue;
    const sc = 0.22 + rnd() * 0.35;
    s.add(rock, place(x, GROUND_Y + sc * 0.3, z, rnd() * 3, rnd() * 3, rnd() * 3, sc * 1.3, sc * 0.8, sc), pick(rockCols), FLAG.NORMAL, true);
  }

  // mushrooms, a stump and a log: small story props near the tree line
  const capGeo = new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const stemGeo = new THREE.CylinderGeometry(0.6, 0.8, 1, 6).translate(0, 0.5, 0);
  for (const [mx, mz] of [[-9.2, 6.2], [-7.1, 9.6], [9.6, -5.2], [7.4, 8.6]]) {
    for (let i = 0; i < 3; i++) {
      const x = mx + (rnd() - 0.5) * 0.9, z = mz + (rnd() - 0.5) * 0.9, sc = 0.09 + rnd() * 0.08;
      s.add(stemGeo, place(x, GROUND_Y, z, 0, 0, 0, sc, sc * 2, sc), lin(0xf3e6c6));
      s.add(capGeo, place(x, GROUND_Y + sc * 2, z, 0, 0, 0, sc * 2.1, sc * 1.4, sc * 2.1), pick([lin(0xd9503f), lin(0xd9503f), lin(0xe8913a)]));
    }
  }
  const log = new THREE.CylinderGeometry(0.28, 0.28, 2.2, 9);
  s.add(log, place(-9.6, GROUND_Y + 0.28, 3.2, 0, 0.5, Math.PI / 2), trunkCol);
  s.add(new THREE.CylinderGeometry(0.265, 0.265, 0.02, 9), place(-9.6 + Math.sin(0.5) * 1.11, GROUND_Y + 0.28, 3.2 + Math.cos(0.5) * 1.11, Math.PI / 2, 0.5, 0), trunkLight);
  s.add(new THREE.CylinderGeometry(0.34, 0.4, 0.42, 9), place(10.2, GROUND_Y + 0.21, 4.4), trunkCol);
  s.add(new THREE.CylinderGeometry(0.33, 0.33, 0.02, 9), place(10.2, GROUND_Y + 0.43, 4.4), trunkLight);
}

function buildPond(s: Collector, d: Collector) {
  // lily pads (flat discs with a notch-free look) and flowers floating on the water
  const pad = new THREE.CylinderGeometry(1, 1, 0.03, 10);
  const padCols = [lin(0x4fae5a), lin(0x62c06a), lin(0x3f9a56)];
  const wy = GROUND_Y - 0.07 + 0.03;
  for (let i = 0; i < 9; i++) {
    const a = rnd() * 6.283, r = rnd() * 0.65;
    const x = POND.x + Math.cos(a) * POND.rx * r, z = POND.z + Math.sin(a) * POND.rz * r, sc = 0.2 + rnd() * 0.14;
    if (pondD(x, z) > 0.78) continue;
    s.add(pad, place(x, wy, z, 0, rnd() * 3, 0, sc, 1, sc), pick(padCols), FLAG.NORMAL, true);
    if (rnd() < 0.4) s.add(new THREE.IcosahedronGeometry(1, 0), place(x, wy + 0.06, z, 0, 0, 0, 0.1, 0.07, 0.1), lin(0xf49ac1), FLAG.NORMAL, true);
  }
  // rocks and reeds around the shore
  const rock = new THREE.DodecahedronGeometry(1, 0);
  const rockCols = [lin(0xb4a891), lin(0xa09784), lin(0xc8bda5)];
  const reed = new THREE.ConeGeometry(0.035, 1, 3, 1).translate(0, 0.5, 0);
  const cattail = new THREE.CylinderGeometry(0.05, 0.05, 0.22, 5).translate(0, 0.11, 0);
  for (let i = 0; i < 60; i++) {
    const a = rnd() * 6.283, k = 1.04 + rnd() * 0.16;
    const x = POND.x + Math.cos(a + POND.rot) * POND.rx * k * 1.0, z = POND.z + Math.sin(a + POND.rot) * POND.rz * k * 1.0;
    if (pondD(x, z) < 1.0 || onPath(x, z)) continue;
    if (rnd() < 0.13) {
      const sc = 0.12 + rnd() * 0.18;
      s.add(rock, place(x, GROUND_Y + sc * 0.3, z, rnd() * 3, rnd() * 3, rnd() * 3, sc * 1.3, sc * 0.8, sc), pick(rockCols), FLAG.NORMAL, true);
      continue;
    }
    if (Math.sin(a * 2.0 + 1.3) < 0.1) continue; // leave gaps in the reed beds
    for (let b = 0; b < 3; b++) {
      const bx = x + (rnd() - 0.5) * 0.3, bz = z + (rnd() - 0.5) * 0.3, h = 0.8 + rnd() * 0.7, lean = (rnd() - 0.5) * 0.25;
      const anim = swayAnim(bx, bz, 0.9);
      d.add(reed, place(bx, GROUND_Y - 0.02, bz, lean, 0, -lean, 1, h, 1), pick([lin(0x5ba84a), lin(0x74be55), lin(0x4c9a52)]), FLAG.DECOR, true, MODE.SWAY, anim);
      if (b === 0 && rnd() < 0.5) d.add(cattail, place(bx + lean * h * 0.9, GROUND_Y - 0.02 + h * 0.96, bz - lean * h * 0.9, lean, 0, -lean), lin(0x7a4a2a), FLAG.DECOR, true, MODE.SWAY, anim);
    }
  }
}

function buildLife(d: Collector) {
  // chimney smoke: dissolving puffs (vertex shader moves them)
  const puff = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 9; i++) {
    const seed = rnd();
    d.add(puff, null, lin(0xfff9ec), FLAG.STEAM, false, MODE.SMOKE, () => [i / 9, seed, 0, 0]);
  }
  // butterflies: two wings, double sided
  const wingCols = [lin(0xfff3da), lin(0xf3c02a), lin(0xff9a4d), lin(0xa9d4f5), lin(0xe96a86)];
  const wing = (sgn: number) => {
    const v = [0, 0, -0.03, sgn * 0.14, 0, -0.11, sgn * 0.14, 0, 0.07, 0, 0, 0.05];
    const idx = [0, 1, 2, 0, 2, 3];
    const pos: number[] = [], nor: number[] = [];
    for (const i of idx) { pos.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]); nor.push(0, 1, 0); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return g;
  };
  const centers = [...flowerSpots.slice(0, 5), { x: POND.x + 1.5, z: POND.z - 2.2 }, { x: 3, z: 6 }];
  centers.forEach((c, i) => {
    const seed = rnd(), col = wingCols[i % wingCols.length];
    for (const sgn of [1, -1]) {
      const g = wing(sgn);
      d.add(g, null, col, FLAG.DECOR, false, MODE.BUTTERFLY, () => [c.x, c.z, i / centers.length, seed]);
      const g2 = wing(sgn); flip(g2);
      d.add(g2, null, col, FLAG.DECOR, false, MODE.BUTTERFLY, () => [c.x, c.z, i / centers.length, seed]);
    }
  });
  // fireflies (only drawn at night)
  const fly = new THREE.IcosahedronGeometry(0.055, 0);
  for (let i = 0; i < 26; i++) {
    const cx = (rnd() - 0.5) * 22 + 0.8, cz = (rnd() - 0.5) * 18, ph = rnd(), sd = rnd();
    d.add(fly, null, lin(0xf4ff9a), FLAG.GLOW, true, MODE.FIREFLY, () => [cx, cz, ph, sd]);
  }
}

// --- public ----------------------------------------------------------------------
export interface World3 {
  staticGeo: THREE.BufferGeometry;
  dynamicGeo: THREE.BufferGeometry;
  triangles: number;
  paletteColors: number;
}

export async function buildWorld3(url: string, paletteK: number): Promise<World3> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const s = new Collector(false), d = new Collector(true);

  // Pass 1: find the belt cookies (they emerge from the oven and ride the conveyor).
  const belt: { mesh: THREE.Mesh; box: THREE.Box3 }[] = [];
  const centres: THREE.Vector3[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = (mesh.material as THREE.Material).name;
    if (!/cookie crumb|cookie edge|dark chocolate/i.test(name)) return;
    const box = new THREE.Box3().setFromObject(mesh), c = box.getCenter(new THREE.Vector3());
    if (c.x > 3.2 && c.x < 5.7 && c.y > 1.8 && c.y < 2.15 && c.z > 0.0 && c.z < 0.7) {
      belt.push({ mesh, box });
      if (/cookie edge/i.test(name)) centres.push(c);
    }
  });
  const beltSet = new Set(belt.map((b) => b.mesh));

  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (/steam/i.test(mat.name)) return; // replaced by animated puffs
    // (three.js sanitises node names: spaces become underscores.)
    // The door's plank grooves are 0.015 wide: under half a pixel at normal zoom, so as geometry they
    // flicker in and out with every camera nudge. They are drawn in the post shader instead, at a
    // constant one-pixel width, on the surface flagged DOOR.
    if (/^Door[ _]plank[ _]groove/i.test(mesh.name)) return;
    const col: RGB = [mat.color.r, mat.color.g, mat.color.b];
    const e = mat.emissive;
    const emissive = e && e.r + e.g + e.b > 0.05;
    if (beltSet.has(mesh)) {
      const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      const home = centres.reduce((a, b) => (Math.hypot(b.x - c.x, b.z - c.z) < Math.hypot(a.x - c.x, a.z - c.z) ? b : a));
      d.add(mesh.geometry, mesh.matrixWorld, col, FLAG.NORMAL, false, MODE.BELT, () => [home.x, home.y, home.z, 0]);
      return;
    }
    s.add(mesh.geometry, mesh.matrixWorld, col, /^Golden[ _]oak[ _]arched[ _]door/i.test(mesh.name) ? FLAG.DOOR : emissive ? FLAG.EMISSIVE : FLAG.NORMAL);
  });

  buildMeadow(s, d);
  buildTrees(s, d);
  buildPond(s, d);
  buildLife(d);

  const staticGeo = mergeGeometries(s.parts, false)!, dynamicGeo = mergeGeometries(d.parts, false)!;
  const paletteColors = quantizePalette([staticGeo, dynamicGeo], paletteK);
  return { staticGeo, dynamicGeo, paletteColors, triangles: (staticGeo.attributes.position.count + dynamicGeo.attributes.position.count) / 3 };
}
