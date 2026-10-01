import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FLAG, linearColor as lin, place, type Lamp } from '../../renderer';
import { addInward, box, rod, wire, type C } from './kit';

// The six bays of the test chart. Each builder gets the bay centre (cx, cz); a bay spans ±3.5 around it.
// The camera's default azimuth looks from +x/+z, so "front" below means larger z.

/** Feature widths in world units for the thin-feature bay: from ~0.5 px to ~4 px at the default zoom (~0.04 units per pixel). */
export const THIN_WIDTHS = [0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.12, 0.16];

/** Thin features: poles, rails in two directions, a ladder, wires, a picket fence and window mullions. */
export function thinBay(s: C, cx: number, cz: number) {
  const dark = 0x2b2724, light = 0xf2efe6, wood = 0x7a4a2a;
  // Poles of every width: dark ones at the back, short light ones in front of them.
  THIN_WIDTHS.forEach((w, i) => {
    const x = cx - 3 + i * 0.42;
    box(s, x, 0, cz - 2.7, w, 2.2, w, dark);
    box(s, x, 0, cz - 2.1, w, 1.4, w, light);
  });
  // Rails along x between two posts, one per width, stacked.
  box(s, cx + 0.4, 0, cz - 2.4, 0.16, 2.2, 0.16, wood);
  box(s, cx + 3.2, 0, cz - 2.4, 0.16, 2.2, 0.16, wood);
  THIN_WIDTHS.forEach((w, i) => rod(s, [cx + 0.4, 0.3 + i * 0.24, cz - 2.4], [cx + 3.2, 0.3 + i * 0.24, cz - 2.4], w, wood));
  // The same rails along z, so they cross the screen at the other diagonal.
  box(s, cx - 3, 0, cz - 1.3, 0.16, 2.2, 0.16, wood);
  box(s, cx - 3, 0, cz + 1.1, 0.16, 2.2, 0.16, wood);
  THIN_WIDTHS.forEach((w, i) => rod(s, [cx - 3, 0.3 + i * 0.24, cz - 1.3], [cx - 3, 0.3 + i * 0.24, cz + 1.1], w, wood));
  // An upright ladder: 0.06 rails, 0.04 rungs.
  for (const dx of [-0.25, 0.25]) box(s, cx - 1.7 + dx, 0, cz - 0.1, 0.06, 2.4, 0.06, wood);
  for (let y = 0.3; y < 2.35; y += 0.3) rod(s, [cx - 1.95, y, cz - 0.1], [cx - 1.45, y, cz - 0.1], 0.04, wood);
  // Two poles with three sagging wires of different widths.
  for (const x of [cx - 0.6, cx + 3]) box(s, x, 0, cz - 0.1, 0.14, 2.7, 0.14, dark);
  [[0.02, 2.6], [0.035, 2.35], [0.05, 2.1]].forEach(([w, y]) => wire(s, [cx - 0.6, y, cz - 0.1], [cx + 3, y, cz - 0.1], 0.35, w, dark));
  // Picket fence: 0.08 slats on two 0.06 rails.
  for (let x = cx - 3; x <= cx + 0.6; x += 0.17) box(s, x, 0, cz + 2.4, 0.08, 0.9, 0.04, light);
  for (const y of [0.25, 0.7]) rod(s, [cx - 3.05, y, cz + 2.36], [cx + 0.65, y, cz + 2.36], 0.06, light);
  // Window frame on a low wall in front of a cream panel: 0.03 mullions on the left half, 0.06 on the right.
  const wx = cx + 2, wz = cz + 2.4, frame = 0x3b5f4a;
  box(s, wx, 0, wz - 0.35, 2.0, 2.1, 0.1, 0xe9dcc0);
  box(s, wx, 0, wz, 1.8, 0.3, 0.2, 0xb9a88a);
  const y0 = 0.3, y1 = 1.9, x0 = wx - 0.8, x1 = wx + 0.8;
  for (const x of [x0, x1]) rod(s, [x, y0, wz], [x, y1, wz], 0.1, frame);
  for (const y of [y0 + 0.05, y1]) rod(s, [x0, y, wz], [x1, y, wz], 0.1, frame);
  rod(s, [wx, y0, wz], [wx, y1, wz], 0.1, frame);
  for (const [side, w] of [[-1, 0.03], [1, 0.06]]) {
    const xa = side < 0 ? x0 : wx, xb = side < 0 ? wx : x1;
    for (const t of [1 / 3, 2 / 3]) rod(s, [xa + (xb - xa) * t, y0, wz], [xa + (xb - xa) * t, y1, wz], w, frame);
    for (const t of [1 / 3, 2 / 3]) rod(s, [xa, y0 + (y1 - y0) * t, wz], [xb, y0 + (y1 - y0) * t, wz], w, frame);
  }
}

