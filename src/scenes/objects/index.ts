import * as THREE from 'three';
import { DEFAULT_PALETTE_SIZE, FLAG, FluidCollector, GeometryCollector, linearColor as lin, place, quantizePalette, type Lamp, type PixelRenderer } from '../../renderer';
import type { BuiltScene, SceneDefinition } from '../types';

// Moving objects: a small yard where everything that moves is a game object (PixelRenderer.addObject), not baked
// ambient motion. A cart drives a loop, balls bounce and squash, a crate turns on a plinth and a field of crops
// grows, is harvested and replanted. `populate` plays the part of the game: it owns the clock-to-transform logic.

const GROUND = { hx: 10, hz: 8 };
const BOX = new THREE.BoxGeometry(1, 1, 1);
type C = GeometryCollector;

/** Box with its base centred at (x, y, z). */
const box = (c: C, x: number, y: number, z: number, w: number, h: number, d: number, hex: number, flag: number = FLAG.NORMAL) =>
  c.add(BOX, place(x, y + h / 2, z, 0, 0, 0, w, h, d), lin(hex), flag);

/** The cart, facing +x, origin on the ground between its wheels. */
function cart() {
  const c = new GeometryCollector(false);
  box(c, 0, 0.22, 0, 1.3, 0.12, 0.8, 0x7a4a2a);                     // bed
  for (const z of [-0.37, 0.37]) box(c, 0, 0.34, z, 1.3, 0.22, 0.06, 0x8f5a34);   // sides
  for (const x of [-0.62, 0.62]) box(c, x, 0.34, 0, 0.06, 0.22, 0.8, 0x8f5a34);   // ends
  box(c, -0.25, 0.34, 0, 0.42, 0.38, 0.42, 0xc89b5a);               // load: two crates
  box(c, 0.28, 0.34, 0.05, 0.36, 0.3, 0.36, 0xb8844a);
  box(c, 0.98, 0.3, 0, 0.7, 0.05, 0.05, 0x4a3020);                  // shaft
  const wheel = new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10);
  for (const x of [-0.42, 0.42]) for (const z of [-0.45, 0.45]) c.add(wheel, place(x, 0.2, z, Math.PI / 2), lin(0x3a2c22), FLAG.NORMAL, true);
  return c.build();
}

function ball() {
  const c = new GeometryCollector(false);
  c.add(new THREE.IcosahedronGeometry(0.3, 1), place(0, 0.3, 0), lin(0xd04a3a), FLAG.NORMAL, true);   // origin at its lowest point
  return c.build();
}

function crate() {
  const c = new GeometryCollector(false);
  box(c, 0, -0.35, 0, 0.7, 0.7, 0.7, 0xc89b5a);
  for (const y of [-0.3, 0.24]) box(c, 0, y, 0, 0.72, 0.06, 0.72, 0x7a4a2a);   // bands
  return c.build();
}

/** One crop plant, origin at its base. Grows by scaling. */
function crop() {
  const c = new GeometryCollector(false);
  box(c, 0, 0, 0, 0.05, 0.42, 0.05, 0x5a8a30);
  const leaf = new THREE.ConeGeometry(0.14, 0.34, 5);
  for (let i = 0; i < 3; i++) c.add(leaf, place(Math.cos(i * 2.1) * 0.08, 0.2, Math.sin(i * 2.1) * 0.08, Math.sin(i * 2.1) * 0.7, 0, -Math.cos(i * 2.1) * 0.7), lin(0x6aa83a), FLAG.NORMAL, true);
  c.add(new THREE.IcosahedronGeometry(0.09, 0), place(0, 0.46, 0), lin(0xe0a030), FLAG.NORMAL, true);
  return c.build();
}

/** Where the cart is at `t` seconds: a 7 x 4.5 m oval, anticlockwise from above. */
const LOOP = { cx: 0, cz: 0, rx: 7, rz: 4.5, speed: 0.17 };   // speed in radians per second
const FIELD = { x0: -3.2, z0: -1.6, cols: 8, rows: 5, step: 0.8 };
const CROP_CYCLE = 12;   // seconds from planting to harvest

