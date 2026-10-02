import * as THREE from 'three';
import { DEFAULT_PALETTE_SIZE, GeometryCollector, LIMITS, quantizePalette, type PixelScene } from '../../renderer';
import { mulberry32 } from '../shared/random';
import type { SceneDefinition } from '../types';
import { buildGround } from './ground';
import { CANAL_RIPPLES, FOUNTAIN, STAIRS, SUN_SHADOW } from './layout';
import { buildLife } from './life';
import { placeModels } from './models';
import { buildTrees } from './trees';

// Lantern Row: a night village street on two levels, with a square, a fountain, a stair up to the upper lane and a
// canal on the camera side. The buildings are modelled in Blender (assets/village/, built to the
// footprints in layout.ts); everything that depends on the layout (paving, walls, stairs, canal, trees) is built here.

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
    target: { x: 0, z: 1, height: 1.2 },
    groundY: 0,
    pan: { minX: -16, maxX: 16, minZ: -12, maxZ: 12 },
    azimuth: 30,
    presets: [
      { name: 'Street', size: 17, el: 34, tx: 0, tz: 1 },
      { name: 'Overview', size: 40, el: 40, tx: 0, tz: -1 },
      { name: 'Square', size: 10, el: 34, tx: 2, tz: -2, az: -20 },
      { name: 'Stairs', size: 8, el: 30, tx: STAIRS.x, tz: -3 },
      { name: 'Canal', size: 9, el: 38, tx: 0, tz: 7.2 },
      { name: 'Tavern', size: 11, el: 32, tx: 9, tz: -1, az: -35 },
    ],
  },
};
