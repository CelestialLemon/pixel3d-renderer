import * as THREE from 'three';
import { FLAG, GeometryCollector, type RGB } from '../../renderer';
import type { Rng } from './random';

export type LeafColors = { dark: RGB; base: RGB; light: RGB };

// A leaf mass built from many small spheres whose normals all point away from the mass
// centre: the shading reads as one smooth, banded sphere while the silhouette stays
// scalloped, like hand-drawn pixel foliage.
const CLUMP = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
export function foliage(c: GeometryCollector, rnd: Rng, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, count: number, clumpR: number, cols: LeafColors) {
  const pa = CLUMP.attributes.position as THREE.BufferAttribute, na = CLUMP.attributes.normal as THREE.BufferAttribute;
  const tmp = new THREE.Vector3(), nrm = new THREE.Vector3(), own = new THREE.Vector3();
  const emit = (px: number, py: number, pz: number, r: number, color: RGB) => {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(pa.count * 3), nor = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      tmp.set(pa.getX(i) * r + px, pa.getY(i) * r + py, pa.getZ(i) * r + pz);
      nrm.set((tmp.x - cx) / rx, (tmp.y - cy) / ry, (tmp.z - cz) / rz).normalize()
        .multiplyScalar(0.88).addScaledVector(own.set(na.getX(i), na.getY(i), na.getZ(i)), 0.12).normalize();
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
