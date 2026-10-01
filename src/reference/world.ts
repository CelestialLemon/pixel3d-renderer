import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Flags written to the G-buffer alpha (value = 1 + flag).
export const FLAG_NORMAL = 0;
export const FLAG_EMISSIVE = 1; // windows: always drawn in the lit tone
export const FLAG_DECOR = 2; // grass/flowers: no outlines, no crease lines

export const GROUND_Y = 0.48; // top of the original lawn in the model
// Footprint of the original lawn diorama (model space, y-up): centre x=0.8, z=0.
const LAWN_CX = 0.8;
const LAWN_CZ = 0;
const LAWN_HX = 5.85;
const LAWN_HZ = 4.15;

// --- helpers ------------------------------------------------------------------
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(7);
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
const lin = (hex: number): RGB => {
  const c = new THREE.Color(hex); // hex is sRGB; Color converts to linear working space
  return [c.r, c.g, c.b];
};

// --- geometry collector --------------------------------------------------------
class Collector {
  parts: THREE.BufferGeometry[] = [];

  add(src: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: RGB, flag = FLAG_NORMAL, flat = false) {
    let g = src.index ? src.toNonIndexed() : src.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (m) {
      g.applyMatrix4(m);
      if (m.determinant() < 0) this.flip(g);
    }
    if (flat || !g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3), f = new Float32Array(n);
    for (let i = 0; i < n; i++) { c[i * 3] = color[0]; c[i * 3 + 1] = color[1]; c[i * 3 + 2] = color[2]; f[i] = flag; }
    g.setAttribute('aColor', new THREE.BufferAttribute(c, 3));
    g.setAttribute('aFlag', new THREE.BufferAttribute(f, 1));
    this.parts.push(g);
  }

  // swap two vertices of every triangle so mirrored meshes keep front faces outward
  private flip(g: THREE.BufferGeometry) {
    for (const k of Object.keys(g.attributes)) {
      const a = g.attributes[k] as THREE.BufferAttribute, s = a.itemSize, arr = a.array as Float32Array;
      for (let t = 0; t < a.count; t += 3) for (let j = 0; j < s; j++) {
        const i1 = (t + 1) * s + j, i2 = (t + 2) * s + j, tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp;
      }
    }
  }
}

// --- palette clustering (k-means in OKLab) -------------------------------------
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

