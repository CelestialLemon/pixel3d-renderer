import * as THREE from 'three';
import type { Look } from './look';
import { LIMITS, type PixelScene } from './scene';
import { POST_VERT } from './shaders/common';
import { GBUF_DYN_VERT, GBUF_FRAG, GBUF_OBJECT_VERT, GBUF_STATIC_VERT, POSE } from './shaders/gbuffer';
import { POST_FRAG } from './shaders/post';
import { CLEAN_FRAG } from './shaders/cleanup';
import { RESOLVE_FRAG } from './shaders/resolve';
import { LampShadows } from './lampShadows';
import { buildWindowLight, type WindowLight } from './windowLight';
import { FLUID_FRAG, FLUID_VERT } from './shaders/water';
import { linearColor } from './geometry';
import { buildFluidMap, type FluidMap } from './fluidMap';
import { MIRROR_X, OBJECT_ATTRIBUTES, ObjectBatch, PixelObject } from './objects';

/** Stylisation switches. All on is the intended look; the toggles exist for comparison and debugging. */
export interface RenderSettings {
  outlines: boolean;
  dither: boolean;
  cleanup: boolean;
  clouds: boolean;
  contacts: boolean;
  glow: boolean;
  vignette: boolean;
}

export const DEFAULT_SETTINGS: RenderSettings = { outlines: true, dither: true, cleanup: true, clouds: true, contacts: true, glow: true, vignette: true };

/** Pads `items` to the shader's fixed array length (three.js uploads the whole declared array). */
const padded = <T,>(items: T[], size: number, fill: () => T) => {
  if (items.length > size) throw new Error(`At most ${size} entries are supported, got ${items.length}`);
  return [...items, ...Array.from({ length: size - items.length }, fill)];
};

/**
 * Draws a PixelScene as pixel art into `canvas`, one canvas pixel per art pixel (scale the canvas up with CSS).
 * Per frame: `placeCamera`, then `renderGeometry` (rasterise the G-buffer and shadow mask) whenever the view,
 * the animation clock or an object changed, then `renderStyle` (the post shader; cheap).
 * The scene is baked; objects the game moves are added with `addObject`.
 */
