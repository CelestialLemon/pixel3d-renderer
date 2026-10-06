import * as THREE from 'three';
import { FLAG, FLUIDS, FluidCollector, GeometryCollector, linearColor as lin, motion, place, type Lamp, type PixelScene } from 'pixel3d-renderer';

// The level: a walled garden drawn from a character map. Each character is one 1 m tile; tile (col, row) covers
// x in [col, col + 1] and z in [row, row + 1]. The game reads the same map for collision.
//   .  grass       ,  path        #  stone wall   T  tree       ~  pond (clear water over a sandy bed)
//   L  lamp post   f  flower bed  @  where the player starts
const MAP = [
  '####################',
  '#T.....,,,,.....T..#',
  '#..f...,..,........#',
  '#......,..,...~~~..#',
  '#..L...,..,...~~~~.#',
  '#,,,,,,,..,,,,,~~..#',
  '#......,......,....#',
  '#..##..,..@...,..T.#',
  '#..#...,......,....#',
  '#......,,,,,,,,..L.#',
  '#.T........,.......#',
  '#....f.....,...f...#',
  '#..........,.....T.#',
  '####################',
];
export const WIDTH = MAP[0].length, DEPTH = MAP.length;

const BOX = new THREE.BoxGeometry(1, 1, 1);
const box = (c: GeometryCollector, x: number, y: number, z: number, w: number, h: number, d: number, hex: number, flag: number = FLAG.NORMAL) =>
  c.add(BOX, place(x, y + h / 2, z, 0, 0, 0, w, h, d), lin(hex), flag);

/** Deterministic noise per tile, so the level looks the same every load. */
const hash = (x: number, z: number) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };

export interface Level {
  scene: PixelScene;
  /** Every geometry the scene draws, for choosing the palette together with the objects'. */
  geometries: THREE.BufferGeometry[];
  /** True where the player can't walk: walls, trees, lamp posts and water. */
  solid(col: number, row: number): boolean;
  start: THREE.Vector3;
}

export function buildLevel(): Level {
  const s = new GeometryCollector(), d = new GeometryCollector(true), fluids = new FluidCollector();
  const lamps: Lamp[] = [];
  let start = new THREE.Vector3(WIDTH / 2, 0, DEPTH / 2);
  const at = (col: number, row: number) => MAP[row]?.[col] ?? '#';

  for (let row = 0; row < DEPTH; row++) for (let col = 0; col < WIDTH; col++) {
    const ch = at(col, row), x = col + 0.5, z = row + 0.5, n = hash(col, row);
    if (ch === '~') {
      // A sunken basin with water over it. Its sides show where the bank meets the pond.
      box(s, x, -0.6, z, 1, 0.2, 1, 0x8a7a5a);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (at(col + dx, row + dz) !== '~') box(s, x + dx * 0.5, -0.6, z + dz * 0.5, dz ? 1 : 0.02, 0.6, dx ? 1 : 0.02, 0x6a5a3e);
      }
      fluids.add(new THREE.PlaneGeometry(1, 1), place(x, -0.12, z, -Math.PI / 2), FLUIDS.water);
      continue;
    }
    // Ground: grass in two shades, or a dirt path.
    const ground = ch === ',' ? (n < 0.5 ? 0xa08058 : 0x9a7a52) : (n < 0.5 ? 0x6f9a48 : 0x76a24c);
    box(s, x, -0.5, z, 1, 0.5, 1, ground);
    if (ch === '@') start = new THREE.Vector3(x, 0, z);
    if (ch === '#') {
      box(s, x, 0, z, 1, 1.1 + 0.1 * Math.round(n * 2), 1, n < 0.5 ? 0x8a8478 : 0x948e80);
    } else if (ch === 'T') {
      box(s, x, 0, z, 0.22, 1.2, 0.22, 0x6a4a30);
      s.add(new THREE.IcosahedronGeometry(0.75, 0), place(x, 1.65, z, n, n * 2, 0), lin(0x4f8a3a), FLAG.NORMAL, true);
      s.add(new THREE.IcosahedronGeometry(0.5, 0), place(x + 0.2, 2.2, z - 0.1, n * 3, n, 0), lin(0x5f9a42), FLAG.NORMAL, true);
    } else if (ch === 'L') {
      box(s, x, 0, z, 0.1, 1.9, 0.1, 0x2b2724);
      box(s, x, 1.9, z, 0.24, 0.26, 0.24, 0xffc070, FLAG.EMISSIVE);
      lamps.push({ position: new THREE.Vector3(x, 2.03, z), color: [1, 0.72, 0.38], radius: 4.5 });
    } else if (ch === 'f') {
      // Flowers sway in the wind: ambient motion the renderer animates on its own.
      for (let i = 0; i < 6; i++) {
        const fx = x - 0.3 + hash(i, col) * 0.6, fz = z - 0.3 + hash(row, i) * 0.6;
        d.add(BOX, place(fx, 0.15, fz, 0, 0, 0, 0.04, 0.3, 0.04), lin(0x4a7a2a), FLAG.NORMAL, false, motion.sway(fx, fz, 0, 0.3));
        d.add(BOX, place(fx, 0.32, fz, 0, 0, 0, 0.12, 0.08, 0.12), lin([0xe05a7a, 0xf0d050, 0xa070e0][i % 3]), FLAG.NORMAL, false, motion.sway(fx, fz, 0, 0.3));
      }
    } else if (ch === '.' && n > 0.75) {
      // Tufts of tall grass.
      for (let i = 0; i < 3; i++) {
        const gx = x - 0.3 + hash(col, i) * 0.6, gz = z - 0.3 + hash(i, row) * 0.6;
        d.add(BOX, place(gx, 0.1, gz, 0, n * 6, 0, 0.05, 0.2, 0.05), lin(0x88b050), FLAG.NORMAL, false, motion.sway(gx, gz, 0, 0.2));
      }
    }
  }

  // Meadow outside the walls, just below the tiles, so the camera never looks past the edge of the world.
  const M = 20;
  for (const [x, z, w, d] of [[WIDTH / 2, -M / 2, WIDTH + 2 * M, M], [WIDTH / 2, DEPTH + M / 2, WIDTH + 2 * M, M], [-M / 2, DEPTH / 2, M, DEPTH], [WIDTH + M / 2, DEPTH / 2, M, DEPTH]]) {
    box(s, x, -0.5, z, w, 0.48, d, 0x5f8a40);
  }

  const staticGeometry = s.build(), dynamicGeometry = d.build();
  const scene: PixelScene = {
    staticGeometry, dynamicGeometry, lamps, fluids: fluids.build(),
    shadow: { center: new THREE.Vector3(WIDTH / 2, 0, DEPTH / 2), radius: Math.max(WIDTH, DEPTH) * 0.6 },
  };
  const solid = (col: number, row: number) => '#TL~'.includes(at(col, row));
  return { scene, geometries: [staticGeometry, dynamicGeometry], solid, start };
}
