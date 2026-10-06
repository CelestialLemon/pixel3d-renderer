import * as THREE from 'three';
import { sceneBuilder } from '../shared/baked';
import { DEFAULT_PALETTE_SIZE, FluidCollector, GeometryCollector, linearColor as lin, place, quantizePalette, type BakedScene as PixelScene } from '../../renderer';
import type { SceneDefinition } from '../types';
import { aoBay, curvesBay, inkBay, lampsBay, paletteBay, thinBay } from './bays';
import { kerb } from './kit';

// Test chart: a calibration ground for the renderer. Six bays, each aimed at one risk, on a 1 m checker
// (one tile is ~25 art pixels at the default zoom). Built entirely in code, so it is exact and deterministic.
// Each bay has a camera preset (`?view=<name>`), which tools/golden.ts uses for its chart shots.

/** Bay centres (x, z). Bays span ±3.5 around these. */
export const BAYS = {
  thin: [-8, -4.5], curves: [0, -4.5], ink: [8, -4.5],
  ao: [-8, 4.5], palette: [0, 4.5], lamps: [8, 4.5],
} as const;
const HALF = 3.5, GROUND = { hx: 13, hz: 9.5 };

async function build(paletteSize = testChart.paletteSize ?? DEFAULT_PALETTE_SIZE): Promise<PixelScene> {
  const s = new GeometryCollector(false), d = new GeometryCollector(true);
  // Checker ground: two close neutrals, so the tiles read as scale without stealing attention.
  const tile = new THREE.PlaneGeometry(1, 1), tiles = [lin(0x9c9a8e), lin(0xa5a397)];
  for (let x = -GROUND.hx; x < GROUND.hx; x++) for (let z = -GROUND.hz; z < GROUND.hz; z++) {
    s.add(tile, place(x + 0.5, 0, z + 0.5, -Math.PI / 2), tiles[(x + Math.floor(z) + 100) % 2]);
  }
  for (const [cx, cz] of Object.values(BAYS)) kerb(s, cx, cz, HALF, HALF, 0x6f6a60);
  thinBay(s, ...BAYS.thin);
  curvesBay(s, ...BAYS.curves);
  inkBay(s, ...BAYS.ink);
  aoBay(s, ...BAYS.ao);
  paletteBay(s, ...BAYS.palette);
  const lamps = lampsBay(s, ...BAYS.lamps);

  const staticGeometry = s.build(), dynamicGeometry = d.build();
  const paletteColors = quantizePalette([staticGeometry, dynamicGeometry], paletteSize);
  const triangles = (staticGeometry.attributes.position.count + dynamicGeometry.attributes.position.count) / 3;
  return {
    staticGeometry, dynamicGeometry, lamps, fluids: new FluidCollector(testChart.limits).build(), grooves: null,
    shadow: { center: new THREE.Vector3(0, 0, 0), radius: 16 },
    stats: { triangles, paletteColors },
  };
}

const bayPreset = (name: string, [tx, tz]: readonly [number, number]) => ({ name, size: 8, el: 38, tx, tz });

export const testChart: SceneDefinition = {
  id: 'test-chart',
  title: 'Test chart',
  hasReference: false,
  build: sceneBuilder(() => testChart, build),
  view: {
    target: { x: 0, z: 0, height: 0.6 },
    groundY: 0,
    pan: { minX: -GROUND.hx, maxX: GROUND.hx, minZ: -GROUND.hz, maxZ: GROUND.hz },
    azimuth: 38,
    presets: [
      { name: 'Overview', size: 22, el: 40, tx: 0, tz: 0 },
      bayPreset('Thin', BAYS.thin), bayPreset('Curves', BAYS.curves), bayPreset('Ink', BAYS.ink),
      bayPreset('AO', BAYS.ao), bayPreset('Palette', BAYS.palette), bayPreset('Lamps', BAYS.lamps),
    ],
  },
};
