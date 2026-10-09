import * as THREE from 'three';
import { sceneBuilder } from '../shared/baked';
import { DEFAULT_PALETTE_SIZE, FLAG, FluidCollector, GeometryCollector, linearColor as lin, place, quantizePalette, type PixelObject, type PixelRenderer } from '../../renderer';
import type { BuiltScene, SceneDefinition, SceneGame } from '../types';

// Per-object looks (PixelObject.tint, tintStrength, opacity, castShadow), as a build game uses them: a field of soil
// tiles, one geometry, each tinted by its fertility; a row of workshops, one plain, one selected and one unpowered; a
// build preview that fits (green) and one that doesn't (red), drawn see-through; and a belt carrying crates that cast
// no sun shadow, so moving them never redraws the object shadow map. Clicking through a preview picks what is behind it.

const GROUND = { hx: 8, hz: 6 };
const BOX = new THREE.BoxGeometry(1, 1, 1);
type C = GeometryCollector;

/** Box with its base centred at (x, y, z). */
const box = (c: C, x: number, y: number, z: number, w: number, h: number, d: number, hex: number, flag: number = FLAG.NORMAL) =>
  c.add(BOX, place(x, y + h / 2, z, 0, 0, 0, w, h, d), lin(hex), flag);

/** A small workshop, facing +z, origin at the middle of its base. */
function workshop() {
  const c = new GeometryCollector();
  box(c, 0, 0, 0, 1.6, 0.9, 1.2, 0xc8b89a);
  box(c, 0, 0.9, 0, 1.8, 0.14, 1.4, 0x7a4a3a);
  box(c, 0.45, 1.04, -0.2, 0.22, 0.45, 0.22, 0x6e625c);
  box(c, -0.3, 0, 0.601, 0.36, 0.55, 0.02, 0x5a3a2a);
  box(c, 0.35, 0.35, 0.601, 0.34, 0.26, 0.02, 0x9ab8c8);
  return c.build();
}

/** One soil tile, 0.9 m square, origin at the middle of its base. */
function tile() {
  const c = new GeometryCollector();
  box(c, 0, 0, 0, 0.9, 0.06, 0.9, 0x6a4a32);
  return c.build();
}

function crate() {
  const c = new GeometryCollector();
  box(c, 0, 0, 0, 0.24, 0.2, 0.24, 0xc89b5a);
  box(c, 0, 0.17, 0, 0.25, 0.03, 0.25, 0x7a4a2a);
  return c.build();
}

const FIELD = { x0: -6.3, z0: -4.2, cols: 6, rows: 5, step: 0.95 };
const BELT = { x0: -1.5, x1: 6.5, z: 3.6, y: 0.18, items: 24, speed: 0.6 };

async function build(paletteSize = objectLooksScene.paletteSize ?? DEFAULT_PALETTE_SIZE): Promise<BuiltScene> {
  const s = new GeometryCollector(false), d = new GeometryCollector(true);
  const ground = new THREE.PlaneGeometry(1, 1), shades = [lin(0x9aa07e), lin(0xa2a886)];
  for (let x = -GROUND.hx; x < GROUND.hx; x++) for (let z = -GROUND.hz; z < GROUND.hz; z++) {
    s.add(ground, place(x + 0.5, 0, z + 0.5, -Math.PI / 2), shades[(x + z + 100) % 2]);
  }
  // The belt: a dark strip on legs, with rollers at both ends.
  const len = BELT.x1 - BELT.x0, mid = (BELT.x0 + BELT.x1) / 2;
  box(s, mid, BELT.y - 0.06, BELT.z, len + 0.3, 0.06, 0.5, 0x3a3634);
  for (const z of [BELT.z - 0.28, BELT.z + 0.28]) box(s, mid, BELT.y - 0.1, z, len + 0.3, 0.14, 0.06, 0x6a625c);
  for (let x = BELT.x0; x <= BELT.x1 + 1e-6; x += 2) for (const z of [BELT.z - 0.28, BELT.z + 0.28]) box(s, x, 0, z, 0.08, BELT.y - 0.1, 0.08, 0x4a4440);

  const geos = { workshop: workshop(), tile: tile(), crate: crate() };
  const staticGeometry = s.build(), dynamicGeometry = d.build();
  const paletteColors = quantizePalette([staticGeometry, dynamicGeometry, ...Object.values(geos)], paletteSize);
  const triangles = (staticGeometry.attributes.position.count + dynamicGeometry.attributes.position.count) / 3;
  return {
    staticGeometry, dynamicGeometry, lamps: [], fluids: new FluidCollector(objectLooksScene.limits).build(), grooves: null,
    shadow: { center: new THREE.Vector3(0, 0, 0), radius: 11 },
    stats: { triangles, paletteColors },
    objectGeometries: geos,
    populate: populateObjects(geos),
  };
}