export class PixelRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300);
  /** Image translation from the snapped camera to the requested camera, in art pixels (+x right, +y down). */
  readonly snapShift = new THREE.Vector2();
  readonly scene = new THREE.Scene();
  readonly light = new THREE.DirectionalLight(0xffffff, 1);

  /** Supersampled G-buffer (S x S per art pixel) and sun-shadow mask, rasterised by `renderGeometry`. */
  private gbufHi!: THREE.WebGLRenderTarget;
  private shadowHi!: THREE.WebGLRenderTarget;
  /** Resolved to art resolution: albedo+flag, normal+depth, shadow (alpha). What the post shader reads. */
  private gbuf!: THREE.WebGLRenderTarget;
  private stylised!: THREE.WebGLRenderTarget;
  /** The fluid G-buffer (normal + depth, velocity + material slot) at art resolution, and the image with the fluids drawn in. */
  private fluidBuf?: THREE.WebGLRenderTarget;
  private withFluids?: THREE.WebGLRenderTarget;
  /** Pass 0's image when fluids follow: linear and unclipped, so the final grade in pass 1 sees the true colour. */
  private linearImage?: THREE.WebGLRenderTarget;
  /** Stands in for the fluid G-buffer in a scene without fluids, whose fluid targets are never allocated. */
  private noFluid = Object.assign(new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType), { needsUpdate: true });
  private fluidMesh: THREE.Mesh;
  private fluidMat: THREE.ShaderMaterial;
  private fluidScene = new THREE.Scene();
  private hasFluids: boolean;
  /** Flow, turbulence and shore distance over the fluid pools, baked once (see fluidMap.ts). */
  readonly fluidMap: FluidMap;
  private staticMesh: THREE.Mesh;
  private staticMat: THREE.ShaderMaterial;
  private resolveMat: THREE.ShaderMaterial;
  private dynMesh: THREE.Mesh;
  private dynMat: THREE.ShaderMaterial;
  /** The sun-shadow mask of the rigid moving parts, at their posed position this frame (see renderGeometry). */
  private dynShadowMat: THREE.ShadowMaterial;
  private hasRigidParts: boolean;
  private shadowMat: THREE.ShadowMaterial;
  private postMat: THREE.ShaderMaterial;
  private cleanMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private shadowDirty = true;
  /** Objects the game added, one instanced batch per geometry, drawn with `objectMat`. */
  private batches = new Map<THREE.BufferGeometry, ObjectBatch>();
  private objectMat: THREE.ShaderMaterial;
  /**
   * The sun again, with a shadow map of the objects only: the static map then renders only when the sun moves, and
   * this one whenever an object does. The mask pass multiplies the two. Created with the first object, so a scene
   * without objects draws exactly as before.
   */
  private objectLight?: THREE.DirectionalLight;
  private objectShadowDirty = false;
  private shadowCenter: THREE.Vector3;
  private lampShadows: LampShadows;
  /** Warm pools below the lit windows, splatted once into a top-down map (see windowLight.ts). */
  readonly windowLight: WindowLight;

  width = 1; height = 1;
  viewHeight = 13;
  /**
   * G-buffer samples per art pixel along each axis: 3 for the thin-feature resolve (docs/THIN_FEATURES.md), or 1 for one
   * sample at the pixel centre (cheaper; thin features flicker). Takes effect on the next `resize`.
   */
  supersample = 3;
  /** Resolve policy at supersample 3: 0 majority; k >= 1 near-priority, where a nearer surface needs k + 1 of the 9 samples. */
  resolvePolicy = 1;
  /** Apply near-priority only to thin-marked surfaces (`thin()`, the `thin_` prefix); everything else resolves by majority. */
  resolveThinOnly = true;
  sun = new THREE.Vector3(0, 1, 0);

  constructor(readonly canvas: HTMLCanvasElement, readonly pixelScene: PixelScene) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    const smat = new THREE.ShaderMaterial({ vertexShader: GBUF_STATIC_VERT, fragmentShader: GBUF_FRAG, glslVersion: THREE.GLSL3, side: THREE.FrontSide, uniforms: { uSS: { value: 1 } } });
    smat.shadowSide = THREE.DoubleSide;
    this.staticMat = smat;
    this.staticMesh = new THREE.Mesh(pixelScene.staticGeometry, smat);
    this.staticMesh.castShadow = true; this.staticMesh.receiveShadow = true; this.staticMesh.frustumCulled = false;

    this.objectMat = new THREE.ShaderMaterial({ vertexShader: GBUF_OBJECT_VERT, fragmentShader: GBUF_FRAG, glslVersion: THREE.GLSL3, side: THREE.FrontSide, uniforms: { uSS: { value: 1 } } });
    this.objectMat.shadowSide = THREE.DoubleSide;

    this.dynMat = new THREE.ShaderMaterial({
      vertexShader: GBUF_DYN_VERT, fragmentShader: GBUF_FRAG, glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uSS: { value: 1 } },
    });
    this.dynMesh = new THREE.Mesh(pixelScene.dynamicGeometry, this.dynMat);
    this.dynMesh.frustumCulled = false; this.dynMesh.castShadow = false; this.dynMesh.receiveShadow = true;
    this.scene.add(this.staticMesh, this.dynMesh);

    const { center, radius } = pixelScene.shadow;
    this.shadowCenter = center.clone();
    this.setupSun(this.light, radius);
    this.scene.add(this.light, this.light.target);

    // Writes shadow occlusion (0 = lit, 1 = shadowed) into alpha, no blending.
    this.shadowMat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 1 });
    this.shadowMat.transparent = false; this.shadowMat.blending = THREE.NoBlending;
    // The same mask for the rigid moving parts (spin, swing): three's shadow shader with each vertex posed by the G-buffer's
    // motion code (POSE), sharing its time uniforms. Other dynamic modes are discarded and keep the mask behind them.
    this.dynShadowMat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 1, side: THREE.DoubleSide });
    this.dynShadowMat.transparent = false; this.dynShadowMat.blending = THREE.NoBlending;
    this.dynShadowMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.dynMat.uniforms.uTime; shader.uniforms.uNight = this.dynMat.uniforms.uNight;
      // Patch three's shadow shader; fail loudly if a three upgrade renames a chunk, rather than silently borrowing again.
      const patch = (src: string, find: string, put: string) => {
        if (!src.includes(find)) throw new Error(`moving-part shadow: three's shadow shader has no '${find}'`);
        return src.replace(find, put);
      };
      let v = patch(shader.vertexShader, '#include <common>', `#include <common>
uniform float uTime; uniform float uNight;
attribute float aMode; attribute vec3 aAnchor; attribute vec4 aAnim;
varying float vMode;   // only so the fragment stage can drop non-rigid modes
${POSE}`);
      // pose() also returns the dither alpha, which the mask doesn't use.
      v = patch(v, '#include <beginnormal_vertex>', 'vec3 posed = position; vec3 objectNormal = normal; float posedAlpha;\n  pose(posed, objectNormal, posedAlpha); vMode = aMode;');
      shader.vertexShader = patch(v, '#include <begin_vertex>', 'vec3 transformed = posed;');
      shader.fragmentShader = patch(shader.fragmentShader, 'void main() {', 'varying float vMode;\nvoid main() {\n  if (vMode < 5.5) discard;');
    };
    // Only scenes with rigid moving parts need that second mask pass.
    const modes = pixelScene.dynamicGeometry.getAttribute('aMode')?.array ?? [];
    this.hasRigidParts = Array.from(modes).some((m) => m > 5.5);

    const { lamps, grooves, fluids } = pixelScene;
    this.fluidMat = new THREE.ShaderMaterial({
      vertexShader: FLUID_VERT, fragmentShader: FLUID_FRAG, glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
      uniforms: { tAlbedo: { value: null }, tNormal: { value: null }, uFwd: { value: new THREE.Vector3() } },
    });
    this.fluidMesh = new THREE.Mesh(fluids.geometry, this.fluidMat);
    this.fluidMesh.frustumCulled = false;
    this.fluidScene.add(this.fluidMesh);
    this.hasFluids = fluids.geometry.attributes.position.count > 0;
    this.fluidMap = buildFluidMap(fluids, pixelScene.staticGeometry);
    const mats = fluids.materials, src = fluids.sources;
    const fluidVec = (pick: (m: typeof mats[number]) => [number, number, number, number]) =>
      padded(mats.map((m) => new THREE.Vector4(...pick(m))), LIMITS.fluidMaterials, () => new THREE.Vector4());
    const gl = this.renderer.getContext();
    this.lampShadows = new LampShadows(lamps, pixelScene.staticGeometry,
      Math.min(this.renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number));
    this.windowLight = buildWindowLight(pixelScene.staticGeometry, lamps);
    const common = { glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false } as const;
    this.postMat = new THREE.ShaderMaterial({
      ...common, vertexShader: POST_VERT, fragmentShader: POST_FRAG,
      uniforms: {
        tAlbedo: { value: null }, tNormal: { value: null }, tShadow: { value: null },
        uRes: { value: new THREE.Vector2() }, uTexel: { value: 0.05 },
        uRight: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3() }, uCamPos: { value: new THREE.Vector3() },
        uSun: { value: this.sun }, uTime: { value: 0 },
        uOutline: { value: 1 }, uDither: { value: 1 }, uClouds: { value: 1 }, uContact: { value: 1 }, uGlow: { value: 1 }, uVignette: { value: 1 },
        uSunI: { value: 1 }, uAmbient: { value: 0.34 }, uExpo: { value: 1 }, uChroma: { value: 1 }, uNight: { value: 0 }, uLampOn: { value: 0 },
        uLitTint: { value: new THREE.Vector2() }, uShadeTint: { value: new THREE.Vector2() },
        uSkyTop: { value: new THREE.Color(0x79b6dc) }, uSkyBot: { value: new THREE.Color(0xf6e6c2) },
        uLampCount: { value: lamps.length },
        tLampShadow: { value: this.lampShadows.target.texture }, uLampAtlas: { value: new THREE.Vector3(this.lampShadows.size.x, this.lampShadows.size.y, this.lampShadows.tile) },
        // Position and radius share one vec4 per lamp, to keep the fragment uniform count low at LIMITS.lamps.
        uLamp: { value: padded(lamps.map((l) => new THREE.Vector4(l.position.x, l.position.y, l.position.z, l.radius)), LIMITS.lamps, () => new THREE.Vector4(0, 0, 0, 1)) },
        uLampCol: { value: padded(lamps.map((l) => new THREE.Vector3(...l.color)), LIMITS.lamps, () => new THREE.Vector3()) },
        tWindow: { value: this.windowLight.texture }, tWindowSource: { value: this.windowLight.source },
        uWindowBounds: { value: new THREE.Vector4(...this.windowLight.bounds) },
        uPass: { value: 0 }, uDeferGrade: { value: 0 }, tImage: { value: null }, tFluidN: { value: null }, tFluidF: { value: null },
        tFluidMap: { value: this.fluidMap.texture }, tFluidHeight: { value: this.fluidMap.height }, uFluidBounds: { value: new THREE.Vector4(...this.fluidMap.bounds) },
        // Packed four vec4 per material and one per source (see WATER_GLSL in shaders/water.ts).
        uFluidA: { value: fluidVec((m) => [...linearColor(m.shallow), m.clarity]) },
        uFluidB: { value: fluidVec((m) => [...linearColor(m.deep), m.reflectivity]) },
        uFluidC: { value: fluidVec((m) => [...linearColor(m.foam), m.roughness]) },
        uFluidD: { value: fluidVec((m) => [m.waveScale, m.foamAmount, m.emission, 0]) },
        uSourceCount: { value: src.length },
        uSources: { value: padded(src.map((o) => new THREE.Vector4(o.x, o.z, o.rings ? o.radius : -o.radius, o.strength)), LIMITS.fluidSources, () => new THREE.Vector4()) },
        uSourceY: { value: padded(src.map((o) => o.y ?? -1e4), LIMITS.fluidSources, () => -1e4) },
        uGrooveCount: { value: grooves?.positions.length ?? 0 },
        uGrooves: { value: padded(grooves?.positions ?? [], LIMITS.grooves, () => 0) },
        uGrooveAxis: { value: new THREE.Vector3(...(grooves?.axis ?? [1, 0, 0])) },
        uGrooveY: { value: new THREE.Vector2(...(grooves?.yRange ?? [0, 0])) },
      },
    });
    this.cleanMat = new THREE.ShaderMaterial({
      ...common, vertexShader: POST_VERT, fragmentShader: CLEAN_FRAG,
      uniforms: { tImage: { value: null }, tAlbedo: { value: null }, tNormal: { value: null }, tFluid: { value: null }, uRes: { value: new THREE.Vector2() }, uOn: { value: 1 } },
    });
    this.resolveMat = new THREE.ShaderMaterial({
      ...common, vertexShader: POST_VERT, fragmentShader: RESOLVE_FRAG,
      uniforms: {
        tAlbedo: { value: null }, tNormal: { value: null }, tShadow: { value: null }, uS: { value: 1 }, uPolicy: { value: 0 }, uThinOnly: { value: 0 }, uTexel: { value: 0.05 },
        uRight: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3() },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** A shadow-casting sun covering the scene's shadow area, rendered only when asked (see `renderGeometry`). */
  private setupSun(light: THREE.DirectionalLight, radius: number) {
    light.castShadow = true;
    light.shadow.autoUpdate = false;
    light.shadow.mapSize.set(4096, 4096);
    const sc = light.shadow.camera;
    sc.left = -radius; sc.right = radius; sc.top = radius; sc.bottom = -radius; sc.near = 1; sc.far = 140;
    light.shadow.bias = -0.0004; light.shadow.normalBias = 0.03;
  }

  /**
   * Add an object the game moves. `geometry` is in the object's local space, with the attributes `GeometryCollector`
   * builds (position, normal, aColor, aFlag; quantise its colours together with the scene's). Many objects may share
   * one geometry; the renderer never disposes it.
   */
  addObject(geometry: THREE.BufferGeometry): PixelObject {
    const missing = OBJECT_ATTRIBUTES.filter((a) => !geometry.getAttribute(a));
    if (missing.length) throw new Error(`addObject: geometry has no ${missing.join(', ')} attribute`);
    if (!this.objectLight) {
      const light = this.objectLight = new THREE.DirectionalLight(0xffffff, 1);
      this.setupSun(light, this.pixelScene.shadow.radius);
      light.position.copy(this.light.position); light.target.position.copy(this.light.target.position);
      light.target.updateMatrixWorld();
      this.scene.add(light, light.target);
    }
    let batch = this.batches.get(geometry);
    if (!batch) {
      batch = new ObjectBatch(geometry, this.objectMat);
      this.batches.set(geometry, batch);
      this.scene.add(...batch.meshes);
    }
    const o = new PixelObject(batch, (o) => this.removeObject(o));
    batch.objects.push(o);
    const old = batch.grow();
    if (old.length) { for (const m of old) { this.scene.remove(m); m.dispose(); } this.scene.add(...batch.meshes); }
    this.objectShadowDirty = true;
    return o;
  }

  private removeObject(o: PixelObject) {
    const batch = o.batch, i = batch.objects.indexOf(o);
    if (i < 0) return;
    batch.objects.splice(i, 1);
    if (o.drawnVisible) this.objectShadowDirty = true;
    if (!batch.objects.length) { for (const m of batch.meshes) { this.scene.remove(m); m.dispose(); } this.batches.delete(batch.geometry); }
  }

  /**
   * Pack every visible object's transform into its batch for this frame, its origin snapped to the art-pixel grid,
   * and note whether any of them changed. An object with a zero scale component is not drawn.
   */
  private poseObjects() {
    const texel = this.viewHeight / this.height, w = this.camera.matrixWorld;
    const right = new THREE.Vector3().setFromMatrixColumn(w, 0), up = new THREE.Vector3().setFromMatrixColumn(w, 1), fwd = new THREE.Vector3().setFromMatrixColumn(w, 2);
    const p = new THREE.Vector3(), m = new THREE.Matrix4(), mm = new THREE.Matrix4();
    for (const batch of this.batches.values()) {
      let n = 0, nm = 0;
      for (const o of batch.objects) {
        const shown = o.visible && o.scale.x !== 0 && o.scale.y !== 0 && o.scale.z !== 0;
        if (shown) {
          p.copy(o.position);
          if (o.snap) {
            const r = p.dot(right), u = p.dot(up);
            p.addScaledVector(right, Math.round(r / texel) * texel - r).addScaledVector(up, Math.round(u / texel) * texel - u);
            // Snapping along `up` also moved the object up or down in the world (sinking or lifting it off the ground).
            // Sliding along the view direction undoes that without moving it in the image, unless the view is near level.
            if (Math.abs(fwd.y) > 0.05) p.addScaledVector(fwd, (o.position.y - p.y) / fwd.y);
          }
          m.compose(p, o.quaternion, o.scale);
          if (m.determinant() < 0) batch.mirrored.setMatrixAt(nm++, mm.multiplyMatrices(MIRROR_X, m));
          else batch.mesh.setMatrixAt(n++, m);
          if (!o.drawnVisible || !m.equals(o.drawn)) this.objectShadowDirty = true;
          o.drawn.copy(m);
        } else if (o.drawnVisible) this.objectShadowDirty = true;
        o.drawnVisible = shown;
      }
      batch.mesh.count = n; batch.mirrored.count = nm;
      batch.mesh.instanceMatrix.needsUpdate = true; batch.mirrored.instanceMatrix.needsUpdate = true;
    }
  }

  /** Apply a time-of-day look: sun direction and strength, colour grade, sky, lamps. */
  setLook(look: Look) {
    const u = this.postMat.uniforms;
    const az = THREE.MathUtils.degToRad(look.sunAz), el = THREE.MathUtils.degToRad(look.sunEl);
    this.sun.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    this.light.position.copy(this.sun).multiplyScalar(60).add(this.shadowCenter);
    this.light.target.position.copy(this.shadowCenter);
    this.light.target.updateMatrixWorld();
    if (this.objectLight) {
      this.objectLight.position.copy(this.light.position);
      this.objectLight.target.position.copy(this.light.target.position);
      this.objectLight.target.updateMatrixWorld();
      this.objectShadowDirty = true;
    }
    this.shadowDirty = true;
    u.uSunI.value = look.sunI; u.uAmbient.value = look.ambient; u.uExpo.value = look.expo; u.uChroma.value = look.chroma;
    u.uLitTint.value.set(...look.litTint); u.uShadeTint.value.set(...look.shadeTint);
    u.uLampOn.value = look.lampOn; u.uNight.value = look.night;
    u.uSkyTop.value.copy(look.skyTop); u.uSkyBot.value.copy(look.skyBot);
    this.dynMat.uniforms.uNight.value = look.night;
  }

  /** Set the art resolution (G-buffer and canvas size in art pixels). */
  resize(w: number, h: number) {
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    const S = this.supersample === 3 ? 3 : 1;
    const mk = (opts: THREE.RenderTargetOptions, count = 1, k = 1) => new THREE.WebGLRenderTarget(w * k, h * k, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false, count, ...opts });
    for (const t of [this.gbufHi, this.shadowHi, this.gbuf, this.stylised, this.fluidBuf, this.withFluids, this.linearImage]) t?.dispose();
    // Full float depth avoids false depth discontinuities on planar roof/paving edges.
    this.gbufHi = mk({ type: THREE.FloatType }, 2, S);
    this.shadowHi = mk({ type: THREE.UnsignedByteType }, 1, S);
    this.gbuf = mk({ type: THREE.FloatType, depthBuffer: false }, 3);
    this.stylised = mk({ type: THREE.UnsignedByteType, depthBuffer: false });
    if (this.hasFluids) {   // a scene without fluids never needs these
      this.fluidBuf = mk({ type: THREE.FloatType }, 2);
      this.withFluids = mk({ type: THREE.UnsignedByteType, depthBuffer: false });
      this.linearImage = mk({ type: THREE.FloatType, depthBuffer: false });
    }
    this.staticMat.uniforms.uSS.value = S; this.objectMat.uniforms.uSS.value = S; this.dynMat.uniforms.uSS.value = S; this.resolveMat.uniforms.uS.value = S;
    this.postMat.uniforms.uRes.value.set(w, h);
    this.cleanMat.uniforms.uRes.value.set(w, h);
  }

  /** Orthographic camera orbiting `target`, snapped so the target sits on the pixel grid. */
  placeCamera(target: THREE.Vector3, azimuth: number, elevation: number, viewHeight: number) {
    this.viewHeight = viewHeight;
    const cam = this.camera, halfH = viewHeight / 2, halfW = halfH * (this.width / this.height);
    cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
    cam.updateProjectionMatrix();
    const dir = new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
    cam.position.copy(target).addScaledVector(dir, 100);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    const texel = viewHeight / this.height;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const snapR = Math.round(cam.position.dot(right) / texel) * texel - cam.position.dot(right);
    const snapU = Math.round(cam.position.dot(up) / texel) * texel - cam.position.dot(up);
    this.snapShift.set(snapR / texel, -snapU / texel);
    cam.position.addScaledVector(right, snapR).addScaledVector(up, snapU);
    cam.updateMatrixWorld();
  }

  /** Rasterise into the G-buffer (+ shadow mask) with the dynamic mesh posed at `time` seconds and the objects where the game put them. */
  renderGeometry(time: number) {
    const r = this.renderer;
    this.lampShadows.render(r);
    this.dynMat.uniforms.uTime.value = time;
    this.poseObjects();
    const objects = [...this.batches.values()].flatMap((b) => b.meshes);
    const setCasters = (staticWorld: boolean, objs: boolean) => { this.staticMesh.castShadow = staticWorld; for (const m of objects) m.castShadow = objs; };

    // Each sun shadow map renders only when it changed, during one of the two scene renders below: the static map
    // (static world only) during the G-buffer render, the object map (objects only) during the mask render.
    // Three renders every caster into every light's map, so the casters are switched per render.
    if (this.shadowDirty) { this.light.shadow.needsUpdate = true; r.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    r.setClearColor(0x000000, 0);
    try {
      setCasters(true, false);
      r.setRenderTarget(this.gbufHi); r.clear(); r.render(this.scene, this.camera);
    } finally { r.shadowMap.needsUpdate = false; this.light.shadow.needsUpdate = false; }
    if (this.objectLight && this.objectShadowDirty) { this.objectLight.shadow.needsUpdate = true; r.shadowMap.needsUpdate = true; this.objectShadowDirty = false; }

    // The shadow mask comes from the static world and the objects: small moving bits (tufts, puffs) borrow the shadow
    // of whatever surface sits behind them. Rigid moving parts (sails, wheels, signs) are big enough that borrowing
    // shows the shadow pattern of the ground behind them, so they get their own mask at their posed position.
    r.setClearColor(0xffffff, 1);
    const autoClear = r.autoClear;
    try {
      setCasters(false, true);
      this.dynMesh.visible = false;
      this.scene.overrideMaterial = this.shadowMat;
      r.setRenderTarget(this.shadowHi); r.clear(); r.render(this.scene, this.camera);
      if (this.hasRigidParts) {
        // Then the rigid moving parts over it, depth-tested against the static world and the objects (no clear in between).
        this.dynMesh.visible = true; this.staticMesh.visible = false; this.scene.overrideMaterial = this.dynShadowMat;
        for (const m of objects) m.visible = false;
        r.autoClear = false; r.render(this.scene, this.camera);
      }
    } finally {
      r.autoClear = autoClear; this.scene.overrideMaterial = null;
      r.shadowMap.needsUpdate = false; if (this.objectLight) this.objectLight.shadow.needsUpdate = false;
      setCasters(true, true);
      this.staticMesh.visible = true; this.dynMesh.visible = true;
      for (const m of objects) m.visible = true;
    }

    const ru = this.resolveMat.uniforms;
    ru.tAlbedo.value = this.gbufHi.textures[0]; ru.tNormal.value = this.gbufHi.textures[1]; ru.tShadow.value = this.shadowHi.texture;
    ru.uPolicy.value = this.resolvePolicy; ru.uThinOnly.value = this.resolveThinOnly ? 1 : 0; ru.uTexel.value = this.viewHeight / this.height;
    ru.uRight.value.setFromMatrixColumn(this.camera.matrixWorld, 0);
    ru.uUp.value.setFromMatrixColumn(this.camera.matrixWorld, 1);
    ru.uFwd.value.setFromMatrixColumn(this.camera.matrixWorld, 2).negate();
    this.quad.material = this.resolveMat;
    r.setRenderTarget(this.gbuf); r.render(this.quadScene, this.quadCam);

    // The fluids, into their own G-buffer, hidden by hand behind the resolved opaque world.
    if (this.fluidBuf) {
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(this.fluidBuf); r.clear();
      const fu = this.fluidMat.uniforms;
      fu.tAlbedo.value = this.gbuf.textures[0]; fu.tNormal.value = this.gbuf.textures[1];
      fu.uFwd.value.copy(ru.uFwd.value);
      r.render(this.fluidScene, this.camera);
    }
  }

  /** Stylise the G-buffer into the final pixel image on the canvas. `time` drives clouds and the fluids. */
  renderStyle(s: RenderSettings, time: number) {
    const r = this.renderer, cam = this.camera;
    const u = this.postMat.uniforms;
    u.tAlbedo.value = this.gbuf.textures[0]; u.tNormal.value = this.gbuf.textures[1]; u.tShadow.value = this.gbuf.textures[2];
    u.uTexel.value = this.viewHeight / this.height;
    u.uRight.value.setFromMatrixColumn(cam.matrixWorld, 0);
    u.uUp.value.setFromMatrixColumn(cam.matrixWorld, 1);
    u.uFwd.value.setFromMatrixColumn(cam.matrixWorld, 2).negate();
    u.uCamPos.value.copy(cam.position);
    u.uTime.value = time;
    u.uContact.value = s.contacts ? 1 : 0; u.uGlow.value = s.glow ? 1 : 0; u.uVignette.value = s.vignette ? 1 : 0;
    u.uOutline.value = s.outlines ? 1 : 0; u.uDither.value = s.dither ? 1 : 0; u.uClouds.value = s.clouds ? 1 : 0;

    const fluidTex = this.fluidBuf?.textures ?? [this.noFluid, this.noFluid];
    u.tFluidN.value = fluidTex[0]; u.tFluidF.value = fluidTex[1];
    this.quad.material = this.postMat;
    u.uPass.value = 0; u.tImage.value = null;   // never sample the target being drawn
    u.uDeferGrade.value = this.hasFluids ? 1 : 0;   // with fluids, pass 1 grades the composited image once
    r.setRenderTarget(this.linearImage ?? this.stylised); r.render(this.quadScene, this.quadCam);
    let image = this.stylised;
    if (this.linearImage && this.withFluids) {   // pass 1: the fluids over pass 0's image
      u.uPass.value = 1; u.uDeferGrade.value = 0; u.tImage.value = this.linearImage.texture;
      r.setRenderTarget(this.withFluids); r.render(this.quadScene, this.quadCam);
      image = this.withFluids;
    }

    this.cleanMat.uniforms.tImage.value = image.texture;
    this.cleanMat.uniforms.tFluid.value = fluidTex[1];
    this.cleanMat.uniforms.tAlbedo.value = this.gbuf.textures[0];
    this.cleanMat.uniforms.tNormal.value = this.gbuf.textures[1];
    this.cleanMat.uniforms.uOn.value = s.cleanup ? 1 : 0;
    this.quad.material = this.cleanMat;
    r.setRenderTarget(null); r.render(this.quadScene, this.quadCam);
  }

  /** Debug and tools: the albedo + flag G-buffer the post shader reads (RGBA float, bottom row first). */
  readAlbedo(): Float32Array {
    const out = new Float32Array(this.width * this.height * 4);
    this.renderer.readRenderTargetPixels(this.gbuf, 0, 0, this.width, this.height, out, undefined, 0);
    return out;
  }

  /** Free GPU resources. The scene's geometries are disposed too; object geometries belong to the game and are not. */
  dispose() {
    for (const t of [this.gbufHi, this.shadowHi, this.gbuf, this.stylised, this.fluidBuf, this.withFluids, this.linearImage]) t?.dispose();
    this.light.shadow.map?.dispose(); this.objectLight?.shadow.map?.dispose(); this.lampShadows.dispose(); this.windowLight.texture.dispose(); this.windowLight.source.dispose();
    this.fluidMap.texture.dispose(); this.fluidMap.height.dispose(); this.noFluid.dispose();
    for (const m of [this.staticMesh, this.dynMesh, this.fluidMesh, this.quad]) m.geometry.dispose();
    for (const b of this.batches.values()) for (const m of b.meshes) m.dispose();
    for (const m of [this.staticMat, this.objectMat, this.dynMat, this.dynShadowMat, this.shadowMat, this.postMat, this.cleanMat, this.resolveMat, this.fluidMat]) (m as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
