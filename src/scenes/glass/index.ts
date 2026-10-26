import * as THREE from 'three';
import { sceneBuilder } from '../shared/baked';
import { DEFAULT_PALETTE_SIZE, FLAG, FluidCollector, GeometryCollector, linearColor as lin, place, quantizePalette, type PixelRenderer } from '../../renderer';
import type { BuiltScene, SceneDefinition, SceneGame } from '../types';

// Glass (FLAG.GLASS, the `glass_` prefix with `glassMeshRule`): greenhouses, a timber frame on stone footings with glass walls
// and a glass gabled roof, and a crop bed inside. One is part of the scene (static glass); the others are objects, as a game
// places them: plain, one under snow (the object tint, the way a game whitens a roof), one turned and one mirrored, and one
// with a lantern lit inside (visible through the panes at night). The frame's shadows and the crop show through the glass.

const GROUND = { hx: 10, hz: 6 };
const BOX = new THREE.BoxGeometry(1, 1, 1);
type C = GeometryCollector;

const box = (c: C, x: number, y: number, z: number, w: number, h: number, d: number, hex: number, flag: number = FLAG.NORMAL) =>
  c.add(BOX, place(x, y + h / 2, z, 0, 0, 0, w, h, d), lin(hex), flag);

/** A flat panel through the corners, in order, as one or two triangles. */
function pane(c: C, hex: number, ...p: [number, number, number][]) {
  const v = p.map((q) => new THREE.Vector3(...q)), pos: number[] = [];
  for (let i = 1; i + 1 < v.length; i++) for (const q of [v[0], v[i], v[i + 1]]) pos.push(q.x, q.y, q.z);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  c.push(g, lin(hex), FLAG.GLASS);
}

const GLASS = 0xbfe3d8, TIMBER = 0x8a5a36, STONE = 0x8d8a84;
const H = 1.5, WALL = 0.9, RIDGE = 1.8, BAR = 0.07;

/** A 3 x 3 m greenhouse, origin at the middle of its base: footings, timber frame, glass, two vents, a crop bed. */
function greenhouse(lantern = false) {
  const c = new GeometryCollector();
  box(c, 0, 0, 0, 3.2, 0.22, 3.2, STONE);
  // The frame: posts at the corners and between the panes, rafters, eaves, ridge.
  for (const x of [-H, -0.5, 0.5, H]) for (const z of [-H, H]) box(c, x, 0.22, z, BAR, WALL - 0.22, BAR, TIMBER);
  for (const z of [-0.5, 0.5]) for (const x of [-H, H]) box(c, x, 0.22, z, BAR, WALL - 0.22, BAR, TIMBER);
  for (const z of [-H, H]) box(c, 0, WALL - BAR / 2, z, 3, BAR, BAR, TIMBER);
  for (const x of [-H, H]) box(c, x, WALL - BAR / 2, 0, BAR, BAR, 3, TIMBER);
  box(c, 0, RIDGE - BAR / 2, 0, 3.1, BAR * 1.2, BAR * 1.2, TIMBER);
  const slope = Math.atan2(RIDGE - WALL, H), len = Math.hypot(RIDGE - WALL, H);
  for (const x of [-H, -0.5, 0.5, H]) for (const s of [-1, 1]) {
    c.add(BOX, place(x, (WALL + RIDGE) / 2, s * H / 2, s * slope, 0, 0, BAR, BAR, len), lin(TIMBER));
  }
  // Glass walls, three panes each, and the gable ends; the panes sit in the frame (the bars stand in front of them).
  for (const [a, b] of [[-H, -0.5], [-0.5, 0.5], [0.5, H]]) {
    for (const z of [-H, H]) pane(c, GLASS, [a, 0.22, z], [b, 0.22, z], [b, WALL, z], [a, WALL, z]);
    for (const x of [-H, H]) pane(c, GLASS, [x, 0.22, a], [x, 0.22, b], [x, WALL, b], [x, WALL, a]);
    for (const s of [-1, 1]) pane(c, GLASS, [a, WALL, s * H], [b, WALL, s * H], [b, RIDGE, 0], [a, RIDGE, 0]);
  }
  for (const x of [-H, H]) pane(c, GLASS, [x, WALL, -H], [x, WALL, H], [x, RIDGE, 0]);
  // Two vents on the ridge, propped open.
  for (const x of [-0.9, 0.9]) c.add(BOX, place(x, RIDGE + 0.12, 0.12, 0.5, 0, 0, 0.55, 0.04, 0.4), lin(TIMBER));
  // The crop bed inside: soil, three rows of plants.
  box(c, 0, 0.22, 0, 2.7, 0.1, 2.7, 0x5a3e2a);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    box(c, -0.9 + i * 0.9, 0.32, -0.9 + j * 0.9, 0.34, 0.3 + 0.08 * ((i + j) % 2), 0.34, (i + j) % 2 ? 0x3f8a2e : 0x56a63a, FLAG.DECOR);
  }
  if (lantern) box(c, 0, 0.5, 0, 0.18, 0.22, 0.18, 0xffc060, FLAG.EMISSIVE);
  return c.build();
}

