import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FluidCollector, FLUIDS, PixelFluid, type FluidCells } from 'pixel3d-renderer';

// A layer's surfaces, as the renderer reads them (internal), and what a renderer would be asked.
type Surfaces = { position: Float32Array; normal: Float32Array; flow: Float32Array };
type Host = ConstructorParameters<typeof PixelFluid>[0];
const tris = (s: Surfaces) => s.position.length / 9;
const layer = () => new PixelFluid({ setMaterial() {}, changed() {}, detach() {} } as unknown as Host, FLUIDS.flood);
const surfacesOf = (l: PixelFluid) => (l as unknown as { surfaces: Surfaces }).surfaces;
const cellsSurfaces = (cells: FluidCells, flow?: [number, number]) => surfacesOf(layer().setCells(cells, flow));
const geometrySurfaces = (g: THREE.BufferGeometry, flow?: [number, number], fall?: number) => surfacesOf(layer().setGeometry(g, flow, fall));

test('cells become rectangles, one per run of equal height along x', () => {
  const nan = Number.NaN;
  // Row 0: 3 cells at 0.5, a gap, 1 cell at 0.5. Row 1: 2 cells at 0, then 2 at 0.2 (a different height: a new run).
  const s = cellsSurfaces({ x: 10, z: -2, cell: 2, cols: 5, rows: 2, heights: [0.5, 0.5, 0.5, nan, 0.5, 0, 0, 0.2, 0.2, Number.POSITIVE_INFINITY] }, [0.3, -0.1]);
  assert.equal(tris(s), 2 * 4, 'four rectangles, two triangles each');
  const xs = Array.from({ length: s.position.length / 3 }, (_, i) => s.position[i * 3]);
  assert.equal(Math.min(...xs), 10);
  assert.equal(Math.max(...xs), 20, 'the gap and the last cell end at x + cols * cell');
  // The first rectangle: x 10..16, z -2..0, at y 0.5, facing up, moving with the flow.
  assert.deepEqual(Array.from(s.position.slice(0, 18)), [10, 0.5, -2, 10, 0.5, 0, 16, 0.5, 0, 10, 0.5, -2, 16, 0.5, 0, 16, 0.5, -2]);
  for (let v = 0; v < s.normal.length / 3; v++) {
    assert.deepEqual([s.normal[v * 3], s.normal[v * 3 + 1], s.normal[v * 3 + 2]], [0, 1, 0]);
    assert.ok(Math.abs(s.flow[v * 3] - 0.3) < 1e-6 && Math.abs(s.flow[v * 3 + 2] + 0.1) < 1e-6 && s.flow[v * 3 + 1] === 0);
  }
  // Both triangles of a rectangle wind the same way (counter-clockwise seen from above), so it is not inside out.
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < tris(s); t++) {
    a.fromArray(s.position, t * 9); b.fromArray(s.position, t * 9 + 3); c.fromArray(s.position, t * 9 + 6);
    assert.ok(b.sub(a).cross(c.sub(a)).y > 0, `triangle ${t} faces up`);
  }
});

test('no cells, no triangles; heights that differ by less than a millimetre merge', () => {
  assert.equal(tris(cellsSurfaces({ x: 0, z: 0, cell: 1, cols: 2, rows: 1, heights: [Number.NaN, Number.NaN] })), 0);
  assert.equal(tris(cellsSurfaces({ x: 0, z: 0, cell: 1, cols: 2, rows: 1, heights: [1, 1.0004] })), 2);
  assert.equal(tris(cellsSurfaces({ x: 0, z: 0, cell: 1, cols: 2, rows: 1, heights: [1, 1.01] })), 4);
  const typed = cellsSurfaces({ x: 0, z: 0, cell: 1, cols: 1, rows: 1, heights: new Float32Array([2]) });
  assert.equal(tris(typed), 2);
});

