import * as THREE from 'three';
import { FLAG, flip, FLUIDS, GeometryCollector, linearColor as lin, place, thin, type FluidCollector, type RGB } from '../../renderer';
import { fbm, mulberry32, pick, type Rng } from '../shared/random';
import {
  AREA, BASIN, BRIDGE, BUILDINGS, CANAL, DRY_WALLS, FENCES, FOOTBRIDGE, footprintRect, grassEdge, groundY, inWater, JETTY, pavedAt, PLOTS, POND, STAIRS, STAIRS_FOOT_Z,
  WATER_STEPS,
  underBuilding, UPPER_Y, WALL_Z, type Paving,
} from './layout';

// The town floor: the quays, the square's flagstones, cobbled streets, dirt paths and grass; the canal and its mill
// basin, the pond, the retaining wall with its stair flight, garden plots, fences, dry-stone walls and the fields
// beyond. Stones are separate flat quads over a darker mortar plane, so the joints read as lines without any geometry
// thinner than about two art pixels.

/** The canal's current (m/s along x; the village sets its sign so the mill wheel turns with it). */
export const CANAL_FLOW = 0.5;

const C = {
  mortar: lin(0x4a4640),
  cobble: [lin(0x8a8378), lin(0x7c766c), lin(0x958c7e), lin(0x6e6962)],
  flag: [lin(0xa79d8b), lin(0x9b9282), lin(0xb2a893)],
  quay: [lin(0x9a948a), lin(0x8b867d), lin(0xa8a196)],
  kerb: lin(0xb7ae9c),
  grass: [lin(0x4f7a3e), lin(0x5a8743), lin(0x46703a)],
  wall: [lin(0x8f8576), lin(0x7f7669), lin(0x9b917f)],
  wallBody: lin(0x6c645a), coping: lin(0xb0a48e), slime: lin(0x3f4c3a),
  step: lin(0xa0978a), stepEdge: lin(0xb4ab9b),
  iron: lin(0x2e2c33),
  dirt: lin(0x6f5d48), dirtDark: lin(0x5e4f3e), mud: lin(0x4b4034),
  bed: lin(0x4f4a3c), bedStone: [lin(0x625c4c), lin(0x57524a), lin(0x6b6450)], weed: lin(0x3c5434),
  picket: lin(0xc9bfa8), post: lin(0x8a7a64),
  dryStone: [lin(0x8c877d), lin(0x77736b), lin(0x9a9488)],
  crop: [lin(0x4e8a3c), lin(0x6a9a40), lin(0x3e7442)], furrow: lin(0x58493a),
  fields: [lin(0x8a7d45), lin(0x5f7a3a), lin(0x7a8a48), lin(0x6c6038)],
  reed: [lin(0x5d7c3a), lin(0x6e8a44), lin(0x8a8a50)], lily: lin(0x3f7a44), lilyFlower: lin(0xe8b8c8),
};

/** Flat quads collected into one prepared geometry (all facing up unless a normal is given). */
class Quads {
  pos: number[] = []; nor: number[] = []; col: number[] = []; flag: number[] = [];
  /** Axis-aligned horizontal quad from (x0, z0) to (x1, z1) at height y. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, color: RGB, fl: number) {
    const v = [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]];
    for (const [x, z] of v) { this.pos.push(x, y, z); this.nor.push(0, 1, 0); this.col.push(...color); this.flag.push(fl); }
  }
  /** Vertical quad facing +z (or -z with `back`), from (x0, y0) to (x1, y1) at depth z. */
  wallZ(x0: number, y0: number, x1: number, y1: number, z: number, color: RGB, fl: number, back = false) {
    const v = back ? [[x1, y0], [x0, y0], [x0, y1], [x1, y0], [x0, y1], [x1, y1]] : [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]];
    for (const [x, y] of v) { this.pos.push(x, y, z); this.nor.push(0, 0, back ? -1 : 1); this.col.push(...color); this.flag.push(fl); }
  }
  /** Vertical quad facing +x (or -x with `back`), from (z0, y0) to (z1, y1) at x. */
  wallX(z0: number, y0: number, z1: number, y1: number, x: number, color: RGB, fl: number, back = false) {
    const v = back ? [[z0, y0], [z1, y0], [z1, y1], [z0, y0], [z1, y1], [z0, y1]] : [[z1, y0], [z0, y0], [z0, y1], [z1, y0], [z0, y1], [z1, y1]];
    for (const [z, y] of v) { this.pos.push(x, y, z); this.nor.push(back ? -1 : 1, 0, 0); this.col.push(...color); this.flag.push(fl); }
  }
  /** A quad through four corners (counter-clockwise seen from above), as two triangles with their own face normals. */
  quad(a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, c: THREE.Vector3Tuple, d: THREE.Vector3Tuple, color: RGB, fl: number) {
    for (const [p0, p1, p2] of [[a, b, c], [a, c, d]]) {
      const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      const n = new THREE.Vector3(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]).normalize();
      for (const pt of [p0, p1, p2]) { this.pos.push(...pt); this.nor.push(n.x, n.y, n.z); this.col.push(...color); this.flag.push(fl); }
    }
  }
  /** A horizontal triangle fan around (cx, cz): a disc of radius r at height y. */
  disc(cx: number, cz: number, r: number, y: number, color: RGB, fl: number, segments = 20) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2, b = ((i + 1) / segments) * Math.PI * 2;
      for (const [x, z] of [[cx, cz], [cx + Math.cos(b) * r, cz + Math.sin(b) * r], [cx + Math.cos(a) * r, cz + Math.sin(a) * r]]) {
        this.pos.push(x, y, z); this.nor.push(0, 1, 0); this.col.push(...color); this.flag.push(fl);
      }
    }
  }
  addTo(s: GeometryCollector) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFlag', new THREE.Float32BufferAttribute(this.flag, 1));
    s.pushPrepared(g);
  }
}

