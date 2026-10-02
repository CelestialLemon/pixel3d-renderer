import * as THREE from 'three';
import { FLAG, GeometryCollector, linearColor as lin, place, type RGB } from '../../renderer';
import { foliage } from '../shared/foliage';
import { pick, type Rng } from '../shared/random';
import { GROUND_Y, LAWN_CX, lawnSdf, onPath, pondD } from './layout';

/** Round trees and firs around the clearing, bushes, rocks, mushrooms, a log and a stump. */
export function buildTrees(s: GeometryCollector, rnd: Rng) {
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
    const set = pick(rnd, leafSets);
    foliage(s, rnd, x, GROUND_Y + 2.7 * sc, z, 1.5 * sc, 1.25 * sc, 1.5 * sc, 34, 0.5 * sc, set);
    for (const [ox, oy, oz, r] of [[0.95, -0.35, 0.3, 0.8], [-0.9, -0.25, -0.35, 0.85], [0.1, 0.8, -0.1, 0.8]]) {
      foliage(s, rnd, x + ox * sc, GROUND_Y + (2.7 + oy) * sc, z + oz * sc, r * sc, r * 0.85 * sc, r * sc, 14, 0.36 * sc, set);
    }
  };
  const fir = (x: number, z: number, sc: number) => {
    s.add(trunk, place(x, GROUND_Y, z, 0, 0, 0, sc * 0.7, sc * 0.9, sc * 0.7), trunkDark);
    for (let i = 0; i < 4; i++) {
      const tier = new THREE.ConeGeometry(1, 1, 9, 1).translate(0, 0.5, 0);
      s.add(tier, place(x, GROUND_Y + (0.6 + i * 0.85) * sc, z, 0, rnd() * 3, 0, (1.4 - i * 0.28) * sc, 1.3 * sc, (1.4 - i * 0.28) * sc), pick(rnd, pineSet));
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
    foliage(s, rnd, x, GROUND_Y + sc * 0.55, z, sc * 1.25, sc * 0.9, sc * 1.1, 11, sc * 0.5, pick(rnd, bushSets));
  }
  const rock = new THREE.DodecahedronGeometry(1, 0);
  const rockCols = [lin(0xb4a891), lin(0xa09784), lin(0xc8bda5)];
  for (let i = 0; i < 18; i++) {
    const x = (rnd() - 0.5) * 34, z = (rnd() - 0.5) * 30;
    if (lawnSdf(x, z) < 1.5 || pondD(x, z) < 1.2 || onPath(x, z, 2.6)) continue;
    const sc = 0.22 + rnd() * 0.35;
    s.add(rock, place(x, GROUND_Y + sc * 0.3, z, rnd() * 3, rnd() * 3, rnd() * 3, sc * 1.3, sc * 0.8, sc), pick(rnd, rockCols), FLAG.NORMAL, true);
  }

  // mushrooms, a stump and a log: small story props near the tree line
  const capGeo = new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const stemGeo = new THREE.CylinderGeometry(0.6, 0.8, 1, 6).translate(0, 0.5, 0);
  for (const [mx, mz] of [[-9.2, 6.2], [-7.1, 9.6], [9.6, -5.2], [7.4, 8.6]]) {
    for (let i = 0; i < 3; i++) {
      const x = mx + (rnd() - 0.5) * 0.9, z = mz + (rnd() - 0.5) * 0.9, sc = 0.09 + rnd() * 0.08;
      s.add(stemGeo, place(x, GROUND_Y, z, 0, 0, 0, sc, sc * 2, sc), lin(0xf3e6c6));
      s.add(capGeo, place(x, GROUND_Y + sc * 2, z, 0, 0, 0, sc * 2.1, sc * 1.4, sc * 2.1), pick(rnd, [lin(0xd9503f), lin(0xd9503f), lin(0xe8913a)]));
    }
  }
  const log = new THREE.CylinderGeometry(0.28, 0.28, 2.2, 9);
  s.add(log, place(-9.6, GROUND_Y + 0.28, 3.2, 0, 0.5, Math.PI / 2), trunkCol);
  s.add(new THREE.CylinderGeometry(0.265, 0.265, 0.02, 9), place(-9.6 + Math.sin(0.5) * 1.11, GROUND_Y + 0.28, 3.2 + Math.cos(0.5) * 1.11, Math.PI / 2, 0.5, 0), trunkLight);
  s.add(new THREE.CylinderGeometry(0.34, 0.4, 0.42, 9), place(10.2, GROUND_Y + 0.21, 4.4), trunkCol);
  s.add(new THREE.CylinderGeometry(0.33, 0.33, 0.02, 9), place(10.2, GROUND_Y + 0.43, 4.4), trunkLight);
}