test('an invalid grid throws a RangeError', () => {
  const ok = { x: 0, z: 0, cell: 1, cols: 2, rows: 2, heights: [0, 0, 0, 0] };
  for (const bad of [{ cell: 0 }, { cell: -1 }, { cell: Number.NaN }, { cols: 0 }, { rows: 1.5 }, { cols: 3 }, { x: Number.NaN }, { z: Number.POSITIVE_INFINITY }, { heights: undefined }]) {
    assert.throws(() => cellsSurfaces({ ...ok, ...bad } as never), RangeError, JSON.stringify(bad));
  }
  assert.throws(() => geometrySurfaces(new THREE.BufferGeometry()), RangeError);
});

test('a geometry becomes surfaces: pools take the flow, a falling sheet runs down its slope', () => {
  const pool = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), sheet = new THREE.PlaneGeometry(2, 1).rotateY(Math.PI / 2);
  const p = geometrySurfaces(pool, [1, 0]);
  assert.equal(tris(p), 2);
  assert.ok(Math.abs(p.normal[1]) > 0.99 && p.flow[0] === 1 && p.flow[1] === 0);
  const f = geometrySurfaces(sheet, [1, 0], 3);
  assert.ok(f.flow[1] < -2.9 && Math.abs(f.flow[0]) < 1e-6, 'it falls');
});

test('a layer hands changes to its renderer, and a removed one does nothing', () => {
  const log: string[] = [];
  const host = {
    setMaterial: (_l: unknown, m: unknown) => { if (m === FLUIDS.acid) throw new RangeError('full'); log.push('material'); },
    changed: () => log.push('changed'),
    detach: () => log.push('detach'),
  };
  const l = new PixelFluid(host as unknown as Host, FLUIDS.flood);
  assert.deepEqual([l.y, l.visible, l.triangles], [0, true, 0]);
  l.setCells({ x: 0, z: 0, cell: 1, cols: 1, rows: 1, heights: [0] });
  assert.equal(l.triangles, 2);
  l.material = FLUIDS.ice;
  assert.equal(l.material, FLUIDS.ice);
  l.material = { ...FLUIDS.ice };   // an equal material needs no new slot
  assert.deepEqual(log, ['changed', 'material']);
  assert.throws(() => { l.material = FLUIDS.acid; }, RangeError);
  assert.equal(l.material.frozen, 1, 'a refused material changes nothing');
  assert.throws(() => l.setCells({ x: 0, z: 0, cell: 0, cols: 1, rows: 1, heights: [0] }), RangeError);
  assert.equal(l.triangles, 2, 'a refused grid changes nothing');
  l.clear();
  assert.equal(l.triangles, 0);
  l.remove(); l.remove();
  assert.equal(log.filter((e) => e === 'detach').length, 1);
  l.setCells({ x: 0, z: 0, cell: 1, cols: 1, rows: 1, heights: [0] });
  assert.equal(log.at(-1), 'detach', 'a removed layer never reaches the renderer again');
});

test('ice is its own material, and frozen counts in what makes two materials equal', () => {
  assert.equal(FLUIDS.ice.frozen, 1);
  const g = new THREE.PlaneGeometry(1, 1), f = new FluidCollector();
  f.add(g, null, FLUIDS.ice); f.add(g, null, { ...FLUIDS.ice, frozen: 0 }); f.add(g, null, { ...FLUIDS.water }); f.add(g, null, { ...FLUIDS.water, frozen: 0 });
  assert.equal(f.build().materials.length, 3, 'ice, ice that is not frozen, and water (unset is not frozen)');
});

test('a geometry with normalized integer positions is read decoded', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Int16BufferAttribute([-32767, 0, -32767, -32767, 0, 32767, 32767, 0, 32767], 3, true));
  const s = geometrySurfaces(g);
  assert.ok(s.position instanceof Float32Array);
  assert.ok(Math.abs(s.position[0] + 1) < 1e-4 && Math.abs(s.position[8] - 1) < 1e-4, 'decoded to -1..1, not raw integers');
});