type Rect = [x0: number, z0: number, x1: number, z1: number];

/** `r` minus the `holes`, as a list of rectangles (cut along every hole edge, keeping the cells outside all holes). */
function minus(r: Rect, holes: Rect[]): Rect[] {
  const xs = [...new Set([r[0], r[2], ...holes.flatMap((h) => [h[0], h[2]])])].filter((x) => x >= r[0] && x <= r[2]).sort((a, b) => a - b);
  const zs = [...new Set([r[1], r[3], ...holes.flatMap((h) => [h[1], h[3]])])].filter((z) => z >= r[1] && z <= r[3]).sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    if (!holes.some((h) => cx > h[0] && cx < h[2] && cz > h[1] && cz < h[3])) out.push([xs[i], zs[j], xs[i + 1], zs[j + 1]]);
  }
  return out;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const box = (s: GeometryCollector, x: number, y: number, z: number, w: number, h: number, d: number, color: RGB, flag: number = FLAG.NORMAL, ry = 0) =>
  s.add(BOX, place(x, y + h / 2, z, 0, ry, 0, w, h, d), color, flag);

const FAR = 200;
const CANAL_RECT: Rect = [CANAL.x0, CANAL.z0, CANAL.x1, CANAL.z1];
const BASIN_RECT: Rect = [BASIN.x0, BASIN.z0, BASIN.x1, BASIN.z1];
/** The square cut out of the ground for the pond; the pond's own cells fill it. */
const POND_RECT: Rect = [POND.x - POND.r - 0.6, POND.z - POND.r - 0.6, POND.x + POND.r + 0.6, POND.z + POND.r + 0.6];
const inPond = (x: number, z: number) => Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.45;

/** What covers the ground at a point: a paving kind, grass, or null where water, a building or the pond takes it. */
function surface(x: number, z: number): Paving | 'grass' | null {
  if (inWater(x, z) || underBuilding(x, z, -0.05) || inPond(x, z)) return null;
  const p = pavedAt(x, z);
  if (p === null) return 'grass';
  // A ragged grass edge where an unpaved neighbour meets dirt.
  if (p === 'dirt' && pavedAt(x + grassEdge(x, z), z + grassEdge(z, x)) === null) return 'grass';
  return p;
}

/** Running-bond stones in rows along x over the area: rows `rowH` deep, stones `minL`..`maxL` long, joints `gap` wide. */
function stones(q: Quads, rnd: Rng, z0: number, z1: number, y: number, rowH: number, minL: number, maxL: number, gap: number, kind: Paving, colors: RGB[]) {
  for (let z = z0; z < z1 - 1e-6; z += rowH) {
    let x = AREA.minX - rnd() * maxL;
    while (x < AREA.maxX) {
      const len = minL + rnd() * (maxL - minL), cx = x + len / 2, cz = z + rowH / 2;
      const color = pick(rnd, colors);
      // Keep a stone only if it lies wholly on its paving (clipped to the area), so none overhangs the water or another kind.
      const x0 = Math.max(x + gap / 2, AREA.minX + 1e-3), x1 = Math.min(x + len - gap / 2, AREA.maxX - 1e-3), z0 = z + gap / 2, z1 = z + rowH - gap / 2;
      if ([[cx, cz], [x0, z0], [x1, z0], [x0, z1], [x1, z1]].every(([px, pz]) => surface(px, pz) === kind)) {
        const shade = fbm(cx * 0.5, cz * 0.5) > 0.62 ? colors[colors.length - 1] : color;
        q.flat(Math.max(x + gap / 2, AREA.minX), z + gap / 2, Math.min(x + len - gap / 2, AREA.maxX), z + rowH - gap / 2, y, shade, FLAG.DECOR);
      }
      x += len;
    }
  }
}

