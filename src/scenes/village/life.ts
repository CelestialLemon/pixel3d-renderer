import * as THREE from 'three';
import { FLAG, GeometryCollector, linearColor as lin, motion } from '../../renderer';
import type { Rng } from '../shared/random';
import { CANAL, groundY, UPPER_Y } from './layout';

/** Chimney smoke and fireflies (drawn at night only), animated by the vertex shader. */
export function buildLife(d: GeometryCollector, rnd: Rng, chimneys: THREE.Vector3[]) {
  const puff = new THREE.IcosahedronGeometry(1, 1);
  for (const top of chimneys) {
    for (let i = 0; i < 7; i++) d.add(puff, null, lin(0xd8d3e2), FLAG.STEAM, false, motion.smoke(top.toArray(), i / 7, rnd()));
  }
  // Fireflies over the grass on the canal's south bank and in the upper-lane garden.
  const fly = new THREE.IcosahedronGeometry(0.05, 0);
  const homes: [number, number][] = [];
  for (let i = 0; i < 16; i++) homes.push([CANAL.x0 + 1 + rnd() * (CANAL.x1 - CANAL.x0 - 2), CANAL.z1 + 1 + rnd() * 2.2]);
  for (let i = 0; i < 7; i++) homes.push([7.5 + rnd() * 6, -11 + rnd() * 4]);
  for (const [x, z] of homes) {
    const y = z < 0 ? UPPER_Y : groundY(x, z);
    d.add(fly, null, lin(0xf4ff9a), FLAG.GLOW, true, motion.firefly([x, y, z], rnd(), rnd()));
  }
}
