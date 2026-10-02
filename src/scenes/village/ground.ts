import * as THREE from 'three';
import { FLAG, GeometryCollector, linearColor as lin, place, thin, type RGB } from '../../renderer';
import { fbm, pick, type Rng } from '../shared/random';
import { AREA, BRIDGE, CANAL, inCanal, isGrass, STAIRS, STAIRS_FOOT_Z, STREET_HALF, streetZ, underBuilding, UPPER_Y, WALL_Z } from './layout';

// The village floor: cobbled street, flagstone square and pavements, grass, the retaining wall with its stair
// flight, and the canal pit with its parapet. Stones are separate flat quads over a darker mortar plane, so the
// joints read as lines without any geometry thinner than about two art pixels.

const C = {
  mortar: lin(0x4a4640), mortarUp: lin(0x47433e),
  cobble: [lin(0x8a8378), lin(0x7c766c), lin(0x958c7e), lin(0x6e6962)],
  flag: [lin(0xa79d8b), lin(0x9b9282), lin(0xb2a893)],
  grass: [lin(0x4f7a3e), lin(0x5a8743), lin(0x46703a)],
  wall: [lin(0x8f8576), lin(0x7f7669), lin(0x9b917f)],
  wallBody: lin(0x6c645a), coping: lin(0xb0a48e),
  step: lin(0xa0978a), stepEdge: lin(0xb4ab9b),
  iron: lin(0x2e2c33),
  dirt: lin(0x6f5d48), dirtDark: lin(0x5e4f3e),
  water: lin(0x2a5f86), deep: lin(0x1f4a6e),
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
  addTo(s: GeometryCollector) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFlag', new THREE.Float32BufferAttribute(this.flag, 1));
    s.pushPrepared(g);
  }
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const box = (s: GeometryCollector, x: number, y: number, z: number, w: number, h: number, d: number, color: RGB, flag: number = FLAG.NORMAL) =>
  s.add(BOX, place(x, y + h / 2, z, 0, 0, 0, w, h, d), color, flag);

/** Paving kind at a point of the main or upper level: null where something else covers the ground. */
function paving(x: number, z: number): 'cobble' | 'flag' | 'grass' | null {
  if (inCanal(x, z) || underBuilding(x, z, -0.05)) return null;
  if (isGrass(x, z)) return 'grass';
  if (z < WALL_Z) return 'cobble';
  if (Math.abs(z - streetZ(x)) < STREET_HALF) return 'cobble';
  return 'flag';
}

/** Running-bond stones in rows along x: rows `rowH` deep, stones `minL`..`maxL` long, joints `gap` wide. */
function stones(q: Quads, rnd: Rng, z0: number, z1: number, y: number, rowH: number, minL: number, maxL: number, gap: number, kind: 'cobble' | 'flag', colors: RGB[]) {
  for (let z = z0; z < z1 - 1e-6; z += rowH) {
    let x = AREA.minX - rnd() * maxL;
    while (x < AREA.maxX) {
      const len = minL + rnd() * (maxL - minL), cx = x + len / 2, cz = z + rowH / 2;
      const color = pick(rnd, colors);
      if (paving(cx, cz) === kind) {
        const shade = fbm(cx * 0.5, cz * 0.5) > 0.62 ? colors[colors.length - 1] : color;
        q.flat(Math.max(x + gap / 2, AREA.minX), z + gap / 2, Math.min(x + len - gap / 2, AREA.maxX), z + rowH - gap / 2, y, shade, FLAG.DECOR);
      }
      x += len;
    }
  }
}