function quantizePalette(geo: THREE.BufferGeometry, K: number): number {
  const col = geo.attributes.aColor as THREE.BufferAttribute;
  const flag = geo.attributes.aFlag as THREE.BufferAttribute;
  const key = (i: number) => {
    const q = (v: number) => Math.round(v * 1023);
    return q(col.getX(i)) * 1048576 + q(col.getY(i)) * 1024 + q(col.getZ(i)) + flag.getX(i) * 1e10;
  };
  const uniq = new Map<number, { rgb: RGB; lab: RGB; w: number; idx: number }>();
  for (let i = 0; i < col.count; i++) {
    const k = key(i);
    const u = uniq.get(k);
    if (u) u.w++;
    else { const rgb: RGB = [col.getX(i), col.getY(i), col.getZ(i)]; uniq.set(k, { rgb, lab: toLab(rgb), w: 1, idx: 0 }); }
  }
  const pts = [...uniq.values()];
  if (pts.length <= K) return pts.length;
  const w = (p: { w: number }) => Math.sqrt(p.w);
  const d2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + 0.8 * (a[1] - b[1]) ** 2 * 4 + 0.8 * (a[2] - b[2]) ** 2 * 4;
  // k-means++ init
  const centers: RGB[] = [pts.reduce((a, b) => (b.w > a.w ? b : a)).lab];
  const dist = pts.map((p) => d2(p.lab, centers[0]));
  while (centers.length < K) {
    let tot = 0; for (let i = 0; i < pts.length; i++) tot += dist[i] * w(pts[i]);
    let r = rnd() * tot, pick = 0;
    for (let i = 0; i < pts.length; i++) { r -= dist[i] * w(pts[i]); if (r <= 0) { pick = i; break; } }
    centers.push(pts[pick].lab);
    for (let i = 0; i < pts.length; i++) dist[i] = Math.min(dist[i], d2(pts[i].lab, pts[pick].lab));
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
  for (let i = 0; i < col.count; i++) {
    const c = out[uniq.get(key(i))!.idx];
    col.setXYZ(i, c[0], c[1], c[2]);
  }
  return new Set(pts.map((p) => p.idx)).size;
}

// --- scenery -------------------------------------------------------------------
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V3 = new THREE.Vector3(), S3 = new THREE.Vector3();
const place = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  M.compose(V3.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S3.set(sx, sy, sz)).clone();

const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

// signed distance to the (wobbly) mowed lawn rectangle; < 0 is inside
function lawnSdf(x: number, z: number) {
  const qx = Math.abs(x - LAWN_CX) - (LAWN_HX - 1.2), qz = Math.abs(z - LAWN_CZ) - (LAWN_HZ - 1.2);
  const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - 1.2;
  return out + (fbm(x * 0.55, z * 0.55) - 0.5) * 1.4;
}

function buildMeadow(c: Collector) {
  const C = {
    lawnA: lin(0x9ac15a), lawnB: lin(0x8db84f),
    dark: lin(0x6aa440), base: lin(0x79b04a), light: lin(0x89bb53), dry: lin(0x9fb85a),
    dirt: lin(0xb98550), dirtDark: lin(0x9c6b40),
  };
  const R = 30, cs = 0.25, n = Math.round((R * 2) / cs);
  const pos: number[] = [], nor: number[] = [], col: number[] = [], flag: number[] = [];
  const quad = (x: number, z: number, s: number, color: RGB, y: number) => {
    const a = [x, y, z], b = [x, y, z + s], d = [x + s, y, z + s], e = [x + s, y, z];
    for (const v of [a, b, d, a, d, e]) { pos.push(v[0], v[1], v[2]); nor.push(0, 1, 0); col.push(...color); flag.push(FLAG_DECOR); }
  };
  // dirt path leading from the shop door out towards the camera side (+z)
  const pathX = (z: number) => -0.55 + 1.8 * Math.sin(z * 0.28) * Math.min(1, Math.max(0, (z - 4) / 6));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = -R + i * cs, z = -R + j * cs, cx = x + cs / 2, cz = z + cs / 2;
    let color: RGB;
    const sd = lawnSdf(cx, cz);
    if (sd < 0) {
      color = Math.floor((cx - LAWN_CX) / 1.3) % 2 === 0 ? C.lawnA : C.lawnB; // mown stripes
    } else {
      const f = fbm(cx * 0.32, cz * 0.32);
      color = f < 0.4 ? C.dark : f > 0.64 ? C.light : C.base;
      if (fbm(cx * 0.2 + 40, cz * 0.2 - 9) > 0.66 && f > 0.45) color = C.dry;
    }
    const dz = cz - 4.1;
    if (dz > 0 && Math.abs(cx - pathX(cz)) < 0.85 + (fbm(cx * 0.8, cz * 0.8) - 0.5) * 0.7) color = fbm(cx * 1.3, cz * 1.3) > 0.55 ? C.dirtDark : C.dirt;
    quad(x, z, cs, color, GROUND_Y - 0.004);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFlag', new THREE.Float32BufferAttribute(flag, 1));
  c.parts.push(g);
  // far ground beyond the detailed grid
  const far = new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2);
  c.add(far, place(0, GROUND_Y - 0.03, 0), C.base, FLAG_DECOR);

  // grass tufts
  const blade = new THREE.ConeGeometry(0.045, 1, 3, 1).translate(0, 0.5, 0);
  const greens = [C.light, lin(0xa4d06a), C.base, lin(0x84bd50)];
  for (let i = 0; i < 4200; i++) {
    const x = (rnd() - 0.5) * 54, z = (rnd() - 0.5) * 54;
    if (lawnSdf(x, z) < 0.35) continue;
    if (z > 4 && Math.abs(x - pathX(z)) < 0.95) continue;
    const f = fbm(x * 0.32, z * 0.32);
    if (rnd() > 0.35 + (0.5 - Math.abs(f - 0.5)) * 0.55) continue;
    const tint = pick(greens), h = 0.28 + rnd() * 0.3, nb = 3 + Math.floor(rnd() * 2);
    for (let b = 0; b < nb; b++) {
      const a = (b / nb) * Math.PI * 2 + rnd(), lean = 0.22 + rnd() * 0.3;
      c.add(blade, place(x + Math.cos(a) * 0.06, GROUND_Y, z + Math.sin(a) * 0.06, Math.sin(a) * lean, 0, -Math.cos(a) * lean, 1, h * (0.75 + rnd() * 0.5), 1), tint, FLAG_DECOR, true);
    }
  }

  // wildflower clusters
  const petals = [lin(0xfff3da), lin(0xf3c02a), lin(0xe96a86), lin(0xa48be0), lin(0xff9a4d)];
  const stem = new THREE.CylinderGeometry(0.012, 0.012, 1, 3).translate(0, 0.5, 0);
  const head = new THREE.IcosahedronGeometry(1, 0);
  for (let k = 0; k < 26; k++) {
    let cx = 0, cz = 0, tries = 0;
    do { cx = (rnd() - 0.5) * 40; cz = (rnd() - 0.5) * 40; } while (lawnSdf(cx, cz) < 1.1 && ++tries < 50);
    const pc = pick(petals), n = 6 + Math.floor(rnd() * 10);
    for (let i = 0; i < n; i++) {
      const x = cx + (rnd() - 0.5) * 2.4, z = cz + (rnd() - 0.5) * 2.4;
      if (lawnSdf(x, z) < 0.5 || (z > 4 && Math.abs(x - pathX(z)) < 0.95)) continue;
      const h = 0.22 + rnd() * 0.2;
      c.add(stem, place(x, GROUND_Y, z, 0, 0, 0, 1, h, 1), C.dark, FLAG_DECOR, true);
      c.add(head, place(x, GROUND_Y + h, z, 0, rnd() * 3, 0, 0.065, 0.05, 0.065), rnd() < 0.8 ? pc : pick(petals), FLAG_DECOR, true);
    }
  }
}

