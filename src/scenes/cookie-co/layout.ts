import * as THREE from 'three';
import type { Lamp } from '../../renderer';
import { fbm } from '../shared/random';

// Where things are in the Cookie Co. diorama (model space, y up), and the terrain shape functions
// that the meadow, trees and pond builders share.

export const GROUND_Y = 0.48; // top of the original lawn in the model
// Mown lawn: centre and half extents.
export const LAWN_CX = 0.8;
const LAWN_CZ = 0, LAWN_HX = 5.85, LAWN_HZ = 4.15;
export const CHIMNEY_TOP = new THREE.Vector3(1.92, 6.3, -0.74);
// Pond: centre, radii, rotation.
export const POND = { x: -5.4, z: 6.3, rx: 2.4, rz: 1.6, rot: 0.5 };

// Warm light sources that glow after dusk. Positions sit just in front of the glass.
export const LAMPS: Lamp[] = [
  { position: new THREE.Vector3(-1.86, 2.3, 2.7), color: [1.0, 0.62, 0.22], radius: 3.6 },
  { position: new THREE.Vector3(1.86, 2.3, 2.7), color: [1.0, 0.62, 0.22], radius: 3.6 },
  { position: new THREE.Vector3(0.93, 2.44, 2.75), color: [1.0, 0.7, 0.3], radius: 2.4 },
  { position: new THREE.Vector3(3.8, 2.0, 0.35), color: [1.0, 0.5, 0.15], radius: 2.6 },
];

// Drip rings on the pond.
export const RIPPLES: [number, number][] = [[-6.0, 6.2], [-4.4, 6.7]];

// The front door's five plank grooves (the geometry versions are 0.015 wide, which flickers).
export const DOOR_GROOVES = { axis: [1, 0, 0] as [number, number, number], positions: [-0.4, -0.2, 0, 0.2, 0.4], yRange: [0.72, 2.78] as [number, number] };

// The conveyor the cookies ride out of the oven: starts at x = 3.38, 2.45 long, 0.27 units/s.
export const BELT = { startX: 3.38, length: 2.45, speed: 0.27 };

/** Signed distance to the mown lawn around the factory (negative inside), with a noisy edge. */
export function lawnSdf(x: number, z: number) {
  const qx = Math.abs(x - LAWN_CX) - (LAWN_HX - 1.2), qz = Math.abs(z - LAWN_CZ) - (LAWN_HZ - 1.2);
  const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - 1.2;
  return out + (fbm(x * 0.55, z * 0.55) - 0.5) * 1.4;
}

/** Normalised elliptical distance from the pond centre: below 1 is water. */
export function pondD(x: number, z: number) {
  const c = Math.cos(POND.rot), s = Math.sin(POND.rot), dx = x - POND.x, dz = z - POND.z;
  const u = dx * c + dz * s, v = -dx * s + dz * c;
  return Math.hypot(u / POND.rx, v / POND.rz) + (fbm(x * 0.7 + 9, z * 0.7 - 4) - 0.5) * 0.3;
}

/** Centre line of the dirt path that winds south from the door. */
export const pathX = (z: number) => -0.55 + 1.8 * Math.sin(z * 0.28) * Math.min(1, Math.max(0, (z - 4) / 6));
export const onPath = (x: number, z: number, margin = 0.95) => z > 4 && Math.abs(x - pathX(z)) < margin;