const levelAt = (z: number) => (z < WALL_Z ? UPPER_Y : 0);
/** Ground height at a cell corner, on the cell's own level (a corner on the wall line belongs to both). */
const cornerY = (x: number, z: number, level: number) => level + groundY(x, z) - levelAt(z);

/**
 * Unpaved ground (grass and dirt) as cells of `cs`. Where the terrain is flat, cells of the same colour merge into runs
 * along x; where it rolls, each cell is a sloped quad through its corner heights.
 */
function softGround(q: Quads) {
  const cs = 0.25, nx = Math.round((AREA.maxX - AREA.minX) / cs);
  const heights = (z: number, level: number) => Array.from({ length: nx + 1 }, (_, i) => cornerY(AREA.minX + i * cs, z, level));
  let below: { level: number; h: number[] } | null = null;
  for (let z = AREA.minZ; z < AREA.maxZ - 1e-6; z += cs) {
    // Each row's far edge is the next row's near edge, unless the row crosses onto the other level.
    const level = levelAt(z + cs / 2), h0 = below?.level === level ? below.h : heights(z, level), h1 = heights(z + cs, level), y = level + 0.016;
    below = { level, h: h1 };
    let run: { x0: number; color: RGB } | null = null;
    const flush = (x1: number) => { if (run) q.flat(run.x0, z, x1, z + cs, y, run.color, FLAG.DECOR); run = null; };
    for (let i = 0; i < nx; i++) {
      const x = AREA.minX + i * cs, cx = x + cs / 2, cz = z + cs / 2, kind = surface(cx, cz);
      let color: RGB | null = null;
      if (kind === 'grass') color = grassColor(cx, cz);
      else if (kind === 'dirt') color = fbm(cx * 0.7, cz * 0.7) > 0.55 ? C.dirtDark : C.dirt;
      const flat = Math.max(h0[i], h0[i + 1], h1[i], h1[i + 1]) - level < 1e-4;
      if (run && (color !== run.color || !flat)) flush(x);
      if (!color) continue;
      if (flat) { if (!run) run = { x0: x, color }; continue; }
      q.quad([x, h0[i] + 0.016, z], [x, h1[i] + 0.016, z + cs], [x + cs, h1[i + 1] + 0.016, z + cs], [x + cs, h0[i + 1] + 0.016, z], color, FLAG.DECOR);
    }
    flush(AREA.maxX);
  }
}

function grassColor(x: number, z: number) {
  const f = fbm(x * 0.4 + 7, z * 0.4 - 3);
  return f < 0.4 ? C.grass[2] : f > 0.62 ? C.grass[1] : C.grass[0];
}

/** The land round the town, 1 m cells out to where the hills die away: grass, and striped fields past the south edge. */
const COUNTRY = { minX: -98, maxX: 98, minZ: -102, maxZ: 88 };
function countryside(q: Quads) {
  const cs = 1, inArea = (x: number, z: number) => x > AREA.minX && x < AREA.maxX && z > AREA.minZ && z < AREA.maxZ;
  for (let z = COUNTRY.minZ; z < COUNTRY.maxZ; z += cs) {
    const level = levelAt(z + 0.5);
    for (let x = COUNTRY.minX; x < COUNTRY.maxX; x += cs) {
      const cx = x + 0.5, cz = z + 0.5;
      if (inArea(cx, cz) || inWater(cx, cz)) continue;
      let color = cz < WALL_Z ? C.grass[2] : grassColor(cx * 0.4, cz * 0.4);
      if (cz > AREA.maxZ + 0.6 && Math.abs(cx) < 60) {
        if (Math.abs(cx - BRIDGE.x) < 1.6) color = C.dirt;
        else {
          const patch = C.fields[Math.floor(fbm(Math.floor((cx + 60) / 11) * 3.1, 0.5) * 7) % C.fields.length];
          color = Math.floor(cz) % 2 ? patch : patch.map((c) => c * 0.8) as RGB;
        }
      }
      const y = (px: number, pz: number) => cornerY(px, pz, level) - 0.01;
      q.quad([x, y(x, z), z], [x, y(x, z + cs), z + cs], [x + cs, y(x + cs, z + cs), z + cs], [x + cs, y(x + cs, z), z], color, FLAG.DECOR);
    }
  }
}

