import * as THREE from 'three';
import { GeometryCollector, linearColor as lin, place } from '../../renderer';
import { foliage } from '../shared/foliage';
import { pick, type Rng } from '../shared/random';
import { BUSHES, groundY, HEDGES, TREES } from './layout';

// Trees, bushes and hedges (positions in layout.ts): shade trees on both banks, fruit trees in the orchard and gardens,
// woods round the ruins on the upper level, and dark firs past the edges of the town so it does not end in bare ground.
// `canopyRadius` in layout.ts must cover the shapes built here.

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
  // A fruit tree: a short crooked trunk and a low, wide crown dotted with fruit.
  const fruitLeaves = { dark: lin(0x34663e), base: lin(0x4c8448), light: lin(0x77a85a) };
  const fruitCols = [lin(0xc8402e), lin(0xe0a030)];
  const fruitBall = new THREE.IcosahedronGeometry(0.09, 0);
  const fruit = (x: number, z: number, sc: number) => {
    const y = groundY(x, z), lean = (rnd() - 0.5) * 0.25, color = pick(rnd, fruitCols);
    s.add(trunk, place(x, y, z, lean, rnd() * 6, lean, sc * 0.75, 1.3 * sc, sc * 0.75), trunkCol);
    foliage(s, rnd, x, y + 1.9 * sc, z, 1.5 * sc, 0.95 * sc, 1.4 * sc, 26, 0.42 * sc, fruitLeaves);
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2, h = 1.6 + rnd() * 0.8;
      s.add(fruitBall, place(x + Math.cos(a) * 1.45 * sc, y + h * sc, z + Math.sin(a) * 1.35 * sc), color);
    }
  };
  const bush = (x: number, z: number, sc: number) =>
    foliage(s, rnd, x, groundY(x, z) + sc * 0.55, z, sc * 1.25, sc * 0.9, sc * 1.1, 11, sc * 0.5, pick(rnd, leafSets));

  for (const [x, z, sc, k] of TREES) ({ r: round, f: fir, o: fruit })[k](x, z, sc);
  for (const [x, z, sc] of BUSHES) bush(x, z, sc);
  // Hedges: overlapping clipped masses along each run.
  const hedgeLeaves = { dark: lin(0x285a3e), base: lin(0x376e46), light: lin(0x4f8a50) };
  for (const run of HEDGES) for (let i = 1; i < run.length; i++) {
    const [ax, az] = run[i - 1], [bx, bz] = run[i], len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 1.1));
    for (let k = 0; k <= n; k++) {
      const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
      foliage(s, rnd, x, groundY(x, z) + 0.6, z, 0.75, 0.6, 0.75, 9, 0.36, hedgeLeaves);
    }
  }
}
