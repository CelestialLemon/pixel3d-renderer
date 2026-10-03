import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { flip } from './geometry';
import { LIMITS } from './scene';

// Fluids: water, ponds, acid, lava. A fluid surface is not part of the opaque world: it is rasterised into its own
// small G-buffer after the opaque one, and a composite pass (shaders/water.ts) draws it over the post-shaded image,
// so what lies under it (a canal bed, steps, a sunken cart) shows through by the fluid's clarity, and what stands
// above it reflects in it. How a fluid looks comes from its FluidMaterial; how it moves comes from its flow.

/** How a fluid looks. Colours are sRGB hex, like the rest of the scene code. */
export interface FluidMaterial {
  /** Colour over a shallow, light bed, and the body colour once it is too deep to see through. */
  shallow: number; deep: number;
  /** Depth (m, along the view ray) over which the bed fades to about a third. Large for clear water, small for murk. */
  clarity: number;
  /** 0..1: how strongly the calm surface mirrors the world. Turbulence lowers it. */
  reflectivity: number;
  /** 0..1: how choppy the surface is with no flow at all (0 is a mirror). Flow and turbulence add to it. */
  roughness: number;
  /** Wavelength (m) of the main ripple pattern. */
  waveScale: number;
  /** Foam colour, and 0..1 how readily the fluid foams where it is disturbed (obstacles, falls, sources, fast flow). */
  foam: number; foamAmount: number;
  /** 0..1: self-lit (acid, lava). The body keeps its colour in the dark and glows. */
  emission: number;
}

/** Ready-made fluids. Spread one and override a field for a variant: `{ ...FLUIDS.water, deep: 0x113355 }`. */
export const FLUIDS = {
  /** Clear fresh water: fountains, streams, shallow pools. */
  water: { shallow: 0x7cc4cc, deep: 0x245a7c, clarity: 1.4, reflectivity: 0.55, roughness: 0.15, waveScale: 0.9, foam: 0xe8f4f4, foamAmount: 0.8, emission: 0 },
  /** A town canal: greener, darker, cloudy. */
  canal: { shallow: 0x3d8a7e, deep: 0x1b5068, clarity: 0.5, reflectivity: 0.6, roughness: 0.12, waveScale: 1.4, foam: 0xd8e6e2, foamAmount: 0.6, emission: 0 },
  /** A still pond: a dark, brown-green mirror. */
  pond: { shallow: 0x55704c, deep: 0x203a38, clarity: 0.45, reflectivity: 0.7, roughness: 0.03, waveScale: 0.8, foam: 0xcfd8c8, foamAmount: 0.3, emission: 0 },
  /** A bog: nearly opaque, dull, sluggish. */
  swamp: { shallow: 0x5e6c36, deep: 0x2c3420, clarity: 0.15, reflectivity: 0.25, roughness: 0.08, waveScale: 0.7, foam: 0x9aa070, foamAmount: 0.4, emission: 0 },
  /** Toxic acid: glows a little and froths readily. */
  acid: { shallow: 0xb8f04a, deep: 0x4c9a1c, clarity: 0.35, reflectivity: 0.35, roughness: 0.1, waveScale: 0.6, foam: 0xeaffb0, foamAmount: 1, emission: 0.45 },
  /** Lava: opaque and self-lit, with a dark crust where it is disturbed, and no mirror. */
  lava: { shallow: 0xffb03a, deep: 0xc8361a, clarity: 0.05, reflectivity: 0.04, roughness: 0.3, waveScale: 1.6, foam: 0x3a2018, foamAmount: 0.9, emission: 1 },
} satisfies Record<string, FluidMaterial>;

export type FluidPreset = keyof typeof FLUIDS;

/**
 * A spot that keeps a fluid stirred: a drip, the foot of a jet, a mill wheel. It adds turbulence (rougher surface, foam)
 * within `radius` m, scaled by `strength` (0..1); `rings` also sends expanding rings out from it. It stirs pools only, never
 * falling sheets. With `y` (the height of the water surface it stirs) it touches only pool surfaces within 5 cm of that
 * height, so a drip in a lower basin leaves a pool above it alone; without `y` it stirs pools at any height. It is not tied
 * to one body of water: a separate pool at the same height within `radius` is stirred too.
 */
export interface FluidSource { x: number; z: number; y?: number; radius: number; strength: number; rings: boolean }