export function buildGround(s: GeometryCollector, f: FluidCollector, rnd: Rng, canalFlow = CANAL_FLOW) {
  const q = new Quads();
  const { minX, maxX, minZ, maxZ } = AREA;
  // Mortar under the stones: the main level with holes for the water and the pond, and the upper level.
  for (const r of minus([minX, WALL_Z, maxX, maxZ], [CANAL_RECT, BASIN_RECT, POND_RECT])) q.flat(...r, 0, C.mortar, FLAG.DECOR);
  q.flat(minX, minZ, maxX, WALL_Z, UPPER_Y, C.mortar, FLAG.DECOR);

  // Stones: quay slabs, the square's flagstones, then the cobbles; then grass and dirt.
  stones(q, rnd, WALL_Z, maxZ, 0.012, 0.6, 0.7, 1.1, 0.07, 'quay', C.quay);
  stones(q, rnd, WALL_Z, maxZ, 0.012, 0.5, 0.55, 0.85, 0.07, 'flag', C.flag);
  stones(q, rnd, WALL_Z, maxZ, 0.012, 0.3, 0.3, 0.48, 0.065, 'cobble', C.cobble);
  stones(q, rnd, minZ, WALL_Z, UPPER_Y + 0.012, 0.3, 0.3, 0.48, 0.065, 'cobble', C.cobble);
  softGround(q);
  meadow(s, rnd);

  // Outside the area: rolling country, then plain ground at both levels out to the horizon, with the canal running on through it.
  countryside(q);
  const g = C.grass[2], C0 = COUNTRY;
  for (const r of minus([-FAR, WALL_Z, FAR, FAR], [[C0.minX, WALL_Z, C0.maxX, C0.maxZ], CANAL_RECT])) q.flat(...r, -0.01, g, FLAG.DECOR);
  for (const r of minus([-FAR, -FAR, FAR, WALL_Z], [[C0.minX, C0.minZ, C0.maxX, WALL_Z]])) q.flat(...r, UPPER_Y - 0.01, g, FLAG.DECOR);

  buildRetainingWall(s, q, rnd);
  buildStairs(s);
  buildCanal(s, q, f, rnd, canalFlow);
  buildPond(s, q, f, rnd);
  buildPlots(s, q, rnd);
  for (const run of FENCES) fence(s, run);
  for (const run of DRY_WALLS) dryWall(s, rnd, run);
  q.addTo(s);
}

const BLADE = new THREE.ConeGeometry(0.05, 1, 3).translate(0, 0.5, 0);
const PETALS = new THREE.IcosahedronGeometry(0.06, 0);
/** Grass tufts and clumps of wildflowers scattered over the open grass, away from the walls of buildings. */
function meadow(s: GeometryCollector, rnd: Rng) {
  const { minX, maxX, minZ, maxZ } = AREA;
  const blades = [lin(0x3e6a34), lin(0x557f3e), lin(0x4a7a3a)], flowers = [lin(0xe8e0c8), lin(0xe8c040), lin(0xb090d8), lin(0xe07a8a)];
  for (let i = 0; i < 900; i++) {
    const x = minX + rnd() * (maxX - minX), z = minZ + rnd() * (maxZ - minZ), flower = rnd() < 0.3, color = pick(rnd, flower ? flowers : blades);
    if (surface(x, z) !== 'grass' || underBuilding(x, z, 0.4)) continue;
    for (let k = 0; k < 4; k++) {
      const bx = x + (rnd() - 0.5) * 0.35, bz = z + (rnd() - 0.5) * 0.35, h = 0.18 + rnd() * 0.2, y = groundY(bx, bz);
      s.add(BLADE, place(bx, y, bz, (rnd() - 0.5) * 0.6, rnd() * 3, (rnd() - 0.5) * 0.6, 1, h, 1), pick(rnd, blades), FLAG.DECOR);
      if (flower && k < 3) s.add(PETALS, place(bx, y + h, bz), color, FLAG.DECOR);
    }
  }
}

/** Coursed stone blocks over a vertical face facing +z at depth z, between x0 and x1 and heights y0 and y1. */
function ashlarZ(q: Quads, rnd: Rng, x0: number, x1: number, y0: number, y1: number, z: number, back = false) {
  const course = 0.32, gap = 0.05;
  for (let y = y0; y < y1 - 1e-6; y += course) {
    const top = Math.min(y + course, y1);
    let x = x0 - rnd() * 0.5;
    while (x < x1) {
      const len = 0.5 + rnd() * 0.45;
      const a = Math.max(x + gap / 2, x0), b = Math.min(x + len - gap / 2, x1);
      if (b > a) q.wallZ(a, y + gap / 2, b, top - gap / 2, z + (back ? -0.012 : 0.012), pick(rnd, C.wall), FLAG.DECOR, back);
      x += len;
    }
  }
}

