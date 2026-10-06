import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_LIMITS, FluidCollector, FLUIDS, resolveLimits } from 'pixel3d-renderer';
import * as THREE from 'three';

test('limits default, override per field, and are frozen', () => {
  assert.deepEqual(resolveLimits(), DEFAULT_LIMITS);
  const l = resolveLimits({ lamps: 8 });
  assert.deepEqual(l, { ...DEFAULT_LIMITS, lamps: 8 });
  assert.ok(Object.isFrozen(l));
});

test('limits must be whole numbers from 1 to 4096', () => {
  for (const lamps of [0, -1, 1.5, 4097, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => resolveLimits({ lamps }), RangeError);
});

test('a fluid collector enforces its limits', () => {
  const f = new FluidCollector({ fluidSources: 2, fluidMaterials: 1 });
  f.source(0, 0); f.source(1, 1);
  assert.throws(() => f.source(2, 2));
  const plane = new THREE.PlaneGeometry(1, 1);
  f.add(plane, null, FLUIDS.water);
  f.add(plane, null, { ...FLUIDS.water });   // an equal material shares the slot
  assert.throws(() => f.add(plane, null, FLUIDS.lava));
});
