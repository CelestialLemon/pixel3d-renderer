// Two measurements of objects the game moves.
// 1. Isolated submission/GPU cost of per-object meshes versus one InstancedMesh, with shared geometry.
//    Same G-buffer + sun depth + shadow mask workload, all objects visible and moving, no style/resolve passes.
// 2. The full addObject path (PixelRenderer: poseObjects, G-buffer, shadow mask, resolve, post, clean-up): 1,500 small
//    items moving along belts every frame beside 100 still buildings, with the items casting sun shadows (the object
//    shadow map redraws every frame, buildings and all) and not casting (PixelObject.castShadow = false: it never redraws).
// Part 1 ends each frame with gl.finish, part 2 with a one-pixel readPixels of the canvas, which waits for the GPU to finish
// the frame. Neither is a whole-game frame-rate estimate.
//   node tools/object-bench.ts
import assert from 'node:assert/strict';
import { launch, newPage, open, glRenderer } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  console.log(await glRenderer(page));
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { GBUF_FRAG } = await import('/src/renderer/shaders/gbuffer.ts');
    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
    renderer.setSize(480, 360, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.info.autoReset = false;
    const gl = renderer.getContext();
    const camera = new THREE.OrthographicCamera(-24, 24, 18, -18, 1, 150);
    camera.position.set(0, 35, 35); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const geometry = new THREE.BoxGeometry(0.55, 1, 0.55).toNonIndexed();
    const count = geometry.attributes.position.count;
    geometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(count * 3).fill(0.5), 3));
    geometry.setAttribute('aFlag', new THREE.BufferAttribute(new Float32Array(count), 1));
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, fragmentShader: GBUF_FRAG, uniforms: { uSS: { value: 3 } },
      vertexShader: `in vec3 aColor; in float aFlag;
        out vec3 vN; out vec3 vC; out float vF; out float vD; out float vA;
        flat out float vObjectId;
        void main() {
          vObjectId = 0.0;
          vec4 p = vec4(position, 1.0); vec3 n = normal;
          #ifdef USE_INSTANCING
            p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
          #endif
          vec4 vp = modelViewMatrix * p;
          vN = mat3(modelMatrix) * n; vC = aColor; vF = aFlag; vA = 1.0; vD = -vp.z;
          gl_Position = projectionMatrix * vp;
        }`,
    });
    material.shadowSide = THREE.DoubleSide;
    const maskMaterial = new THREE.ShadowMaterial();
    maskMaterial.transparent = false; maskMaterial.blending = THREE.NoBlending;
    const gbuffer = new THREE.WebGLRenderTarget(480, 360, { count: 2, type: THREE.FloatType });
    const mask = new THREE.WebGLRenderTarget(480, 360);
    const matrix = new THREE.Matrix4();
    const output = [];
    try {
      for (const n of [50, 500, 2000]) for (const instanced of [false, true]) {
        const scene = new THREE.Scene();
        const light = new THREE.DirectionalLight(); light.castShadow = true;
        light.position.set(12, 35, 20); light.shadow.mapSize.set(4096, 4096);
        Object.assign(light.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 100 });
        light.shadow.bias = -0.0004; light.shadow.normalBias = 0.03;
        scene.add(light, light.target);
        const instances = instanced ? new THREE.InstancedMesh(geometry, material, n) : null;
        const meshes = instances ? [] : Array.from({ length: n }, () => new THREE.Mesh(geometry, material));
        if (instances) { instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(instances); }
        else scene.add(...meshes);
        for (const mesh of instances ? [instances] : meshes) {
          mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
        }
        const side = Math.ceil(Math.sqrt(n)), samples: number[] = [];
        let calls = 0;
        for (let frame = 0; frame < 72; frame++) {
          renderer.info.reset();
          const start = performance.now();
          for (let i = 0; i < n; i++) {
            const x = ((i % side) / side - 0.5) * 32;
            const z = (Math.floor(i / side) / side - 0.5) * 28;
            const y = 0.6 + (frame % 2) * 0.1;
            if (instances) { matrix.makeTranslation(x, y, z); instances.setMatrixAt(i, matrix); }
            else meshes[i].position.set(x, y, z);
          }
          if (instances) instances.instanceMatrix.needsUpdate = true;
          scene.overrideMaterial = null;
          renderer.shadowMap.needsUpdate = true;
          renderer.setRenderTarget(gbuffer); renderer.render(scene, camera);
          scene.overrideMaterial = maskMaterial;
          renderer.setRenderTarget(mask); renderer.render(scene, camera);
          gl.finish();
          if (frame >= 12) samples.push(performance.now() - start);
          calls = renderer.info.render.calls;
        }
        samples.sort((a, b) => a - b);
        output.push({ objects: n, mode: instanced ? 'instanced' : 'meshes', calls,
          medianMs: +samples[Math.floor(samples.length / 2)].toFixed(2),
          p95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(2) });
        light.shadow.map?.dispose();
        instances?.dispose();
      }
      return output;
    } finally {
      geometry.dispose(); material.dispose(); maskMaterial.dispose(); gbuffer.dispose(); mask.dispose(); renderer.dispose();
    }
  });
  console.table(results);

  const full = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { PixelRenderer, GeometryCollector, place, lookAt } = await import('/src/renderer/index.ts');
    const box = new THREE.BoxGeometry(1, 1, 1);
    const collect = (w: number, h: number, color: [number, number, number]) => {
      const c = new GeometryCollector(); c.add(box, place(0, h / 2, 0, 0, 0, 0, w, h, w), color); return c.build();
    };
    const ground = new GeometryCollector(); ground.add(box, place(0, -0.1, 0, 0, 0, 0, 40, 0.2, 40), [0.4, 0.42, 0.36]);
    const item = collect(0.22, 0.18, [0.8, 0.5, 0.2]), building = collect(1.4, 1.2, [0.6, 0.55, 0.5]);
    const ITEMS = 1500, BELTS = 30, PER_BELT = ITEMS / BELTS, LENGTH = 24;
    const output = [];
    for (const mode of ['no items', 'items cast', 'items cast none'] as const) {
      const r = new PixelRenderer(document.createElement('canvas'), { staticGeometry: ground.build(), shadow: { center: new THREE.Vector3(), radius: 20 } });
      try {
        r.resize(480, 270); r.setLook(lookAt(15)); r.placeCamera(new THREE.Vector3(), 0.7, 0.6, 30);
        for (let i = 0; i < 100; i++) r.addObject(building).position.set((i % 10 - 4.5) * 3.6, 0, (Math.floor(i / 10) - 4.5) * 3.6 + 1.6);
        const items = mode === 'no items' ? [] : Array.from({ length: ITEMS }, () => {
          const o = r.addObject(item); o.castShadow = mode === 'items cast'; return o;
        });
        const gl = r.renderer.getContext(), frame = (t: number) => {
          items.forEach((o, i) => {
            const belt = Math.floor(i / PER_BELT), u = ((i % PER_BELT) / PER_BELT + t * 0.05) % 1;
            o.position.set(u * LENGTH - LENGTH / 2, 0.05, (belt - BELTS / 2) * 1.2);
          });
          r.renderGeometry(t); r.renderStyle(t);
        };
        const samples: number[] = [], cpu: number[] = [], pixel = new Uint8Array(4);
        for (let f = 0; f < 84; f++) {
          const start = performance.now();
          frame(f / 60);
          const submitted = performance.now();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);   // waits for the GPU, unlike gl.finish in Chrome
          if (f >= 12) { samples.push(performance.now() - start); cpu.push(submitted - start); }
        }
        const median = (a: number[]) => +a.sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(2);
        output.push({ mode, objects: 100 + items.length, medianMs: median([...samples]),
          p95Ms: +samples.sort((x, y) => x - y)[Math.floor(samples.length * 0.95)].toFixed(2), cpuMedianMs: median(cpu) });
      } finally { r.dispose(); }
    }
    for (const g of [item, building, box]) g.dispose();
    return output;
  });
  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.log('Full addObject path: 480x270 art pixels (supersample 3), 4096² sun maps, 100 still buildings, 1,500 moving items');
  console.table(full);
} finally { await browser.close(); }
