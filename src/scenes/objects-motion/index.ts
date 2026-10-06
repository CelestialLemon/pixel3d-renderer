import * as THREE from 'three';
import { sceneBuilder } from '../shared/baked';
import { mulberry32, type Rng } from '../shared/random';
import { DEFAULT_PALETTE_SIZE, FLAG, FluidCollector, GeometryCollector, linearColor as lin, motion, place, quantizePalette, type Lamp, type Motion, type PixelRenderer } from '../../renderer';
import type { BuiltScene, SceneDefinition, SceneGame } from '../types';

// Objects with ambient motion: game objects (PixelRenderer.addObject) whose geometry comes from a dynamic collector,
// so the renderer animates them from its clock like the baked dynamic mesh. Wheat sways beside baked grass in the same
// wind, machines smoke, windmills turn and signs swing. Copies are turned, stretched and mirrored, and one machine
// rides a turntable, to show the motion follows each object's transform while smoke still rises straight up.

const GROUND = { hx: 8, hz: 6 };
const BOX = new THREE.BoxGeometry(1, 1, 1);
type C = GeometryCollector;

/** Box with its base centred at (x, y, z), optionally rotated about z (radians) around that base. */
const box = (c: C, x: number, y: number, z: number, w: number, h: number, d: number, hex: number, flag: number = FLAG.NORMAL, mo?: Motion) =>
  c.add(BOX, place(x, y + h / 2, z, 0, 0, 0, w, h, d), lin(hex), flag, false, mo);

/** A clump of wheat, origin at its base. Each stalk sways about its own foot. */
function wheat(rnd: Rng) {
  const c = new GeometryCollector(true);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = 0.05 + 0.17 * Math.sqrt(i / 9), x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.5 + rnd() * 0.2;
    const sway = motion.sway(x, z, 0, h);
    box(c, x, 0, z, 0.035, h, 0.035, 0x9a9a3a, FLAG.NORMAL, sway);
    box(c, x, h - 0.02, z, 0.07, 0.17, 0.07, rnd() < 0.5 ? 0xe0b448 : 0xd4a23c, FLAG.NORMAL, sway);
  }
  return c.build();
}

/** A small engine house, facing +z, origin at the middle of its base. Its chimney smokes and its window glows. */
function machine(rnd: Rng) {
  const c = new GeometryCollector(true);
  box(c, 0, 0, 0, 1.2, 0.8, 0.9, 0x8a6a52);
  box(c, 0, 0.8, 0, 1.35, 0.12, 1.05, 0x5a4a44);
  box(c, 0.35, 0.92, -0.1, 0.2, 0.6, 0.2, 0x6e625c);
  box(c, -0.25, 0.3, 0.451, 0.34, 0.26, 0.02, 0xffb860, FLAG.EMISSIVE);
  const puff = new THREE.IcosahedronGeometry(0.32, 1);
  for (let i = 0; i < 6; i++) c.add(puff, null, lin(0xe8e4ee), FLAG.STEAM, false, motion.smoke([0.35, 1.55, -0.1], i / 6, rnd()));
  return c.build();
}

/** A windmill, sails on its +z face, origin at the middle of its base. */
function windmill() {
  const c = new GeometryCollector(true);
  c.add(new THREE.CylinderGeometry(0.34, 0.5, 2.4, 8), place(0, 1.2, 0), lin(0xd8cbb0), FLAG.NORMAL, true);
  c.add(new THREE.ConeGeometry(0.46, 0.55, 8), place(0, 2.67, 0), lin(0x7a4a3a), FLAG.NORMAL, true);
  box(c, 0, 0.0, 0.48, 0.3, 0.5, 0.04, 0x5a3a2a);   // door
  const hub: [number, number, number] = [0, 2.2, 0.5], spin = motion.spin(hub, [0, 0, 1], 0.9);
  box(c, 0, 2.1, 0.43, 0.18, 0.2, 0.18, 0x4a3a30, FLAG.NORMAL, spin);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, ux = -Math.sin(a), uy = Math.cos(a);
    // Each sail: a spar along its arm and a cloth panel trailing it, both turning about the hub.
    c.add(BOX, place(hub[0] + ux * 0.7, hub[1] + uy * 0.7, hub[2], 0, 0, a, 0.05, 1.3, 0.04), lin(0x5a3a2a), FLAG.NORMAL, false, spin);
    c.add(BOX, place(hub[0] + ux * 0.8 + uy * 0.12, hub[1] + uy * 0.8 - ux * 0.12, hub[2] + 0.02, 0, 0, a, 0.22, 1.0, 0.02), lin(0xeee6d4), FLAG.NORMAL, false, spin);
  }
  return c.build();
}

