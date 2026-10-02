import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FLAG, thin } from './flags';
import type { GeometryCollector, RGB } from './geometry';
import { motion, type Motion } from './motion';
import type { Lamp } from './scene';

/** How one glTF mesh enters the scene. Anything left out uses the default. */
export interface MeshRule {
  skip?: boolean;
  /** Default: EMISSIVE if the material has a visible emissive colour, else NORMAL. */
  flag?: number;
  /** Default: the material's base colour (textures are ignored). */
  color?: RGB;
  /** Add the thin mark (see `thin` in flags.ts) to whatever flag the mesh ends up with. */
  thin?: boolean;
  /** Set to make the mesh move: it goes into the dynamic collector. */
  motion?: Motion;
}

/**
 * The object's own name, or for a mesh that is one primitive of a multi-material node, the node's name. GLTFLoader
 * turns such a node into a Group named after the node, whose child meshes are named after the mesh data instead.
 */
const PREFIX = /^(decor|water|glass|thin|move|lamp)_/i;
export const meshNodeName = (o: THREE.Object3D) => (!PREFIX.test(o.name) && o.parent?.type === 'Group' ? o.parent.name : o.name);
const nodeName = meshNodeName;

/**
 * Behaviour from object-name prefixes, the asset naming convention in docs/ASSET_BRIEF.md: `glass_` is skipped,
 * `water_` and `decor_` get their flags, `thin_` gets the thin mark. `move_*` parts stay static here; a scene that wants them to move
 * adds `movingPartMotion`. Pass to `collectGltf`, or call it first inside a scene's own rule.
 */
export function namedMeshRule(mesh: THREE.Mesh): MeshRule | void {
  const n = nodeName(mesh).toLowerCase();
  if (n.startsWith('glass_')) return { skip: true };
  if (n.startsWith('water_')) return { flag: FLAG.WATER };
  if (n.startsWith('decor_')) return { flag: FLAG.DECOR };
  if (n.startsWith('thin_')) return { thin: true };
}

/**
 * Motion for a mesh under a `move_spin_*` or `move_sway_*` node (itself or its nearest such ancestor): the part turns about
 * that node's own local X axis through its origin, a steady spin or a gentle swing. The node's custom properties `speed`
 * (radians per second, default 0.6) and `amplitude` (radians, default 0.1) tune it. World matrices must be current.
 * Not part of `namedMeshRule`: a scene opts in, since moving parts change its frames over time.
 */
export function movingPartMotion(mesh: THREE.Mesh): Motion | undefined {
  for (let o: THREE.Object3D | null = mesh; o; o = o.parent) {
    const m = /^move_(spin|sway)_/i.exec(o.name);
    if (!m) continue;
    const pivot = o.getWorldPosition(new THREE.Vector3()).toArray();
    const axis = new THREE.Vector3().setFromMatrixColumn(o.matrixWorld, 0).normalize().toArray();
    const { speed = 0.6, amplitude = 0.1 } = o.userData as { speed?: number; amplitude?: number };
    return m[1].toLowerCase() === 'spin' ? motion.spin(pivot, axis, speed) : motion.swing(pivot, axis, amplitude);
  }
}

/** Lamps from `lamp_*` empties: world position, plus `color` (linear RGB), `radius` and `clearance` from the node's custom properties. */
export function collectLamps(root: THREE.Object3D): Lamp[] {
  const lamps: Lamp[] = [];
  root.traverse((o) => {
    if (!/^lamp_/i.test(o.name) || (o as THREE.Mesh).isMesh) return;
    const { color = [1, 0.62, 0.22], radius = 3, clearance } = o.userData as { color?: [number, number, number]; radius?: number; clearance?: number };
    lamps.push({ position: o.getWorldPosition(new THREE.Vector3()), color, radius, clearance });
  });
  return lamps;
}

/** Load a glTF/GLB and bake its world matrices. */
export async function loadGltf(url: string): Promise<THREE.Group> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

/**
 * Add every mesh under `root` to the collectors, in traversal order, using one flat colour per material.
 * `rule` can skip meshes or override their flag, colour or motion. Note that three.js turns spaces in node
 * names into underscores, so match names with `[ _]`.
 */
export function collectGltf(root: THREE.Object3D, staticOut: GeometryCollector, dynamicOut: GeometryCollector,
  rule: (mesh: THREE.Mesh, material: THREE.MeshStandardMaterial) => MeshRule | void = () => {}) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const r = rule(mesh, mat) ?? {};
    if (r.skip) return;
    const e = mat.emissive;
    const base = r.flag ?? (e && e.r + e.g + e.b > 0.05 ? FLAG.EMISSIVE : FLAG.NORMAL);
    const flag = r.thin ? thin(base) : base;
    const color = r.color ?? [mat.color.r, mat.color.g, mat.color.b];
    if (r.motion) dynamicOut.add(mesh.geometry, mesh.matrixWorld, color, flag, false, r.motion);
    else staticOut.add(mesh.geometry, mesh.matrixWorld, color, flag);
  });
}
