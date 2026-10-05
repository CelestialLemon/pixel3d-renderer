// Isolated submission/GPU cost of per-object meshes versus one InstancedMesh, with shared geometry.
// Same G-buffer + sun depth + shadow mask workload, all objects visible and moving, no style/resolve passes.
// gl.finish includes completed GPU work in the measurement; this is not a whole-game frame-rate estimate.
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
  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.table(results);
} finally { await browser.close(); }
