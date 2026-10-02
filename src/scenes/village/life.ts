import * as THREE from 'three';
import { FLAG, GeometryCollector, linearColor as lin, motion } from '../../renderer';
import type { Rng } from '../shared/random';
import { groundY, POND } from './layout';

/** Chimney smoke and fireflies (drawn at night only), animated by the vertex shader. */
export function buildLife(d: GeometryCollector, rnd: Rng, chimneys: THREE.Vector3[]) {
  const puff = new THREE.IcosahedronGeometry(1, 1);
  for (const top of chimneys) {
    for (let i = 0; i < 7; i++) d.add(puff, null, lin(0xd8d3e2), FLAG.STEAM, false, motion.smoke(top.toArray(), i / 7, rnd()));
  }
  // Fireflies: over the pond, in the orchard and the gardens, round the ruins, and along the water by the mill.
  const fly = new THREE.IcosahedronGeometry(0.05, 0);
  const swarms: [x: number, z: number, rx: number, rz: number, n: number][] = [
    [POND.x, POND.z, POND.r + 1, POND.r + 1, 14], [-7.5, 19, 4, 2, 10], [12.5, 20.5, 4, 2, 6], [-14, -30, 6, 5, 14],
    [-19.5, 12, 3, 1.5, 6], [25, -28, 4, 3, 5],
  ];
  for (const [cx, cz, rx, rz, n] of swarms) for (let i = 0; i < n; i++) {
    const x = cx + (rnd() * 2 - 1) * rx, z = cz + (rnd() * 2 - 1) * rz;
    d.add(fly, null, lin(0xf4ff9a), FLAG.GLOW, true, motion.firefly([x, groundY(x, z), z], rnd(), rnd()));
  }
}
