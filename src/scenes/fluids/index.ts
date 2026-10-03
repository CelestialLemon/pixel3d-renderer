import * as THREE from 'three';
import {
  DEFAULT_PALETTE_SIZE, FLAG, FluidCollector, FLUIDS, GeometryCollector, linearColor as lin, place, quantizePalette,
  type FluidMaterial, type Lamp, type PixelScene,
} from '../../renderer';
import type { SceneDefinition } from '../types';

// Fluids: one raised pool per FLUIDS preset, in two rows of three on a 1 m checker, to see how each looks and moves side by side.
// Behind every pool stand a striped mast, a glowing panel and a lamp, to judge its reflections; on its bed lie a ball
// and a block, to judge how far you can see into it. The flowing pools have posts standing in them, so their wakes
// show. The clear pool is fed by a spout pouring a sheet of water into it. Built in code, so it is exact.

/** The pools, left to right: what each shows. */
export const POOLS: { name: string; material: FluidMaterial; flow: [number, number] }[] = [
  { name: 'Water', material: FLUIDS.water, flow: [0, 0] },     // clear and still, with a small fall
  { name: 'Canal', material: FLUIDS.canal, flow: [1.4, 0] },   // fast: foam and wakes round the posts, broken reflections
  { name: 'Pond', material: FLUIDS.pond, flow: [0, 0] },       // a dark mirror
  { name: 'Swamp', material: FLUIDS.swamp, flow: [0, 0.15] },  // dull and murky
  { name: 'Acid', material: FLUIDS.acid, flow: [0, 0] },       // glowing, bubbling at a source
  { name: 'Lava', material: FLUIDS.lava, flow: [0.3, 0] },     // self-lit, crusting
];
const POOL = { w: 3.6, d: 3, pitch: 4.8, row: 5.6, rim: 0.5, level: 0.38, wall: 0.18 };
/** Centre of pool i: the first three along the back row, the rest along the front. */
const poolAt = (i: number): [number, number] => [((i % 3) - 1) * POOL.pitch, (Math.floor(i / 3) - 0.5) * POOL.row];
const GROUND = { hx: 10, hz: 8 };

const BOX = new THREE.BoxGeometry(1, 1, 1);
const box = (s: GeometryCollector, x: number, y: number, z: number, w: number, h: number, d: number, hex: number, flag: number = FLAG.NORMAL) =>
  s.add(BOX, place(x, y + h / 2, z, 0, 0, 0, w, h, d), lin(hex), flag);

async function build(paletteSize = DEFAULT_PALETTE_SIZE): Promise<PixelScene> {
  const s = new GeometryCollector(false), d = new GeometryCollector(true), f = new FluidCollector();
  const tile = new THREE.PlaneGeometry(1, 1), tiles = [lin(0x9c9a8e), lin(0xa5a397)];
  for (let x = -GROUND.hx; x < GROUND.hx; x++) for (let z = -GROUND.hz; z < GROUND.hz; z++) {
    s.add(tile, place(x + 0.5, 0, z + 0.5, -Math.PI / 2), tiles[(x + z + 100) % 2]);
  }
  const stone = 0x8a8478, bed = 0xc8b48a, { w, d: depth, rim, level, wall: t } = POOL, lamps: Lamp[] = [];
  POOLS.forEach(({ material, flow }, i) => {
    const [x, z] = poolAt(i), back = z - depth / 2;
    // Rim walls and a light bed.
    box(s, x, 0, back - t / 2, w + 2 * t, rim, t, stone);
    box(s, x, 0, z + depth / 2 + t / 2, w + 2 * t, rim, t, stone);
    for (const sx of [-1, 1]) box(s, x + sx * (w / 2 + t / 2), 0, z, t, rim, depth, stone);
    box(s, x, 0, z, w, 0.02, depth, bed);
    // Behind it: a striped mast, a glowing panel and a lamp on a post, all to be mirrored.
    for (let k = 0; k < 6; k++) box(s, x - 1.1, k * 0.4, back - 0.6, 0.25, 0.4, 0.25, k % 2 ? 0xf2efe6 : 0xc0392b);
    box(s, x + 0.4, 0.6, back - 0.5, 1.0, 0.7, 0.08, 0xffd27a, FLAG.EMISSIVE);
    box(s, x + 1.4, 0, back - 0.6, 0.08, 1.6, 0.08, 0x2b2724);
    box(s, x + 1.4, 1.6, back - 0.6, 0.22, 0.24, 0.22, 0xffcf80, FLAG.EMISSIVE);
    lamps.push({ position: new THREE.Vector3(x + 1.4, 1.72, back - 0.6), color: [1, 0.62, 0.22], radius: 3.2 });
    // On the bed: a ball near the front and a block further back.
    s.add(new THREE.SphereGeometry(0.22, 16, 8), place(x - 0.6, 0.24, z + 0.6), lin(0xe0782c), FLAG.NORMAL, true);
    box(s, x + 0.8, 0.02, z - 0.3, 0.5, 0.2, 0.5, 0x5b8fd0);
    // Posts standing in a moving pool: obstacles for its flow.
    if (flow[0] || flow[1]) for (const [dx, dz] of [[-0.3, -0.5], [0.6, 0.6]]) box(s, x + dx, 0, z + dz, 0.22, level + 0.3, 0.22, 0x6f5a40);
    f.add(new THREE.PlaneGeometry(w, depth).rotateX(-Math.PI / 2).translate(x, level, z), null, material, flow);
    if (material === FLUIDS.water) {
      // A spout on the back rim pouring a sheet of water into the pool.
      box(s, x + 1.2, rim, back - 0.2, 0.5, 0.25, 0.5, stone);
      f.add(new THREE.PlaneGeometry(0.34, rim + 0.2 - level).translate(x + 1.2, (rim + 0.2 + level) / 2, back + 0.07), null, material);
    }
    if (material === FLUIDS.acid) f.source(x + 0.4, z + 0.3, { radius: 0.5, strength: 0.8 });
  });

  const staticGeometry = s.build(), dynamicGeometry = d.build();
  const paletteColors = quantizePalette([staticGeometry, dynamicGeometry], paletteSize);
  const triangles = (staticGeometry.attributes.position.count + dynamicGeometry.attributes.position.count) / 3;
  return {
    staticGeometry, dynamicGeometry, lamps, fluids: f.build(), grooves: null,
    shadow: { center: new THREE.Vector3(0, 0, 0), radius: GROUND.hx + 1 },
    stats: { triangles, paletteColors },
  };
}

export const fluidsScene: SceneDefinition = {
  id: 'fluids',
  title: 'Fluids',
  hasReference: false,
  build,
  view: {
    target: { x: 0, z: 0, height: 0.4 },
    groundY: 0,
    pan: { minX: -GROUND.hx, maxX: GROUND.hx, minZ: -GROUND.hz, maxZ: GROUND.hz },
    azimuth: 30,
    presets: [
      { name: 'Overview', size: 13, el: 38, tx: 0, tz: 0 },
      ...POOLS.map(({ name }, i) => ({ name, size: 6, el: 38, tx: poolAt(i)[0], tz: poolAt(i)[1] })),
    ],
  },
};
