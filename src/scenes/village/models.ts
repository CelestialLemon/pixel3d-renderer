import * as THREE from 'three';
import {
  collectGltf, collectLamps, GeometryCollector, loadGltf, meshNodeName, movingPartMotion, namedMeshRule, type FluidCollector, type Lamp, type MeshRule, type RGB,
} from '../../renderer';
import { BACKDROP, BASIN, BRIDGE, BUILDINGS, CANAL, facingAngle, FOOTBRIDGE, FOUNTAIN, groundY, JETTY, STATUE, type Facing } from './layout';

// Places the modelled buildings and props. Every model must load: a missing or broken GLB fails the scene build,
// so it can never be hidden by a stand-in.

/**
 * A model placed in the scene: `src` is `village` (public/village/) or `props` (public/props/, batch 1). `y` defaults
 * to the ground height; boats sit on the water. `look` recolours this copy (see RECOLOURS).
 * `backdrop` copies fill the land past the town: their windows glow but their lamps are dropped, to keep the lamp budget.
 */
export interface Placement { id: string; src: 'village' | 'props'; x: number; z: number; front: Facing; y?: number; look?: string; backdrop?: boolean }

const lamp = (x: number, z: number, id = 'street_lamp'): Placement => ({ id, src: 'props', x, z, front: '+z' });
const at = (id: string, x: number, z: number, front: Facing = '+z', extra: Partial<Placement> = {}): Placement => ({ id, src: 'village', x, z, front, ...extra });

/** Props, street furniture and boats. Anything tied to a layout feature takes its position from layout.ts. */
export const PROPS: Placement[] = [
  at('bridge_stone', BRIDGE.x, BRIDGE.z),
  at('footbridge', FOOTBRIDGE.x, FOOTBRIDGE.z),
  at('jetty', JETTY.x, JETTY.z, '-z'),
  // street lamps: along both quays, on the square, by the bridge lane and on the upper level
  ...[[-22, -3.3], [-9, -3.3], [5, -3.3], [16, -3.3], [26, -3.3], [-13, 7.3], [3.5, 7.3], [12.5, 7.3], [21, 7.3], [-0.2, 14.5],
    [-12.5, -15.8], [8.6, -15.8]].map(([x, z]) => lamp(x, z)),
  lamp(-8, -26.4, 'street_lamp_cool'),
  // the square
  at('guardian_statue', STATUE.x, STATUE.z),
  at('fountain', FOUNTAIN.x, FOUNTAIN.z),
  at('festoon', BRIDGE.x, -5.4),
  at('market_stall_lit', 2.6, -15),
  at('market_stall_lit', 5.6, -15, '+z', { look: 'stallBlue' }),
  at('closed_stall', -9, -15.3),
  at('notice_board', -12.4, -4.9),
  at('bench', -5.2, -12.6, '+x'), at('bench', 1.2, -12.6, '-x'),
  at('barrel', 8.2, -12.2), at('crate', 8.1, -11.2, '-x'),
  // the quays: benches and flower boxes facing the water, bollards, the barge's cargo
  at('bench', -6.8, -2.4), at('flower_box', -8.6, -1.6), at('flower_box', 3.4, -1.6),
  ...[9.5, 13, 20, -17, -25].map((x) => at('mooring_bollard', x, CANAL.z0 - 0.55)),
  at('barrel', 14.6, -2.6), at('barrel', 15.3, -2.2, '+x'), at('crate', 13.4, -2.5, '-x'),
  at('bench', 26.5, 7.0, '-z'),
  at('signpost', 0.9, 9.2, '-z'),
  // the south bank: the mill yard, the bakery, the cottages, the smithy and the barn
  { id: 'cart', src: 'props', x: -13.5, z: 9.3, front: '+x' },
  at('woodpile', -11.2, 15.6, '-x'),
  at('laundry_line', 4.8, 18.3),
  at('hay_bales', 19.6, 15.8, '+x'),
  at('crate', -6.0, 13.2, '+x'), at('barrel', -6.1, 11.4),
  at('barrel', 16.6, 13.4), at('woodpile', 16.7, 10.4, '-x'),
  { id: 'well', src: 'props', x: -16.5, z: -15, front: '+z' },
  // the ruins on the upper level, with the wardstone among them
  at('wardstone', -13.6, -29.6),
  // boats: moored at the jetty, in the basin, and the barge along the north quay
  at('rowboat', JETTY.x - 2.9, CANAL.z1 - 1.75, '-z', { y: CANAL.waterY }),
  at('rowboat', JETTY.x + 2.9, CANAL.z1 - 1.85, '-z', { y: CANAL.waterY, look: 'boatGreen' }),
  at('rowboat', BASIN.x0 + 4, BASIN.z1 - 1.6, '+z', { y: CANAL.waterY }),
  at('barge', 12.5, CANAL.z0 + 1.3, '+x', { y: CANAL.waterY }),
];