/** A scene's fluids, as the renderer takes them (FluidCollector builds this). */
export interface SceneFluids {
  /**
   * World-space, non-indexed triangles with position, normal, `aFlow` (vec3: the surface's velocity in m/s, world space)
   * and `aFluid` (float: index into `materials`).
   */
  geometry: THREE.BufferGeometry;
  materials: FluidMaterial[];
  sources: FluidSource[];
}

const materialKey = (m: FluidMaterial) =>
  [m.shallow, m.deep, m.clarity, m.reflectivity, m.roughness, m.waveScale, m.foam, m.foamAmount, m.emission].join(',');

/** Below this |normal.y| a fluid triangle counts as falling (a jet, a spill, a waterfall) rather than a pool. */
export const POOL_NORMAL_Y = 0.95;

/**
 * Gathers fluid surfaces. A pool (a surface facing up within ~18°) moves with the flow it was added with (vx, vz in m/s;
 * leave it out for still water). A sloped or upright surface (a jet, a spill, a waterfall) runs straight down its own
 * slope at `fall` m/s, so modelled falling water needs no flow data.
 */
export class FluidCollector {
  private parts: THREE.BufferGeometry[] = [];
  private materials: FluidMaterial[] = [];
  private keys: string[] = [];
  private sources: FluidSource[] = [];

  add(src: THREE.BufferGeometry, m: THREE.Matrix4 | null, material: FluidMaterial, flow: [number, number] = [0, 0], fall = 2.4) {
    // Equal materials share a slot, so a variant spread inline at every call (`{ ...FLUIDS.water, deep }`) uses only one.
    const key = materialKey(material);
    let slot = this.keys.indexOf(key);
    if (slot < 0) {
      if (this.materials.length >= LIMITS.fluidMaterials) throw new Error(`At most ${LIMITS.fluidMaterials} different fluid materials per scene`);
      slot = this.materials.length; this.materials.push(material); this.keys.push(key);
    }
    const g = src.index ? src.toNonIndexed() : src.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    if (m) { g.applyMatrix4(m); if (m.determinant() < 0) flip(g); }
    g.computeVertexNormals();
    const pos = g.attributes.position, n = pos.count, vel = new Float32Array(n * 3), id = new Float32Array(n).fill(slot);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3(), v = new THREE.Vector3();
    for (let t = 0; t + 2 < n; t += 3) {
      a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2);
      nrm.subVectors(b, a).cross(c.sub(a)).normalize();
      if (Math.abs(nrm.y) >= POOL_NORMAL_Y) v.set(flow[0], 0, flow[1]);
      else v.set(0, -1, 0).addScaledVector(nrm, nrm.y).normalize().multiplyScalar(fall);   // gravity along the surface
      for (let k = (t * 3); k < (t + 3) * 3; k += 3) { vel[k] = v.x; vel[k + 1] = v.y; vel[k + 2] = v.z; }
    }
    g.setAttribute('aFlow', new THREE.BufferAttribute(vel, 3));
    g.setAttribute('aFluid', new THREE.BufferAttribute(id, 1));
    this.parts.push(g);
  }

  /** Add a stirred spot (see FluidSource). */
  source(x: number, z: number, { y, radius = 0.6, strength = 1, rings = true }: Partial<Omit<FluidSource, 'x' | 'z'>> = {}) {
    if (this.sources.length >= LIMITS.fluidSources) throw new Error(`At most ${LIMITS.fluidSources} fluid sources per scene`);
    this.sources.push({ x, z, y, radius, strength, rings });
  }

  build(): SceneFluids {
    let geometry: THREE.BufferGeometry;
    if (this.parts.length) geometry = mergeGeometries(this.parts, false)!;
    else {
      geometry = new THREE.BufferGeometry();
      for (const [k, size] of [['position', 3], ['normal', 3], ['aFlow', 3], ['aFluid', 1]] as const) geometry.setAttribute(k, new THREE.BufferAttribute(new Float32Array(0), size));
    }
    return { geometry, materials: [...this.materials], sources: [...this.sources] };
  }
}

/** The preset a `water_` asset name asks for: `water_acid_pool` is acid, plain `water_spill` is water. */
export function fluidFromName(name: string): FluidMaterial {
  const m = /^water_([a-z]+)_/i.exec(name);
  const key = m?.[1].toLowerCase();
  return key && Object.hasOwn(FLUIDS, key) ? FLUIDS[key as FluidPreset] : FLUIDS.water;   // own keys only: not 'toString'
}