/** Smooth curves for banding and dither, next to a faceted sphere for contrast, and a broad low mound. */
export function curvesBay(s: C, cx: number, cz: number) {
  const smooth = (g: THREE.BufferGeometry, m: THREE.Matrix4, hex: number) => s.add(g, m, lin(hex), FLAG.NORMAL);
  smooth(new THREE.SphereGeometry(0.7, 48, 24), place(cx - 2.4, 0.7, cz - 2.3), 0xe8e2d4);
  smooth(new THREE.SphereGeometry(0.7, 48, 24), place(cx - 0.8, 0.7, cz - 2.3), 0xe0782c);
  s.add(new THREE.IcosahedronGeometry(0.7, 1), place(cx + 0.8, 0.7, cz - 2.3), lin(0x5b8fd0), FLAG.NORMAL, true);
  smooth(new THREE.TorusGeometry(0.6, 0.22, 24, 48), place(cx + 2.5, 0.22, cz - 2.3, -Math.PI / 2), 0xc04a6a);
  smooth(new THREE.SphereGeometry(1.1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), place(cx - 2.2, 0, cz + 0.1), 0xd8c49a);
  smooth(new THREE.CylinderGeometry(0.45, 0.45, 1.6, 32), place(cx - 0.4, 0.8, cz - 0.3), 0x6a9a8a);
  smooth(new THREE.ConeGeometry(0.5, 1.4, 32), place(cx + 1.0, 0.7, cz - 0.5), 0xd0b040);
  smooth(new THREE.CapsuleGeometry(0.3, 1.2, 8, 24), place(cx - 1.6, 0.3, cz + 2.4, 0, 0, Math.PI / 2), 0x9a6ad0);
  // Mound: a cap 0.45 high cut from a sphere of radius 3, so its slope changes very slowly.
  const R = 3, cap = 0.45;
  smooth(new THREE.SphereGeometry(R, 64, 24, 0, Math.PI * 2, 0, Math.acos((R - cap) / R)), place(cx + 1.6, cap - R, cz + 1.8), 0x8fae6a);
}

/** Ink and creases: stairs, a concave open box, near-coplanar overlaps, sharp vs rounded edges, crossing boxes, a ziggurat. */
export function inkBay(s: C, cx: number, cz: number) {
  // Stairs climbing towards -x, so the risers face the camera.
  for (let i = 0; i < 8; i++) box(s, cx - 0.35 - i * 0.3, 0, cz - 2.2, 0.3, (i + 1) * 0.2, 1.2, 0xc9b79c);
  // Open box: floor, back and side walls, open at the top and the front.
  const bx = cx + 1.6, bz = cz - 2.2, wall = 0xa9b8c2;
  box(s, bx, 0, bz, 1.6, 0.1, 1.6, wall);
  box(s, bx, 0, bz - 0.75, 1.6, 1.6, 0.1, wall);
  box(s, bx - 0.75, 0, bz, 0.1, 1.6, 1.4, wall);
  box(s, bx + 0.75, 0, bz, 0.1, 1.6, 1.4, wall);
  // Sharp cube, rounded cube, three crossing boxes, ziggurat.
  box(s, cx - 2.2, 0, cz - 0.6, 0.8, 0.8, 0.8, 0xd08060);
  s.add(new RoundedBoxGeometry(0.8, 0.8, 0.8, 3, 0.12), place(cx - 1.0, 0.4, cz - 0.6), lin(0xd08060), FLAG.NORMAL);
  box(s, cx + 0.4, 0, cz - 0.6, 1.0, 0.4, 0.4, 0x7aa0c0);
  box(s, cx + 0.4, 0, cz - 0.6, 0.4, 1.0, 0.4, 0x7aa0c0);
  box(s, cx + 0.4, 0.1, cz - 0.6, 0.3, 0.3, 1.0, 0x7aa0c0, FLAG.NORMAL, Math.PI / 4);
  [1.2, 0.9, 0.6, 0.3].forEach((w, i) => box(s, cx + 2.3, i * 0.2, cz - 0.6, w, 0.2, w, 0xc8a870));
  // Overlapping slabs at growing depth gaps: different colours at the back row, the same colour at the front.
  const gaps = [0.01, 0.03, 0.06, 0.12, 0.25];
  for (const [z, back, front] of [[cz + 0.5, 0x5a7fa8, 0xe8dcc0], [cz + 2.2, 0xb07a50, 0xb07a50]]) {
    gaps.forEach((gap, i) => {
      const x = cx - 2.6 + i * 1.25;
      box(s, x, 0, z, 0.9, 1.2, 0.06, back);
      box(s, x + 0.35, 0, z + 0.06 + gap, 0.9, 0.9, 0.06, front);
    });
  }
}

