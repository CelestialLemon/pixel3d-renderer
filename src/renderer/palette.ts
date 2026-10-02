import * as THREE from 'three';
import type { RGB } from './geometry';

// OKLab conversions (linear sRGB in, linear sRGB out). The post shader has GLSL twins of these.
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

/** Number of base colours a scene is reduced to unless it asks for another. */
export const DEFAULT_PALETTE_SIZE = 80;

/**
 * Reduce every vertex colour (`aColor`) across `geos` to at most `K` base colours, in place, in OKLab, treating each
 * distinct (colour, flag) as one input. Minimax merging: repeatedly merge the two colour groups whose merged colour
 * moves its furthest member the least, until `K` are left. This bounds the worst shift of any input colour, so no
 * colour is pushed far just because few vertices use it (k-means, used before, absorbed small objects' colours into
 * clearly different ones). A merged colour is the mean of its members weighted by the square root of their surface
 * area. Geometry must be non-indexed (as GeometryCollector builds it). Returns how many colours are actually used.
 */
export function quantizePalette(geos: THREE.BufferGeometry[], K: number): number {
  if (!Number.isInteger(K) || K < 1) throw new RangeError(`palette size must be a whole number of at least 1, got ${K}`);
  const key = (col: THREE.BufferAttribute, flag: THREE.BufferAttribute, i: number) => {
    const q = (v: number) => Math.round(v * 1023);
    return q(col.getX(i)) * 1048576 + q(col.getY(i)) * 1024 + q(col.getZ(i)) + Math.round(flag.getX(i)) * 1e10;   // rounded: the thin mark is not a colour
  };
  const uniq = new Map<number, Point>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const g of geos) {
    const col = g.attributes.aColor as THREE.BufferAttribute, flag = g.attributes.aFlag as THREE.BufferAttribute, pos = g.attributes.position;
    for (let i = 0; i < col.count; i++) {
      const k = key(col, flag, i);
      let u = uniq.get(k);
      if (!u) uniq.set(k, (u = { lab: toLab([col.getX(i), col.getY(i), col.getZ(i)]), area: 0, idx: 0 }));
      // A triangle's area goes to its first vertex's colour: GeometryCollector gives all three the same colour.
      if (i % 3 === 0) u.area += 0.5 * b.fromBufferAttribute(pos, i + 1).sub(a.fromBufferAttribute(pos, i)).cross(c.fromBufferAttribute(pos, i + 2).sub(a)).length();
    }
  }
  const pts = [...uniq.values()];
  if (pts.length <= K) return pts.length;
  const out = mergeMinimax(pts, K).map((c) => fromLab(c).map((v) => Math.min(1, Math.max(0, v))) as RGB);
  for (const g of geos) {
    const col = g.attributes.aColor as THREE.BufferAttribute, flag = g.attributes.aFlag as THREE.BufferAttribute;
    for (let i = 0; i < col.count; i++) { const c = out[uniq.get(key(col, flag, i))!.idx]; col.setXYZ(i, c[0], c[1], c[2]); }
  }
  return new Set(pts.map((p) => p.idx)).size;
}

/** One distinct input colour: OKLab, surface area, and the palette entry it ends up in. */
type Point = { lab: RGB; area: number; idx: number };

// Chroma counts 3.2x: small hue shifts matter more than small lightness shifts in pixel art.
const d2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + 3.2 * (a[1] - b[1]) ** 2 + 3.2 * (a[2] - b[2]) ** 2;

/**
 * Agglomerative merging with minimax linkage: sets each point's `idx` and returns the K cluster centres.
 * O(n³) in the number of distinct inputs, fine for the ~100 of today's scenes but not for thousands (textures).
 */
function mergeMinimax(pts: Point[], K: number): RGB[] {
  const centre = (ms: Point[]): RGB => {
    let W = 0; const s: RGB = [0, 0, 0];
    for (const p of ms) { const w = Math.sqrt(p.area) + 1e-6; W += w; s[0] += p.lab[0] * w; s[1] += p.lab[1] * w; s[2] += p.lab[2] * w; }
    return [s[0] / W, s[1] / W, s[2] / W];
  };
  const cost = (x: Point[], y: Point[]) => { const ms = x.concat(y), c = centre(ms); let m = 0; for (const p of ms) m = Math.max(m, d2(p.lab, c)); return m; };
  const clusters = pts.map((p) => [p]);
  const pair = clusters.map((x, i) => clusters.map((y, j) => (j > i ? cost(x, y) : 0)));   // upper triangle
  while (clusters.length > K) {
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) if (pair[i][j] < bd) { bd = pair[i][j]; bi = i; bj = j; }
    clusters[bi] = clusters[bi].concat(clusters[bj]);
    clusters.splice(bj, 1); pair.splice(bj, 1); for (const row of pair) row.splice(bj, 1);
    for (let j = 0; j < clusters.length; j++) if (j !== bi) { const v = cost(clusters[bi], clusters[j]); if (j > bi) pair[bi][j] = v; else pair[j][bi] = v; }
  }
  clusters.forEach((ms, i) => ms.forEach((p) => (p.idx = i)));
  return clusters.map(centre);
}
