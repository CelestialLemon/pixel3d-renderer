import * as THREE from 'three';
import { collectGltf, collectLamps, GeometryCollector, loadGltf, namedMeshRule, type Lamp } from '../../renderer';
import { BUILDINGS, facingAngle, groundY, type Facing, type Footprint } from './layout';

// Places the modelled buildings and props. A building whose model is not delivered yet (no
// assets/village/<id>/metadata.json) is drawn as a grey block-out box with a gable roof and a few lit windows,
// so the layout can be judged before every model exists.

const DELIVERED = new Set(Object.keys(import.meta.glob('/assets/village/*/metadata.json')).map((p) => p.split('/')[3]));

/**
 * A model placed in the scene: `src` is `village` (public/village/) or `props` (public/props/, batch 1).
 * `backdrop` copies fill the land past the street: their windows glow but their lamps are dropped, to keep the lamp budget.
 */
export interface Placement { id: string; src: 'village' | 'props'; x: number; z: number; front: Facing; y?: number; backdrop?: boolean }

/** Batch 1 props and village clutter, placed by hand. Clutter only shows once its model is delivered. */
export const PROPS: Placement[] = [
  { id: 'stone_arch_bridge', src: 'props', x: 0, z: 7.7, front: '+x' },
  ...([[-9.2, 0.7], [-3.4, 0.7], [6.6, 0.9], [-6, 5.9], [5, 5.9], [-4.2, 9.8], [5.6, 9.9]] as const)
    .map(([x, z]) => ({ id: 'street_lamp', src: 'props' as const, x, z, front: '+z' as const })),
  { id: 'street_lamp_cool', src: 'props', x: 8, z: -6.2, front: '+z' },
  { id: 'fountain', src: 'village', x: 2.8, z: -1.6, front: '+z' },
  { id: 'well', src: 'props', x: 9.6, z: -9.3, front: '+z' },
  { id: 'cart', src: 'props', x: -8.2, z: 5.3, front: '-x' },
  // the square
  { id: 'closed_stall', src: 'village', x: 5.2, z: -4.0, front: '+z' },
  { id: 'festoon', src: 'village', x: 2.8, z: 0.5, front: '+z' },
  { id: 'bench', src: 'village', x: 0.7, z: -4.15, front: '+z' },
  { id: 'barrel', src: 'village', x: 6.45, z: -1.25, front: '+z' },
  { id: 'barrel', src: 'village', x: 6.5, z: -0.35, front: '+x' },
  { id: 'crate', src: 'village', x: 5.75, z: -0.8, front: '-x' },
  // the street and the canal
  { id: 'bench', src: 'village', x: -4.8, z: 5.85, front: '-z' },
  { id: 'signpost', src: 'village', x: 1.6, z: 5.9, front: '-z' },
  { id: 'crate', src: 'village', x: -10.4, z: 5.0, front: '-z' },
  { id: 'crate', src: 'village', x: -10.35, z: 5.0, front: '-x', y: 0.76 },
  { id: 'barrel', src: 'village', x: -9.4, z: 5.05, front: '+z' },
  ...([-7.2, -2.6, 3.4, 7.2] as const).map((x) => ({ id: 'flower_box', src: 'village' as const, x, z: 6.32, front: '-z' as const, y: 0.45 })),
];

/** Copies of the street's houses past its ends and behind the upper lane, so the village carries on into the dark. */
export const BACKDROP: Placement[] = ([
  ['house_C', -19.5, -2.2, '+z'], ['house_E', -25, -1.8, '+z'], ['bakery', -20, 8.4, '-z'], ['house_D', -27.5, 8.8, '-z'],
  ['house_B', 19.5, -2.4, '+z'], ['house_A', 25.5, -2.2, '+z'], ['house_E', 20, 8.6, '-z'], ['bakery', 26, 8.2, '-z'],
  ['house_D', -6.5, -16, '+z'], ['house_A', 0, -16.5, '+z'], ['house_C', 7, -16, '+z'], ['house_E', -15, -17, '+x'],
] as const).map(([id, x, z, front]) => ({ id, src: 'village' as const, x, z, front, backdrop: true }));

/** Buildings whose chimney smokes. */
const SMOKY = new Set(['bakery', 'tavern', 'house_C']);

const plaster = new THREE.MeshStandardMaterial({ color: 0x9a948a });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4f63 });
const windowMat = new THREE.MeshStandardMaterial({ color: 0xffb45c, emissive: 0xffb45c });