/** Ambient occlusion and self-shadowing: an arch, a cantilever over a small cube, a tunnel, a pergola, a hollow pipe. */
export function aoBay(s: C, cx: number, cz: number) {
  // Arch: two pillars and a half ring of 14 voussoirs.
  const ax = cx - 1.9, az = cz - 2.1, stone = 0xb9a88a;
  for (const dx of [-1, 1]) box(s, ax + dx, 0, az, 0.4, 1.6, 0.6, stone);
  for (let i = 0; i < 14; i++) {
    const a = (i + 0.5) / 14 * Math.PI;
    s.add(new THREE.BoxGeometry(0.4, 0.25, 0.6), place(ax + Math.cos(a) * 1.0, 1.6 + Math.sin(a) * 1.0, az, 0, 0, a), lin(stone), FLAG.NORMAL);
  }
  // Cantilevered slab over a small cube.
  box(s, cx + 0.8, 0, cz - 2.4, 0.8, 2.2, 0.8, 0xc77b58);
  box(s, cx + 1.7, 2.2, cz - 2.2, 2.4, 0.12, 1.6, 0x6b5a4a);
  box(s, cx + 2.3, 0, cz - 2.0, 0.4, 0.4, 0.4, 0x8fb0c8);
  // Tunnel along x: two walls and a roof around a 0.8 x 1.2 passage.
  const tx = cx - 1.6, tz = cz + 1.3, rock = 0x9a8f80;
  for (const dz of [-0.6, 0.6]) box(s, tx, 0, tz + dz, 2.4, 1.2, 0.4, rock);
  box(s, tx, 1.2, tz, 2.4, 0.4, 1.6, rock);
  // Pergola: four posts, two beams, eight slats that stripe the ground with shadow.
  const px = cx + 1.7, pz = cz + 0.6, timber = 0x8a5a36;
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) box(s, px + dx * 0.95, 0, pz + dz * 0.95, 0.12, 2.0, 0.12, timber);
  for (const dz of [-0.95, 0.95]) box(s, px, 2.0, pz + dz, 2.2, 0.12, 0.12, timber);
  for (let i = 0; i < 8; i++) box(s, px - 0.875 + i * 0.25, 2.12, pz, 0.08, 0.1, 2.2, timber);
  // Hollow pipe lying along x.
  const pipe = new THREE.CylinderGeometry(0.45, 0.45, 1.6, 32, 1, true), m = place(cx + 1.7, 0.45, cz + 2.6, 0, 0, Math.PI / 2);
  s.add(pipe, m, lin(0x6f8c5a), FLAG.NORMAL);
  addInward(s, new THREE.CylinderGeometry(0.37, 0.37, 1.6, 32, 1, true), m, 0x6f8c5a);
  const rim = new THREE.RingGeometry(0.37, 0.45, 32);
  s.add(rim, place(cx + 2.5, 0.45, cz + 2.6, 0, Math.PI / 2, 0), lin(0x6f8c5a), FLAG.NORMAL);
  s.add(rim, place(cx + 0.9, 0.45, cz + 2.6, 0, -Math.PI / 2, 0), lin(0x6f8c5a), FLAG.NORMAL);
}

const HUES = Array.from({ length: 12 }, (_, i) => new THREE.Color().setHSL(i / 12, 0.85, 0.5).getHex());
// Pairs a few percent apart: can the palette and the ink keep them apart?
const NEAR_PAIRS = [[0xc0392b, 0xc8402c], [0x2e86c1, 0x2f8fc8], [0x27ae60, 0x2fb868], [0xf1c40f, 0xf5cc20], [0x8e44ad, 0x9548b5], [0xd35400, 0xdb5c08]];
const GREYS = [0xffffff, 0xf4f2ec, 0xdcdad4, 0xa8a8a8, 0x6e6e6e, 0x383838, 0x161616, 0x050505];
const PASTEL_DARK = [0xf8c8d0, 0xc8e0f8, 0xd0f0c8, 0xfff0b8, 0xe0d0f8, 0xf8dcc0, 0x1a2a5a, 0x1e4a2a, 0x5a1a22, 0x3a2a14, 0x2a1a4a, 0x0e3a3a];
const SKIN = [0xf6d5c0, 0xe8b996, 0xc68863, 0xa0663f, 0x6f4429, 0x3f2618];
const METALS = [0xd4a537, 0xb5a642, 0xb87333, 0xc0c0c8, 0x7f8a92, 0x3a3d40];

