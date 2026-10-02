import { fbm } from '../shared/random';

// Where things are in Lantern Row, the canal town (model space, y up, x east, z south towards the default camera).
// A canal runs east-west through the middle of town. The north bank holds the quay, the market square, the town hall and
// the chapel, and behind a retaining wall at z = WALL_Z an upper level with the watch tower and the old ruins. The south
// bank holds the towpath, the mill on its basin, cottages, the smithy, the barn, gardens and the orchard.
// The building footprints are the contract with the modeller (see docs/ASSET_BRIEF.md, batches 2 and 3): each model is
// centred on its footprint with its front facing Blender -Y, which is +z here before `front` turns it.

export const UPPER_Y = 1.6;
export const WALL_Z = -24;
/** The detailed rectangle: paving, grass and gardens inside, plain ground outside. */
export const AREA = { minX: -34, maxX: 34, minZ: -38, maxZ: 24 };

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
  /** Material recolouring for this copy (a key of `RECOLOURS` in models.ts). */
  look?: string;
  /** Open to the sky (ruins, the windmill's sail sweep): the ground under it keeps its grass. */
  open?: boolean;
}

/**
 * The canal: water between z0 and z1, running past both ends of the town. The quays are at y = 0, the water at
 * `waterY` and the bed at `bedY` (the cross-section in docs/ASSET_BRIEF.md, batch 3).
 */
export const CANAL = { x0: -90, x1: 90, z0: -1, z1: 5, waterY: -1, bedY: -1.5 };
/** The basin, a widening of the canal on the south bank where boats moor, east of the mill. */
export const BASIN = { x0: -24.5, x1: -15, z0: CANAL.z1, z1: 10 };
/** Width of the stone quay along each bank. */
export const QUAY = 3;

/** The main road bridge (bridge_stone) and the footbridge, both spanning the canal north-south. */
export const BRIDGE = { x: -2, z: (CANAL.z0 + CANAL.z1) / 2, halfWidth: 2.25, halfLength: 6.5 };
export const FOOTBRIDGE = { x: 17, z: BRIDGE.z, halfWidth: 0.9, halfLength: 4 };

/** The jetty on the south quay (its back edge on the quay edge), and the stone steps down to the water: x of the top
 * step, the bank, and which way the flight descends along x. */
export const JETTY = { x: 7.5, z: CANAL.z1 };
export const WATER_STEPS: { x: number; bank: 'n' | 's'; dir: 1 | -1 }[] = [{ x: -12, bank: 'n', dir: 1 }, { x: 24, bank: 's', dir: -1 }];

export const inWater = (x: number, z: number) =>
  (x > CANAL.x0 && x < CANAL.x1 && z > CANAL.z0 && z < CANAL.z1) || (x > BASIN.x0 && x < BASIN.x1 && z >= BASIN.z0 && z < BASIN.z1);