function buildTrees(c: Collector) {
  const trunkCol = lin(0x7a4a2a), trunkDark = lin(0x5e3a22);
  const leaf = [lin(0x4f9a4a), lin(0x63ab4c), lin(0x3f8550), lin(0x79b955)];
  const pine = [lin(0x2f7a55), lin(0x3b8a5a), lin(0x256a4c)];
  const trunk = new THREE.CylinderGeometry(0.18, 0.26, 1, 6).translate(0, 0.5, 0);
  const ball = new THREE.IcosahedronGeometry(1, 2);
  const cone = new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0);
  const round = (x: number, z: number, s: number) => {
    const ry = rnd() * 6;
    c.add(trunk, place(x, GROUND_Y, z, 0, ry, 0, s, 1.5 * s, s), trunkCol, FLAG_NORMAL, true);
    const base = pick(leaf);
    for (const [ox, oy, oz, r] of [[0, 2.15, 0, 1.25], [0.75, 1.75, 0.2, 0.9], [-0.7, 1.85, -0.25, 0.95], [0.1, 2.9, -0.1, 0.85]]) {
      c.add(ball, place(x + ox * s, GROUND_Y + oy * s, z + oz * s, rnd(), rnd(), rnd(), r * s, r * s * 0.92, r * s), rnd() < 0.7 ? base : pick(leaf), FLAG_NORMAL, false);
    }
  };
  const fir = (x: number, z: number, s: number) => {
    c.add(trunk, place(x, GROUND_Y, z, 0, 0, 0, s * 0.7, s * 0.9, s * 0.7), trunkDark, FLAG_NORMAL, true);
    const col = pick(pine);
    for (let i = 0; i < 4; i++) c.add(cone, place(x, GROUND_Y + (0.6 + i * 0.85) * s, z, 0, rnd() * 3, 0, (1.35 - i * 0.28) * s, 1.25 * s, (1.35 - i * 0.28) * s), i % 2 ? col : pick(pine), FLAG_NORMAL, true);
  };
  const T: [number, number, number, 'r' | 'f'][] = [
    [-11.5, -7.5, 1.0, 'r'], [-14.5, 0.5, 1.05, 'f'], [-12, 8.5, 0.95, 'r'],
    [12.5, -8.5, 1.05, 'f'], [15.5, -1.5, 1.0, 'r'], [14.5, 8, 1.1, 'f'],
    [2.5, -12, 1.0, 'r'], [-5, -13.5, 1.1, 'f'], [8, -14.5, 1.2, 'r'],
    [-19, -7, 1.3, 'f'], [20, 3, 1.3, 'r'], [-2, 17, 1.2, 'r'], [-16, 15, 1.3, 'f'], [17, 15, 1.2, 'r'],
  ];
  for (const [x, z, s, k] of T) (k === 'r' ? round : fir)(x, z, s);

  const bush = new THREE.IcosahedronGeometry(1, 2);
  const bushCols = [lin(0x74bd5a), lin(0x8ccb62), lin(0x63b052)];
  for (let i = 0; i < 30; i++) {
    const a = rnd() * Math.PI * 2, d = 8 + rnd() * 10;
    const x = LAWN_CX + Math.cos(a) * d * 1.15, z = Math.sin(a) * d * 0.85;
    if (lawnSdf(x, z) < 1.4 || (z > 4 && Math.abs(x + 0.55) < 3)) continue;
    const s = 0.3 + rnd() * 0.4;
    c.add(bush, place(x, GROUND_Y + s * 0.45, z, rnd(), rnd(), rnd(), s * 1.2, s * 0.85, s * 1.1), pick(bushCols), FLAG_NORMAL, false);
  }
  const rock = new THREE.DodecahedronGeometry(1, 0);
  const rockCols = [lin(0xb4a891), lin(0xa09784), lin(0xc8bda5)];
  for (let i = 0; i < 18; i++) {
    const x = (rnd() - 0.5) * 34, z = (rnd() - 0.5) * 30;
    if (lawnSdf(x, z) < 1.5 || (z > 4 && Math.abs(x + 0.55) < 2.6)) continue;
    const s = 0.22 + rnd() * 0.35;
    c.add(rock, place(x, GROUND_Y + s * 0.3, z, rnd() * 3, rnd() * 3, rnd() * 3, s * 1.3, s * 0.8, s), pick(rockCols), FLAG_NORMAL, true);
  }
}

// --- public --------------------------------------------------------------------
export interface World {
  geometry: THREE.BufferGeometry;
  triangles: number;
  paletteColors: number;
}

export async function buildWorld(url: string, paletteK: number): Promise<World> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const c = new Collector();
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const col: RGB = [mat.color.r, mat.color.g, mat.color.b];
    const e = mat.emissive;
    const emissive = (e && e.r + e.g + e.b > 0.05) || /steam/i.test(mat.name);
    c.add(mesh.geometry, mesh.matrixWorld, col, emissive ? FLAG_EMISSIVE : FLAG_NORMAL);
  });
  buildMeadow(c);
  buildTrees(c);
  const geometry = mergeGeometries(c.parts, false)!;
  const paletteColors = quantizePalette(geometry, paletteK);
  return { geometry, triangles: geometry.attributes.position.count / 3, paletteColors };
}