function ashlarX(q: Quads, rnd: Rng, z0: number, z1: number, y0: number, y1: number, x: number, back = false) {
  const course = 0.32, gap = 0.05;
  for (let y = y0; y < y1 - 1e-6; y += course) {
    const top = Math.min(y + course, y1);
    let z = z0 - rnd() * 0.5;
    while (z < z1) {
      const len = 0.5 + rnd() * 0.45;
      const a = Math.max(z + gap / 2, z0), b = Math.min(z + len - gap / 2, z1);
      if (b > a) q.wallX(a, y + gap / 2, b, top - gap / 2, x + (back ? -0.012 : 0.012), pick(rnd, C.wall), FLAG.DECOR, back);
      z += len;
    }
  }
}

/** The 1.6 m wall between the two levels, its coping and the low parapet along the upper edge. */
function buildRetainingWall(s: GeometryCollector, q: Quads, rnd: Rng) {
  const { minX, maxX } = AREA;
  box(s, 0, 0, WALL_Z - 0.5, FAR * 2, UPPER_Y - 0.005, 1, C.wallBody);
  ashlarZ(q, rnd, minX, maxX, 0, UPPER_Y, WALL_Z);
  const sx0 = STAIRS.x - STAIRS.width / 2 - 0.3, sx1 = STAIRS.x + STAIRS.width / 2 + 0.3;
  for (const [a, b] of [[minX, sx0], [sx1, maxX]]) {
    box(s, (a + b) / 2, UPPER_Y, WALL_Z - 0.2, b - a, 0.45, 0.36, C.wall[0]);
    box(s, (a + b) / 2, UPPER_Y + 0.45, WALL_Z - 0.2, b - a + 0.02, 0.1, 0.46, C.coping);
  }
}

/** The stair flight up to the gateway, with cheek walls and a thin iron handrail on each side. */
function buildStairs(s: GeometryCollector) {
  const { x, width, steps, tread } = STAIRS, rise = UPPER_Y / steps;
  for (let i = 0; i < steps; i++) {
    const front = STAIRS_FOOT_Z - i * tread, top = (i + 1) * rise;
    const z0 = front, z1 = WALL_Z;
    box(s, x, 0, (z0 + z1) / 2, width, top - 0.04, z0 - z1, C.step);
    box(s, x, top - 0.04, (z0 + z1) / 2 + 0.02, width, 0.04, z0 - z1 + 0.04, C.stepEdge);
  }
  const shape = new THREE.Shape();
  const run = STAIRS_FOOT_Z - WALL_Z;
  shape.moveTo(0, 0); shape.lineTo(run + 0.2, 0); shape.lineTo(run + 0.2, 0.45); shape.lineTo(0.15, UPPER_Y + 0.45); shape.lineTo(0, UPPER_Y + 0.45);
  const cheek = new THREE.ExtrudeGeometry(shape, { depth: 0.28, bevelEnabled: false });
  for (const side of [-1, 1]) {
    const cx = x + side * (width / 2 + 0.14);
    // Shape x runs from the wall (z = WALL_Z) towards the foot (+z); extrusion is along x.
    s.add(cheek, new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)).setPosition(cx - 0.14, 0, WALL_Z), C.wall[1], FLAG.NORMAL, true);
    const railH = 0.55, p = (t: number) => new THREE.Vector3(cx, UPPER_Y + 0.45 - t * UPPER_Y + railH, WALL_Z + 0.15 + t * (run - 0.15));
    for (const t of [0.05, 0.5, 0.95]) {
      const base = p(t);
      s.add(BOX, place(base.x, base.y - railH / 2, base.z, 0, 0, 0, 0.045, railH, 0.045), C.iron, thin(FLAG.NORMAL));
    }
    const a = p(0), b = p(1), mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b);
    const tilt = Math.atan2(a.y - b.y, b.z - a.z);
    s.add(BOX, place(mid.x, mid.y, mid.z, tilt, 0, 0, 0.045, 0.045, len), C.iron, thin(FLAG.NORMAL));
  }
}

/** Where the quay kerb along the water's edge opens: the bridges land there, and the water steps and the jetty start there. */
const KERB_GAPS: { bank: 'n' | 's'; x0: number; x1: number }[] = [
  ...(['n', 's'] as const).flatMap((bank) => [BRIDGE, FOOTBRIDGE].map((b) => ({ bank, x0: b.x - b.halfWidth - 0.1, x1: b.x + b.halfWidth + 0.1 }))),
  ...WATER_STEPS.map((w) => ({ bank: w.bank, x0: Math.min(w.x, w.x + w.dir * 0.9), x1: Math.max(w.x, w.x + w.dir * 0.9) })),
  { bank: 's', x0: JETTY.x - 0.7, x1: JETTY.x + 0.7 },
  // the mill's wall stands on the water's edge
  ...BUILDINGS.filter((b) => b.id === 'watermill').map((b) => { const [x0, , x1] = footprintRect(b); return { bank: 's' as const, x0, x1 }; }),
];

