import * as THREE from 'three';
import { collectGltf, FLAG, GeometryCollector, motion, type Vec3 } from '../../renderer';
import { BELT } from './layout';

/** Adds the cookie factory model (public/cookie_factory.glb). The cookies on the belt become moving geometry. */
export function addFactory(root: THREE.Object3D, s: GeometryCollector, d: GeometryCollector) {
  // Find the belt cookies: each one is a few meshes sharing the centre of its "cookie edge" ring.
  const belt = new Set<THREE.Mesh>();
  const centres: THREE.Vector3[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = (mesh.material as THREE.Material).name;
    if (!/cookie crumb|cookie edge|dark chocolate/i.test(name)) return;
    const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    if (c.x > 3.2 && c.x < 5.7 && c.y > 1.8 && c.y < 2.15 && c.z > 0.0 && c.z < 0.7) {
      belt.add(mesh);
      if (/cookie edge/i.test(name)) centres.push(c);
    }
  });

  collectGltf(root, s, d, (mesh, mat) => {
    if (/steam/i.test(mat.name)) return { skip: true }; // replaced by animated puffs (life.ts)
    // The door's plank grooves are 0.015 wide: under half a pixel at normal zoom, so as geometry they
    // flicker in and out with every camera nudge. The post shader draws them instead (DOOR_GROOVES).
    if (/^Door[ _]plank[ _]groove/i.test(mesh.name)) return { skip: true };
    if (/^Golden[ _]oak[ _]arched[ _]door/i.test(mesh.name)) return { flag: FLAG.GROOVED };
    if (belt.has(mesh)) {
      const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      const home = centres.reduce((a, b) => (Math.hypot(b.x - c.x, b.z - c.z) < Math.hypot(a.x - c.x, a.z - c.z) ? b : a));
      return { flag: FLAG.NORMAL, motion: motion.conveyor(home.toArray() as Vec3, BELT.startX, BELT.length, BELT.speed) };
    }
  });
}