export function buildGround(s: GeometryCollector, rnd: Rng) {
  const q = new Quads();
  // Mortar planes: the main level with a hole for the canal, and the upper level.
  const { minX, maxX, minZ, maxZ } = AREA;
  q.flat(minX, WALL_Z, maxX, CANAL.z0, 0, C.mortar, FLAG.DECOR);
  q.flat(minX, CANAL.z1, maxX, maxZ, 0, C.mortar, FLAG.DECOR);
  q.flat(minX, CANAL.z0, CANAL.x0, CANAL.z1, 0, C.mortar, FLAG.DECOR);
  q.flat(CANAL.x1, CANAL.z0, maxX, CANAL.z1, 0, C.mortar, FLAG.DECOR);
  q.flat(minX, minZ, maxX, WALL_Z, UPPER_Y, C.mortarUp, FLAG.DECOR);

  // Stones: flagstones first (square and pavements), then the street and upper-lane cobbles, then grass cells.
  stones(q, rnd, WALL_Z, CANAL.z1 + 4, 0.012, 0.5, 0.55, 0.85, 0.07, 'flag', C.flag);
  stones(q, rnd, WALL_Z, AREA.maxZ, 0.012, 0.3, 0.3, 0.48, 0.065, 'cobble', C.cobble);
  stones(q, rnd, minZ, WALL_Z, UPPER_Y + 0.012, 0.3, 0.3, 0.48, 0.065, 'cobble', C.cobble);
  const cs = 0.25;
  for (let x = minX; x < maxX; x += cs) for (let z = minZ; z < maxZ; z += cs) {
    const cx = x + cs / 2, cz = z + cs / 2;
    if (paving(cx, cz) !== 'grass') continue;
    const f = fbm(cx * 0.4 + 7, cz * 0.4 - 3);
    q.flat(x, z, x + cs, z + cs, (cz < WALL_Z ? UPPER_Y : 0) + 0.016, f < 0.4 ? C.grass[2] : f > 0.62 ? C.grass[1] : C.grass[0], FLAG.DECOR);
  }

  // Outside the area: plain ground at both levels, out to the horizon.
  const far = 200, g = C.grass[2];
  q.flat(-far, WALL_Z, minX, far, -0.01, g, FLAG.DECOR);
  q.flat(maxX, WALL_Z, far, far, -0.01, g, FLAG.DECOR);
  q.flat(minX, maxZ, maxX, far, -0.01, g, FLAG.DECOR);
  q.flat(-far, -far, far, minZ, UPPER_Y - 0.01, g, FLAG.DECOR);
  q.flat(-far, minZ, minX, WALL_Z, UPPER_Y - 0.01, g, FLAG.DECOR);
  q.flat(maxX, minZ, far, WALL_Z, UPPER_Y - 0.01, g, FLAG.DECOR);
  // The street carries on past both ends as a packed-earth road that fades into the grass.
  for (let x = -40; x < 40; x += cs) {
    if (x >= minX && x < maxX) continue;
    const out = Math.max(minX - x, x - maxX) / 25, zc = streetZ(x);
    for (let z = zc - STREET_HALF; z < zc + STREET_HALF; z += cs) {
      const edge = Math.abs(z + cs / 2 - zc) / STREET_HALF, f = fbm(x * 0.7, z * 0.7);
      if (edge + out * 0.8 + (f - 0.5) * 0.5 > 0.95) continue;
      q.flat(x, z, x + cs, z + cs, 0.002, f > 0.55 ? C.dirtDark : C.dirt, FLAG.DECOR);
    }
  }

  buildRetainingWall(s, q, rnd);
  buildStairs(s);
  buildCanal(s, q, rnd);
  q.addTo(s);
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
  const { minX, maxX } = AREA, far = 200;
  // The wall body: the front face of the upper level, out to the horizon on both sides.
  box(s, 0, 0, WALL_Z - 0.5, far * 2, UPPER_Y - 0.005, 1, C.wallBody);
  ashlarZ(q, rnd, minX, maxX, 0, UPPER_Y, WALL_Z);
  const sx0 = STAIRS.x - STAIRS.width / 2 - 0.3, sx1 = STAIRS.x + STAIRS.width / 2 + 0.3;
  // Coping and a parapet with a gap at the top of the stairs.
  for (const [a, b] of [[minX, sx0], [sx1, maxX]]) {
    box(s, (a + b) / 2, UPPER_Y, WALL_Z - 0.2, b - a, 0.45, 0.36, C.wall[0]);
    box(s, (a + b) / 2, UPPER_Y + 0.45, WALL_Z - 0.2, b - a + 0.02, 0.1, 0.46, C.coping);
  }
}

