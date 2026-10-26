import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FLAG, GeometryCollector, glassMeshRule, namedMeshRule, place, splitGlass, thin, collectGltf } from 'pixel3d-renderer';

const box = new THREE.BoxGeometry(1, 1, 1);

test('splitGlass separates the glass triangles and keeps every attribute', () => {
  const c = new GeometryCollector(true);
  c.add(box, place(0, 0, 0), [1, 0, 0]);
  c.add(box, place(2, 0, 0), [0, 1, 0], FLAG.GLASS);
  c.add(box, place(4, 0, 0), [0, 0, 1], thin(FLAG.GLASS));   // the thin mark does not make it less glass
  const g = c.build(), triangles = g.getAttribute('position').count / 3;
  const { solid, glass } = splitGlass(g);
  assert.ok(glass);
  assert.equal(solid.getAttribute('position').count / 3, triangles / 3);
  assert.equal(glass.getAttribute('position').count / 3, 2 * triangles / 3);
  for (const k of Object.keys(g.attributes)) {
    assert.equal(glass.getAttribute(k).itemSize, g.getAttribute(k).itemSize, k);
    assert.equal(glass.getAttribute(k).count, glass.getAttribute('position').count, k);
    assert.equal(solid.getAttribute(k).count, solid.getAttribute('position').count, k);
  }
  const flags = [...glass.getAttribute('aFlag').array].map(Math.round);
  assert.ok(flags.every((f) => f === FLAG.GLASS));
  assert.ok([...solid.getAttribute('aFlag').array].every((f) => f === FLAG.NORMAL));
});

test('a geometry without glass comes back as it is', () => {
  const c = new GeometryCollector();
  c.add(box, place(0, 0, 0), [1, 0, 0]);
  const g = c.build();
  const { solid, glass } = splitGlass(g);
  assert.equal(solid, g);
  assert.equal(glass, null);
  assert.equal(splitGlass(new GeometryCollector().build()).glass, null);
});

test('only glassMeshRule draws glass_ meshes; namedMeshRule still skips them', () => {
  const mesh = (name: string) => Object.assign(new THREE.Mesh(box, new THREE.MeshStandardMaterial()), { name });
  assert.deepEqual(namedMeshRule(mesh('glass_roof')), { skip: true });
  assert.deepEqual(glassMeshRule(mesh('glass_roof')), { flag: FLAG.GLASS });
  assert.deepEqual(glassMeshRule(mesh('Glass_Roof.001')), { flag: FLAG.GLASS });
  assert.deepEqual(glassMeshRule(mesh('decor_grass')), { flag: FLAG.DECOR });
  assert.equal(glassMeshRule(mesh('wall')), undefined);
});

test('collectGltf puts glass in the static collector and refuses glass that moves', () => {
  const root = new THREE.Group().add(Object.assign(new THREE.Mesh(box, new THREE.MeshStandardMaterial()), { name: 'glass_roof' }));
  root.updateMatrixWorld(true);
  const s = new GeometryCollector(), d = new GeometryCollector(true);
  collectGltf(root, s, d, glassMeshRule);
  const { glass } = splitGlass(s.build());
  assert.equal(glass?.getAttribute('position').count, 36);
  assert.equal(d.build().getAttribute('position').count, 0);
  assert.throws(() => collectGltf(root, s, d, (m) => ({ ...glassMeshRule(m), motion: { mode: 6, anim: [0, 1, 0, 1] } as never })), /glass/);
});

test('splitGlass splits only the draw range', () => {
  const c = new GeometryCollector();
  c.add(box, place(0, 0, 0), [1, 0, 0]);
  c.add(box, place(2, 0, 0), [0, 1, 0], FLAG.GLASS);
  const g = c.build();
  g.setDrawRange(36, 36);   // the glass box only
  const { solid, glass } = splitGlass(g);
  assert.equal(glass?.getAttribute('position').count, 36);
  assert.equal(solid.getAttribute('position').count, 0);
  g.setDrawRange(0, 0);
  assert.equal(splitGlass(g).glass, null);
});

test('splitGlass keeps the draw range of an indexed geometry', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
  g.setAttribute('aFlag', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 7, 7, 7]), 1));
  g.setIndex([0, 1, 2, 3, 4, 5]);
  g.setDrawRange(3, 3);
  const { solid, glass } = splitGlass(g);
  assert.equal(glass?.getAttribute('position').count, 3);
  assert.equal(solid.getAttribute('position').count, 0);
});

test('splitGlass starts triangles at the draw range\'s own offset', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
  g.setAttribute('aFlag', new THREE.BufferAttribute(new Float32Array(6).fill(7), 1));
  g.setDrawRange(1, 3);
  assert.equal(splitGlass(g).glass?.getAttribute('position').count, 3);
});

test('splitGlass clamps a negative draw range start like three.js', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
  g.setAttribute('aFlag', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 7, 7, 7]), 1));
  g.setDrawRange(-1, 7);
  const { solid, glass } = splitGlass(g);
  assert.equal(glass?.getAttribute('position').count, 3);
  assert.equal(solid.getAttribute('position').count, 3);
});

test('splitGlass reads interleaved attributes through their stride and offset', () => {
  const g = new THREE.BufferGeometry();
  // per vertex: x y z, flag
  const buf = new THREE.InterleavedBuffer(new Float32Array([
    1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0,
    4, 5, 6, 7, 4, 5, 6, 7, 4, 5, 6, 7,
  ]), 4);
  g.setAttribute('position', new THREE.InterleavedBufferAttribute(buf, 3, 0));
  g.setAttribute('aFlag', new THREE.InterleavedBufferAttribute(buf, 1, 3));
  const { glass } = splitGlass(g);
  const p = glass!.getAttribute('position');
  assert.deepEqual([p.getX(0), p.getY(0), p.getZ(0)], [4, 5, 6]);
  assert.equal(glass!.getAttribute('aFlag').getX(2), 7);
});

test('splitGlass ends the range at start + count before clamping, and keeps normalized integers', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
  g.setAttribute('aFlag', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 7, 7, 7]), 1));
  g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(18).fill(128), 3, true));
  g.setDrawRange(-3, 6);
  const { solid, glass } = splitGlass(g);
  assert.equal(glass, null);
  assert.equal(solid, g);
  g.setDrawRange(0, 6);
  const r = splitGlass(g);
  assert.equal(r.glass!.getAttribute('color').getX(0), 128 / 255);
  assert.equal(r.solid.getAttribute('color').getX(0), 128 / 255);
});