/**
 * The canal and the mill basin: stone quay walls with a dark waterline band, a silty bed with stones and weed, the water
 * (flowing in the canal, still in the basin), a kerb along both quay edges, and stone steps down to the water.
 */
function buildCanal(s: GeometryCollector, q: Quads, f: FluidCollector, rnd: Rng, flow: number) {
  const { x0, x1, z0, z1, waterY, bedY } = CANAL;
  const { minX, maxX } = AREA, lo = waterY + 0.18;
  // North wall (faces +z into the water), the south wall either side of the basin, and the basin's three walls.
  const southRuns: [number, number][] = [[x0, BASIN.x0], [BASIN.x1, x1]];
  q.wallZ(x0, bedY, x1, 0, z0 - 0.002, C.wallBody, FLAG.NORMAL);
  for (const [a, b] of southRuns) q.wallZ(a, bedY, b, 0, z1 + 0.002, C.wallBody, FLAG.NORMAL, true);
  q.wallX(z0, bedY, z1, 0, x0, C.wallBody, FLAG.NORMAL);   // the far ends, past the hills
  q.wallX(z0, bedY, z1, 0, x1, C.wallBody, FLAG.NORMAL, true);
  q.wallX(BASIN.z0, bedY, BASIN.z1, 0, BASIN.x0 - 0.002, C.wallBody, FLAG.NORMAL);
  q.wallX(BASIN.z0, bedY, BASIN.z1, 0, BASIN.x1 + 0.002, C.wallBody, FLAG.NORMAL, true);
  q.wallZ(BASIN.x0, bedY, BASIN.x1, 0, BASIN.z1 + 0.002, C.wallBody, FLAG.NORMAL, true);
  // Dressed stone above a band of green slime at the waterline, inside the area only.
  ashlarZ(q, rnd, minX, maxX, lo, 0, z0);
  q.wallZ(minX, waterY, maxX, lo, z0 + 0.006, C.slime, FLAG.DECOR);
  for (const [a, b] of [[minX, BASIN.x0], [BASIN.x1, maxX]]) {
    ashlarZ(q, rnd, a, b, lo, 0, z1, true);
    q.wallZ(a, waterY, b, lo, z1 - 0.006, C.slime, FLAG.DECOR, true);
  }
  ashlarX(q, rnd, BASIN.z0, BASIN.z1, lo, 0, BASIN.x0);
  ashlarX(q, rnd, BASIN.z0, BASIN.z1, lo, 0, BASIN.x1, true);
  ashlarZ(q, rnd, BASIN.x0, BASIN.x1, lo, 0, BASIN.z1, true);
  q.wallX(BASIN.z0, waterY, BASIN.z1, lo, BASIN.x0 + 0.006, C.slime, FLAG.DECOR);
  q.wallX(BASIN.z0, waterY, BASIN.z1, lo, BASIN.x1 - 0.006, C.slime, FLAG.DECOR, true);
  q.wallZ(BASIN.x0, waterY, BASIN.x1, lo, BASIN.z1 - 0.006, C.slime, FLAG.DECOR, true);

  // The bed, seen through the water: silt with scattered stones and weed inside the area. Its own generator, so the
  // rest of the town keeps its layout.
  q.flat(x0, z0, x1, z1, bedY, C.bed, FLAG.DECOR);
  q.flat(BASIN.x0, BASIN.z0, BASIN.x1, BASIN.z1, bedY, C.bed, FLAG.DECOR);
  const bedRnd = mulberry32(71);
  for (let i = 0; i < 260; i++) {
    const x = minX + bedRnd() * (maxX - minX), z = z0 + 0.3 + bedRnd() * (BASIN.z1 - z0 - 0.6), w = 0.25 + bedRnd() * 0.45;
    if (!inWater(x, z) || !inWater(x + w, z + w)) continue;
    if (bedRnd() < 0.3) q.flat(x, z, x + w * 0.5, z + w * 1.6, bedY + 0.01, C.weed, FLAG.DECOR);
    else q.flat(x, z, x + w, z + w * (0.6 + bedRnd() * 0.5), bedY + 0.01, pick(bedRnd, C.bedStone), FLAG.DECOR);
  }

  // The water: the canal runs, the basin beside it lies still.
  const sheet = (a: number, b: number, c: number, d: number) => new THREE.PlaneGeometry(c - a, d - b).rotateX(-Math.PI / 2).translate((a + c) / 2, waterY, (b + d) / 2);
  f.add(sheet(x0, z0, x1, z1), null, FLUIDS.canal, [flow, 0]);
  f.add(sheet(BASIN.x0, BASIN.z0, BASIN.x1, BASIN.z1), null, FLUIDS.canal);

  // The kerb: long coping stones along the quay edges, open where the bridges land.
  const kerb = (a: number, b: number, z: number, along: 'x' | 'z') => {
    const bank = z < BRIDGE.z ? 'n' : 's';
    for (let t = a; t < b - 0.05;) {
      const len = Math.min(0.9 + rnd() * 0.5, b - t);
      if (along === 'z' || !KERB_GAPS.some((g) => g.bank === bank && t + len > g.x0 && t < g.x1)) {
        if (along === 'x') box(s, t + len / 2, 0, z, len - 0.04, 0.14, 0.36, C.kerb);
        else box(s, z, 0, t + len / 2, 0.36, 0.14, len - 0.04, C.kerb);
      }
      t += len;
    }
  };
  kerb(minX, maxX, z0 - 0.2, 'x');
  kerb(minX, BASIN.x0 - 0.2, z1 + 0.2, 'x'); kerb(BASIN.x1 + 0.2, maxX, z1 + 0.2, 'x');
  kerb(BASIN.z0 + 0.2, BASIN.z1, BASIN.x0 - 0.2, 'z'); kerb(BASIN.z0 + 0.2, BASIN.z1, BASIN.x1 + 0.2, 'z');
  kerb(BASIN.x0 - 0.2, BASIN.x1 + 0.2, BASIN.z1 + 0.2, 'x');

  // Water steps: a flight down the wall face, from quay level to just under the water.
  const steps = 6, rise = (0 - waterY + 0.15) / steps, run = 0.42, depth = 1.1;
  for (const w of WATER_STEPS) {
    const face = w.bank === 'n' ? z0 : z1, out = w.bank === 'n' ? 1 : -1;
    for (let i = 0; i < steps; i++) {
      const top = -(i + 1) * rise, x = w.x + w.dir * (i + 0.5) * run;
      box(s, x, waterY - 0.2, face + out * depth / 2, run, top - (waterY - 0.2), depth, i % 2 ? C.step : C.stepEdge);
    }
  }
}

