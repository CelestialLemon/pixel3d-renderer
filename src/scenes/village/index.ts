import * as THREE from 'three';
import { DEFAULT_PALETTE_SIZE, FluidCollector, GeometryCollector, MODE, quantizePalette, resolveLimits, type PixelScene } from '../../renderer';
import { mulberry32 } from '../shared/random';
import type { SceneDefinition } from '../types';
import { buildGround, CANAL_FLOW } from './ground';
import { BRIDGE, CANAL, CANAL_RIPPLES, FOUNTAIN, POND, STAIRS, STATUE, SUN_SHADOW } from './layout';
import { buildLife } from './life';
import { placeModels } from './models';
import { buildTrees } from './trees';

// Lantern Row: a night canal town. A canal with quays, two bridges, boats and a mill runs through the middle; the market
// square, town hall and chapel stand on the north bank, with an upper level holding the watch tower and old ruins; cottages,
// gardens, a smithy, a barn and an orchard fill the south bank. The buildings are modelled in Blender (assets/village/, built
// to the footprints in layout.ts); everything that depends on the layout (paving, quays, walls, stairs, water, plants) is built here.

async function build(paletteSize = village.paletteSize ?? DEFAULT_PALETTE_SIZE): Promise<PixelScene> {
  // One generator for the whole build, consumed in a fixed order: the scene is reproducible.
  const rnd = mulberry32(23);
  const limits = resolveLimits(village.limits);
  const s = new GeometryCollector(false), d = new GeometryCollector(true), f = new FluidCollector(limits);
  // The models first (into their own collectors), to learn which way the mill wheel turns: the canal runs with it.
  const ms = new GeometryCollector(false), md = new GeometryCollector(true);
  const placed = await placeModels(ms, md, f);
  const modelDyn = md.build(), wheel = millWheel(modelDyn);
  buildGround(s, f, rnd, wheel ? wheel.flowSign * CANAL_FLOW : CANAL_FLOW);
  buildTrees(s, rnd);
  s.pushPrepared(ms.build()); d.pushPrepared(modelDyn);
  buildLife(d, rnd, placed.chimneys);
  // Drips and rising fish on the canal, the basin and the pond, and the churn at the foot of the mill wheel.
  for (const [x, z] of CANAL_RIPPLES) {
    const y = Math.hypot(x - POND.x, z - POND.z) < POND.r ? POND.waterY : CANAL.waterY;
    f.source(x, z, { y, radius: 0.5, strength: 0.35 });
  }
  if (wheel) f.source(wheel.x, wheel.z, { y: CANAL.waterY, radius: 1.8, strength: 1, rings: false });
  let lamps = placed.lamps;
  if (lamps.length > limits.lamps) {
    console.warn(`village: ${lamps.length} lamps, the renderer supports ${limits.lamps}; the rest are dropped`);
    lamps = lamps.slice(0, limits.lamps);
  }

  const staticGeometry = s.build(), dynamicGeometry = d.build();
  const paletteColors = quantizePalette([staticGeometry, dynamicGeometry], paletteSize);
  const triangles = (staticGeometry.attributes.position.count + dynamicGeometry.attributes.position.count) / 3;
  return {
    staticGeometry, dynamicGeometry, lamps, fluids: f.build(), grooves: null,
    shadow: { center: new THREE.Vector3(0, 0, 0), radius: SUN_SHADOW.radius },
    stats: { triangles, paletteColors },
  };
}

/**
 * The mill wheel (the spinning part anchored over the canal): where it dips into the water, and which way along x its
 * bottom paddles move (+1 or -1), so the current can push it.
 */
function millWheel(g: THREE.BufferGeometry): { x: number; z: number; flowSign: number } | null {
  const mode = g.attributes.aMode.array, anchor = g.attributes.aAnchor.array, anim = g.attributes.aAnim.array;
  for (let i = 0; i < mode.length; i++) {
    if (Math.round(mode[i]) !== MODE.SPIN) continue;
    const x = anchor[i * 3], z = anchor[i * 3 + 2];
    if (z < CANAL.z0 - 1 || z > CANAL.z1 + 1) continue;
    // The lowest point moves at speed x (axis cross down), whose x part is speed x axis.z.
    const vx = anim[i * 4 + 3] * anim[i * 4 + 2];
    return { x, z, flowSign: vx >= 0 ? 1 : -1 };
  }
  return null;
}

export const village: SceneDefinition = {
  id: 'village',
  title: 'Lantern Row',
  hasReference: false,
  hour: 22,
  build,
  view: {
    target: { x: BRIDGE.x + 2, z: BRIDGE.z - 2, height: 1.2 },
    groundY: 0,
    pan: { minX: -34, maxX: 34, minZ: -36, maxZ: 24 },
    azimuth: 30,
    presets: [
      { name: 'Street', size: 22, el: 34, tx: BRIDGE.x + 2, tz: BRIDGE.z - 2 },
      { name: 'Overview', size: 66, el: 42, tx: 0, tz: -6 },
      { name: 'Square', size: 14, el: 34, tx: STATUE.x + 1, tz: STATUE.z, az: -20 },
      { name: 'Fountain', size: 6, el: 36, tx: FOUNTAIN.x, tz: FOUNTAIN.z },
      { name: 'Stairs', size: 9, el: 30, tx: STAIRS.x, tz: -21, az: -30 },
      { name: 'Canal', size: 13, el: 38, tx: BRIDGE.x + 3, tz: BRIDGE.z },
      { name: 'Mill', size: 11, el: 50, tx: -26.5, tz: 4.5, az: 150 },
      { name: 'Ruins', size: 14, el: 36, tx: -13, tz: -29, az: -30 },
      { name: 'Gardens', size: 16, el: 36, tx: 6, tz: 16, az: 40 },
      { name: 'Windmill', size: 23, el: 26, tx: 27, tz: 29.5 },
      { name: 'Tavern', size: 11, el: 32, tx: 27, tz: -4, az: -35 },
    ],
  },
};
