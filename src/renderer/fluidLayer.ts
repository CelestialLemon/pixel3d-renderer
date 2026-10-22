import * as THREE from 'three';
import { FluidCollector, materialKey, type FluidMaterial } from './fluids';

// Fluids the game changes while it plays (`PixelRenderer.addFluid`): a flood that rises and drains, ice that forms and melts.
// The baked scene's fluids (fluids.ts) are fixed when it is built; a PixelFluid is a layer on top of them that the game owns.
// Each is a set of surfaces with one material, drawn into the same fluid pass, so they mirror, show the bed, take lamps and
// hide behind the opaque world exactly as the baked ones do. Opaque ground in front of a layer hides it (by the usual
// depth test), so a flood's edge follows the terrain without the game working it out.

/** Added to a layer surface's material slot in the fluid G-buffer: tells the water shader not to look it up in the baked flow map. */
export const LAYER_SLOT = 4096;

/**
 * A grid of square cells on the ground, each with a water surface height or none: what a tile game has. Cell (col, row)
 * covers x from `x + col * cell` to `x + (col + 1) * cell` and z from `z + row * cell` to `z + (row + 1) * cell`, and its
 * height is `heights[row * cols + col]`: a finite number (metres, world y) for a surface, NaN or infinite for none.
 */
export interface FluidCells {
  /** World x and z of the grid's lowest corner (the corner of cell 0, 0). */
  x: number; z: number;
  /** Side of a cell, in metres. */
  cell: number;
  cols: number; rows: number;
  heights: ArrayLike<number>;
}

/** Surfaces of a layer: world-space triangles, and what the fluid pass reads. */
export interface LayerSurfaces {
  position: Float32Array; normal: Float32Array; flow: Float32Array;
}

/** The empty set of surfaces. */
export const NO_SURFACES: LayerSurfaces = { position: new Float32Array(0), normal: new Float32Array(0), flow: new Float32Array(0) };

/**
 * Triangles for a grid of cells: runs of neighbouring cells along x at the same height (within a millimetre) become one
 * rectangle. Throws a RangeError for a grid that is not valid. `flow` (m/s, world x and z) is the current on every surface.
 */
export function cellsSurfaces(cells: FluidCells, flow: readonly [number, number] = [0, 0]): LayerSurfaces {
  const { x, z, cell, cols, rows, heights } = cells;
  if (![x, z].every(Number.isFinite)) throw new RangeError('FluidCells: x and z must be finite numbers');
  if (!(cell > 0) || !Number.isFinite(cell)) throw new RangeError(`FluidCells: cell must be a positive number, got ${String(cell)}`);
  for (const [name, n] of [['cols', cols], ['rows', rows]] as const) {
    if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`FluidCells: ${name} must be a positive integer, got ${String(n)}`);
  }
  if (!heights || !(heights.length >= cols * rows)) throw new RangeError(`FluidCells: heights needs ${cols * rows} entries (cols x rows), got ${heights?.length}`);
  const rects: number[] = [];   // x0, x1, z0, z1, y
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols;) {
      const y = heights[row * cols + col];
      if (!Number.isFinite(y)) { col++; continue; }
      let end = col + 1;
      while (end < cols && Math.abs(heights[row * cols + end] - y) < 1e-3) end++;
      rects.push(x + col * cell, x + end * cell, z + row * cell, z + (row + 1) * cell, y);
      col = end;
    }
  }
  const n = rects.length / 5, position = new Float32Array(n * 18), normal = new Float32Array(n * 18), vel = new Float32Array(n * 18);
  for (let r = 0; r < n; r++) {
    const [x0, x1, z0, z1, y] = rects.slice(r * 5, r * 5 + 5);
    position.set([x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0], r * 18);
    for (let v = 0; v < 6; v++) { normal[r * 18 + v * 3 + 1] = 1; vel[r * 18 + v * 3] = flow[0]; vel[r * 18 + v * 3 + 2] = flow[1]; }
  }
  return { position, normal, flow: vel };
}

/**
 * Triangles for any geometry (non-indexed or indexed, in world space; flat-shaded normals are computed). A surface facing up
 * moves with `flow`, a sloped or upright one (a spill, a waterfall) runs down its own slope at `fall` m/s, as in `FluidCollector`.
 */