/** The stair flight from the square up to the gateway, with cheek walls and a thin iron handrail on each side. */
function buildStairs(s: GeometryCollector) {
  const { x, width, steps, tread } = STAIRS, rise = UPPER_Y / steps;
  for (let i = 0; i < steps; i++) {
    const front = STAIRS_FOOT_Z - i * tread, top = (i + 1) * rise;
    const z0 = front, z1 = WALL_Z;
    box(s, x, 0, (z0 + z1) / 2, width, top - 0.04, z0 - z1, C.step);
    box(s, x, top - 0.04, (z0 + z1) / 2 + 0.02, width, 0.04, z0 - z1 + 0.04, C.stepEdge);
  }
  // Cheek walls: a sloped slab on each side.
  const shape = new THREE.Shape();
  const run = STAIRS_FOOT_Z - WALL_Z;
  shape.moveTo(0, 0); shape.lineTo(run + 0.2, 0); shape.lineTo(run + 0.2, 0.45); shape.lineTo(0.15, UPPER_Y + 0.45); shape.lineTo(0, UPPER_Y + 0.45);
  const cheek = new THREE.ExtrudeGeometry(shape, { depth: 0.28, bevelEnabled: false });
  for (const side of [-1, 1]) {
    const cx = x + side * (width / 2 + 0.14);
    // Shape x runs from the wall (z = WALL_Z) towards the foot (+z); extrusion is along x.
    s.add(cheek, new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)).setPosition(cx - 0.14, 0, WALL_Z), C.wall[1], FLAG.NORMAL, true);
    // Handrail: posts and a sloped rail above the cheek wall.
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

/** The canal: stone sides, water, a parapet on the street side and a kerb on the grass side. The bridge is a model. */
function buildCanal(s: GeometryCollector, q: Quads, rnd: Rng) {
  const { x0, x1, z0, z1, waterY, bedY } = CANAL;
  // Sides of the pit, facing into it.
  ashlarZ(q, rnd, x0, x1, bedY, 0, z0, false);
  ashlarZ(q, rnd, x0, x1, bedY, 0, z1, true);
  q.wallZ(x0, bedY, x1, 0, z0 - 0.002, C.wallBody, FLAG.NORMAL);
  q.wallZ(x0, bedY, x1, 0, z1 + 0.002, C.wallBody, FLAG.NORMAL, true);
  q.wallX(z0, bedY, z1, 0, x0, C.wallBody, FLAG.NORMAL);
  q.wallX(z0, bedY, z1, 0, x1, C.wallBody, FLAG.NORMAL, true);
  ashlarX(q, rnd, z0, z1, bedY, 0, x0);
  ashlarX(q, rnd, z0, z1, bedY, 0, x1, true);
  // Water, darker towards the middle.
  const n = 6, dz = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const mid = Math.abs(i + 0.5 - n / 2) < 1.5;
    q.flat(x0, z0 + i * dz, x1, z0 + (i + 1) * dz, waterY, mid ? C.deep : C.water, FLAG.WATER);
  }
  // Parapet along the street side, open where the bridge lands; a low kerb on the grass side.
  const bx0 = BRIDGE.x - BRIDGE.halfWidth - 0.05, bx1 = BRIDGE.x + BRIDGE.halfWidth + 0.05;
  for (const [a, b] of [[x0, bx0], [bx1, x1]]) {
    box(s, (a + b) / 2, 0, z0 - 0.18, b - a, 0.36, 0.36, C.wall[0]);
    box(s, (a + b) / 2, 0.36, z0 - 0.18, b - a + 0.02, 0.09, 0.46, C.coping);
    box(s, (a + b) / 2, 0, z1 + 0.15, b - a, 0.12, 0.3, C.coping);
  }
}