/** The pond: a muddy bowl, still water, reeds round the edge and lily pads. */
function buildPond(s: GeometryCollector, q: Quads, f: FluidCollector, rnd: Rng) {
  const { x, z, r, waterY } = POND;
  // The rim: an open cone sloping from the grass down under the water, turned inside out so its inner face shows.
  const rim = new THREE.CylinderGeometry(r + 0.55, r - 0.1, 0.05 - waterY, 28, 1, true).toNonIndexed();
  flip(rim);
  s.add(rim, place(x, (waterY + 0.05) / 2, z), C.mud, FLAG.DECOR, true);
  // Under the water the mud shelves down to a flat bottom.
  const bowl = new THREE.CylinderGeometry(r - 0.1, r * 0.45, 0.6, 28, 1, true).toNonIndexed();
  flip(bowl);
  s.add(bowl, place(x, waterY - 0.3, z), C.mud, FLAG.DECOR, true);
  q.disc(x, z, r * 0.45 + 0.01, waterY - 0.6, C.mud, FLAG.DECOR, 28);
  f.add(new THREE.CircleGeometry(r, 28).rotateX(-Math.PI / 2).translate(x, waterY, z), null, FLUIDS.pond);

  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = r - 0.15 + rnd() * 0.45;
    reeds(s, rnd, x + Math.cos(a) * d, waterY, z + Math.sin(a) * d);
  }
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * (r - 0.8);
    lily(s, q, rnd, x + Math.cos(a) * d, waterY, z + Math.sin(a) * d);
  }
  // Reeds and lilies in the mill basin's quiet corners too.
  for (const [cx, cz] of [[BASIN.x1 - 0.5, BASIN.z1 - 0.5], [BASIN.x1 - 1.6, BASIN.z1 - 0.4]]) reeds(s, rnd, cx, CANAL.waterY, cz);
  for (const [cx, cz] of [[BASIN.x1 - 2.4, BASIN.z1 - 1.3], [BASIN.x1 - 1.2, BASIN.z1 - 1.9], [BASIN.x1 - 3.2, BASIN.z1 - 0.8]]) lily(s, q, rnd, cx, CANAL.waterY, cz);
}

const REED = new THREE.ConeGeometry(0.035, 1, 3).translate(0, 0.5, 0);
const CATTAIL = new THREE.CylinderGeometry(0.06, 0.06, 0.22, 5);
/** A clump of reed blades (thin cones leaning outwards) with a couple of cattail heads. */
function reeds(s: GeometryCollector, rnd: Rng, x: number, y: number, z: number) {
  for (let i = 0; i < 7; i++) {
    const h = 0.7 + rnd() * 0.7, lean = (rnd() - 0.5) * 0.5, ry = rnd() * Math.PI * 2;
    s.add(REED, place(x + (rnd() - 0.5) * 0.4, y - 0.05, z + (rnd() - 0.5) * 0.4, lean, ry, 0, 1.6, h, 1.6), pick(rnd, C.reed), FLAG.DECOR);
    if (i < 2) s.add(CATTAIL, place(x + (rnd() - 0.5) * 0.3, y + h * 0.9, z + (rnd() - 0.5) * 0.3, 0, 0, 0, 1, 1, 1), lin(0x5a3a26), FLAG.DECOR);
  }
}

