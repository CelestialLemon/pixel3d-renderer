import * as THREE from 'three';
import type { Look } from './look';
import { LIMITS, type PixelScene } from './scene';
import { POST_VERT } from './shaders/common';
import { GBUF_DYN_VERT, GBUF_FRAG, GBUF_STATIC_VERT } from './shaders/gbuffer';
import { POST_FRAG } from './shaders/post';
import { CLEAN_FRAG } from './shaders/cleanup';
import { RESOLVE_FRAG } from './shaders/resolve';
import { LampShadows } from './lampShadows';

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
 * Per frame: `placeCamera`, then `renderGeometry` (rasterise the G-buffer and shadow mask) whenever the view
 * or the animation clock changed, then `renderStyle` (the post shader; cheap).
 */
export class PixelRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300);
  readonly scene = new THREE.Scene();
  readonly light = new THREE.DirectionalLight(0xffffff, 1);

  /** Supersampled G-buffer (S x S per art pixel) and sun-shadow mask, rasterised by `renderGeometry`. */
  private gbufHi!: THREE.WebGLRenderTarget;
  private shadowHi!: THREE.WebGLRenderTarget;
  /** Resolved to art resolution: albedo+flag, normal+depth, shadow (alpha). What the post shader reads. */
  private gbuf!: THREE.WebGLRenderTarget;
  private stylised!: THREE.WebGLRenderTarget;
  private staticMesh: THREE.Mesh;
  private staticMat: THREE.ShaderMaterial;
  private resolveMat: THREE.ShaderMaterial;
  private dynMesh: THREE.Mesh;
  private dynMat: THREE.ShaderMaterial;
  private shadowMat: THREE.ShadowMaterial;
  private postMat: THREE.ShaderMaterial;
  private cleanMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private shadowDirty = true;
  private shadowCenter: THREE.Vector3;
  private lampShadows: LampShadows;

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

    this.dynMat = new THREE.ShaderMaterial({
      vertexShader: GBUF_DYN_VERT, fragmentShader: GBUF_FRAG, glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uSS: { value: 1 } },
    });
    this.dynMesh = new THREE.Mesh(pixelScene.dynamicGeometry, this.dynMat);
    this.dynMesh.frustumCulled = false; this.dynMesh.castShadow = false;
    this.scene.add(this.staticMesh, this.dynMesh);

    const { center, radius } = pixelScene.shadow;
    this.shadowCenter = center.clone();
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(4096, 4096);
    const sc = this.light.shadow.camera;
    sc.left = -radius; sc.right = radius; sc.top = radius; sc.bottom = -radius; sc.near = 1; sc.far = 140;
    this.light.shadow.bias = -0.0004; this.light.shadow.normalBias = 0.03;
    this.scene.add(this.light, this.light.target);

    // Writes shadow occlusion (0 = lit, 1 = shadowed) into alpha, no blending.
    this.shadowMat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 1 });
    this.shadowMat.transparent = false; this.shadowMat.blending = THREE.NoBlending;

    const { lamps, ripples, grooves } = pixelScene;
    const gl = this.renderer.getContext();
    this.lampShadows = new LampShadows(lamps, pixelScene.staticGeometry,
      Math.min(this.renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number));
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
        uLampPos: { value: padded(lamps.map((l) => l.position.clone()), LIMITS.lamps, () => new THREE.Vector3()) },
        uLampCol: { value: padded(lamps.map((l) => new THREE.Vector3(...l.color)), LIMITS.lamps, () => new THREE.Vector3()) },
        uLampRad: { value: padded(lamps.map((l) => l.radius), LIMITS.lamps, () => 1) },
        uRippleCount: { value: ripples.length },
        uRipples: { value: padded(ripples.map(([x, z]) => new THREE.Vector2(x, z)), LIMITS.ripples, () => new THREE.Vector2()) },
        uGrooveCount: { value: grooves?.positions.length ?? 0 },
        uGrooves: { value: padded(grooves?.positions ?? [], LIMITS.grooves, () => 0) },
        uGrooveAxis: { value: new THREE.Vector3(...(grooves?.axis ?? [1, 0, 0])) },
        uGrooveY: { value: new THREE.Vector2(...(grooves?.yRange ?? [0, 0])) },
      },
    });
    this.cleanMat = new THREE.ShaderMaterial({
      ...common, vertexShader: POST_VERT, fragmentShader: CLEAN_FRAG,
      uniforms: { tImage: { value: null }, tAlbedo: { value: null }, tNormal: { value: null }, uRes: { value: new THREE.Vector2() }, uOn: { value: 1 } },
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

  /** Apply a time-of-day look: sun direction and strength, colour grade, sky, lamps. */
  setLook(look: Look) {
    const u = this.postMat.uniforms;
    const az = THREE.MathUtils.degToRad(look.sunAz), el = THREE.MathUtils.degToRad(look.sunEl);
    this.sun.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    this.light.position.copy(this.sun).multiplyScalar(60).add(this.shadowCenter);
    this.light.target.position.copy(this.shadowCenter);
    this.light.target.updateMatrixWorld();
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
    for (const t of [this.gbufHi, this.shadowHi, this.gbuf, this.stylised]) t?.dispose();
    // Full float depth avoids false depth discontinuities on planar roof/paving edges.
    this.gbufHi = mk({ type: THREE.FloatType }, 2, S);
    this.shadowHi = mk({ type: THREE.UnsignedByteType }, 1, S);
    this.gbuf = mk({ type: THREE.FloatType, depthBuffer: false }, 3);
    this.stylised = mk({ type: THREE.UnsignedByteType, depthBuffer: false });
    this.staticMat.uniforms.uSS.value = S; this.dynMat.uniforms.uSS.value = S; this.resolveMat.uniforms.uS.value = S;
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
    cam.position.addScaledVector(right, snapR).addScaledVector(up, snapU);
    cam.updateMatrixWorld();
  }

  /** Rasterise into the G-buffer (+ static shadow mask) with the dynamic mesh posed at `time` seconds. */
  renderGeometry(time: number) {
    const r = this.renderer;
    this.lampShadows.render(r);
    this.dynMat.uniforms.uTime.value = time;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.gbufHi); r.clear(); r.render(this.scene, this.camera);

    // The shadow mask only needs the static world; moving bits borrow the shadow of
    // whatever surface sits behind them, which is what a small tuft or puff would get.
    if (this.shadowDirty) { r.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    r.setClearColor(0xffffff, 1);
    this.dynMesh.visible = false;
    this.scene.overrideMaterial = this.shadowMat;
    r.setRenderTarget(this.shadowHi); r.clear(); r.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;
    this.dynMesh.visible = true;

    const ru = this.resolveMat.uniforms;
    ru.tAlbedo.value = this.gbufHi.textures[0]; ru.tNormal.value = this.gbufHi.textures[1]; ru.tShadow.value = this.shadowHi.texture;
    ru.uPolicy.value = this.resolvePolicy; ru.uThinOnly.value = this.resolveThinOnly ? 1 : 0; ru.uTexel.value = this.viewHeight / this.height;
    ru.uRight.value.setFromMatrixColumn(this.camera.matrixWorld, 0);
    ru.uUp.value.setFromMatrixColumn(this.camera.matrixWorld, 1);
    ru.uFwd.value.setFromMatrixColumn(this.camera.matrixWorld, 2).negate();
    this.quad.material = this.resolveMat;
    r.setRenderTarget(this.gbuf); r.render(this.quadScene, this.quadCam);
  }

  /** Stylise the G-buffer into the final pixel image on the canvas. `time` drives clouds and water. */
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

    this.quad.material = this.postMat;
    r.setRenderTarget(this.stylised); r.render(this.quadScene, this.quadCam);

    this.cleanMat.uniforms.tImage.value = this.stylised.texture;
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

  /** Free GPU resources. The scene's geometries are disposed too. */
  dispose() {
    for (const t of [this.gbufHi, this.shadowHi, this.gbuf, this.stylised]) t?.dispose();
    this.light.shadow.map?.dispose(); this.lampShadows.dispose();
    for (const m of [this.staticMesh, this.dynMesh, this.quad]) m.geometry.dispose();
    for (const m of [this.staticMat, this.dynMat, this.shadowMat, this.postMat, this.cleanMat, this.resolveMat]) (m as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