/**
 * Recolourings by material name, so copies of the same building differ: roofs of red clay tile instead of slate, plaster
 * in other colours, a blue stall canopy. Material names come from assets/village/village_common.py.
 */
export const RECOLOURS: Record<string, Record<string, RGB>> = {
  redTile: {
    'Village midnight blue slate': [0.30, 0.085, 0.055], 'Village weathered blue slate': [0.38, 0.13, 0.075],
    'Village violet slate': [0.25, 0.08, 0.06],
  },
  rose: { 'Village sage plaster': [0.53, 0.30, 0.30], 'Village warm ivory plaster': [0.62, 0.42, 0.18] },
  stallBlue: { 'Village barn red timber': [0.07, 0.17, 0.36], 'Village tavern rose enamel': [0.62, 0.55, 0.42] },
  boatGreen: { 'Village tarred waterside timber': [0.10, 0.26, 0.17] },
};

/** Buildings whose chimney smokes. */
const SMOKY = new Set(['bakery', 'tavern', 'house_C', 'smithy', 'cottage_thatch', 'town_hall']);

/**
 * The name the asset rules see: the node's own name, or its multi-material parent node's name when only that one carries
 * a naming prefix (`meshNodeName` alone would report any parent group's name, the scene root's included).
 */
const PREFIXED = /^(decor|water|glass|thin|move|lamp)_/i;
export const ruleName = (o: THREE.Object3D) => (PREFIXED.test(meshNodeName(o)) ? meshNodeName(o) : o.name);

/**
 * The asset naming rules, plus this copy's recolouring and, with `moving`, its `move_*` parts. Only models built to the
 * local-X pivot convention (docs/ASSET_BRIEF.md) may move: the batch-1 props (the cart's wheels) predate it.
 */
export const villageRule = (look?: string, moving = false) => (mesh: THREE.Mesh, mat: THREE.MeshStandardMaterial): MeshRule | void => {
  const rule: MeshRule = { ...namedMeshRule(mesh) };
  if (rule.skip) return rule;
  const color = look ? RECOLOURS[look]?.[mat.name] : undefined;
  if (color) rule.color = color;
  const mo = moving ? movingPartMotion(mesh) : undefined;
  if (mo) rule.motion = mo;
  return rule;
};

/** Villagers (batch 1 `villagers`, four figures side by side): which figure, where, and which way they face. */
export const VILLAGERS: { figure: number; x: number; z: number; front: Facing; y?: number }[] = [
  { figure: 0, x: STATUE.x - 1.9, z: STATUE.z + 1.7, front: '+x' },     // at the guardian statue
  { figure: 1, x: STATUE.x - 0.9, z: STATUE.z + 2.0, front: '-x' },
  { figure: 2, x: 2.6, z: -13.3, front: '-z' },                          // at the market stall
  { figure: 3, x: 27, z: -3.4, front: '+z' },                            // outside the tavern
  { figure: 1, x: BRIDGE.x + 4, z: CANAL.z1 + 0.9, front: '-z' },        // on the towpath by the bridge, looking at the water
  { figure: 2, x: JETTY.x + 0.4, z: JETTY.z - 1.5, front: '-z', y: -0.55 }, // on the jetty
  { figure: 0, x: 14.2, z: 15.2, front: '+x' },                          // at the smithy
  { figure: 3, x: -16.4, z: -13.4, front: '+z' },                        // at the well
];