export const BUILDINGS: Footprint[] = [
  // north bank, along the quay
  { id: 'house_A', x: -27, z: -6.6, w: 5, d: 5, front: '+z' },
  { id: 'house_B', x: -18.5, z: -6.6, w: 5.5, d: 5, front: '+z' },
  { id: 'house_D', x: 12.5, z: -6.6, w: 5, d: 5, front: '+z' },
  { id: 'house_C', x: 20.5, z: -6.6, w: 6, d: 5, front: '+z', look: 'redTile' },
  { id: 'tavern', x: 28.5, z: -7.1, w: 7, d: 6, front: '+z' },
  // the square and behind it
  { id: 'town_hall', x: -2, z: -20, w: 10, d: 7, front: '+z' },
  { id: 'market_hall', x: -9, z: -10, w: 7, d: 4.5, front: '+x' },
  { id: 'chapel', x: -25.5, z: -15.5, w: 6, d: 11, front: '+x' },
  { id: 'clock_tower', x: 16, z: -17, w: 4, d: 4, front: '+z' },
  { id: 'house_E', x: 23, z: -18, w: 5, d: 4.5, front: '+z', look: 'rose' },
  { id: 'stair_arch', x: 11, z: WALL_Z - 0.4, w: 2.5, d: 0.8, front: '+z' },
  // the upper level
  { id: 'watch_tower', x: 25, z: -29, w: 4, d: 4, front: '+z' },
  { id: 'ruins', x: -14, z: -30, w: 9, d: 8, front: '+z', open: true },
  // south bank
  // an undershot mill on the canal's south bank: turned front +x, its local x = +2.5 (the quay edge) lands on the water's
  // edge at z = CANAL.z1, and the wheel turns in the main channel with its axle across the flow
  { id: 'watermill', x: -28, z: CANAL.z1 + 2.5, w: 8, d: 6, front: '+x' },
  { id: 'bakery', x: -8.5, z: 12, w: 4.5, d: 4, front: '+x' },
  { id: 'cottage_thatch', x: -14.5, z: 16, w: 5, d: 4, front: '+z' },
  { id: 'cottage_long', x: 5, z: 12.5, w: 7, d: 4.5, front: '-x' },
  { id: 'smithy', x: 13, z: 12, w: 6, d: 5, front: '+z' },
  { id: 'barn', x: 25, z: 15, w: 8, d: 6, front: '-x' },
  // the fields past the south edge (the envelope is the sails' sweep; the tower is 3.8 m across)
  { id: 'windmill_large', x: 27, z: 29.5, w: 9, d: 5.4, front: '+z', open: true },
];

