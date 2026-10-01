import * as THREE from 'three';
import { FLAG, flip, GeometryCollector, linearColor as lin, place } from '../../renderer';

// Small building blocks for the test chart: boxes, rods between two points, and inward-facing shells.
// Colours are sRGB hex. Every helper takes the collector first.

export type C = GeometryCollector;
export type P3 = [number, number, number];

const BOX = new THREE.BoxGeometry(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** Box with its base centred at (x, y, z): w along x, h up, d along z, turned `ry` radians about y. */
export const box = (s: C, x: number, y: number, z: number, w: number, h: number, d: number, hex: number, flag: number = FLAG.NORMAL, ry = 0) =>
  s.add(BOX, place(x, y + h / 2, z, 0, ry, 0, w, h, d), lin(hex), flag);

/** Square-section rod `w` thick from `a` to `b`. */
export function rod(s: C, a: P3, b: P3, w: number, hex: number, flag: number = FLAG.NORMAL) {
  const pa = new THREE.Vector3(...a), dir = new THREE.Vector3(...b).sub(pa), len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  const m = new THREE.Matrix4().compose(pa.addScaledVector(dir, 0.5), q, new THREE.Vector3(w, len, w));
  s.add(BOX, m, lin(hex), flag);
}

/** A sagging wire from `a` to `b` (catenary-like parabola), built from `n` rods. */
export function wire(s: C, a: P3, b: P3, sag: number, w: number, hex: number, n = 12) {
  const at = (t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
  for (let i = 0; i < n; i++) rod(s, at(i / n), at((i + 1) / n), w, hex, FLAG.NORMAL);
}

/** Add `geo` turned inside out (flipped winding, negated normals): the inner wall of a pipe or bowl. */
export function addInward(s: C, geo: THREE.BufferGeometry, m: THREE.Matrix4, hex: number) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.applyMatrix4(m);
  flip(g);
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  s.add(g, null, lin(hex), FLAG.NORMAL);
}

/** A low kerb outlining a rectangular bay (half sizes hx, hz). */
export function kerb(s: C, cx: number, cz: number, hx: number, hz: number, hex: number) {
  const t = 0.12, h = 0.05;
  box(s, cx, 0, cz - hz, 2 * hx + t, h, t, hex);
  box(s, cx, 0, cz + hz, 2 * hx + t, h, t, hex);
  box(s, cx - hx, 0, cz, t, h, 2 * hz - t, hex);
  box(s, cx + hx, 0, cz, t, h, 2 * hz - t, hex);
}
