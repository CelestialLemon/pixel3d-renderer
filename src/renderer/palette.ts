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

/**
 * Reduce every vertex colour (`aColor`) across `geos` to at most `K` base colours, in place: weighted k-means
 * in OKLab, seeded with k-means++ from `rnd`, where each distinct (colour, flag) input is weighted by the square
 * root of its vertex count. Returns how many colours are actually used.
 */
export function quantizePalette(geos: THREE.BufferGeometry[], K: number, rnd: () => number): number {
  const key = (col: THREE.BufferAttribute, flag: THREE.BufferAttribute, i: number) => {
    const q = (v: number) => Math.round(v * 1023);
    return q(col.getX(i)) * 1048576 + q(col.getY(i)) * 1024 + q(col.getZ(i)) + Math.round(flag.getX(i)) * 1e10;   // rounded: the thin mark is not a colour
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
  // Chroma counts 3.2x: small hue shifts matter more than small lightness shifts in pixel art.
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
