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
  front: Facing;
}

export const BUILDINGS: Footprint[] = [
  { id: 'house_A', x: -12, z: -2.5, w: 5, d: 5, front: '+z' },
  { id: 'house_B', x: -6.5, z: -2.5, w: 5.5, d: 5, front: '+z' },
  { id: 'tavern', x: 10.5, z: -2, w: 7, d: 6, front: '+z' },
  { id: 'clock_tower', x: -12, z: -8, w: 4, d: 4, front: '+z' },
  { id: 'house_C', x: -5.5, z: -8.2, w: 6, d: 5, front: '+z' },
  { id: 'house_D', x: 2.5, z: -8.2, w: 5, d: 5, front: '+z' },
  { id: 'stair_arch', x: -1.25, z: -5.4, w: 2.5, d: 0.8, front: '+z' },
  { id: 'bakery', x: -11.5, z: 7.5, w: 4.5, d: 4, front: '-z' },
  { id: 'house_E', x: 11.5, z: 7.5, w: 5, d: 4.5, front: '-z' },
];

/** Copies of the street's houses past its ends and behind the upper lane, so the village carries on into the dark. */
export const BACKDROP: Footprint[] = ([
  ['house_C', -19.5, -2.2, '+z'], ['house_E', -25, -1.8, '+z'], ['bakery', -20, 8.4, '-z'], ['house_D', -27.5, 8.8, '-z'],
  ['house_B', 19.5, -2.4, '+z'], ['house_A', 25.5, -2.2, '+z'], ['house_E', 20, 8.6, '-z'], ['bakery', 26, 8.2, '-z'],
  ['house_D', -6.5, -16, '+z'], ['house_A', 0, -16.5, '+z'], ['house_C', 7, -16, '+z'], ['house_E', -15, -17, '+x'],
] as const).map(([id, x, z, front]) => {
  const { w, d } = BUILDINGS.find((b) => b.id === id)!;
  return { id, x, z, w, d, front };
});

/** Ground-plan rectangle of a footprint after turning: [minX, minZ, maxX, maxZ]. */
export function footprintRect(b: Footprint, margin = 0): [number, number, number, number] {
  const turned = b.front === '+x' || b.front === '-x';
  const hw = (turned ? b.d : b.w) / 2 + margin, hd = (turned ? b.w : b.d) / 2 + margin;
  return [b.x - hw, b.z - hd, b.x + hw, b.z + hd];
}

/** The stair flight from the square up to the upper lane: centred on x, rising towards -z, ending at the wall. */
export const STAIRS = { x: -1.25, width: 1.9, steps: 8, tread: 0.33 };
export const STAIRS_FOOT_Z = WALL_Z + STAIRS.steps * STAIRS.tread;

export const FOUNTAIN = { x: 2.8, z: -1.6, r: 1.5 };

/** The canal on the camera side: water between z0 and z1, from the bakery to house_E. */
export const CANAL = { x0: -9.25, x1: 9, z0: 6.5, z1: 8.9, waterY: -0.5, bedY: -0.9 };
/** The bridge crosses the canal here (stone_arch_bridge, turned to span north-south). */
export const BRIDGE = { x: 0, z: (CANAL.z0 + CANAL.z1) / 2, halfWidth: 1.06 };
/**
 * The square the sun's (and moon's) shadow map covers: half-size `radius` around the origin, in light space. It must
 * hold every model and tree at every hour; village-check projects them all through the day cycle. The widest is the
 * backdrop house_D at 10:30 (31.9 m), so 33 leaves a margin.
 */
export const SUN_SHADOW = { radius: 33 };
/** Drip rings on the canal: offsets from its west and east ends, and from the bridge line. */
export const CANAL_RIPPLES: [number, number][] = [[CANAL.x0 + 4.75, BRIDGE.z - 0.4], [CANAL.x1 - 3.5, BRIDGE.z + 0.1]];
/** The parapet along the canal's street side: centre line `inset` in from the water's edge, wall and coping heights. */
export const PARAPET = { inset: 0.18, height: 0.36, coping: 0.09 };

/** Centre line of the cobbled street (z as a function of x): a gentle curve between the two rows of houses. */
export const streetZ = (x: number) => 2.9 + 0.55 * Math.sin(x * 0.19 + 0.4);
export const STREET_HALF = 2.0;

export const inCanal = (x: number, z: number) => x > CANAL.x0 && x < CANAL.x1 && z > CANAL.z0 && z < CANAL.z1;

/** Ground height at (x, z), ignoring the canal pit and the stairs. */
export const groundY = (x: number, z: number) => (z < WALL_Z ? UPPER_Y : 0);

