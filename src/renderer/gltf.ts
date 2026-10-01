import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FLAG } from './flags';
import type { GeometryCollector, RGB } from './geometry';
import type { Motion } from './motion';

/** How one glTF mesh enters the scene. Anything left out uses the default. */
export interface MeshRule {
  skip?: boolean;
  /** Default: EMISSIVE if the material has a visible emissive colour, else NORMAL. */
  flag?: number;
  /** Default: the material's base colour (textures are ignored). */
  color?: RGB;
  /** Set to make the mesh move: it goes into the dynamic collector. */
  motion?: Motion;
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
    const flag = r.flag ?? (e && e.r + e.g + e.b > 0.05 ? FLAG.EMISSIVE : FLAG.NORMAL);
    const color = r.color ?? [mat.color.r, mat.color.g, mat.color.b];
    if (r.motion) dynamicOut.add(mesh.geometry, mesh.matrixWorld, color, flag, false, r.motion);
    else staticOut.add(mesh.geometry, mesh.matrixWorld, color, flag);
  });
}