const SPOTS = { static: [-6.5, 0], plain: [-2.2, 0], snow: [2.2, 0], turned: [6.5, 0], mirrored: [-2.2, -3.8], lit: [2.2, -3.8] } as const;

async function build(paletteSize = glassScene.paletteSize ?? DEFAULT_PALETTE_SIZE): Promise<BuiltScene> {
  const s = new GeometryCollector(false), d = new GeometryCollector(true);
  const ground = new THREE.PlaneGeometry(1, 1), shades = [lin(0x9aa07e), lin(0xa2a886)];
  for (let x = -GROUND.hx; x < GROUND.hx; x++) for (let z = -GROUND.hz; z < GROUND.hz; z++) {
    s.add(ground, place(x + 0.5, 0, z + 0.5, -Math.PI / 2), shades[(x + z + 100) % 2]);
  }
  const geos = { greenhouse: greenhouse(), lit: greenhouse(true) };
  // The scene's own greenhouse: its geometry is placed in the world and merged into the static geometry.
  const own = geos.greenhouse.clone().translate(SPOTS.static[0], 0, SPOTS.static[1]);
  s.pushPrepared(own);
  const staticGeometry = s.build(), dynamicGeometry = d.build();
  const paletteColors = quantizePalette([staticGeometry, dynamicGeometry, ...Object.values(geos)], paletteSize);
  const triangles = (staticGeometry.attributes.position.count + dynamicGeometry.attributes.position.count) / 3;
  return {
    staticGeometry, dynamicGeometry, lamps: [], fluids: new FluidCollector(glassScene.limits).build(), grooves: null,
    shadow: { center: new THREE.Vector3(0, 0, 0), radius: 14 },
    stats: { triangles, paletteColors },
    objectGeometries: geos,
    populate: populateObjects(geos),
  };
}

function populateObjects(geos: Record<string, THREE.BufferGeometry>) {
  return (r: PixelRenderer): SceneGame => {
    const at = (geo: string, [x, z]: readonly [number, number], yaw = 0) =>
      r.addObject(geos[geo]).setTransform(new THREE.Vector3(x, 0, z), new THREE.Euler(0, yaw, 0));
    at('greenhouse', SPOTS.plain);
    const snow = at('greenhouse', SPOTS.snow);
    snow.tint = new THREE.Color(0xf2f6ff); snow.tintStrength = 0.6;
    at('greenhouse', SPOTS.turned, Math.PI / 2);
    at('greenhouse', SPOTS.mirrored).scale.set(-1, 1, 1);
    at('lit', SPOTS.lit);
    return { update() {} };
  };
}

export const glassScene: SceneDefinition = {
  id: 'glass',
  title: 'Glass: greenhouses',
  hasReference: false,
  build: sceneBuilder(() => glassScene, build, (scene) => ({ ...scene, populate: populateObjects(scene.objectGeometries!) })),
  hour: 12,
  view: {
    target: { x: 0, z: -1.5, height: 0.6 },
    groundY: 0,
    pan: { minX: -GROUND.hx, maxX: GROUND.hx, minZ: -GROUND.hz, maxZ: GROUND.hz },
    azimuth: 30,
    presets: [
      { name: 'Yard', size: 12, el: 40, tx: 0, tz: -1.5 },
      { name: 'Close', size: 5, el: 40, tx: -2.2, tz: 0 },
      { name: 'Snow', size: 5, el: 40, tx: 2.2, tz: 0 },
      { name: 'Low', size: 5, el: 18, tx: -2.2, tz: 0 },
    ],
  },
};