/** An inn sign on a post, origin at the foot of the post. The board swings from its arm. */
function sign() {
  const c = new GeometryCollector(true);
  box(c, 0, 0, 0, 0.1, 1.7, 0.1, 0x4a3426);
  box(c, 0.3, 1.55, 0, 0.7, 0.06, 0.06, 0x4a3426);
  const swing = motion.swing([0.42, 1.55, 0], [1, 0, 0], 0.3);
  box(c, 0.42, 1.12, 0, 0.46, 0.34, 0.04, 0x9a5a2e, FLAG.NORMAL, swing);
  box(c, 0.42, 1.2, 0.025, 0.2, 0.14, 0.01, 0xe8c050, FLAG.NORMAL, swing);
  for (const x of [0.25, 0.59]) box(c, x, 1.46, 0, 0.02, 0.1, 0.02, 0x2a2a2a, FLAG.NORMAL, swing);   // hooks
  return c.build();
}

const FIELD = { x0: -5.6, z0: -2.2, cols: 7, rows: 5, step: 0.62 };
const TURNTABLE = { x: 4.6, z: -2.4, speed: 0.35 };   // radians per second

async function build(paletteSize = objectsMotionScene.paletteSize ?? DEFAULT_PALETTE_SIZE): Promise<BuiltScene> {
  const rnd = mulberry32(23);
  const s = new GeometryCollector(false), d = new GeometryCollector(true);
  const tile = new THREE.PlaneGeometry(1, 1), grass = [lin(0x7a9a4a), lin(0x83a352)];
  for (let x = -GROUND.hx; x < GROUND.hx; x++) for (let z = -GROUND.hz; z < GROUND.hz; z++) {
    s.add(tile, place(x + 0.5, 0, z + 0.5, -Math.PI / 2), grass[(x + z + 100) % 2]);
  }
  // The wheat's soil bed, a path past the machines and the turntable's plinth.
  box(s, FIELD.x0 + (FIELD.cols - 1) * FIELD.step / 2, 0, FIELD.z0 + (FIELD.rows - 1) * FIELD.step / 2, FIELD.cols * FIELD.step + 0.3, 0.04, FIELD.rows * FIELD.step + 0.3, 0x6a4a32);
  box(s, 3.2, 0, -0.9, 5.5, 0.02, 0.9, 0xb8a888);
  s.add(new THREE.CylinderGeometry(1.0, 1.05, 0.1, 16), place(TURNTABLE.x, 0.05, TURNTABLE.z), lin(0x8a8478), FLAG.NORMAL, true);
  // Baked grass along the field's front edge, swaying in the same wind as the wheat objects.
  const blade = new THREE.ConeGeometry(0.03, 1, 3);
  for (let i = 0; i < 70; i++) {
    const x = FIELD.x0 - 0.3 + rnd() * (FIELD.cols * FIELD.step + 0.4), z = FIELD.z0 + FIELD.rows * FIELD.step + 0.05 + rnd() * 0.5, h = 0.25 + rnd() * 0.15;
    d.add(blade, place(x, h / 2, z, 0, 0, 0, 1, h, 1), lin(0x5f8a36), FLAG.DECOR, true, motion.sway(x, z, 0, h));
  }
  const lamps: Lamp[] = [];
  box(s, 2.2, 0, -1.5, 0.08, 1.8, 0.08, 0x2b2724);
  box(s, 2.2, 1.8, -1.5, 0.22, 0.24, 0.22, 0xffc070, FLAG.EMISSIVE);
  lamps.push({ position: new THREE.Vector3(2.2, 1.92, -1.5), color: [1, 0.7, 0.35], radius: 4 });

  const geos = { wheat: wheat(rnd), machine: machine(rnd), windmill: windmill(), sign: sign() };
  const staticGeometry = s.build(), dynamicGeometry = d.build();
  const paletteColors = quantizePalette([staticGeometry, dynamicGeometry, ...Object.values(geos)], paletteSize);
  const triangles = (staticGeometry.attributes.position.count + dynamicGeometry.attributes.position.count) / 3;

  return {
    staticGeometry, dynamicGeometry, lamps, fluids: new FluidCollector(objectsMotionScene.limits).build(), grooves: null,
    shadow: { center: new THREE.Vector3(0, 0, 0), radius: 11 },
    stats: { triangles, paletteColors },
    objectGeometries: geos,
    populate: populateObjects(geos),
  };
}

