import type * as THREE from 'three';
import type { SceneFluids } from './fluids';

/** Shader capacities, chosen before collecting fluids and constructing a renderer. All are positive integers. */
export interface RendererLimits {
  lamps: number;
  grooves: number;
  fluidMaterials: number;
  fluidSources: number;
}

export const DEFAULT_LIMITS: Readonly<RendererLimits> = Object.freeze({ lamps: 64, grooves: 8, fluidMaterials: 8, fluidSources: 8 });
/** Default capacities, retained for callers that use the original name. */
export const LIMITS = DEFAULT_LIMITS;

/** Fill omitted capacities with defaults and take an immutable copy. Larger budgets need more GPU uniforms. */
export function resolveLimits(overrides: Partial<RendererLimits> = {}): Readonly<RendererLimits> {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(limits) as (keyof RendererLimits)[]) {
    const value = overrides[key] ?? limits[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > 4096) {
      throw new RangeError(`limits.${key} must be a positive integer no greater than 4096`);
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}

/** A light that glows after dusk (window, lantern, oven). Solid static geometry blocks it. */
export interface Lamp {
  position: THREE.Vector3;
  /** Linear RGB. Tints the lit surfaces; the brightest channel sets the hue, not the strength. */
  color: [number, number, number];
  /** Distance at which the light fades to nothing. Distance below the lamp counts half, so a raised lamp reaches the ground. */
  radius: number;
  /**
   * Geometry closer than this to the lamp is its own fixture (lantern base, shade) and casts no lamp shadow.
   * Default 0.45 m. Lower it for a lamp mounted close to a wall or ceiling that must still block it.
   */
  clearance?: number;
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
  /** Water and other fluids: surfaces, their materials and the spots that stir them (see fluids.ts). */
  fluids: SceneFluids;
  grooves: Grooves | null;
  /** Region the sun's shadow map covers: a square of half-size `radius` around `center`. */
  shadow: { center: THREE.Vector3; radius: number };
  stats: { triangles: number; paletteColors: number };
}
