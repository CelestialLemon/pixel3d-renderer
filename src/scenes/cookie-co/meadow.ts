import * as THREE from 'three';
import { FLAG, GeometryCollector, linearColor as lin, motion, place, type RGB } from '../../renderer';
import { fbm, pick, type Rng } from '../shared/random';
import { GROUND_Y, LAWN_CX, lawnSdf, onPath, pathX, pondD } from './layout';

/** Ground tiles (lawn, meadow, path, pond water), swaying grass tufts and wildflowers. Returns the flower cluster centres. */
export function buildMeadow(s: GeometryCollector, d: GeometryCollector, rnd: Rng) {
  const C = {
    lawnA: lin(0x9ac15a), lawnB: lin(0x8db84f),
    dark: lin(0x6aa440), base: lin(0x79b04a), light: lin(0x89bb53), dry: lin(0x9fb85a), clover: lin(0x62a85a),
    dirt: lin(0xb98550), dirtDark: lin(0x9c6b40),
    bank: lin(0xcdb47c), bankWet: lin(0xa88d5c),
    deep: lin(0x2f86c4), water: lin(0x4db4e0), foam: lin(0xd2f0f2),
  };
  // One flat quad per 0.25-unit ground cell, coloured by region.
  const R = 30, cs = 0.25, n = Math.round((R * 2) / cs);
  const pos: number[] = [], nor: number[] = [], col: number[] = [], flag: number[] = [];
  const quad = (x: number, z: number, sz: number, color: RGB, y: number, fl: number) => {
    const a = [x, y, z], b = [x, y, z + sz], dd = [x + sz, y, z + sz], e = [x + sz, y, z];
    for (const v of [a, b, dd, a, dd, e]) { pos.push(v[0], v[1], v[2]); nor.push(0, 1, 0); col.push(...color); flag.push(fl); }
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = -R + i * cs, z = -R + j * cs, cx = x + cs / 2, cz = z + cs / 2;
    const pd = pondD(cx, cz);
    if (pd < 1.0) {
      const color = pd > 0.86 ? C.foam : pd > 0.55 ? C.water : C.deep;
      quad(x, z, cs, color, GROUND_Y - 0.07, FLAG.WATER);
      continue;
    }
    let color: RGB;
    if (pd < 1.12) color = pd < 1.05 ? C.bankWet : C.bank;
    else if (lawnSdf(cx, cz) < 0) color = Math.floor((cx - LAWN_CX) / 1.3) % 2 === 0 ? C.lawnA : C.lawnB;
    else {
      const f = fbm(cx * 0.32, cz * 0.32);
      color = f < 0.4 ? C.dark : f > 0.64 ? C.light : C.base;
      if (fbm(cx * 0.2 + 40, cz * 0.2 - 9) > 0.66 && f > 0.45) color = C.dry;
      if (fbm(cx * 0.45 - 20, cz * 0.45 + 30) > 0.72) color = C.clover;
    }
    if (cz > 4.1 && Math.abs(cx - pathX(cz)) < 0.85 + (fbm(cx * 0.8, cz * 0.8) - 0.5) * 0.7) color = fbm(cx * 1.3, cz * 1.3) > 0.55 ? C.dirtDark : C.dirt;
    quad(x, z, cs, color, GROUND_Y - 0.004, FLAG.DECOR);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFlag', new THREE.Float32BufferAttribute(flag, 1));
  s.pushPrepared(g);
  // A huge plane below everything, so the horizon is never sky.
  s.add(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), place(0, GROUND_Y - 0.1, 0), C.base, FLAG.DECOR);

  // grass tufts (swaying)
  const blade = new THREE.ConeGeometry(0.045, 1, 3, 1).translate(0, 0.5, 0);
  const greens = [lin(0x5a9a3c), lin(0x4f9238), C.dark, lin(0x84bd50), C.light, lin(0x6bae44)];
  for (let i = 0; i < 4600; i++) {
    const x = (rnd() - 0.5) * 54, z = (rnd() - 0.5) * 54;
    if (lawnSdf(x, z) < 0.35 || pondD(x, z) < 1.18 || onPath(x, z)) continue;
    const f = fbm(x * 0.32, z * 0.32);
    if (rnd() > 0.35 + (0.5 - Math.abs(f - 0.5)) * 0.55) continue;
    const tint = pick(rnd, greens), tall = rnd() < 0.14 ? 1.7 : 1, h = (0.28 + rnd() * 0.3) * tall, nb = 3 + Math.floor(rnd() * 2);
    for (let b = 0; b < nb; b++) {
      const a = (b / nb) * Math.PI * 2 + rnd(), lean = 0.2 + rnd() * 0.3;
      d.add(blade, place(x + Math.cos(a) * 0.06, GROUND_Y, z + Math.sin(a) * 0.06, Math.sin(a) * lean, 0, -Math.cos(a) * lean, 1, h * (0.75 + rnd() * 0.5), 1), tint, FLAG.DECOR, true, motion.sway(x, z, GROUND_Y, 0.5 * tall));
    }
  }

  // wildflower clusters (swaying)
  const flowerSpots: { x: number; z: number }[] = [];
  const petals = [lin(0xfff3da), lin(0xf3c02a), lin(0xe96a86), lin(0xa48be0), lin(0xff9a4d)];
  const stem = new THREE.CylinderGeometry(0.012, 0.012, 1, 3).translate(0, 0.5, 0);
  const head = new THREE.IcosahedronGeometry(1, 0);
  for (let k = 0; k < 30; k++) {
    let cx = 0, cz = 0, tries = 0;
    do { cx = (rnd() - 0.5) * 40; cz = (rnd() - 0.5) * 40; } while ((lawnSdf(cx, cz) < 1.1 || pondD(cx, cz) < 1.4) && ++tries < 50);
    flowerSpots.push({ x: cx, z: cz });
    const pc = pick(rnd, petals), nn = 7 + Math.floor(rnd() * 11);
    for (let i = 0; i < nn; i++) {
      const x = cx + (rnd() - 0.5) * 2.4, z = cz + (rnd() - 0.5) * 2.4;
      if (lawnSdf(x, z) < 0.5 || pondD(x, z) < 1.2 || onPath(x, z)) continue;
      const h = 0.22 + rnd() * 0.2, sway = motion.sway(x, z, GROUND_Y, 0.5);
      d.add(stem, place(x, GROUND_Y, z, 0, 0, 0, 1, h, 1), C.dark, FLAG.DECOR, true, sway);
      d.add(head, place(x, GROUND_Y + h, z, 0, rnd() * 3, 0, 0.065, 0.05, 0.065), rnd() < 0.8 ? pc : pick(rnd, petals), FLAG.DECOR, true, sway);
    }
  }
  return flowerSpots;
}