export function geometrySurfaces(geometry: THREE.BufferGeometry, flow: readonly [number, number] = [0, 0], fall = 2.4): LayerSurfaces {
  if (!geometry.getAttribute('position')) throw new RangeError('addFluid: the geometry has no position attribute');
  const c = new FluidCollector({ fluidMaterials: 1 });
  c.add(geometry, null, { shallow: 0, deep: 0, clarity: 1, reflectivity: 0, roughness: 0, waveScale: 1, foam: 0, foamAmount: 0, emission: 0 }, [flow[0], flow[1]], fall);
  const g = c.build().geometry;
  const floats = (name: string) => {   // decoded: a normalized or integer attribute holds raw integers in `.array`
    const a = g.getAttribute(name), out = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) { out[i * 3] = a.getX(i); out[i * 3 + 1] = a.getY(i); out[i * 3 + 2] = a.getZ(i); }
    return out;
  };
  return { position: floats('position'), normal: floats('normal'), flow: floats('aFlow') };
}

/** @internal What a PixelFluid asks of its renderer. */
export interface FluidHost {
  /** Claim a slot for the material, or throw if the table is full. */
  setMaterial(layer: PixelFluid, material: FluidMaterial): void;
  /** The layer's surfaces changed. */
  changed(layer: PixelFluid): void;
  detach(layer: PixelFluid): void;
}

/**
 * A layer of fluid the game changes while it plays, added with `PixelRenderer.addFluid`. It holds a set of surfaces with
 * one material. Change the surfaces (`setCells`, `setGeometry`, `clear`) when the shape changes, a few times a minute at
 * most; move the whole layer up and down (`y`) and show or hide it as often as you like, every frame if you like.
 *
 * A flood: one layer with a flood material over the cells the flood can reach, `y` the water level, rising and falling;
 * ground higher than the level hides it, so the shore follows the terrain. Freezing: another layer with `FLUIDS.ice` over
 * the quiet stretches of river, a hair above the water (at least 2 cm, so the two never fight over a pixel), shown and hidden
 * as the cold comes and goes, or grown cell by cell from the banks with `setCells`.
 *
 * Layers know nothing of the baked scene's flow map: a layer's current is the `flow` it is given, with no deflection round
 * banks and no foam along them. A frozen material (`FluidMaterial.frozen`) never moves.
 */
export class PixelFluid {
  /** Added to the height of every surface, in metres. Read at each `renderGeometry`. Default 0. */
  y = 0;
  /** Draw the layer (default true). Read at each `renderGeometry`. */
  visible = true;

  /** @internal The surfaces now, and how many triangles they make. */
  surfaces: LayerSurfaces = NO_SURFACES;
  /** @internal The slot of the material in the renderer's table, set by the renderer. */
  slot = 0;
  private current: FluidMaterial;
  private removed = false;
  private readonly host: FluidHost;

  /** @internal Created by `PixelRenderer.addFluid`. */
  constructor(host: FluidHost, material: FluidMaterial) { this.host = host; this.current = material; }

  /** How the layer looks. Changing it (water to ice) is cheap. At most `limits.fluidMaterials` different materials fit, the scene's and every layer's together; one more throws a RangeError and changes nothing. */
  get material(): FluidMaterial { return this.current; }
  set material(m: FluidMaterial) {
    if (this.removed) return;
    if (materialKey(m) !== materialKey(this.current)) this.host.setMaterial(this, m);
    this.current = m;
  }

  /** The number of triangles drawn. */
  get triangles() { return this.surfaces.position.length / 9; }

  /** Replace the surfaces with a grid of cells (see `FluidCells`). `flow` is the current in m/s along x and z. Throws a RangeError for an invalid grid and changes nothing. */
  setCells(cells: FluidCells, flow: readonly [number, number] = [0, 0]): this {
    this.surfaces = cellsSurfaces(cells, flow);
    if (!this.removed) this.host.changed(this);
    return this;
  }

  /** Replace the surfaces with a geometry in world space (only its positions are read; see `geometrySurfaces`). The geometry stays the caller's. */
  setGeometry(geometry: THREE.BufferGeometry, flow: readonly [number, number] = [0, 0], fall = 2.4): this {
    this.surfaces = geometrySurfaces(geometry, flow, fall);
    if (!this.removed) this.host.changed(this);
    return this;
  }

  /** Remove every surface (the layer stays, empty). */
  clear(): this {
    this.surfaces = NO_SURFACES;
    if (!this.removed) this.host.changed(this);
    return this;
  }

  /** Take the layer out of the renderer. It can't be used again (changes do nothing). */
  remove() {
    if (this.removed) return;
    this.removed = true; this.surfaces = NO_SURFACES;
    this.host.detach(this);
  }
}
