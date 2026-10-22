import * as THREE from 'three';
import { sceneBuilder } from '../shared/baked';
import {
  DEFAULT_PALETTE_SIZE, FLAG, FluidCollector, FLUIDS, GeometryCollector, linearColor as lin, place, quantizePalette,
  type FluidCells, type PixelFluid, type PixelRenderer,
} from '../../renderer';
import type { BuiltScene, SceneDefinition } from '../types';

// A floodplain: what a game does with runtime fluids (PixelRenderer.addFluid). A river runs along x below a flat floodplain
// at y = 0, with a terrace on its north bank, a hill to the south, a barn and fields on the plain and a levee (a bank of earth)
// across it. The river is baked: quiet upstream (x < 0), a fall at x = 0, and running below it. On top of it two layers
// the "game" drives, from the URL: `?flood=0..1` raises a flood over the plain (a layer of cells at y = 0 moved by `y`; the
// levee and the hill keep it out, the flood stops at the levee because the "game" leaves the cells beyond it out), and
// `?ice=0..1` freezes the quiet stretch from its banks inwards (a second layer of cells, grown a ring at a time). `?cycle=1`
// plays both as a loop: freeze, thaw, flood, drain.

const GROUND = { hx: 12, hz: 9 };
const RIVER = { z0: -4, z1: -1, upstream: -0.1, downstream: -0.65, depth: 0.35, fallX: 0 };
const TERRACE = { z1: -4, y: 0.9 };
const HILL = { z0: 5, y: 0.7 };
const LEVEE = { x: 4, w: 1, y: 0.8 };
const BOX = new THREE.BoxGeometry(1, 1, 1);
const box = (s: GeometryCollector, x: number, y: number, z: number, w: number, h: number, d: number, hex: number, flag: number = FLAG.NORMAL) =>
  s.add(BOX, place(x, y + h / 2, z, 0, 0, 0, w, h, d), lin(hex), flag);

async function build(paletteSize = floodplainScene.paletteSize ?? DEFAULT_PALETTE_SIZE): Promise<BuiltScene> {
  const s = new GeometryCollector(false), d = new GeometryCollector(true), f = new FluidCollector(floodplainScene.limits);
  const tile = new THREE.PlaneGeometry(1, 1), greens = [lin(0x6f9a4a), lin(0x78a24f)], soil = [lin(0x8b6a4a), lin(0x94734f)];
  const { z0: rz0, z1: rz1 } = RIVER;
  for (let x = -GROUND.hx; x < GROUND.hx; x++) for (let z = -GROUND.hz; z < GROUND.hz; z++) {
    if (z >= rz0 && z < rz1) continue;   // the channel
    const y = z < TERRACE.z1 ? TERRACE.y : z >= HILL.z0 ? HILL.y : 0, field = y === 0 && x >= -10 && x < -6 && z >= 0 && z < 4;
    s.add(tile, place(x + 0.5, y, z + 0.5, -Math.PI / 2), (field ? soil : greens)[(x + z + 100) % 2]);
  }
  // Cliffs to the terrace and the hill, and the channel's banks and beds.
  box(s, 0, -0.1, rz0 - 0.1, 2 * GROUND.hx, TERRACE.y + 0.1, 0.2, 0x8a7a5a);
  box(s, 0, -0.1, HILL.z0 - 0.1, 2 * GROUND.hx, HILL.y + 0.1, 0.2, 0x8a7a5a);
  const bed = (x0: number, x1: number, top: number) => box(s, (x0 + x1) / 2, -1.2, (rz0 + rz1) / 2, x1 - x0, top + 1.2, rz1 - rz0, 0xb09a72);
  bed(-GROUND.hx, RIVER.fallX, RIVER.upstream - RIVER.depth);
  bed(RIVER.fallX, GROUND.hx, RIVER.downstream - RIVER.depth);
  for (const z of [rz0 + 0.05, rz1 - 0.05]) box(s, 0, -1.2, z, 2 * GROUND.hx, 1.2, 0.1, 0x7d6c4c);
  for (const sx of [-1, 1]) box(s, sx * (GROUND.hx - 0.05), -1.2, (rz0 + rz1) / 2, 0.1, 1.2, rz1 - rz0, 0x7d6c4c);
  box(s, RIVER.fallX - 0.04, -1.2, (rz0 + rz1) / 2, 0.08, RIVER.upstream - RIVER.depth + 1.2, rz1 - rz0, 0x9a8a68);   // the ledge
  // The river: quiet above the fall, running below it, and the sheet falling between.
  const mid = (rz0 + rz1) / 2, width = rz1 - rz0, plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  f.add(plane, place(-GROUND.hx / 2, RIVER.upstream, mid, 0, 0, 0, GROUND.hx, 1, width), FLUIDS.water, [0.35, 0]);
  f.add(plane, place(GROUND.hx / 2, RIVER.downstream, mid, 0, 0, 0, GROUND.hx, 1, width), FLUIDS.water, [1.4, 0]);
  f.add(new THREE.PlaneGeometry(width, RIVER.upstream - RIVER.downstream).rotateY(Math.PI / 2).translate(RIVER.fallX + 0.02, (RIVER.upstream + RIVER.downstream) / 2, mid), null, FLUIDS.water);
  // A levee across the plain, a barn, fields, fence posts, a haystack and trees.
  box(s, LEVEE.x + LEVEE.w / 2, 0, (rz1 + HILL.z0) / 2, LEVEE.w, LEVEE.y, HILL.z0 - rz1, 0x8b7a52);
  const bx = -3.5, bz = 2.2;
  box(s, bx, 0, bz, 3.2, 1.6, 2.4, 0xb5493a);
  for (const sz of [-1, 1]) s.add(BOX, place(bx, 1.95, bz + sz * 0.62, 0, 0, sz * 0.62, 3.4, 0.12, 1.5), lin(0x6b4a3a));
  box(s, bx, 0, bz + 1.2, 0.9, 1.1, 0.06, 0x5a3a2a);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) box(s, -9.7 + j * 0.5, 0.02, 0.6 + i * 0.9, 0.12, 0.35, 0.12, 0x4f8a2e);
  for (let i = 0; i < 6; i++) box(s, 1 + i * 0.5, 0, 4.6, 0.08, 0.7, 0.08, 0x6b5036);
  s.add(new THREE.SphereGeometry(0.55, 14, 8), place(1.6, 0.35, 0.2, 0, 0, 0, 1, 0.8, 1), lin(0xd6b45a), FLAG.NORMAL, true);
  const tree = (x: number, y: number, z: number, k: number) => {
    box(s, x, y, z, 0.3 * k, 1.1 * k, 0.3 * k, 0x6b4a32);
    s.add(new THREE.IcosahedronGeometry(0.9 * k, 1), place(x, y + 1.6 * k, z), lin(0x3f7a38), FLAG.NORMAL, true);
  };
  tree(8, 0, 2.5, 1); tree(-9, TERRACE.y, -6.5, 1.1); tree(5.5, 0, 6.5 + HILL.y, 1); tree(10.5, HILL.y, 6.8, 0.9);

  const staticGeometry = s.build(), dynamicGeometry = d.build();
  const paletteColors = quantizePalette([staticGeometry, dynamicGeometry], paletteSize);
  const triangles = (staticGeometry.attributes.position.count + dynamicGeometry.attributes.position.count) / 3;
  return {
    staticGeometry, dynamicGeometry, lamps: [], fluids: f.build(), grooves: null,
    shadow: { center: new THREE.Vector3(0, 0, 0), radius: GROUND.hx + 2 },
    stats: { triangles, paletteColors },
    populate: populate,
  };
}

