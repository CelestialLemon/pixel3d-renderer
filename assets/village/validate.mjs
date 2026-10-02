// Check the actual exported model using the runtime's GLTFLoader and ray geometry.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Box3, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const root = new URL('../../', import.meta.url);
const names = process.argv.slice(2);
if (!names.length) names.push(...(await readdir(new URL('public/village/', root)))
  .filter(n => n.endsWith('.glb')).map(n => n.slice(0,-4)).sort());
for (const name of names) {
  const bytes = await readFile(new URL(`public/village/${name}.glb`, root));
  const metadata = JSON.parse(await readFile(new URL(`assets/village/${name}/metadata.json`,root),'utf8'));
  assert.equal(bytes.readUInt32LE(0),0x46546c67);
  const json = JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  assert(!json.images?.length && !json.textures?.length, `${name}: texture-free`);
  assert(!json.cameras?.length && !json.extensions?.KHR_lights_punctual, `${name}: studio rig absent`);
  const { scene } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  scene.updateMatrixWorld(true);
  let triangles=0, meshes=0, lamps=0, emissive=0;
  const opaque=[],lightNodes=[];
  scene.traverse(obj => {
    if (obj.name.startsWith('lamp_')) {
      assert(!obj.isMesh, `${name}: lamp empty`);
      assert.equal(obj.userData.color.length,3);
      assert(obj.userData.color.every(c=>Number.isFinite(c)&&c>=0&&c<=1));
      assert(obj.userData.radius>0 && obj.userData.clearance>0);
      lamps++;
      lightNodes.push(obj);
    }
    if (!obj.isMesh) return;
    meshes++;
    if (!obj.name.startsWith('glass_')) opaque.push(obj);
    const g=obj.geometry, p=g.attributes.position;
    assert(g.attributes.normal && !g.attributes.uv && !g.attributes.color);
    assert([...p.array].every(Number.isFinite));
    const index=g.index, count=index?.count??p.count;
    assert.equal(count%3,0);
    triangles+=count/3;
    const a=new Vector3(),b=new Vector3(),c=new Vector3();
    for (let i=0;i<count;i+=3) {
      a.fromBufferAttribute(p,index?index.getX(i):i);
      b.fromBufferAttribute(p,index?index.getX(i+1):i+1);
      c.fromBufferAttribute(p,index?index.getX(i+2):i+2);
      assert(b.sub(a).cross(c.sub(a)).lengthSq()>1e-18, `${name}: nondegenerate geometry`);
    }
    for (const mat of Array.isArray(obj.material)?obj.material:[obj.material])
      if (mat.emissive.r+mat.emissive.g+mat.emissive.b>.05) emissive++;
  });
  const bounds=new Box3().setFromObject(scene);
  assert(bounds.min.y>=-.001, `${name}: ground`);
  assert(Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x))<=metadata.footprintMetres[0]/2+.001);
  assert(Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z))<=metadata.footprintMetres[1]/2+.001);
  assert(triangles>0 && triangles<=metadata.triangleBudget);
  assert.equal(triangles,metadata.triangles);
  assert.equal(lamps,metadata.lamps.length);
  if (metadata.maxHeightMetres!==null && metadata.maxHeightMetres!==undefined)
    assert(bounds.max.y<=metadata.maxHeightMetres+.001,`${name}: maximum agreed height`);
  for (const light of lightNodes.filter(o=>o.name.includes('_floor'))) {
    const side=light.name.includes('_left_')?'left':light.name.includes('_right_')?'right':light.name.includes('_back_')?'back':'front';
    const direction={front:new Vector3(0,0,1),back:new Vector3(0,0,-1),left:new Vector3(-1,0,0),right:new Vector3(1,0,0)}[side];
    const p=light.getWorldPosition(new Vector3());
    const outward=new Raycaster(p,direction,0,.65).intersectObjects(opaque,false);
    assert.equal(outward.length,0,`${name}: ${light.name} escapes window aperture`);
    assert(new Raycaster(p,direction.clone().negate(),0,.65).intersectObjects(opaque,false).length>0,
      `${name}: solid interior behind ${light.name}`);
  }
  if (name==='house_A') {
    assert.equal(lamps,2);
    assert(emissive>0);
    // A direct ray exits a real aperture, while its reverse is stopped by the interior.
    const lamp=scene.getObjectByName('lamp_House_A_front_lower_0');
    const position=lamp.getWorldPosition(new Vector3());
    const outward=new Raycaster(position,new Vector3(0,0,1),0,1).intersectObjects(opaque,false);
    assert.equal(outward.length,0,'House_A: window spill escapes through open wall');
    const inward=new Raycaster(position,new Vector3(0,0,-1),0,1).intersectObjects(opaque,false);
    assert(inward.length>0,'House_A: interior blocks inward light');
    assert.equal(scene.getObjectByName('glass_House_A_front_lower_0')?.isMesh,true);
  }
  if (name==='fountain') {
    assert.equal(lamps,1);
    const water=scene.getObjectByName('water_Fountain_basin');
    assert(water?.isMesh);
    const normal=new Vector3().fromBufferAttribute(water.geometry.attributes.normal,0).transformDirection(water.matrixWorld);
    assert(normal.y>.999,'Fountain water faces up');
    const hit=new Raycaster(new Vector3(.9,2.5,0),new Vector3(0,-1,0)).intersectObjects(opaque,false)[0];
    assert(hit?.object===water,'Fountain basin is hollow down to water');
  }
  if (name==='festoon') {
    assert.equal(lamps,0,'Festoon does not consume scene lights');
    assert.equal(emissive,15,'All fifteen festoon bulbs exported');
    assert(scene.getObjectByName('thin_Festoon_sagging_wire')?.isMesh);
  }
  if(name==='clock_tower') {
    assert(bounds.max.y>=12 && bounds.max.y<=14);
    assert.equal(opaque.filter(o=>o.name.startsWith('Clock_tower_emissive_clock_face')).length,4);
  }
  if(name==='tavern') {
    const sign=scene.getObjectByName('move_sway_tavern_tavern_sign');
    assert(sign,'Tavern has pivoted sign');
    let children=0;
    sign.traverse(o=>{if(o!==sign) children++;});
    assert(children>=4,'Sign chains and emblem inherit suspension pivot');
    assert(lightNodes.some(o=>o.name.includes('_left_')),'Square-facing tavern facade casts light');
  }
  if(name==='stair_arch') {
    for (const x of [-.94,0,.94]) {
      const passage=new Raycaster(new Vector3(x,2.45,1),new Vector3(0,0,-1),0,2).intersectObjects(opaque,false);
      assert.equal(passage.length,0,'Gateway clear 1.9 m passage below 2.5 m spring line');
    }
    assert(new Raycaster(new Vector3(0,3.60,1),new Vector3(0,0,-1),0,2).intersectObjects(opaque,false).length>0,
      'Gateway solid arch crown above opening');
  }
  console.log(`${name}: ${triangles} triangles, ${meshes} meshes, ${lamps} lamps, ${emissive} emissive primitives; valid`);
}
