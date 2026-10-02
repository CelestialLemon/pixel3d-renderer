import { fbm } from '../shared/random';

// Where things are in Lantern Row, the night village street (model space, y up, x east, z south towards the
// default camera). Two ground levels: the main street at y = 0, and the upper lane at UPPER_Y behind a retaining
// wall at z = WALL_Z. The building footprints are the contract with the modeller (see docs/ASSET_BRIEF.md, batch 2): each model is
// centred on its footprint with its front facing Blender -Y, which is +z here before `front` turns it.

export const UPPER_Y = 1.6;
export const WALL_Z = -5;
/** The playable rectangle: paving and grass inside, a plain ground plane outside. */
export const AREA = { minX: -15, maxX: 15, minZ: -12, maxZ: 12 };

/** Which way a model's front faces once placed. */
export type Facing = '+z' | '-z' | '+x' | '-x';
/** y rotation that turns a model's front (+z) to `f`. */
export const facingAngle = (f: Facing) => ({ '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 })[f];

export interface Footprint {
  id: string;
  x: number; z: number;
  /** Envelope along the model's own x (width) and z (depth), before turning. */
  w: number; d: number;
  /** Height used by the block-out box. */
  h: number;
  front: Facing;
  upper?: boolean;
}

export const BUILDINGS: Footprint[] = [
  { id: 'house_A', x: -12, z: -2.5, w: 5, d: 5, h: 7.7, front: '+z' },
  { id: 'house_B', x: -6.5, z: -2.5, w: 5.5, d: 5, h: 9, front: '+z' },
  { id: 'tavern', x: 10.5, z: -2, w: 7, d: 6, h: 10, front: '+z' },
  { id: 'clock_tower', x: -12, z: -8, w: 4, d: 4, h: 13, front: '+z', upper: true },
  { id: 'house_C', x: -5.5, z: -8.2, w: 6, d: 5, h: 9, front: '+z', upper: true },
  { id: 'house_D', x: 2.5, z: -8.2, w: 5, d: 5, h: 8.5, front: '+z', upper: true },
  { id: 'stair_arch', x: -1.25, z: -5.4, w: 2.5, d: 0.8, h: 4, front: '+z', upper: true },
  { id: 'bakery', x: -11.5, z: 7.5, w: 4.5, d: 4, h: 6, front: '-z' },
  { id: 'house_E', x: 11.5, z: 7.5, w: 5, d: 4.5, h: 8, front: '-z' },
];

/** The stair flight from the square up to the upper lane: centred on x, rising towards -z, ending at the wall. */
export const STAIRS = { x: -1.25, width: 1.9, steps: 8, tread: 0.33 };
export const STAIRS_FOOT_Z = WALL_Z + STAIRS.steps * STAIRS.tread;

export const FOUNTAIN = { x: 2.8, z: -1.6, r: 1.5 };

/** The canal on the camera side: water between z0 and z1, from the bakery to house_E. */
export const CANAL = { x0: -9.25, x1: 9, z0: 6.5, z1: 8.9, waterY: -0.5, bedY: -0.9 };
/** The bridge crosses the canal here (stone_arch_bridge, turned to span north-south). */
export const BRIDGE = { x: 0, z: 7.7, halfWidth: 1.06 };

/** Centre line of the cobbled street (z as a function of x): a gentle curve between the two rows of houses. */
export const streetZ = (x: number) => 2.9 + 0.55 * Math.sin(x * 0.19 + 0.4);
export const STREET_HALF = 2.0;

export const inCanal = (x: number, z: number) => x > CANAL.x0 && x < CANAL.x1 && z > CANAL.z0 && z < CANAL.z1;

/** Ground height at (x, z), ignoring the canal pit and the stairs. */
export const groundY = (x: number, z: number) => (z < WALL_Z ? UPPER_Y : 0);

/** Inside a building footprint (with a margin), using the turned envelope. */
export function underBuilding(x: number, z: number, margin = 0) {
  return BUILDINGS.some((b) => {
    const turned = b.front === '+x' || b.front === '-x';
    const hw = (turned ? b.d : b.w) / 2 + margin, hd = (turned ? b.w : b.d) / 2 + margin;
    return Math.abs(x - b.x) < hw && Math.abs(z - b.z) < hd;
  });
}

/** Grass on the south bank of the canal and the garden at the east end of the upper lane; paving elsewhere. */
export function isGrass(x: number, z: number) {
  const edge = (fbm(x * 0.6, z * 0.6) - 0.5) * 0.8;
  if (z > CANAL.z1 + 0.5 + edge && x > CANAL.x0 - 0.5 && x < CANAL.x1 + 0.5) return true;
  if (z < WALL_Z - 1.4 + edge && x > 6.2 + edge) return true;
  return z > 10.6 + edge || x < -14.2 + edge || x > 14.4 + edge;
}