function populateObjects(geos: Record<string, THREE.BufferGeometry>) {
  return (r: PixelRenderer): SceneGame => {
    const at = (geo: string, x: number, z: number, yaw = 0) =>
      r.addObject(geos[geo]).setTransform(new THREE.Vector3(x, 0, z), new THREE.Euler(0, yaw, 0));
    // Soil fertility, a smooth made-up field: barren tiles go pale, fertile ones green.
    const barren = new THREE.Color(0xc8b48a), fertile = new THREE.Color(0x4f8a2a);
    for (let i = 0; i < FIELD.cols; i++) for (let j = 0; j < FIELD.rows; j++) {
      const f = 0.5 + 0.5 * Math.sin(i * 0.9 + 0.4) * Math.cos(j * 0.8 - 0.3);
      const o = at('tile', FIELD.x0 + i * FIELD.step, FIELD.z0 + j * FIELD.step);
      o.tint = f > 0.5 ? fertile.clone() : barren.clone();
      o.tintStrength = Math.min(1, Math.abs(f - 0.5) * 1.6);
    }
    // Workshops: plain, selected (lifted towards a warm white) and unpowered (pulled towards grey).
    at('workshop', 0.2, -3.6);
    const selected = at('workshop', 2.6, -3.6);
    selected.tint = new THREE.Color(0xfff0b0); selected.tintStrength = 0.45;
    const unpowered = at('workshop', 5.0, -3.6);
    unpowered.tint = new THREE.Color(0x7a7a7a); unpowered.tintStrength = 0.7;
    // Build previews: one that fits, on open ground, and one that doesn't, overlapping a workshop.
    const ghost = (x: number, z: number, hex: number) => {
      const o = at('workshop', x, z, 0.0);
      o.opacity = 0.5; o.tint = new THREE.Color(hex); o.tintStrength = 0.6;
      return o;
    };
    ghost(1.4, 0.2, 0x40e060);
    ghost(5.5, -2.9, 0xf04030);
    // Crates on the belt: many small moving objects that cast no sun shadow (they still receive one).
    const crates: PixelObject[] = Array.from({ length: BELT.items }, () => {
      const o = r.addObject(geos.crate); o.castShadow = false; return o;
    });
    const update = (t: number) => {
      const len = BELT.x1 - BELT.x0;
      crates.forEach((o, i) => {
        const u = (i / BELT.items + t * BELT.speed / len) % 1;
        o.position.set(BELT.x0 + u * len, BELT.y, BELT.z);
      });
    };
    return { update };
  };
}

export const objectLooksScene: SceneDefinition = {
  id: 'object-looks',
  title: 'Object tint and opacity',
  hasReference: false,
  build: sceneBuilder(() => objectLooksScene, build, (scene) => ({
    ...scene, populate: populateObjects(scene.objectGeometries!),
  })),
  hour: 12,
  view: {
    target: { x: 0, z: 0, height: 0.4 },
    groundY: 0,
    pan: { minX: -GROUND.hx, maxX: GROUND.hx, minZ: -GROUND.hz, maxZ: GROUND.hz },
    azimuth: 30,
    presets: [
      { name: 'Yard', size: 12, el: 40, tx: 0, tz: 0 },
      { name: 'Workshops', size: 5.5, el: 35, tx: 3.0, tz: -2.6 },
      { name: 'Field', size: 6, el: 50, tx: -4, tz: -2.3 },
    ],
  },
};
