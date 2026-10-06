import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { decodeScene, encodeScene, FluidCollector, GeometryCollector, place } from 'pixel3d-renderer';

test('baking preserves partial, empty and unlimited draw ranges for every geometry', () => {
  const collector = new GeometryCollector();
  collector.add(new THREE.BoxGeometry(1, 1, 1), place(0, 0, 0), [1, 1, 1]);
  const staticGeometry = collector.build();
  staticGeometry.setDrawRange(3, 3);
  const dynamicGeometry = new GeometryCollector(true).build();
  dynamicGeometry.setDrawRange(0, 0);
  const fluids = new FluidCollector().build();
  fluids.geometry.setDrawRange(0, 0);
  const limited = new THREE.BoxGeometry(1, 1, 1);
  limited.setDrawRange(6, 6);
  const unlimited = new THREE.BoxGeometry(1, 1, 1);
  const encoded = encodeScene({ staticGeometry, dynamicGeometry, fluids,
    objectGeometries: { limited, unlimited }, shadow: { center: new THREE.Vector3(), radius: 2 } });
  const decoded = decodeScene(encoded);
  assert.deepEqual(decoded.staticGeometry.drawRange, { start: 3, count: 3 });
  assert.deepEqual(decoded.dynamicGeometry.drawRange, { start: 0, count: 0 });
  assert.deepEqual(decoded.fluids.geometry.drawRange, { start: 0, count: 0 });
  assert.deepEqual(decoded.objectGeometries!.limited.drawRange, { start: 6, count: 6 });
  assert.deepEqual(decoded.objectGeometries!.unlimited.drawRange, { start: 0, count: Infinity });
  assert.deepEqual(Buffer.from(encodeScene(decoded)), Buffer.from(encoded), 're-encoding preserves exact bytes');
});
