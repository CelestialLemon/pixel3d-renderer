import * as THREE from 'three';
import { collectGltf, collectLamps, GeometryCollector, loadGltf, meshNodeName, namedMeshRule, type Lamp } from '../../renderer';
import { BACKDROP, BRIDGE, BUILDINGS, CANAL, facingAngle, FOUNTAIN, groundY, PARAPET, type Facing } from './layout';

// Places the modelled buildings and props. Every model must load: a missing or broken GLB fails the scene build,
// so it can never be hidden by a stand-in.

/**
 * A model placed in the scene: `src` is `village` (public/village/) or `props` (public/props/, batch 1).
 * `backdrop` copies fill the land past the street: their windows glow but their lamps are dropped, to keep the lamp budget.
 */
export interface Placement { id: string; src: 'village' | 'props'; x: number; z: number; front: Facing; y?: number; backdrop?: boolean }

const parapetTop = PARAPET.height + PARAPET.coping, parapetZ = CANAL.z0 - PARAPET.inset;

/** Batch 1 props and village clutter. Anything tied to a layout feature takes its position from layout.ts. */
export const PROPS: Placement[] = [
  { id: 'stone_arch_bridge', src: 'props', x: BRIDGE.x, z: BRIDGE.z, front: '+x' },
  ...([[-9.2, 0.7], [-3.4, 0.7], [6.6, 0.9], [-6, 5.9], [5, 5.9], [-4.2, 9.8], [5.6, 9.9]] as const)
    .map(([x, z]) => ({ id: 'street_lamp', src: 'props' as const, x, z, front: '+z' as const })),
  { id: 'street_lamp_cool', src: 'props', x: 8, z: -6.2, front: '+z' },
  { id: 'fountain', src: 'village', x: FOUNTAIN.x, z: FOUNTAIN.z, front: '+z' },
  { id: 'well', src: 'props', x: 9.6, z: -9.3, front: '+z' },
  { id: 'cart', src: 'props', x: -8.2, z: 5.3, front: '-x' },
  // the square: the festoon hangs across the front of the fountain
  { id: 'closed_stall', src: 'village', x: 5.2, z: -4.0, front: '+z' },
  { id: 'festoon', src: 'village', x: FOUNTAIN.x, z: FOUNTAIN.z + 2.1, front: '+z' },
  { id: 'bench', src: 'village', x: 0.7, z: -4.15, front: '+z' },
  { id: 'barrel', src: 'village', x: 6.45, z: -1.25, front: '+z' },
  { id: 'barrel', src: 'village', x: 6.5, z: -0.35, front: '+x' },
  { id: 'crate', src: 'village', x: 5.75, z: -0.8, front: '-x' },
  // the street and the canal: flower boxes stand on the parapet
  { id: 'bench', src: 'village', x: -4.8, z: 5.85, front: '-z' },
  { id: 'signpost', src: 'village', x: 1.6, z: 5.9, front: '-z' },
  { id: 'crate', src: 'village', x: -10.4, z: 5.0, front: '-z' },
  { id: 'crate', src: 'village', x: -10.35, z: 5.0, front: '-x', y: 0.76 },
  { id: 'barrel', src: 'village', x: -9.4, z: 5.05, front: '+z' },
  ...([-7.2, -2.6, 3.4, 7.2] as const).map((x) => ({ id: 'flower_box', src: 'village' as const, x, z: parapetZ, front: '-z' as const, y: parapetTop })),
];

/** Buildings whose chimney smokes. */
const SMOKY = new Set(['bakery', 'tavern', 'house_C']);

/**
 * The name the asset rules see: the node's own name, or its multi-material parent node's name when only that one carries
 * a naming prefix (`meshNodeName` alone would report any parent group's name, the scene root's included).
 */
const PREFIXED = /^(decor|water|glass|thin|move|lamp)_/i;
export const ruleName = (o: THREE.Object3D) => (PREFIXED.test(meshNodeName(o)) ? meshNodeName(o) : o.name);

/** The asset naming rules, minus the bridge's own patch of water: the canal under it has its own, lower surface. */
export const villageRule = (mesh: THREE.Mesh) => (/^water_clear_patch/i.test(ruleName(mesh)) ? { skip: true } : namedMeshRule(mesh));

/** Villagers (batch 1 `villagers`, four figures side by side): which figure, where, and which way they face. */
export const VILLAGERS: { figure: number; x: number; z: number; front: Facing }[] = [
  { figure: 0, x: FOUNTAIN.x - 2.5, z: FOUNTAIN.z + 0.6, front: '+x' },    // chatting by the fountain
  { figure: 1, x: FOUNTAIN.x - 1.85, z: FOUNTAIN.z + 0.85, front: '-x' },
  { figure: 3, x: 9.4, z: 1.75, front: '+z' },                              // outside the tavern
  { figure: 2, x: -3.6, z: 5.75, front: '+z' },                             // looking over the canal
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
  ...BUILDINGS.map((b) => ({ id: b.id, src: 'village' as const, x: b.x, z: b.z, front: b.front })),
  ...PROPS,
  ...BACKDROP.map((b) => ({ id: b.id, src: 'village' as const, x: b.x, z: b.z, front: b.front, backdrop: true })),
];

/**
 * Load every building and prop (each GLB once, in parallel with the villagers) and add their meshes to the collectors in
 * a fixed order. Rejects if any model fails to load. Returns the lamps, and the chimney tops of the buildings that smoke.
 */
export async function placeModels(s: GeometryCollector, d: GeometryCollector): Promise<{ lamps: Lamp[]; chimneys: THREE.Vector3[] }> {
  const urls = [...new Set(PLACEMENTS.map((p) => `/${p.src}/${p.id}.glb`))];
  const [crowd, ...models] = await Promise.all(['/props/villagers.glb', ...urls].map((url) => loadGltf(url)));
  const byUrl = new Map(urls.map((url, i) => [url, models[i]]));

  const lamps: Lamp[] = [], chimneys: THREE.Vector3[] = [];
  for (const place of PLACEMENTS) {
    const root = byUrl.get(`/${place.src}/${place.id}.glb`)!.clone();
    root.position.set(place.x, place.y ?? groundY(place.x, place.z), place.z);
    root.rotation.y = facingAngle(place.front);
    root.updateMatrixWorld(true);
    collectGltf(root, s, d, villageRule);
    if (place.backdrop) continue;
    lamps.push(...collectLamps(root));
    const top = SMOKY.has(place.id) ? chimneyTop(root) : null;
    if (top) chimneys.push(top);
  }

  const figures = villagerFigures(crowd);
  for (const v of VILLAGERS) {
    const root = new THREE.Group().add(figures[v.figure].clone());
    root.position.set(v.x, groundY(v.x, v.z), v.z);
    root.rotation.y = facingAngle(v.front);
    root.updateMatrixWorld(true);
    collectGltf(root, s, d, villageRule);
  }
  return { lamps, chimneys };
}
