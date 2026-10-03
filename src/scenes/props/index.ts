import * as THREE from 'three';
import { DEFAULT_PALETTE_SIZE, FluidCollector, collectGltf, collectLamps, GeometryCollector, LIMITS, linearColor as lin, loadGltf, namedMeshRule, place, quantizePalette, type Lamp, type PixelScene } from '../../renderer';
import type { SceneDefinition, SceneView } from '../types';

// Props gallery: every modeled prop in assets/props/<id>/ (built per docs/ASSET_BRIEF.md, exported to
// public/props/<id>.glb), laid out in rows on a 1 m checker. Props are found from their metadata.json files at
// build time, so a new prop shows up after a page reload. Each prop gets a camera preset (`?view=<id>`).

interface PropMeta { id: string; dimensionsMetres: [number, number, number] }

const META = Object.values(import.meta.glob<PropMeta>('/assets/props/*/metadata.json', { eager: true, import: 'default' }))
  .sort((a, b) => a.id.localeCompare(b.id));

const GAP = 1.2, ROW_WIDTH = 16;

/** Slot centres: props left to right in rows, wrapping at ROW_WIDTH. Blender x is width, Blender y becomes depth. */
function layout() {
  const slots: { meta: PropMeta; x: number; z: number }[] = [];
  let x = 0, z = 0, rowDepth = 0;
  for (const meta of META) {
    const [w, d] = meta.dimensionsMetres;
    if (x > 0 && x + w > ROW_WIDTH) { z += rowDepth + GAP; x = 0; rowDepth = 0; }
    slots.push({ meta, x: x + w / 2, z: z + d / 2 });
    x += w + GAP; rowDepth = Math.max(rowDepth, d);
  }
  const width = Math.max(...slots.map((s) => s.x + s.meta.dimensionsMetres[0] / 2), 1), depth = z + rowDepth;
  // Centre the whole layout on the origin.
  for (const s of slots) { s.x -= width / 2; s.z -= depth / 2; }
  return { slots, hx: width / 2 + 2, hz: depth / 2 + 2 };
}
const LAYOUT = layout();

async function build(paletteSize = DEFAULT_PALETTE_SIZE): Promise<PixelScene> {
  const s = new GeometryCollector(false), d = new GeometryCollector(true), f = new FluidCollector();
  const tile = new THREE.PlaneGeometry(1, 1), tiles = [lin(0x9c9a8e), lin(0xa5a397)];
  const gx = Math.ceil(LAYOUT.hx), gz = Math.ceil(LAYOUT.hz);
  for (let x = -gx; x < gx; x++) for (let z = -gz; z < gz; z++) s.add(tile, place(x + 0.5, 0, z + 0.5, -Math.PI / 2), tiles[(x + z + 1000) % 2]);

  let lamps: Lamp[] = [];
  const roots = await Promise.all(LAYOUT.slots.map((slot) => loadGltf(`/props/${slot.meta.id}.glb`)));
  LAYOUT.slots.forEach((slot, i) => {
    const root = roots[i];
    root.position.set(slot.x, 0, slot.z);
    root.updateMatrixWorld(true);
    collectGltf(root, s, d, namedMeshRule, f);
    lamps.push(...collectLamps(root));
  });
  if (lamps.length > LIMITS.lamps) {
    console.warn(`props gallery: ${lamps.length} lamps, the renderer supports ${LIMITS.lamps}; the rest are dropped`);
    lamps = lamps.slice(0, LIMITS.lamps);
  }

  const staticGeometry = s.build(), dynamicGeometry = d.build();
  const paletteColors = quantizePalette([staticGeometry, dynamicGeometry], paletteSize);
  const triangles = (staticGeometry.attributes.position.count + dynamicGeometry.attributes.position.count) / 3;
  return {
    staticGeometry, dynamicGeometry, lamps, fluids: f.build(), grooves: null,
    shadow: { center: new THREE.Vector3(0, 0, 0), radius: Math.max(LAYOUT.hx, LAYOUT.hz) + 2 },
    stats: { triangles, paletteColors },
  };
}

const view: SceneView = {
  target: { x: 0, z: 0, height: 0.8 },
  groundY: 0,
  pan: { minX: -LAYOUT.hx, maxX: LAYOUT.hx, minZ: -LAYOUT.hz, maxZ: LAYOUT.hz },
  azimuth: 38,
  presets: [
    { name: 'Overview', size: Math.min(30, Math.max(10, LAYOUT.hz * 2.2, LAYOUT.hx * 1.3)), el: 40, tx: 0, tz: 0 },
    // One per prop, at Cookie Co.'s default pixel scale (~0.04 m per art pixel): how big the prop really reads in a game view.
    ...LAYOUT.slots.map(({ meta, x, z }) => ({ name: meta.id, size: 11.5, el: 38, tx: x, tz: z })),
  ],
};

export const propsGallery: SceneDefinition = { id: 'props', title: 'Props gallery', hasReference: false, build, view };
