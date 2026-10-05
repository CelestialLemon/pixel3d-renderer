// Check the actual exported model using the runtime's GLTFLoader and ray geometry.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Box3, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from 'three';
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
  assert(bounds.min.y>=(metadata.minHeightMetres??0)-.001, `${name}: agreed minimum height`);
  const xy=metadata.footprintBoundsBlender??[
    [-metadata.footprintMetres[0]/2,-metadata.footprintMetres[1]/2],
    [metadata.footprintMetres[0]/2,metadata.footprintMetres[1]/2]];
  // Blender -Y becomes GLTF +Z. Quay-origin props deliberately have asymmetric bounds.
  assert(bounds.min.x>=xy[0][0]-.001 && bounds.max.x<=xy[1][0]+.001, `${name}: X envelope`);
  assert(bounds.min.z>=-xy[1][1]-.001 && bounds.max.z<=-xy[0][1]+.001, `${name}: Y envelope`);
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
    assert.equal(lamps,4,'Each rim lantern lights the paving');
    const water=scene.getObjectByName('water_Fountain_basin');
    assert(water?.isMesh);
    const normal=new Vector3().fromBufferAttribute(water.geometry.attributes.normal,0).transformDirection(water.matrixWorld);
    assert(normal.y>.999,'Fountain water faces up');
    const hit=new Raycaster(new Vector3(.9,2.5,0),new Vector3(0,-1,0)).intersectObjects(opaque,false)[0];
    assert(hit?.object===water,'Fountain basin is hollow down to water');
    const upper=scene.getObjectByName('water_Fountain_upper_pool');
    assert(upper?.isMesh,'Fountain upper bowl has a fluid pool');
    const upperNormal=new Vector3().fromBufferAttribute(upper.geometry.attributes.normal,0).transformDirection(upper.matrixWorld);
    assert(upperNormal.y>.999,'Fountain upper pool faces up');
    const streams=opaque.filter(o=>o.name.startsWith('water_Fountain_spill'));
    assert.equal(streams.length,4,'All four fountain streams route to fluids');
    for(const stream of streams){
      const box=new Box3().setFromObject(stream);
      assert(box.min.y<.51 && box.max.y>1.2,'Fountain stream reaches from spout to basin');
    }
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
  if(name==='bridge_stone' || name==='footbridge') {
    // Sample the ENTIRE navigable centre; a high crown alone is insufficient.
    for (let z=-1.5;z<=1.501;z+=.125) for (const x of [-.6,0,.6]) {
      const hit=new Raycaster(new Vector3(x,-1,z),new Vector3(0,1,0),0,4).intersectObjects(opaque,false)[0];
      assert(hit && hit.point.y>=.6-1e-5,`${name}: 1.6 m boat headroom at (${x},${z})`);
    }
    if(name==='bridge_stone') {
      assert.equal(lamps,2);
      for (const z of [-2.575,2.575]) {
        assert.equal(new Raycaster(new Vector3(-3,-.25,z),new Vector3(1,0,0),0,6).intersectObjects(opaque,false).length,0,
          'Stone bridge side arches are real clear openings');
      }
      for (const z of [-6.499,6.499]) {
        const hit=new Raycaster(new Vector3(0,2,z),new Vector3(0,-1,0),0,4).intersectObjects(opaque,false)[0];
        assert(hit && Math.abs(hit.point.y)<.01,'Bridge ramps land at quay level');
      }
    }
  }
  if(name==='watermill') {
    const wheel=scene.getObjectByName('move_spin_wheel');
    assert(wheel,'Watermill wheel is independently pivoted');
    let wheelMeshes=0;
    wheel.traverse(o=>{if(o.isMesh) wheelMeshes++;});
    assert(wheelMeshes>0,'Wheel root contains exported material primitives');
    const axle=wheel.getWorldPosition(new Vector3());
    assert(Math.abs(axle.y-.5)<1e-5 && axle.x>2.5,'Wheel axle at agreed quay-relative height on +X');
    const wb=new Box3().setFromObject(wheel);
    assert(wb.min.y<-1 && wb.min.y>=-1.3,'Wheel dips below canal surface');
    assert.equal(lamps,1);
  }
  if(name==='rowboat' || name==='barge') {
    assert.equal(metadata.origin,'waterline at footprint centre');
    assert(bounds.min.y<-.2 && bounds.max.y>.2,'Boat straddles its waterline');
    // Include the scene's flat water: a hollow asset alone can pass while its interior floods.
    const water=new Mesh(new PlaneGeometry(20,20),new MeshBasicMaterial());
    water.rotation.x=-Math.PI/2;
    water.updateMatrixWorld(true);
    for(const z of name==='rowboat'?[.45,.95]:[.6,1.0]) for(const x of [-.12,0,.12]) {
      const hit=new Raycaster(new Vector3(x,2,z),new Vector3(0,-1,0),0,3)
        .intersectObjects([...opaque,water],false)[0];
      assert(hit && hit.object.name.endsWith('_hollow_hull') && hit.point.y>.01 && hit.point.y<.20,
        `${name}: dry hollow interior at (${x},${z}) over continuous canal water`);
    }
    water.geometry.dispose();
    water.material.dispose();
    if(name==='barge') {
      // The beam becomes bridge-local Z when a boat travels along the canal.
      for(const bridgeName of ['bridge_stone','footbridge']) {
        const b=await readFile(new URL(`public/village/${bridgeName}.glb`,root));
        const {scene:bridge}=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
        bridge.updateMatrixWorld(true);
        const bridgeMeshes=[];
        bridge.traverse(o=>{if(o.isMesh && !o.name.startsWith('glass_')) bridgeMeshes.push(o);});
        for(const x of bridgeName==='footbridge'?[-.78,0,.78]:[-1.8,0,1.8]) for(let i=0;i<=48;i++) {
          const z=bounds.min.x+(bounds.max.x-bounds.min.x)*i/48;
          const hit=new Raycaster(new Vector3(x,-1,z),new Vector3(0,1,0),0,4).intersectObjects(bridgeMeshes,false)[0];
          assert(hit && bounds.max.y+.05<=hit.point.y+1,
            `Barge air draft clears ${bridgeName} over its entire beam with 5 cm margin at (${x},${z})`);
        }
      }
    }
    assert.equal(lamps,name==='barge'?1:0);
  }
  if(name==='jetty') {
    const hit=new Raycaster(new Vector3(1,1,1.4),new Vector3(0,-1,0),0,3).intersectObjects(opaque,false)[0];
    assert(hit && Math.abs(hit.point.y+.55)<1e-5,'Jetty deck is .55 m below quay');
    assert(bounds.min.z>=-.001 && bounds.max.z<=2.501,'Jetty projects entirely from quay into -Y');
    assert(Math.abs(bounds.min.y+1.5)<1e-5,'Jetty piles reach bed');
  }
  const authoredLampCounts={town_hall:2,chapel:1,watch_tower:1,smithy:1,cottage_thatch:1,cottage_long:1,
    barn:0,market_hall:2,guardian_statue:1,wardstone:1,ruins:0,hay_bales:0,woodpile:0,
    laundry_line:0,notice_board:0,market_stall_lit:1,mooring_bollard:0,windmill_large:0};
  if(name in authoredLampCounts) assert.equal(lamps,authoredLampCounts[name],`${name}: authored lamp budget`);
  if(name==='town_hall') {
    for(const x of [-2.95,0,2.95]) {
      assert.equal(new Raycaster(new Vector3(x,1.2,4),new Vector3(0,0,-1),0,2.2).intersectObjects(opaque,false).length,0,
        'Town hall front arcades remain open to the interior');
    }
  }
  if(name==='smithy') {
    const p=new Vector3(.95,1.31,3);
    const hit=new Raycaster(p,new Vector3(0,0,-1),0,5).intersectObjects(opaque,false)[0];
    assert(hit && hit.object.material.emissive.r>.5,'Forge glow is visible through the open workshop front');
    assert(opaque.some(o=>/chimney_mouth/.test(o.name)),'Smithy smoke mouth exported');
  }
  if(name==='chapel') {
    const stained=new Set();
    for(const obj of opaque) if(/coloured_pane|gold_point/.test(obj.name)) stained.add(obj.material.name);
    assert.equal(stained.size,3,'Chapel exports three stained-glass colours');
  }
  if(name==='guardian_statue') {
    const light=scene.getObjectByName('lamp_Guardian_crystal');
    const p=light.getWorldPosition(new Vector3());
    // From inside, a one-sided surface is invisible: shoot from outside toward the lamp instead.
    const shell=new Raycaster(p.clone().add(new Vector3(0,1,0)),new Vector3(0,-1,0),0,1).intersectObjects(opaque,false)[0];
    assert(shell && shell.object.name==='Guardian_luminous_crystal','Guardian lamp contained by crystal');
    assert(shell.point.distanceTo(p)<light.userData.clearance,'Crystal fixture clears its own lamp');
  }
  if(name==='laundry_line') {
    const cloths=scene.children.filter(o=>o.name.startsWith('move_sway_Laundry_cloth'));
    assert.equal(cloths.length,4,'All four cloths keep independent motion roots');
    for(const cloth of cloths) {
      const cb=new Box3().setFromObject(cloth),p=cloth.getWorldPosition(new Vector3());
      assert(Math.abs(cb.max.y-p.y)<1e-5,'Laundry pivot sits at upper cloth edge');
    }
  }
  if(name==='windmill_large') {
    const sails=scene.getObjectByName('move_spin_Windmill_large_sails');
    assert(sails,'Windmill sails have a shared motion root');
    const axis=new Vector3(1,0,0).transformDirection(sails.matrixWorld);
    assert(axis.z>.999,'Windmill root local X points along its exported shaft');
    assert(sails.children.some(o=>o.name.startsWith('thin_Windmill_lattice')),'Thin lattice remains named under sail root');
    assert(bounds.max.y>12 && metadata.attachmentsBlender.capHeightMetres>=10,'Full-size tower mill height');
  }
  console.log(`${name}: ${triangles} triangles, ${meshes} meshes, ${lamps} lamps, ${emissive} emissive primitives; valid`);
}
