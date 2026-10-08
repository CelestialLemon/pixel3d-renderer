import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PixelObject } from 'pixel3d-renderer';
import * as THREE from 'three';

// A PixelObject comes from PixelRenderer.addObject (WebGL); its look properties need no renderer.
const object = () => new PixelObject(null as never, 1, () => {}, () => true);

test('tint, opacity and castShadow default to the plain look', () => {
  const o = object();
  assert.equal(o.tint, null);
  assert.equal(o.tintStrength, 0.5);
  assert.equal(o.opacity, 1);
  assert.equal(o.castShadow, true);
});

test('opacity and tintStrength take 0 to 1 and reject anything else', () => {
  const o = object();
  for (const v of [0, 0.25, 1]) { o.opacity = v; o.tintStrength = v; assert.equal(o.opacity, v); assert.equal(o.tintStrength, v); }
  for (const v of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => { o.opacity = v; }, RangeError);
    assert.throws(() => { o.tintStrength = v; }, RangeError);
  }
  assert.equal(o.opacity, 1); assert.equal(o.tintStrength, 1);   // a rejected value changes nothing
  o.tint = new THREE.Color(0x44ff44);
  assert.ok(o.tint instanceof THREE.Color);
});