/** A lily pad on the water, sometimes with a flower. */
function lily(s: GeometryCollector, q: Quads, rnd: Rng, x: number, y: number, z: number) {
  q.disc(x, z, 0.22 + rnd() * 0.14, y + 0.012, C.lily, FLAG.DECOR, 9);
  if (rnd() < 0.4) box(s, x + 0.05, y, z, 0.12, 0.08, 0.12, C.lilyFlower, FLAG.DECOR, rnd() * 3);
}

/** Vegetable plots: dark furrows with rows of round crops. */
function buildPlots(s: GeometryCollector, q: Quads, rnd: Rng) {
  const head = new THREE.IcosahedronGeometry(0.17, 1);
  for (const p of PLOTS) {
    q.flat(p.x0, p.z0, p.x1, p.z1, 0.02, C.furrow, FLAG.DECOR);
    for (let z = p.z0 + 0.4; z < p.z1 - 0.2; z += 0.7) {
      const color = pick(rnd, C.crop);
      q.flat(p.x0 + 0.2, z - 0.12, p.x1 - 0.2, z + 0.12, 0.026, C.mud, FLAG.DECOR);
      for (let x = p.x0 + 0.4; x < p.x1 - 0.3; x += 0.45 + rnd() * 0.15) {
        const k = 0.7 + rnd() * 0.5;
        s.add(head, place(x, 0.1 * k, z, 0, rnd() * 3, 0, k, 0.75 * k, k), color, FLAG.DECOR);
      }
    }
  }
}

/** Corners of a polyline as consecutive segments. */
const segments = (run: [number, number][]) => run.slice(1).map((b, i) => [run[i], b] as const);

/** A picket fence along a polyline: posts at the corners and every ~1.8 m, two rails, and pickets. */
function fence(s: GeometryCollector, run: [number, number][]) {
  for (const [[ax, az], [bx, bz]] of segments(run)) {
    const len = Math.hypot(bx - ax, bz - az), ry = Math.atan2(-(bz - az), bx - ax), ux = (bx - ax) / len, uz = (bz - az) / len;
    const posts = Math.max(1, Math.round(len / 1.8));
    for (let i = 0; i <= posts; i++) box(s, ax + ux * len * i / posts, 0, az + uz * len * i / posts, 0.11, 1.05, 0.11, C.post, FLAG.NORMAL, ry);
    for (const y of [0.3, 0.72]) box(s, (ax + bx) / 2, y, (az + bz) / 2, len, 0.07, 0.06, C.post, FLAG.NORMAL, ry);
    for (let t = 0.15; t < len - 0.1; t += 0.2) box(s, ax + ux * t, 0, az + uz * t, 0.08, 0.92, 0.035, C.picket, FLAG.NORMAL, ry);
  }
}

/** A dry-stone field wall along a polyline: rough blocks in two courses with upright coping stones. */
function dryWall(s: GeometryCollector, rnd: Rng, run: [number, number][]) {
  for (const [[ax, az], [bx, bz]] of segments(run)) {
    const len = Math.hypot(bx - ax, bz - az), ry = Math.atan2(-(bz - az), bx - ax), ux = (bx - ax) / len, uz = (bz - az) / len;
    // Each stone sits on the ground under it, sunk a little so the wall follows the swells without gaps.
    const y0 = (t: number) => groundY(ax + ux * t, az + uz * t) - 0.06;
    for (const [course, h, d] of [[0, 0.38, 0.6], [0.32, 0.28, 0.5]] as const) {
      for (let t = rnd() * 0.3; t < len;) {
        const l = Math.min(0.35 + rnd() * 0.4, len - t);
        if (l > 0.08) box(s, ax + ux * (t + l / 2), y0(t + l / 2) + course, az + uz * (t + l / 2), l - 0.05, h - 0.03, d - rnd() * 0.08, pick(rnd, C.dryStone), FLAG.NORMAL, ry + (rnd() - 0.5) * 0.08);
        t += l;
      }
    }
    for (let t = 0.1; t < len - 0.1; t += 0.22) box(s, ax + ux * t, y0(t) + 0.6, az + uz * t, 0.13, 0.2 + rnd() * 0.08, 0.36, pick(rnd, C.dryStone), FLAG.NORMAL, ry);
  }
}
