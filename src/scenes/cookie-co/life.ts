import * as THREE from 'three';
import { flip, FLAG, GeometryCollector, linearColor as lin, motion } from '../../renderer';
import type { Rng } from '../shared/random';
import { CHIMNEY_TOP, GROUND_Y, POND } from './layout';

/** Chimney smoke, butterflies around `flowerSpots`, and fireflies: all animated by the vertex shader. */
export function buildLife(d: GeometryCollector, rnd: Rng, flowerSpots: { x: number; z: number }[]) {
  // chimney smoke: dissolving puffs
  const puff = new THREE.IcosahedronGeometry(1, 1);
  const chimney = CHIMNEY_TOP.toArray();
  for (let i = 0; i < 9; i++) d.add(puff, null, lin(0xfff9ec), FLAG.STEAM, false, motion.smoke(chimney, i / 9, rnd()));

  // butterflies: two wings, double sided
  const wingCols = [lin(0xfff3da), lin(0xf3c02a), lin(0xff9a4d), lin(0xa9d4f5), lin(0xe96a86)];
  const wing = (sgn: number) => {
    const v = [0, 0, -0.03, sgn * 0.14, 0, -0.11, sgn * 0.14, 0, 0.07, 0, 0, 0.05];
    const idx = [0, 1, 2, 0, 2, 3];
    const pos: number[] = [], nor: number[] = [];
    for (const i of idx) { pos.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]); nor.push(0, 1, 0); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return g;
  };
  const centers = [...flowerSpots.slice(0, 5), { x: POND.x + 1.5, z: POND.z - 2.2 }, { x: 3, z: 6 }];
  centers.forEach((c, i) => {
    const seed = rnd(), col = wingCols[i % wingCols.length], mo = motion.butterfly([c.x, GROUND_Y, c.z], i / centers.length, seed);
    for (const sgn of [1, -1]) {
      d.add(wing(sgn), null, col, FLAG.DECOR, false, mo);
      const back = wing(sgn); flip(back);
      d.add(back, null, col, FLAG.DECOR, false, mo);
    }
  });

  // fireflies (only drawn at night)
  const fly = new THREE.IcosahedronGeometry(0.055, 0);
  for (let i = 0; i < 26; i++) {
    const cx = (rnd() - 0.5) * 22 + 0.8, cz = (rnd() - 0.5) * 18, ph = rnd(), sd = rnd();
    d.add(fly, null, lin(0xf4ff9a), FLAG.GLOW, true, motion.firefly([cx, GROUND_Y, cz], ph, sd));
  }
}
