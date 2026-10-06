import * as THREE from 'three';
import { FLAG, GeometryCollector, linearColor as lin, place } from 'pixel3d-renderer';

// The game's objects, built once in local space (origin on the ground unless noted). The renderer draws each one with
// PixelRenderer.addObject; copies that share a geometry are drawn together.

const BOX = new THREE.BoxGeometry(1, 1, 1);
const box = (c: GeometryCollector, x: number, y: number, z: number, w: number, h: number, d: number, hex: number, flag: number = FLAG.NORMAL) =>
  c.add(BOX, place(x, y + h / 2, z, 0, 0, 0, w, h, d), lin(hex), flag);

/** The walker's body, facing +z: everything but the legs. */
function body() {
  const c = new GeometryCollector();
  box(c, 0, 0.42, 0, 0.36, 0.42, 0.24, 0x3a6ab0);             // tunic
  box(c, 0, 0.42, 0, 0.38, 0.06, 0.26, 0x6a4a2a);             // belt
  box(c, 0, 0.84, 0, 0.26, 0.26, 0.26, 0xf0c8a0);             // head
  box(c, 0, 1.08, 0, 0.34, 0.05, 0.34, 0xc8a050);             // hat brim
  box(c, 0, 1.13, 0, 0.2, 0.12, 0.2, 0xc8a050);               // hat crown
  for (const x of [-0.06, 0.06]) box(c, x, 0.9, 0.13, 0.04, 0.05, 0.01, 0x202020);   // eyes
  for (const x of [-0.23, 0.23]) box(c, x, 0.46, 0, 0.1, 0.36, 0.12, 0x3a6ab0);       // arms
  return c.build();
}

/** One leg, hanging from its origin at the hip, so swinging it is a rotation about x. */
function leg() {
  const c = new GeometryCollector();
  box(c, 0, -0.42, 0, 0.13, 0.36, 0.14, 0x4a3a2a);
  box(c, 0, -0.44, 0.03, 0.14, 0.08, 0.2, 0x2a2018);          // boot
  return c.build();
}

/** Things the player can place on the grass. */
function crate() {
  const c = new GeometryCollector();
  box(c, 0, 0, 0, 0.7, 0.7, 0.7, 0xc89b5a);
  for (const y of [0.05, 0.59]) box(c, 0, y, 0, 0.72, 0.06, 0.72, 0x7a4a2a);
  return c.build();
}

function pumpkin() {
  const c = new GeometryCollector();
  c.add(new THREE.SphereGeometry(0.32, 8, 6), place(0, 0.26, 0, 0, 0, 0, 1, 0.8, 1), lin(0xe08030), FLAG.NORMAL, true);
  box(c, 0, 0.48, 0, 0.06, 0.12, 0.06, 0x4a6a2a);
  return c.build();
}

function lantern() {
  const c = new GeometryCollector();
  box(c, 0, 0, 0, 0.3, 0.06, 0.3, 0x2b2724);
  box(c, 0, 0.06, 0, 0.22, 0.26, 0.22, 0xffd080, FLAG.EMISSIVE);
  box(c, 0, 0.32, 0, 0.3, 0.05, 0.3, 0x2b2724);
  return c.build();
}

/** A flat frame marking the tile under the pointer, 1 m across, lying just above the ground. */
function cursor() {
  const c = new GeometryCollector();
  for (const [x, z, w, d] of [[0, -0.47, 1, 0.06], [0, 0.47, 1, 0.06], [-0.47, 0, 0.06, 0.88], [0.47, 0, 0.06, 0.88]]) box(c, x, 0, z, w, 0.02, d, 0xfff0c0, FLAG.EMISSIVE);
  return c.build();
}

export const ITEMS = ['crate', 'pumpkin', 'lantern'] as const;
export type Item = typeof ITEMS[number];

export function buildModels() {
  return { body: body(), leg: leg(), cursor: cursor(), items: { crate: crate(), pumpkin: pumpkin(), lantern: lantern() } satisfies Record<Item, THREE.BufferGeometry> };
}
