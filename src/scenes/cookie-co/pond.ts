import * as THREE from 'three';
import { FLAG, GeometryCollector, linearColor as lin, motion, place } from '../../renderer';
import { pick, type Rng } from '../shared/random';
import { GROUND_Y, onPath, POND, pondD } from './layout';

/** Lily pads and flowers on the pond (the water itself is part of the meadow tiles), shore rocks, reeds and cattails. */
export function buildPond(s: GeometryCollector, d: GeometryCollector, rnd: Rng) {
  const pad = new THREE.CylinderGeometry(1, 1, 0.03, 10);
  const padCols = [lin(0x4fae5a), lin(0x62c06a), lin(0x3f9a56)];
  const wy = GROUND_Y - 0.07 + 0.03;
  for (let i = 0; i < 9; i++) {
    const a = rnd() * 6.283, r = rnd() * 0.65;
    const x = POND.x + Math.cos(a) * POND.rx * r, z = POND.z + Math.sin(a) * POND.rz * r, sc = 0.2 + rnd() * 0.14;
    if (pondD(x, z) > 0.78) continue;
    s.add(pad, place(x, wy, z, 0, rnd() * 3, 0, sc, 1, sc), pick(rnd, padCols), FLAG.NORMAL, true);
    if (rnd() < 0.4) s.add(new THREE.IcosahedronGeometry(1, 0), place(x, wy + 0.06, z, 0, 0, 0, 0.1, 0.07, 0.1), lin(0xf49ac1), FLAG.NORMAL, true);
  }
  const rock = new THREE.DodecahedronGeometry(1, 0);
  const rockCols = [lin(0xb4a891), lin(0xa09784), lin(0xc8bda5)];
  const reed = new THREE.ConeGeometry(0.035, 1, 3, 1).translate(0, 0.5, 0);
  const cattail = new THREE.CylinderGeometry(0.05, 0.05, 0.22, 5).translate(0, 0.11, 0);
  for (let i = 0; i < 60; i++) {
    const a = rnd() * 6.283, k = 1.04 + rnd() * 0.16;
    const x = POND.x + Math.cos(a + POND.rot) * POND.rx * k * 1.0, z = POND.z + Math.sin(a + POND.rot) * POND.rz * k * 1.0;
    if (pondD(x, z) < 1.0 || onPath(x, z)) continue;
    if (rnd() < 0.13) {
      const sc = 0.12 + rnd() * 0.18;
      s.add(rock, place(x, GROUND_Y + sc * 0.3, z, rnd() * 3, rnd() * 3, rnd() * 3, sc * 1.3, sc * 0.8, sc), pick(rnd, rockCols), FLAG.NORMAL, true);
      continue;
    }
    if (Math.sin(a * 2.0 + 1.3) < 0.1) continue; // leave gaps in the reed beds
    for (let b = 0; b < 3; b++) {
      const bx = x + (rnd() - 0.5) * 0.3, bz = z + (rnd() - 0.5) * 0.3, h = 0.8 + rnd() * 0.7, lean = (rnd() - 0.5) * 0.25;
      const sway = motion.sway(bx, bz, GROUND_Y, 0.9);
      d.add(reed, place(bx, GROUND_Y - 0.02, bz, lean, 0, -lean, 1, h, 1), pick(rnd, [lin(0x5ba84a), lin(0x74be55), lin(0x4c9a52)]), FLAG.DECOR, true, sway);
      if (b === 0 && rnd() < 0.5) d.add(cattail, place(bx + lean * h * 0.9, GROUND_Y - 0.02 + h * 0.96, bz - lean * h * 0.9, lean, 0, -lean), lin(0x7a4a2a), FLAG.DECOR, true, sway);
    }
  }
}
