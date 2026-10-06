import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FLAG, GeometryCollector, quantizePalette, thin, type RGB } from 'pixel3d-renderer';

/** One flat square of `size` per colour, side by side, collected the way a scene does it. */
function squares(colors: { color: RGB; size?: number; flag?: number }[]) {
  const c = new GeometryCollector();
  colors.forEach(({ color, size = 1, flag = FLAG.NORMAL }, i) => c.add(new THREE.PlaneGeometry(size, size), new THREE.Matrix4().makeTranslation(i * 2, 0, 0), color, flag));
  return c.build();
}
const colorsOf = (g: THREE.BufferGeometry) => {
  const a = g.attributes.aColor, out = new Set<string>();
  for (let i = 0; i < a.count; i++) out.add([a.getX(i), a.getY(i), a.getZ(i)].map((v) => v.toFixed(5)).join(','));
  return out;
};

test('a scene with no more colours than the budget is left untouched', () => {
  const g = squares([{ color: [1, 0, 0] }, { color: [0, 1, 0] }, { color: [0, 0, 1] }]);
  const before = (g.attributes.aColor.array as Float32Array).slice();
  assert.equal(quantizePalette([g], 3), 3);
  assert.deepEqual(g.attributes.aColor.array, before);
});

test('reduces to the budget, consistently across geometries, and is stable when run again', () => {
  const greens = Array.from({ length: 12 }, (_, i) => ({ color: [0.1, 0.3 + i * 0.04, 0.1] as RGB }));
  const a = squares(greens.slice(0, 6)), b = squares(greens.slice(6));
  assert.equal(quantizePalette([a, b], 4), 4);
  const all = new Set([...colorsOf(a), ...colorsOf(b)]);
  assert.equal(all.size, 4);
  const before = [(a.attributes.aColor.array as Float32Array).slice(), (b.attributes.aColor.array as Float32Array).slice()];
  assert.equal(quantizePalette([a, b], 4), 4);
  assert.deepEqual([a.attributes.aColor.array, b.attributes.aColor.array], before);
});

test('a small, clearly different colour keeps its own palette entry (minimax, not area-weighted k-means)', () => {
  const greens = Array.from({ length: 8 }, (_, i) => ({ color: [0.1, 0.3 + i * 0.05, 0.1] as RGB, size: 10 }));
  const g = squares([...greens, { color: [0.9, 0.05, 0.05], size: 0.05 }]);
  quantizePalette([g], 2);
  const a = g.attributes.aColor, last = a.count - 1;
  assert.ok(a.getX(last) > 0.6 && a.getY(last) < 0.2, `the red square became ${[a.getX(last), a.getY(last), a.getZ(last)]}`);
});

test('the same colour under different flags counts twice, but the thin mark is not a separate colour', () => {
  const grey: RGB = [0.5, 0.5, 0.5];
  assert.equal(quantizePalette([squares([{ color: grey }, { color: grey, flag: FLAG.EMISSIVE }])], 8), 2);
  assert.equal(quantizePalette([squares([{ color: grey }, { color: grey, flag: thin(FLAG.NORMAL) }])], 8), 1);
});

test('rejects a palette size that is not a whole number of at least 1', () => {
  const g = squares([{ color: [1, 1, 1] }]);
  for (const k of [0, -3, 2.5, Number.NaN]) assert.throws(() => quantizePalette([g], k), RangeError);
});
