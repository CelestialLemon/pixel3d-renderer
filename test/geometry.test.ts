import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FLAG, GeometryCollector, linearColor, place, MODE } from 'pixel3d-renderer';

const near = (a: number, b: number, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('linearColor converts sRGB hex to linear', () => {
  assert.deepEqual(linearColor(0xffffff), [1, 1, 1]);
  assert.deepEqual(linearColor(0x000000), [0, 0, 0]);
  near(linearColor(0x808080)[0], 0.21586);
});

test('place composes position, rotation and scale', () => {
  const p = new THREE.Vector3(1, 0, 0).applyMatrix4(place(5, 6, 7, 0, Math.PI / 2, 0, 2));
  near(p.x, 5); near(p.y, 6); near(p.z, 7 - 2);
});

test('add() copies the source as world-space, non-indexed triangles with colour and flag', () => {
  const src = new THREE.BoxGeometry(1, 1, 1), c = new GeometryCollector();
  const srcPositions = (src.attributes.position.array as Float32Array).slice();
  c.add(src, place(10, 0, 0), [0.2, 0.4, 0.6], FLAG.EMISSIVE);
  const g = c.build();
  assert.equal(g.index, null);
  assert.equal(g.attributes.position.count, 36);
  assert.deepEqual(Object.keys(g.attributes).sort(), ['aColor', 'aFlag', 'normal', 'position']);
  for (let i = 0; i < 36; i++) {
    near(g.attributes.position.getX(i), 10 + Math.sign(g.attributes.position.getX(i) - 10) * 0.5);
    assert.deepEqual([g.attributes.aColor.getX(i), g.attributes.aColor.getY(i), g.attributes.aColor.getZ(i)].map((v) => +v.toFixed(5)), [0.2, 0.4, 0.6]);
    assert.equal(g.attributes.aFlag.getX(i), FLAG.EMISSIVE);
  }
  assert.deepEqual(src.attributes.position.array, srcPositions, 'the source geometry is not modified');
});

test('a mirroring transform keeps every triangle facing outward', () => {
  const c = new GeometryCollector();
  c.add(new THREE.BoxGeometry(1, 1, 1), place(0, 0, 0, 0, 0, 0, -1, 1, 1), [1, 1, 1]);
  const g = c.build(), p = g.attributes.position, n = g.attributes.normal;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let t = 0; t < p.count; t += 3) {
    a.fromBufferAttribute(p, t); b.fromBufferAttribute(p, t + 1).sub(a); d.fromBufferAttribute(p, t + 2).sub(a);
    const face = b.cross(d).normalize();
    assert.ok(face.dot(normal.fromBufferAttribute(n, t)) > 0.99, `triangle ${t / 3} winds inward`);
    assert.ok(face.dot(a) > 0, `triangle ${t / 3} faces the box centre`);
  }
});

test('a dynamic collector adds motion attributes, per vertex when the animation is a function', () => {
  const c = new GeometryCollector(true);
  c.add(new THREE.PlaneGeometry(1, 1), null, [1, 1, 1], FLAG.NORMAL, false, { mode: MODE.SWAY, anchor: [1, 2, 3], anim: (x, y) => [x, y, 0, 1] });
  const g = c.build();
  assert.deepEqual(Object.keys(g.attributes).sort(), ['aAnchor', 'aAnim', 'aColor', 'aFlag', 'aMode', 'normal', 'position']);
  for (let i = 0; i < g.attributes.position.count; i++) {
    assert.equal(g.attributes.aMode.getX(i), MODE.SWAY);
    assert.deepEqual([g.attributes.aAnchor.getX(i), g.attributes.aAnchor.getY(i), g.attributes.aAnchor.getZ(i)], [1, 2, 3]);
    assert.equal(g.attributes.aAnim.getX(i), g.attributes.position.getX(i));
    assert.equal(g.attributes.aAnim.getY(i), g.attributes.position.getY(i));
  }
});

test('an empty collector builds an empty geometry with every attribute', () => {
  assert.deepEqual(Object.keys(new GeometryCollector().build().attributes).sort(), ['aColor', 'aFlag', 'normal', 'position']);
  const dyn = new GeometryCollector(true).build();
  assert.equal(dyn.attributes.position.count, 0);
  assert.ok(dyn.attributes.aMode && dyn.attributes.aAnchor && dyn.attributes.aAnim);
});
