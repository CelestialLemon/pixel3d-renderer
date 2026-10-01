import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FLAG } from './flags';
import type { Motion } from './motion';

export type RGB = [number, number, number];

/** sRGB hex to the linear colour the G-buffer stores. */
export const linearColor = (hex: number): RGB => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V3 = new THREE.Vector3(), S3 = new THREE.Vector3();
/** Transform from position, Euler rotation (radians) and scale. */
export const place = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  M.compose(V3.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S3.set(sx, sy, sz)).clone();

/** Swap two vertices of every triangle, so mirrored meshes keep their front faces outward. */
export function flip(g: THREE.BufferGeometry) {
  for (const k of Object.keys(g.attributes)) {
    const a = g.attributes[k] as THREE.BufferAttribute, s = a.itemSize, arr = a.array as Float32Array;
    for (let t = 0; t < a.count; t += 3) for (let j = 0; j < s; j++) {
      const i1 = (t + 1) * s + j, i2 = (t + 2) * s + j, tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp;
    }
  }
}

/**
 * Gathers world-space, non-indexed triangles with the per-vertex attributes the renderer reads:
 * `aColor` (linear RGB) and `aFlag`, plus `aMode`, `aAnchor` and `aAnim` for a dynamic collector.
 * Everything is merged into one geometry by `build()`.
 */
export class GeometryCollector {
  private parts: THREE.BufferGeometry[] = [];
  constructor(readonly dynamic = false) {}

  /** Add a geometry that is already world space, non-indexed and has position + normal. */
  push(g: THREE.BufferGeometry, color: RGB, flag: number, mo?: Motion) {
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3), f = new Float32Array(n);
    for (let i = 0; i < n; i++) { c[i * 3] = color[0]; c[i * 3 + 1] = color[1]; c[i * 3 + 2] = color[2]; f[i] = flag; }
    g.setAttribute('aColor', new THREE.BufferAttribute(c, 3));
    g.setAttribute('aFlag', new THREE.BufferAttribute(f, 1));
    if (this.dynamic) {
      const md = new Float32Array(n).fill(mo?.mode ?? 0), anchor = new Float32Array(n * 3), an = new Float32Array(n * 4);
      if (mo?.anchor) for (let i = 0; i < n; i++) anchor.set(mo.anchor, i * 3);
      const anim = mo?.anim;
      if (typeof anim === 'function') {
        const p = g.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < n; i++) an.set(anim(p.getX(i), p.getY(i), p.getZ(i)), i * 4);
      } else if (anim) for (let i = 0; i < n; i++) an.set(anim, i * 4);
      g.setAttribute('aMode', new THREE.BufferAttribute(md, 1));
      g.setAttribute('aAnchor', new THREE.BufferAttribute(anchor, 3));
      g.setAttribute('aAnim', new THREE.BufferAttribute(an, 4));
    }
    this.parts.push(g);
  }

  /** Add a geometry that already has every attribute this collector needs (see the class comment). */
  pushPrepared(g: THREE.BufferGeometry) { this.parts.push(g); }

  /**
   * Add a copy of `src` transformed by `m`. `flat` recomputes normals from the triangles (faceted look);
   * otherwise the source normals are kept. Only position and normal survive from the source.
   */
  add(src: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: RGB, flag: number = FLAG.NORMAL, flat = false, mo?: Motion) {
    const g = src.index ? src.toNonIndexed() : src.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (m) { g.applyMatrix4(m); if (m.determinant() < 0) flip(g); }
    if (flat || !g.attributes.normal) g.computeVertexNormals();
    this.push(g, color, flag, mo);
  }

  /** Merge everything collected so far. An empty collector gives an empty geometry with the right attributes. */
  build(): THREE.BufferGeometry {
    if (this.parts.length) return mergeGeometries(this.parts, false)!;
    const g = new THREE.BufferGeometry(), empty = (size: number) => new THREE.BufferAttribute(new Float32Array(0), size);
    g.setAttribute('position', empty(3)); g.setAttribute('normal', empty(3)); g.setAttribute('aColor', empty(3)); g.setAttribute('aFlag', empty(1));
    if (this.dynamic) { g.setAttribute('aMode', empty(1)); g.setAttribute('aAnchor', empty(3)); g.setAttribute('aAnim', empty(4)); }
    return g;
  }
}