function populateObjects(geos: Record<string, THREE.BufferGeometry>) {
  return (r: PixelRenderer): SceneGame => {
    const rnd = mulberry32(7), e = new THREE.Euler();
    const add = (geo: string, x: number, z: number, yaw = 0, scale: THREE.Vector3 | number = 1) =>
      r.addObject(geos[geo]).setTransform(new THREE.Vector3(x, 0, z), e.set(0, yaw, 0), scale);
    for (let i = 0; i < FIELD.cols; i++) for (let j = 0; j < FIELD.rows; j++) {
      add('wheat', FIELD.x0 + i * FIELD.step + (rnd() - 0.5) * 0.12, FIELD.z0 + j * FIELD.step + (rnd() - 0.5) * 0.12, rnd() * 6.28, 0.85 + rnd() * 0.3).position.y = 0.04;
    }
    add('machine', 2.2, -3.4);
    add('machine', 0.6, -2.6, 0.4, new THREE.Vector3(-1, 1, 1));   // mirrored
    const turning = add('machine', TURNTABLE.x, TURNTABLE.z);
    turning.position.y = 0.1;
    add('windmill', -5.2, 2.6, -0.25);
    add('windmill', 2.4, 3.4, 0.5, new THREE.Vector3(0.9, 1.15, 0.9));   // stretched
    add('sign', 5.6, 0.4, -0.6);
    add('sign', -0.6, -0.3, 2.2, new THREE.Vector3(-1, 1, 1));   // mirrored
    return { update: (t) => { turning.quaternion.setFromEuler(e.set(0, t * TURNTABLE.speed, 0)); } };
  };
}

export const objectsMotionScene: SceneDefinition = {
  id: 'objects-motion',
  title: 'Objects with motion',
  hasReference: false,
  build: sceneBuilder(() => objectsMotionScene, build, (scene) => ({
    ...scene, populate: populateObjects(scene.objectGeometries!),
  })),
  hour: 12,
  view: {
    target: { x: 0, z: 0, height: 0.6 },
    groundY: 0,
    pan: { minX: -GROUND.hx, maxX: GROUND.hx, minZ: -GROUND.hz, maxZ: GROUND.hz },
    azimuth: 30,
    presets: [
      { name: 'Yard', size: 12, el: 38, tx: 0, tz: 0 },
      { name: 'Wheat', size: 4.5, el: 40, tx: -3.7, tz: -1.0 },
      { name: 'Machines', size: 5.5, el: 35, tx: 3.0, tz: -2.6 },
      { name: 'Mill', size: 5, el: 25, tx: -5.2, tz: 2.6 },
    ],
  },
};