async function build(paletteSize = DEFAULT_PALETTE_SIZE): Promise<BuiltScene> {
  const s = new GeometryCollector(false), d = new GeometryCollector(true);
  const tile = new THREE.PlaneGeometry(1, 1), tiles = [lin(0x9c9a8e), lin(0xa5a397)];
  for (let x = -GROUND.hx; x < GROUND.hx; x++) for (let z = -GROUND.hz; z < GROUND.hz; z++) {
    s.add(tile, place(x + 0.5, 0, z + 0.5, -Math.PI / 2), tiles[(x + z + 100) % 2]);
  }
  // The field's soil bed inside the loop, a shed and a plinth for the crate.
  box(s, -0.4, 0, 0, FIELD.cols * FIELD.step + 0.2, 0.04, FIELD.rows * FIELD.step + 0.2, 0x6a4a32);
  box(s, -8, 0, -6, 2.6, 1.6, 2, 0xd8c8a8); box(s, -8, 1.6, -6, 2.9, 0.15, 2.3, 0x7a5a4a);
  box(s, 4.6, 0, 0, 0.9, 0.5, 0.9, 0x8a8478);
  const lamps: Lamp[] = [];
  for (const [x, z] of [[-4, 5.6], [4, -5.6]]) {
    box(s, x, 0, z, 0.08, 1.8, 0.08, 0x2b2724);
    box(s, x, 1.8, z, 0.22, 0.24, 0.22, 0xffc070, FLAG.EMISSIVE);
    lamps.push({ position: new THREE.Vector3(x, 1.92, z), color: [1, 0.7, 0.35], radius: 4 });
  }

  const geos = { cart: cart(), ball: ball(), crate: crate(), crop: crop() };
  const staticGeometry = s.build(), dynamicGeometry = d.build();
  const paletteColors = quantizePalette([staticGeometry, dynamicGeometry, ...Object.values(geos)], paletteSize);
  const triangles = (staticGeometry.attributes.position.count + dynamicGeometry.attributes.position.count) / 3;

  const populate = (r: PixelRenderer) => {
    const cartObj = r.addObject(geos.cart), crateObj = r.addObject(geos.crate);
    const balls = [[7.8, 5.6], [8.8, 4.6], [-8.6, 1.5]].map(([x, z]) => ({ x, z, o: r.addObject(geos.ball) }));
    const crops: { o: ReturnType<PixelRenderer['addObject']>; phase: number }[] = [];
    for (let i = 0; i < FIELD.cols; i++) for (let j = 0; j < FIELD.rows; j++) {
      const o = r.addObject(geos.crop);
      o.position.set(FIELD.x0 + i * FIELD.step, 0.04, FIELD.z0 + j * FIELD.step);
      o.quaternion.setFromAxisAngle(UP, (i * 7 + j * 3) % 6);
      crops.push({ o, phase: ((i * 5 + j * 3) % 8) / 8 });
    }
    const e = new THREE.Euler();
    return (t: number) => {
      const a = t * LOOP.speed;   // radians around the loop
      const x = LOOP.cx + Math.cos(a) * LOOP.rx, z = LOOP.cz - Math.sin(a) * LOOP.rz;
      // Face along the loop: the cart's +x turned by yaw is (cos, -sin), the loop's direction is (-sin a rx, -cos a rz).
      cartObj.setTransform(new THREE.Vector3(x, 0, z), e.set(0, Math.atan2(Math.cos(a) * LOOP.rz, -Math.sin(a) * LOOP.rx), 0));
      crateObj.setTransform(new THREE.Vector3(4.6, 0.92 + 0.06 * Math.sin(t * 1.7), 0), e.set(0, t * 0.8, 0));
      balls.forEach((b, i) => {
        const u = (t * 0.9 + i * 0.37) % 1, h = 4 * u * (1 - u) * 1.4;
        const squash = u < 0.08 || u > 0.92 ? 0.75 : 1;   // squashed for a moment at each bounce
        b.o.setTransform(new THREE.Vector3(b.x, h, b.z), undefined, new THREE.Vector3(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash)));
      });
      for (const c of crops) {
        const g = (t / CROP_CYCLE + c.phase) % 1;
        c.o.visible = g < 0.85;   // harvested, then replanted
        c.o.scale.setScalar(0.15 + 0.85 * Math.min(g / 0.7, 1));
      }
    };
  };

  return {
    staticGeometry, dynamicGeometry, lamps, fluids: new FluidCollector().build(), grooves: null,
    shadow: { center: new THREE.Vector3(0, 0, 0), radius: 13 },
    stats: { triangles, paletteColors },
    populate,
  };
}

const UP = new THREE.Vector3(0, 1, 0);

export const objectsScene: SceneDefinition = {
  id: 'objects',
  title: 'Moving objects',
  hasReference: false,
  build,
  hour: 12,
  view: {
    target: { x: 0, z: 0, height: 0.4 },
    groundY: 0,
    pan: { minX: -GROUND.hx, maxX: GROUND.hx, minZ: -GROUND.hz, maxZ: GROUND.hz },
    azimuth: 38,
    presets: [
      { name: 'Yard', size: 16, el: 40, tx: 0, tz: 0 },
      { name: 'Field', size: 7, el: 45, tx: -0.4, tz: 0 },
      { name: 'Balls', size: 5, el: 30, tx: 8.3, tz: 5.1 },
    ],
  },
};
