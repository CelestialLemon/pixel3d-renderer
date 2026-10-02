import * as THREE from 'three';
import { GeometryCollector, linearColor as lin, place } from '../../renderer';
import { foliage } from '../shared/foliage';
import { pick, type Rng } from '../shared/random';
import { groundY } from './layout';

// Trees and bushes: a row along the canal's south bank, a garden at the east end of the upper lane, and a few
// dark firs past the edges of the street so it does not end in bare ground.

export function buildTrees(s: GeometryCollector, rnd: Rng) {
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 1, 7).translate(0, 0.5, 0);
  const trunkCol = lin(0x5e4030);
  const leafSets = [
    { dark: lin(0x2f6b48), base: lin(0x478a52), light: lin(0x6fae5e) },
    { dark: lin(0x2c6450), base: lin(0x3f8058), light: lin(0x63a46a) },
  ];
  const pine = [lin(0x24584a), lin(0x2d6a52), lin(0x21504a)];
  const round = (x: number, z: number, sc: number) => {
    const y = groundY(x, z), set = pick(rnd, leafSets);
    s.add(trunk, place(x, y, z, 0, rnd() * 6, 0, sc, 1.8 * sc, sc), trunkCol);
    foliage(s, rnd, x, y + 2.8 * sc, z, 1.4 * sc, 1.2 * sc, 1.4 * sc, 30, 0.48 * sc, set);
    for (const [ox, oy, oz, r] of [[0.9, -0.3, 0.3, 0.75], [-0.85, -0.2, -0.3, 0.8]]) {
      foliage(s, rnd, x + ox * sc, y + (2.8 + oy) * sc, z + oz * sc, r * sc, r * 0.85 * sc, r * sc, 12, 0.34 * sc, set);
    }
  };
  const fir = (x: number, z: number, sc: number) => {
    const y = groundY(x, z);
    s.add(trunk, place(x, y, z, 0, 0, 0, sc * 0.7, sc * 0.9, sc * 0.7), trunkCol);
    for (let i = 0; i < 4; i++) {
      const tier = new THREE.ConeGeometry(1, 1, 9, 1).translate(0, 0.5, 0);
      s.add(tier, place(x, y + (0.6 + i * 0.85) * sc, z, 0, rnd() * 3, 0, (1.4 - i * 0.28) * sc, 1.3 * sc, (1.4 - i * 0.28) * sc), pick(rnd, pine));
    }
  };
  const bush = (x: number, z: number, sc: number) =>
    foliage(s, rnd, x, groundY(x, z) + sc * 0.55, z, sc * 1.25, sc * 0.9, sc * 1.1, 11, sc * 0.5, pick(rnd, leafSets));

  const T: [number, number, number, 'r' | 'f'][] = [
    // south bank of the canal
    [-7.4, 11.3, 0.9, 'r'], [-2.4, 11.8, 0.8, 'r'], [3.2, 11.6, 0.85, 'r'], [7.8, 11.2, 0.95, 'r'],
    // upper-lane garden
    [11.4, -11.2, 1.0, 'r'], [12.6, -9.8, 1.05, 'f'], [13.2, -6.6, 0.85, 'r'],
    // beyond the edges
    [-17, 3, 1.2, 'f'], [17.5, 2.5, 1.25, 'f'], [-16.5, 10, 1.1, 'r'], [16.8, 11, 1.2, 'f'], [-17, -9, 1.3, 'f'], [17, -10, 1.2, 'r'],
    [-8, 15, 1.3, 'f'], [6, 15.5, 1.2, 'f'], [0, -15, 1.3, 'r'], [-9, -15, 1.2, 'f'],
  ];
  for (const [x, z, sc, k] of T) (k === 'r' ? round : fir)(x, z, sc);
  for (const [x, z, sc] of [[-5.9, 10.1, 0.5], [-1.6, 10.4, 0.42], [1.8, 10.3, 0.45], [4.2, 10.5, 0.55], [8.4, 10.3, 0.5], [7.3, -6.3, 0.5], [11, -6.2, 0.45]]) bush(x, z, sc);
}