/** Palette stress: hue wheel, near-identical pairs, greys from white to black, pastels and darks, skin tones, metals. */
export function paletteBay(s: C, cx: number, cz: number) {
  const row = (z: number, cols: number[], spacing: number, shape: 'cube' | 'ball') => cols.forEach((hex, i) => {
    const x = cx + (i - (cols.length - 1) / 2) * spacing;
    if (shape === 'cube') box(s, x, 0, z, 0.42, 0.42, 0.42, hex);
    else s.add(new THREE.SphereGeometry(0.26, 32, 16), place(x, 0.26, z), lin(hex), FLAG.NORMAL);
  });
  row(cz - 2.8, HUES, 0.55, 'cube');
  NEAR_PAIRS.forEach(([a, b], i) => {
    const x = cx - 2.75 + i * 1.1;
    box(s, x, 0, cz - 1.7, 0.42, 0.42, 0.42, a);
    box(s, x + 0.43, 0, cz - 1.7, 0.42, 0.42, 0.42, b);
  });
  row(cz - 0.6, GREYS, 0.75, 'cube');
  row(cz + 0.5, PASTEL_DARK, 0.55, 'cube');
  row(cz + 1.6, SKIN, 0.9, 'ball');
  row(cz + 2.7, METALS, 0.9, 'ball');
}

/** Lamp colours (linear RGB) for the seven lamp posts. */
const LAMP_COLOURS: [number, number, number][] = [[1, 0.62, 0.22], [1, 0.15, 0.1], [0.2, 1, 0.3], [0.2, 0.4, 1], [1, 1, 1], [0.2, 0.9, 1], [1, 0.2, 0.9]];

/**
 * Terraces at small height steps (seams between flat planes), a closed room lit from inside and seen through a
 * window opening, and a row of lamp posts in different colours. Returns the lamps (eight: the renderer's limit).
 */
export function lampsBay(s: C, cx: number, cz: number): Lamp[] {
  [0.02, 0.05, 0.1, 0.2, 0.4, 0.8].forEach((h, i) => box(s, cx - 3.0 + i * 0.8, 0, cz - 1.7, 0.8, h, 2.2, 0xb6ad9a));
  // Room: 2.4 x 2.0 x 1.8 with a 1.4 x 0.8 window in the front wall and a glowing back wall.
  const rx = cx + 1.9, rz = cz - 1.7, W = 2.4, D = 2.0, H = 1.8, t = 0.12, plaster = 0xd8c8a8;
  box(s, rx, 0, rz - D / 2, W, H, t, plaster);
  for (const dx of [-1, 1]) box(s, rx + dx * (W / 2 - t / 2), 0, rz, t, H, D - 2 * t, plaster);
  box(s, rx, H, rz, W + 0.2, t, D + 0.2, 0x7a5a4a);
  const fz = rz + D / 2, win = 1.4, sill = 0.6, top = 1.4;
  box(s, rx, 0, fz, W, sill, t, plaster);
  box(s, rx, top, fz, W, H - top, t, plaster);
  for (const dx of [-1, 1]) box(s, rx + dx * (win / 2 + (W - win) / 4), sill, fz, (W - win) / 2, top - sill, t, plaster);
  box(s, rx, 0.3, rz - D / 2 + t / 2 + 0.02, W - 0.4, 1.2, 0.02, 0xffb860, FLAG.EMISSIVE);
  box(s, rx - 0.3, 0, rz - 0.2, 0.8, 0.5, 0.5, 0x8a5a36);
  const lamps: Lamp[] = [{ position: new THREE.Vector3(rx, 1.2, rz + 0.2), color: [1, 0.7, 0.3], radius: 2.2 }];
  // Lamp posts in front of the terraces.
  LAMP_COLOURS.forEach((color, i) => {
    const x = cx - 3.0 + i * 1.0, z = cz + 2.0;
    box(s, x, 0, z, 0.08, 1.6, 0.08, 0x2b2724);
    const glow = new THREE.Color(color[0], color[1], color[2]).getHex(THREE.SRGBColorSpace);
    box(s, x, 1.6, z, 0.22, 0.24, 0.22, glow, FLAG.EMISSIVE);
    lamps.push({ position: new THREE.Vector3(x, 1.72, z + 0.2), color, radius: 2.6 });
  });
  return lamps;
}
