import type * as THREE from 'three';

/** Shader limits on the per-scene arrays below. Keep in sync with shaders/post.ts. */
export const LIMITS = { lamps: 8, ripples: 4, grooves: 8 } as const;

/** A warm light that glows after dusk (window, lantern, oven). */
export interface Lamp {
  position: THREE.Vector3;
  /** Linear RGB. Passed to the shader but not used yet: lamp light is one fixed warm tint for now. */
  color: [number, number, number];
  /** Distance at which the light fades to nothing. */
  radius: number;
}

/**
 * Fixed groove lines on surfaces flagged GROOVED (door planks). Drawn by the post shader at exactly one screen
 * pixel wide, so they cannot flicker the way sub-pixel geometry does. A stopgap: see docs/ROADMAP.md.
 */
export interface Grooves {
  /** World direction the positions are measured along (unit vector). */
  axis: [number, number, number];
  /** Groove positions along `axis`. */
  positions: number[];
  /** World height range the grooves cover. */
  yRange: [number, number];
}

/** Everything the renderer needs to draw a scene. Scene modules (src/scenes/) build these. */
export interface PixelScene {
  /** World-space triangles with aColor and aFlag (see GeometryCollector). Never moves. */
  staticGeometry: THREE.BufferGeometry;
  /** Moving triangles, also with aMode, aAnchor and aAnim (see motion.ts). Animated on the GPU every frame. */
  dynamicGeometry: THREE.BufferGeometry;
  lamps: Lamp[];
  /** Centres (world x, z) of expanding drip rings on WATER surfaces. */
  ripples: [number, number][];
  grooves: Grooves | null;
  /** Region the sun's shadow map covers: a square of half-size `radius` around `center`. */
  shadow: { center: THREE.Vector3; radius: number };
  stats: { triangles: number; paletteColors: number };
}