/** The cells a flood could cover: the plain and the river, as far as the levee. Height 0: the layer's `y` is the water level. */
function floodCells(): FluidCells {
  const x = -GROUND.hx, z = RIVER.z0, cell = 1, cols = 2 * GROUND.hx, rows = HILL.z0 - RIVER.z0;
  const heights = new Float32Array(cols * rows).fill(Number.NaN);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (x + c < LEVEE.x + LEVEE.w) heights[r * cols + c] = 0;
  return { x, z, cell, cols, rows, heights };
}

/** The quiet stretch of river (above the fall, stopping 2 m short of it) frozen `reach` rings in from its banks (3 rings meet in the middle). */
function iceCells(reach: number): FluidCells {
  const cell = 0.5, x = -GROUND.hx, z = RIVER.z0, cols = Math.round((RIVER.fallX - 2 - x) / cell), rows = Math.round((RIVER.z1 - RIVER.z0) / cell);
  const heights = new Float32Array(cols * rows).fill(Number.NaN);
  for (let r = 0; r < rows; r++) if (Math.min(r, rows - 1 - r) < reach) for (let c = 0; c < cols; c++) heights[r * cols + c] = RIVER.upstream + 0.03;
  return { x, z, cell, cols, rows, heights };
}

/** The game's part: a flood and an ice layer, driven by the URL (or by the clock with `?cycle=1`). */
function populate(r: PixelRenderer) {
  const q = new URLSearchParams(location.search), num = (k: string) => Math.min(Math.max(Number(q.get(k) ?? 0) || 0, 0), 1), cycle = q.get('cycle') === '1';
  const flood: PixelFluid = r.addFluid(FLUIDS.flood).setCells(floodCells(), [0.3, 0]);
  const ice: PixelFluid = r.addFluid(FLUIDS.ice);
  let shown = -1;
  const tri = (t: number, a: number, b: number, c: number, e: number) => Math.min(Math.max((t - a) / (b - a), 0), 1) - Math.min(Math.max((t - c) / (e - c), 0), 1);
  return {
    update(t: number) {
      const loop = t % 48, level = cycle ? tri(loop, 24, 32, 38, 46) : num('flood'), freeze = cycle ? tri(loop, 2, 8, 14, 20) : num('ice');
      flood.y = -0.15 + 0.75 * level;
      flood.visible = flood.y > 0.02;
      const reach = Math.ceil(freeze * 3);   // rings of ice from the banks: the layer's surfaces change only when this does
      if (reach !== shown) { shown = reach; if (reach > 0) ice.setCells(iceCells(reach)); else ice.clear(); }
    },
  };
}

export const floodplainScene: SceneDefinition = {
  id: 'floodplain',
  title: 'Floodplain',
  hasReference: false,
  build: sceneBuilder(() => floodplainScene, build, (scene) => ({ ...scene, populate })),
  hour: 12,
  view: {
    target: { x: 0, z: 1, height: 0.4 },
    groundY: 0,
    pan: { minX: -GROUND.hx, maxX: GROUND.hx, minZ: -GROUND.hz, maxZ: GROUND.hz },
    azimuth: 38,
    presets: [
      { name: 'Plain', size: 15, el: 38, tx: 0, tz: 1 },
      { name: 'River', size: 8, el: 40, tx: -6, tz: -2.5 },
      { name: 'Barn', size: 8, el: 36, tx: -3, tz: 2 },
    ],
  },
};
