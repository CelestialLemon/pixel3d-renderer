import * as THREE from 'three';
import { DEFAULT_PALETTE_SIZE, GeometryCollector, LIMITS, quantizePalette, type PixelScene } from '../../renderer';
import { mulberry32 } from '../shared/random';
import type { SceneDefinition } from '../types';
import { buildGround } from './ground';
import { BRIDGE, CANAL_RIPPLES, FOUNTAIN, STAIRS, STATUE, SUN_SHADOW } from './layout';
import { buildLife } from './life';
import { placeModels } from './models';
import { buildTrees } from './trees';

// Lantern Row: a night canal town. A canal with quays, two bridges, boats and a mill runs through the middle; the market
// square, town hall and chapel stand on the north bank, with an upper level holding the watch tower and old ruins; cottages,
// gardens, a smithy, a barn and an orchard fill the south bank. The buildings are modelled in Blender (assets/village/, built
// to the footprints in layout.ts); everything that depends on the layout (paving, quays, walls, stairs, water, plants) is built here.

async function build(paletteSize = DEFAULT_PALETTE_SIZE): Promise<PixelScene> {
  // One generator for the whole build, consumed in a fixed order: the scene is reproducible.
  const rnd = mulberry32(23);
  const s = new GeometryCollector(false), d = new GeometryCollector(true);
  buildGround(s, rnd);
  buildTrees(s, rnd);
  const placed = await placeModels(s, d);
  buildLife(d, rnd, placed.chimneys);
  let lamps = placed.lamps;
  if (lamps.length > LIMITS.lamps) {
    console.warn(`village: ${lamps.length} lamps, the renderer supports ${LIMITS.lamps}; the rest are dropped`);
    lamps = lamps.slice(0, LIMITS.lamps);
  }

  const staticGeometry = s.build(), dynamicGeometry = d.build();
  const paletteColors = quantizePalette([staticGeometry, dynamicGeometry], paletteSize);
  const triangles = (staticGeometry.attributes.position.count + dynamicGeometry.attributes.position.count) / 3;
  return {
    staticGeometry, dynamicGeometry, lamps, ripples: [[FOUNTAIN.x + 0.6, FOUNTAIN.z + 0.4], ...CANAL_RIPPLES], grooves: null,
    shadow: { center: new THREE.Vector3(0, 0, 0), radius: SUN_SHADOW.radius },
    stats: { triangles, paletteColors },
  };
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