/** Where the four figures of the villagers model stand along its x axis. */
const FIGURE_X = [-1.5, -0.5, 0.5, 1.5].map((x) => x + 0.0039);

/**
 * Split the villagers model into its four figures, each re-centred on its own feet. Each mesh goes to the nearest figure
 * by x, as a single (non-recursive) copy that keeps its world transform and its resolved node name, so naming prefixes
 * on a parent node still apply and a mesh with child meshes is not added twice.
 */
export function villagerFigures(model: THREE.Object3D): THREE.Group[] {
  model.updateMatrixWorld(true);
  const figures = FIGURE_X.map(() => new THREE.Group());
  model.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const p = o.getWorldPosition(new THREE.Vector3());
    const i = FIGURE_X.reduce((best, c, k) => (Math.abs(p.x - c) < Math.abs(p.x - FIGURE_X[best]) ? k : best), 0);
    const mesh = (o as THREE.Mesh).clone(false);
    mesh.name = ruleName(o);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(o.matrixWorld).premultiply(new THREE.Matrix4().makeTranslation(-FIGURE_X[i], 0, 0));
    figures[i].add(mesh);
  });
  return figures;
}

/** Top of the chimney flue of a placed model (its world matrices must be current), or null if it has none. */
function chimneyTop(root: THREE.Object3D): THREE.Vector3 | null {
  const box = new THREE.Box3();
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && /chimney_mouth|dark_flue/i.test(`${o.name} ${o.parent?.name ?? ''}`)) box.expandByObject(o); });
  return box.isEmpty() ? null : new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 0.05, (box.min.z + box.max.z) / 2);
}

/** Every placement in collection order: the buildings, the props, then the backdrop copies. */
export const PLACEMENTS: Placement[] = [
  ...BUILDINGS.map((b) => ({ id: b.id, src: 'village' as const, x: b.x, z: b.z, front: b.front, look: b.look })),
  ...PROPS,
  ...BACKDROP.map((b) => ({ id: b.id, src: 'village' as const, x: b.x, z: b.z, front: b.front, backdrop: true })),
];

/**
 * Load every building and prop (each GLB once, in parallel with the villagers) and add their meshes to the collectors in
 * a fixed order (their `water_` surfaces to `f`). Rejects if any model fails to load. Returns the lamps, and the chimney
 * tops of the buildings that smoke.
 */
export async function placeModels(s: GeometryCollector, d: GeometryCollector, f: FluidCollector): Promise<{ lamps: Lamp[]; chimneys: THREE.Vector3[] }> {
  const urls = [...new Set(PLACEMENTS.map((p) => `/${p.src}/${p.id}.glb`))];
  const [crowd, ...models] = await Promise.all(['/props/villagers.glb', ...urls].map((url) => loadGltf(url)));
  const byUrl = new Map(urls.map((url, i) => [url, models[i]]));

  const lamps: Lamp[] = [], chimneys: THREE.Vector3[] = [];
  for (const p of PLACEMENTS) {
    const root = byUrl.get(`/${p.src}/${p.id}.glb`)!.clone();
    root.position.set(p.x, p.y ?? groundY(p.x, p.z), p.z);
    root.rotation.y = facingAngle(p.front);
    root.updateMatrixWorld(true);
    collectGltf(root, s, d, villageRule(p.look, p.src === 'village'), f);
    if (p.backdrop) continue;
    lamps.push(...collectLamps(root));
    const top = SMOKY.has(p.id) ? chimneyTop(root) : null;
    if (top) chimneys.push(top);
  }

  const figures = villagerFigures(crowd);
  for (const v of VILLAGERS) {
    const root = new THREE.Group().add(figures[v.figure].clone());
    root.position.set(v.x, v.y ?? groundY(v.x, v.z), v.z);
    root.rotation.y = facingAngle(v.front);
    root.updateMatrixWorld(true);
    collectGltf(root, s, d, villageRule(), f);
  }
  return { lamps, chimneys };
}