/** Grey box, gable roof along the model's x, and two lit windows per floor on the front. */
function blockOut(b: Footprint): THREE.Group {
  const g = new THREE.Group(), wallH = b.h * 0.62;
  const body = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.94, wallH, b.d * 0.94), plaster);
  body.position.y = wallH / 2; g.add(body);
  const roof = new THREE.Shape();
  roof.moveTo(-b.d / 2, 0); roof.lineTo(b.d / 2, 0); roof.lineTo(0, b.h - wallH); roof.lineTo(-b.d / 2, 0);
  const prism = new THREE.Mesh(new THREE.ExtrudeGeometry(roof, { depth: b.w, bevelEnabled: false }), roofMat);
  prism.rotation.y = Math.PI / 2; prism.position.set(-b.w / 2, wallH, 0); g.add(prism);
  for (let y = 1.2; y + 1.1 < wallH; y += 2.8) for (const sx of [-0.25, 0.25]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.1), windowMat);
    win.position.set(sx * b.w, y + 0.55, b.d * 0.47 + 0.01); g.add(win);
  }
  return g;
}

/** The asset naming rules, minus the bridge's own patch of water: the canal under it has its own, lower surface. */
const villageRule = (mesh: THREE.Mesh) => (/water_clear_patch/i.test(mesh.name || mesh.parent?.name || '') ? { skip: true } : namedMeshRule(mesh));

/** Villagers (batch 1 `villagers`, four figures side by side): which figure, where, and which way they face. */
export const VILLAGERS: { figure: number; x: number; z: number; front: Facing }[] = [
  { figure: 0, x: 0.3, z: -1.0, front: '+x' }, { figure: 1, x: 0.95, z: -0.75, front: '-x' },   // chatting by the fountain
  { figure: 3, x: 9.4, z: 1.75, front: '+z' },                                                    // outside the tavern
  { figure: 2, x: -3.6, z: 5.75, front: '+z' },                                                   // looking over the canal
];

/** Split the villagers model into its four figures, each re-centred on its own feet. Meshes go to the nearest figure by x. */
function villagerFigures(model: THREE.Group): THREE.Group[] {
  const centres = [-1.5, -0.5, 0.5, 1.5].map((x) => x + 0.0039), figures = centres.map(() => new THREE.Group());
  model.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const p = o.getWorldPosition(new THREE.Vector3());
    const i = centres.reduce((best, c, k) => (Math.abs(p.x - c) < Math.abs(p.x - centres[best]) ? k : best), 0);
    const mesh = (o as THREE.Mesh).clone();
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(o.matrixWorld).premultiply(new THREE.Matrix4().makeTranslation(-centres[i], 0, 0));
    figures[i].add(mesh);
  });
  return figures;
}

/** Top of the chimney flue of a placed model (its world matrices must be current), or null if it has none. */
function chimneyTop(root: THREE.Object3D): THREE.Vector3 | null {
  const box = new THREE.Box3();
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && /chimney_mouth|dark_flue/i.test(o.name || o.parent?.name || '')) box.expandByObject(o); });
  return box.isEmpty() ? null : new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 0.05, (box.min.z + box.max.z) / 2);
}

/**
 * Load every building and prop and add their meshes to the collectors in a fixed order.
 * Returns the lamps, and the chimney tops of the buildings that smoke.
 */
export async function placeModels(s: GeometryCollector, d: GeometryCollector): Promise<{ lamps: Lamp[]; chimneys: THREE.Vector3[] }> {
  const items: { place: Placement; build?: Footprint }[] = [
    ...BUILDINGS.map((b) => ({ place: { id: b.id, src: 'village' as const, x: b.x, z: b.z, front: b.front }, build: b })),
    ...PROPS.filter((p) => p.src === 'props' || DELIVERED.has(p.id)).map((p) => ({ place: p })),
    ...BACKDROP.filter((p) => DELIVERED.has(p.id)).map((p) => ({ place: p })),
  ];
  // Load each model once, however often it is placed; a building whose model fails to load falls back to its box.
  const loaded = new Map<string, Promise<THREE.Group | null>>();
  const load = (p: Placement) => {
    const url = `/${p.src}/${p.id}.glb`;
    if (!loaded.has(url)) loaded.set(url, p.src === 'village' && !DELIVERED.has(p.id) ? Promise.resolve(null) : loadGltf(url).catch(() => null));
    return loaded.get(url)!;
  };
  const roots = await Promise.all(items.map(async ({ place, build }) => {
    const model = await load(place);
    return model ? model.clone() : build ? blockOut(build) : null;
  }));
  const lamps: Lamp[] = [], chimneys: THREE.Vector3[] = [];
  items.forEach(({ place }, i) => {
    const root = roots[i];
    if (!root) return;
    root.position.set(place.x, place.y ?? groundY(place.x, place.z), place.z);
    root.rotation.y = facingAngle(place.front);
    root.updateMatrixWorld(true);
    collectGltf(root, s, d, villageRule);
    if (place.backdrop) return;
    lamps.push(...collectLamps(root));
    const top = SMOKY.has(place.id) ? chimneyTop(root) : null;
    if (top) chimneys.push(top);
  });
  const crowd = await loadGltf('/props/villagers.glb');
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