/** Inside a building footprint (with a margin), using the turned envelope. */
export function underBuilding(x: number, z: number, margin = 0) {
  return BUILDINGS.some((b) => {
    const [x0, z0, x1, z1] = footprintRect(b, margin);
    return x > x0 && x < x1 && z > z0 && z < z1;
  });
}

/** Trees: x, z, scale, round or fir. Their canopies must clear every footprint and the road (see `layoutProblems`). */
export const TREES: [x: number, z: number, scale: number, kind: 'r' | 'f'][] = [
  // south bank of the canal
  [-7.4, 11.3, 0.9, 'r'], [-2.4, 11.8, 0.8, 'r'], [3.2, 11.6, 0.85, 'r'], [6.8, 11.6, 0.95, 'r'],
  // upper-lane garden
  [11.4, -11.2, 1.0, 'r'], [12.6, -9.8, 1.05, 'f'], [13.4, -7.2, 0.85, 'r'],
  // beyond the edges, clear of the backdrop houses and the road
  [-16.6, -6.8, 1.2, 'f'], [16.6, -7.0, 1.25, 'f'], [-15.2, 12.8, 1.1, 'r'], [16.2, 13.2, 1.2, 'f'], [-17, -9, 1.3, 'f'], [17, -10, 1.2, 'r'],
  [-8, 15, 1.3, 'f'], [6, 15.5, 1.2, 'f'], [0, -22.5, 1.3, 'r'], [-10.8, -13.6, 1.2, 'f'],
];
/** Bushes: x, z, scale. */
export const BUSHES: [x: number, z: number, scale: number][] = [
  [-5.9, 10.1, 0.5], [-1.6, 10.4, 0.42], [1.8, 10.3, 0.45], [4.2, 10.5, 0.55], [7.9, 10.6, 0.5], [7.3, -6.3, 0.5], [11, -6.2, 0.45],
];
/** Plan radius of a tree's or bush's leaves, from the shapes in trees.ts (main mass, side clumps and their leaf balls). */
export const canopyRadius = (kind: 'r' | 'f' | 'bush', scale: number) => scale * (kind === 'r' ? 2.15 : kind === 'f' ? 1.4 : 1.9);

/** The packed-earth road beyond the area, and the cobbled street inside it. */
export const onRoad = (x: number, z: number, margin = 0) => Math.abs(x) < 40 && Math.abs(z - streetZ(x)) < STREET_HALF + margin;

/**
 * Layout mistakes a modelled scene cannot show by itself: canopies that cut into a building or backdrop house, or that
 * stand on the road. Returns one message per problem; an empty list means the layout is clean.
 */
export function layoutProblems(): string[] {
  const problems: string[] = [];
  const footprints = [...BUILDINGS, ...BACKDROP];
  const plants = [
    ...TREES.map(([x, z, sc, k]) => ({ x, z, r: canopyRadius(k, sc), name: `${k === 'r' ? 'tree' : 'fir'} (${x}, ${z})` })),
    ...BUSHES.map(([x, z, sc]) => ({ x, z, r: canopyRadius('bush', sc), name: `bush (${x}, ${z})` })),
  ];
  for (const p of plants) {
    for (const b of footprints) {
      const [x0, z0, x1, z1] = footprintRect(b);
      const dx = Math.max(x0 - p.x, 0, p.x - x1), dz = Math.max(z0 - p.z, 0, p.z - z1);
      if (Math.hypot(dx, dz) < p.r) problems.push(`${p.name}: canopy (r ${p.r.toFixed(2)}) cuts into ${b.id} at (${b.x}, ${b.z})`);
    }
    // The road: sample the canopy's edge and centre.
    for (let a = 0; a < 16; a++) {
      const k = a === 0 ? 0 : 1, x = p.x + Math.cos(a * Math.PI / 8) * p.r * k, z = p.z + Math.sin(a * Math.PI / 8) * p.r * k;
      if (onRoad(x, z)) { problems.push(`${p.name}: canopy reaches over the road`); break; }
    }
  }
  return problems;
}

/** Grass on the south bank of the canal and the garden at the east end of the upper lane; paving elsewhere. */
export function isGrass(x: number, z: number) {
  const edge = (fbm(x * 0.6, z * 0.6) - 0.5) * 0.8;
  if (z > CANAL.z1 + 0.5 + edge && x > CANAL.x0 - 0.5 && x < CANAL.x1 + 0.5) return true;
  if (z < WALL_Z - 1.4 + edge && x > 6.2 + edge) return true;
  return z > 10.6 + edge || x < -14.2 + edge || x > 14.4 + edge;
}