/** Houses past the town's edges and behind the upper level, so the village carries on into the dark. */
export const BACKDROP: Footprint[] = ([
  ['house_C', -41, -7, '+z'], ['house_E', -48, -6.5, '+z'], ['house_D', 41, -7, '+z'], ['house_A', 48, -6.8, '+z'],
  ['house_D', -6, -45, '+z'], ['house_A', 2, -46, '+z'], ['house_C', 10, -45, '+z'], ['house_E', -24, -44, '+z'],
  ['bakery', 36.5, 12, '-x'], ['house_E', -40, 13, '+z'],
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

/** The stair flight from the lower town up to the upper level: centred on x, rising towards -z, ending at the wall. */
export const STAIRS = { x: 11, width: 1.9, steps: 8, tread: 0.33 };
export const STAIRS_FOOT_Z = WALL_Z + STAIRS.steps * STAIRS.tread;

export const FOUNTAIN = { x: 4.5, z: -9, r: 1.5 };
export const STATUE = { x: -2, z: -10.5 };

/** Ground kinds, painted by `paving` in ground.ts. Later rectangles win. */
export type Paving = 'flag' | 'cobble' | 'quay' | 'dirt';
export const PAVED: { x0: number; z0: number; x1: number; z1: number; kind: Paving }[] = [
  // the quays along both banks and round the mill basin
  { x0: AREA.minX, z0: CANAL.z0 - QUAY, x1: AREA.maxX, z1: CANAL.z0, kind: 'quay' },
  { x0: AREA.minX, z0: CANAL.z1, x1: AREA.maxX, z1: CANAL.z1 + QUAY, kind: 'quay' },
  { x0: BASIN.x0 - 1.2, z0: CANAL.z1, x1: BASIN.x1 + QUAY, z1: BASIN.z1 + 1.2, kind: 'quay' },
  // the market square, the main street through it and over the bridge, and the lane to the stairs
  { x0: -13, z0: -16.5, x1: 9, z1: -4, kind: 'flag' },
  { x0: -4, z0: -16.5, x1: 0, z1: -4, kind: 'cobble' },
  { x0: 9, z0: -15, x1: 13, z1: -4, kind: 'cobble' },
  { x0: 9.5, z0: STAIRS_FOOT_Z, x1: 12.5, z1: -15, kind: 'cobble' },
  // the lane south from the bridge, between the bakery and the long cottage
  { x0: -3.7, z0: CANAL.z1 + QUAY, x1: -0.3, z1: AREA.maxZ, kind: 'cobble' },
  // the upper level: a path from the ruins past the stairs to the watch tower
  { x0: -10, z0: -27.2, x1: 22.5, z1: -25.4, kind: 'dirt' },
  { x0: 9.5, z0: -25.4, x1: 12.5, z1: WALL_Z, kind: 'dirt' },
  // yards: in front of the smithy and the barn
  { x0: 10, z0: 14.5, x1: 16, z1: 17, kind: 'dirt' },
  { x0: 18.5, z0: 12, x1: 21, z1: 18, kind: 'dirt' },
];

/** The pond on the south bank, west of the cottage. */
export const POND = { x: -22.5, z: 18.5, r: 3.2, waterY: -0.18 };

/** Vegetable plots: rows of crops along x. */
export const PLOTS: { x0: number; z0: number; x1: number; z1: number }[] = [
  { x0: 9, z0: 18.5, x1: 16.5, z1: 22.5 },
  { x0: -17.5, z0: 19.5, x1: -11.5, z1: 22.5 },
];

/** Fence runs (picket fences, posts at the corners): lists of (x, z) corners. */
export const FENCES: [number, number][][] = [
  [[8.6, 22.9], [8.6, 18.1], [16.9, 18.1], [16.9, 22.9]],
  [[-11.1, 19.1], [-17.9, 19.1], [-17.9, 22.9]],
];
/** Dry-stone walls round the fields and the upper level: lists of (x, z) corners. */
export const DRY_WALLS: [number, number][][] = [
  [[AREA.minX, 23.4], [-3.9, 23.4]], [[-0.1, 23.4], [AREA.maxX, 23.4]],
  [[-33, -36.5], [-20, -36.5]], [[29.5, -33], [29.5, -37]],
];
/** Hedges: lists of (x, z) corners. */
export const HEDGES: [number, number][][] = [
  [[-5.1, 22.6], [-5.1, 15.6]], [[19.2, 20.5], [27.5, 20.5]], [[-33, -20], [-33, -12]],
];

/** The square the sun's (and moon's) shadow map covers: half-size `radius` around the origin, in light space. village-check proves it. */
export const SUN_SHADOW = { radius: 56 };
/** Drip rings on the canal, the basin and the pond. */
export const CANAL_RIPPLES: [number, number][] = [[6.5, 0.6], [-19, 7.5], [POND.x + 0.8, POND.z - 0.5]];

/**
 * Where the ground stays exactly at its level (0 below the wall, UPPER_Y above it): every street and quay, the water, the
 * pond, the garden plots, the wall and the stairs, and every building with its backdrop copies. Terrain rises and falls only
 * away from these, so buildings and paths sit on flat ground and the canal keeps its cross-section.
 */
const FLATS: [number, number, number, number][] = [
  ...PAVED.map((r) => [r.x0, r.z0, r.x1, r.z1] as [number, number, number, number]),
  [CANAL.x0, CANAL.z0 - QUAY, CANAL.x1, CANAL.z1 + QUAY], [BASIN.x0 - 1.2, BASIN.z0, BASIN.x1 + QUAY, BASIN.z1 + 1.2],
  [POND.x - POND.r - 0.6, POND.z - POND.r - 0.6, POND.x + POND.r + 0.6, POND.z + POND.r + 0.6],
  ...PLOTS.map((p) => [p.x0 - 0.6, p.z0 - 0.6, p.x1 + 0.6, p.z1 + 0.6] as [number, number, number, number]),
  [-200, WALL_Z - 0.8, 200, STAIRS_FOOT_Z], [-3.7, AREA.maxZ, -0.3, 200],
  ...[...BUILDINGS, ...BACKDROP].map((b) => footprintRect(b, 0.5)),
];

/** Distance in plan from (x, z) to the nearest flat area. */
function flatDistance(x: number, z: number) {
  let best = Infinity;
  for (const [x0, z0, x1, z1] of FLATS) {
    const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
    best = Math.min(best, dx * dx + dz * dz);
  }
  return Math.sqrt(best);
}

const smooth = (a: number, b: number, t: number) => { const u = Math.min(Math.max((t - a) / (b - a), 0), 1); return u * u * (3 - 2 * u); };

/**
 * Ground height at (x, z), ignoring water and the stairs: the level, plus gentle rolling ground away from the flat areas.
 * Inside the town the swells stay under about a metre; past its edges they grow into low hills, and they fade out again far
 * away where the plain ground plane takes over.
 */
export function groundY(x: number, z: number) {
  const level = z < WALL_Z ? UPPER_Y : 0;
  const k = smooth(0.8, 4.5, flatDistance(x, z));
  if (k === 0) return level;
  const out = Math.hypot(Math.max(AREA.minX - x, 0, x - AREA.maxX), Math.max(AREA.minZ - z, 0, z - AREA.maxZ));
  const fade = 1 - smooth(45, 64, out);
  const swell = Math.max(fbm(x * 0.06 + 3.1, z * 0.06 - 1.7) - 0.28, 0) * 2.4 * fade;
  const hills = smooth(2, 24, out) * fade * (1.2 + 4.5 * fbm(x * 0.025 - 5, z * 0.025 + 2));
  return level + k * (swell + hills);
}

/** Inside a roofed building's footprint (with a margin), using the turned envelope. */
export function underBuilding(x: number, z: number, margin = 0) {
  return BUILDINGS.some((b) => {
    if (b.open) return false;
    const [x0, z0, x1, z1] = footprintRect(b, margin);
    return x > x0 && x < x1 && z > z0 && z < z1;
  });
}

/** Trees: x, z, scale, round, fir or fruit. Their canopies must clear every footprint, road and the water (see `layoutProblems`). */
export type TreeKind = 'r' | 'f' | 'o';
export const TREES: [x: number, z: number, scale: number, kind: TreeKind][] = [
  // south bank, between the towpath and the cottages
  [-19.5, 13.6, 0.85, 'r'], [30.5, 10.6, 0.9, 'r'],
  // the orchard south of the bakery, and fruit trees in the gardens
  [-9.9, 17.6, 0.62, 'o'], [-7.3, 18.1, 0.6, 'o'], [-9.4, 20.9, 0.6, 'o'], [-6.8, 21.2, 0.62, 'o'], [1.6, 21.5, 0.6, 'o'], [6.6, 21.6, 0.55, 'o'],
  // north bank: the square's corner and the gardens behind the houses
  [-15.5, -11.5, 0.75, 'r'], [7.5, -19.5, 0.8, 'r'], [29, -14.5, 0.95, 'f'], [-31.5, -24.5, 1.1, 'f'],
  // the upper level, round the ruins and the watch tower
  [-21.5, -28.5, 1.0, 'r'], [-6.5, -31.5, 0.9, 'r'], [-21, -35.5, 1.2, 'f'], [-7.5, -35.5, 1.1, 'f'], [19, -31.5, 0.95, 'r'],
  [30.5, -27, 1.15, 'f'], [4.5, -33, 1.0, 'r'],
  // beyond the edges
  [-38, -14, 1.3, 'f'], [38, -16, 1.25, 'f'], [-37.5, 19.5, 1.2, 'r'], [38.5, 21, 1.3, 'f'], [-14, 28, 1.3, 'f'], [12, 29, 1.2, 'f'],
  [-30, -42, 1.3, 'f'], [26, -41, 1.25, 'r'],
];
/** Bushes: x, z, scale. */
export const BUSHES: [x: number, z: number, scale: number][] = [
  [-23.6, 13.2, 0.5], [-20.2, 21.8, 0.45], [-26.2, 16.2, 0.5], [16.5, -10.6, 0.45], [-12.4, -18.5, 0.5], [32.5, -11.5, 0.5],
  [-20, -25.8, 0.55], [-8, -28.4, 0.45], [8.4, 10.6, 0.4], [28, -30.6, 0.5], [21.4, 9.7, 0.45], [1.5, 9.8, 0.4],
];
/** Plan radius of a tree's or bush's leaves, from the shapes in trees.ts (main mass, side clumps and their leaf balls). */
export const canopyRadius = (kind: TreeKind | 'bush', scale: number) => scale * (kind === 'r' ? 2.15 : kind === 'f' ? 1.4 : kind === 'o' ? 2.05 : 1.9);

/** Paving kind at a point, or null where nothing is paved (grass). */
export function pavedAt(x: number, z: number): Paving | null {
  let kind: Paving | null = null;
  for (const r of PAVED) if (x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1) kind = r.kind;
  return kind;
}

/** Where a canopy may not reach: streets, the quays and the water (the orchard's dirt and garden plots are fine). */
const blocksCanopy = (x: number, z: number) => inWater(x, z) || ['flag', 'cobble', 'quay'].includes(pavedAt(x, z) ?? '');

/**
 * Layout mistakes a modelled scene cannot show by itself: canopies that cut into a building or backdrop house, or that
 * hang over a street, a quay or the water, and buildings that overlap each other or the water. Returns one message per
 * problem; an empty list means the layout is clean.
 */
export function layoutProblems(): string[] {
  const problems: string[] = [];
  const footprints = [...BUILDINGS, ...BACKDROP];
  const plants = [
    ...TREES.map(([x, z, sc, k]) => ({ x, z, r: canopyRadius(k, sc), name: `tree ${k} (${x}, ${z})` })),
    ...BUSHES.map(([x, z, sc]) => ({ x, z, r: canopyRadius('bush', sc), name: `bush (${x}, ${z})` })),
  ];
  for (const p of plants) {
    for (const b of footprints) {
      const [x0, z0, x1, z1] = footprintRect(b);
      const dx = Math.max(x0 - p.x, 0, p.x - x1), dz = Math.max(z0 - p.z, 0, p.z - z1);
      if (Math.hypot(dx, dz) < p.r) problems.push(`${p.name}: canopy (r ${p.r.toFixed(2)}) cuts into ${b.id} at (${b.x}, ${b.z})`);
    }
    for (let a = 0; a < 16; a++) {
      const k = a === 0 ? 0 : 1, x = p.x + Math.cos(a * Math.PI / 8) * p.r * k, z = p.z + Math.sin(a * Math.PI / 8) * p.r * k;
      if (blocksCanopy(x, z)) { problems.push(`${p.name}: canopy reaches over a street, quay or the water`); break; }
    }
  }
  for (const [i, a] of footprints.entries()) {
    const [ax0, az0, ax1, az1] = footprintRect(a);
    for (const b of footprints.slice(i + 1)) {
      const [bx0, bz0, bx1, bz1] = footprintRect(b);
      if (ax0 < bx1 && bx0 < ax1 && az0 < bz1 && bz0 < az1) problems.push(`${a.id} at (${a.x}, ${a.z}) overlaps ${b.id} at (${b.x}, ${b.z})`);
    }
    // The watermill's wheel hangs over the basin by design; nothing else may stand in the water.
    if (a.id !== 'watermill' && [[ax0, az0], [ax1, az0], [ax0, az1], [ax1, az1], [a.x, a.z]].some(([x, z]) => inWater(x, z))) {
      problems.push(`${a.id} at (${a.x}, ${a.z}) stands in the water`);
    }
  }
  return problems;
}

/** Ragged edge between grass and paving, for the grass cells in ground.ts. */
export const grassEdge = (x: number, z: number) => (fbm(x * 0.6, z * 0.6) - 0.5) * 0.8;
