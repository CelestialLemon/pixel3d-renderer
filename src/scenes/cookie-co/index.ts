import * as THREE from 'three';
import { DEFAULT_PALETTE_SIZE, GeometryCollector, loadGltf, quantizePalette, type PixelScene } from '../../renderer';
import { mulberry32 } from '../shared/random';
import type { SceneDefinition } from '../types';
import { addFactory } from './factory';
import { DOOR_GROOVES, GROUND_Y, LAMPS, LAWN_CX, RIPPLES } from './layout';
import { buildLife } from './life';
import { buildMeadow } from './meadow';
import { buildPond } from './pond';
import { buildTrees } from './trees';

// Cookie Co.: the cookie factory from Harvest Frenzy in a meadow with a pond, trees and wildlife.

async function build(paletteSize = DEFAULT_PALETTE_SIZE): Promise<PixelScene> {
  const root = await loadGltf('/cookie_factory_current.glb');
  // One generator for the whole build, consumed in a fixed order: the scene is reproducible.
  const rnd = mulberry32(11);
  const s = new GeometryCollector(false), d = new GeometryCollector(true);
  addFactory(root, s, d);
  const flowerSpots = buildMeadow(s, d, rnd);
  buildTrees(s, rnd);
  buildPond(s, d, rnd);
  buildLife(d, rnd, flowerSpots);

  const staticGeometry = s.build(), dynamicGeometry = d.build();
  const paletteColors = quantizePalette([staticGeometry, dynamicGeometry], paletteSize);
  const triangles = (staticGeometry.attributes.position.count + dynamicGeometry.attributes.position.count) / 3;
  return {
    staticGeometry, dynamicGeometry,
    lamps: LAMPS, ripples: RIPPLES, grooves: DOOR_GROOVES,
    shadow: { center: new THREE.Vector3(LAWN_CX, 0, 0), radius: 24 },
    stats: { triangles, paletteColors },
  };
}

export const cookieCo: SceneDefinition = {
  id: 'cookie-co',
  title: 'Cookie Co.',
  hasReference: true,
  build,
  view: {
    target: { x: 0.8, z: 0.4, height: 1.3 },
    groundY: GROUND_Y,
    pan: { minX: -9, maxX: 10, minZ: -8, maxZ: 8 },
    azimuth: 38,
    presets: [{ name: 'Factory', size: 11.5, el: 38 }, { name: 'Landscape', size: 23, el: 32 }],
  },
};
