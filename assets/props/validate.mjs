// Validate the exported files through the same Three.js GLTFLoader used by the renderer.
// Run: node assets/props/validate.mjs [prop-id ...]
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Box3, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const root = new URL('../../', import.meta.url);
const requested = process.argv.slice(2);
const names = requested.length ? requested : (await readdir(new URL('public/props/', root)))
  .filter(name => name.endsWith('.glb')).map(name => name.slice(0, -4)).sort();
for (const name of names) {
  const data = await readFile(new URL(`public/props/${name}.glb`, root));
  assert.equal(data.readUInt32LE(0), 0x46546c67, `${name}: GLB header`);
  const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
  assert(!json.images?.length && !json.textures?.length, `${name}: texture-free`);
  assert(!json.cameras?.length && !json.extensions?.KHR_lights_punctual, `${name}: no exported studio rig`);
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  let triangles = 0, meshes = 0, lamps = 0, emissive = 0, thin = 0, spokes = 0;
  const wheels = [];
  gltf.scene.traverse(object => {
    if (object.name.startsWith('move_spin_wheel_')) wheels.push(object);
    if (object.name.startsWith('lamp_')) {
      assert(!object.isMesh, `${name}: lamp is an empty`);
      assert.equal(object.userData.color.length, 3);
      assert(object.userData.color.every(c => Number.isFinite(c) && c >= 0 && c <= 1));
      assert(object.userData.radius > 0);
      lamps++;
    }
    if (!object.isMesh) return;
    meshes++;
    const geometry = object.geometry;
    assert(geometry.attributes.normal, `${name}: normals present`);
    assert(!geometry.attributes.uv, `${name}: no UVs`);
    assert(!geometry.attributes.color, `${name}: no vertex colours`);
    const positions = geometry.attributes.position;
    assert(Array.from(positions.array).every(Number.isFinite), `${name}: finite positions`);
    const index = geometry.index;
    const count = index?.count ?? positions.count;
    assert.equal(count % 3, 0);
    triangles += count / 3;
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    for (let i = 0; i < count; i += 3) {
      a.fromBufferAttribute(positions, index ? index.getX(i) : i);
      b.fromBufferAttribute(positions, index ? index.getX(i+1) : i+1);
      c.fromBufferAttribute(positions, index ? index.getX(i+2) : i+2);
      assert(b.sub(a).cross(c.sub(a)).lengthSq() > 1e-18, `${name}: nondegenerate exported triangles`);
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material.emissive.r + material.emissive.g + material.emissive.b > .05) emissive++;
    }
    if (object.name.startsWith('thin_')) thin++;
    if (object.name.startsWith('thin_spoke_')) {
      spokes++;
      let parent = object.parent;
      while (parent && !parent.name.startsWith('move_spin_wheel_')) parent = parent.parent;
      assert(parent, `${name}: spoke inherits a wheel pivot`);
      assert(object.getWorldPosition(new Vector3()).distanceTo(parent.getWorldPosition(new Vector3())) < 1e-5,
        `${name}: spoke origin matches axle`);
    }
  });
  const bounds = new Box3().setFromObject(gltf.scene);
  assert(bounds.min.y >= -.001, `${name}: above Y-up ground`);
  assert(Math.abs(bounds.getCenter(new Vector3()).x) < .05 && Math.abs(bounds.getCenter(new Vector3()).z) < .05,
    `${name}: centred horizontal bounds`);
  assert(triangles > 0 && triangles <= 5000, `${name}: triangle budget`);
  const metadata = JSON.parse(await readFile(new URL(`assets/props/${name}/metadata.json`, root), 'utf8'));
  assert.equal(triangles, metadata.triangles, `${name}: exported triangle count matches metadata`);
  if (name.startsWith('street_lamp')) {
    assert.equal(lamps, 1);
    assert(emissive >= 4);
  }
  if (name === 'cart') {
    assert.equal(wheels.length, 2);
    assert.equal(spokes, 20);
    for (const wheel of wheels) assert(Math.abs(wheel.getWorldPosition(new Vector3()).y - .46) < 1e-5);
  }
  if (name === 'windmill') {
    const sails = gltf.scene.getObjectByName('move_spin_windmill_sails');
    assert(sails, 'Windmill pivot exported');
    const axis = new Vector3(1,0,0).transformDirection(sails.matrixWorld);
    assert(Math.abs(axis.z) > .999, 'Windmill local X follows the Y-up model shaft');
    let lattice = 0;
    sails.traverse(o => { if (o.name.startsWith('thin_sail_lattice_')) lattice++; });
    assert.equal(lattice, 20);
  }
  if (name === 'well') {
    const bottom = new Raycaster(new Vector3(0,1,0), new Vector3(0,-1,0))
      .intersectObject(gltf.scene, true)[0];
    assert(bottom && bottom.point.y < .1, 'Well centre is hollow down to the recessed bottom');
  }
  if (name === 'stone_arch_bridge') {
    const water = gltf.scene.getObjectByName('water_clear_patch_under_arch');
    assert(water?.isMesh, 'Bridge water surface exported');
    const normal = new Vector3().fromBufferAttribute(water.geometry.attributes.normal, 0).transformDirection(water.matrixWorld);
    assert(normal.y > .999, 'Water faces up');
    const below = new Raycaster(new Vector3(0,.9,0), new Vector3(0,-1,0))
      .intersectObject(gltf.scene, true)[0];
    assert(below && below.object === water, 'Bridge arch is unobstructed above the water');
    const deck = new Raycaster(new Vector3(0,3,0), new Vector3(0,-1,0))
      .intersectObject(gltf.scene,true)[0];
    assert(deck && deck.object.name.startsWith('Arch_deck_') && deck.point.y > 1.3,
      'Bridge has a solid upward-facing deck above the open tunnel');
  }
  if (name === 'shop_front') {
    assert(gltf.scene.getObjectByName('glass_shop_display')?.isMesh);
    assert.equal(lamps, 1);
    assert(emissive > 0);
  }
  console.log(`${name}: ${triangles} triangles, ${meshes} meshes, ${lamps} lamps, ${thin} thin meshes; valid`);
}
console.log(`Validated ${names.length} props in ${fileURLToPath(new URL('public/props/', root))}`);
