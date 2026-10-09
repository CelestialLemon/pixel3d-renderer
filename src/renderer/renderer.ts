import * as THREE from 'three';
import type { Look } from './look';
import { resolveLimits, resolveScene, type RendererLimits, type PixelScene, type ResolvedPixelScene } from './scene';
import { BAYER4, POST_VERT } from './shaders/common';
import { GBUF_DYN_VERT, GBUF_FRAG, GBUF_OBJECT_MOTION_VERT, GBUF_OBJECT_VERT, GBUF_STATIC_VERT, POSE, POSE_OBJECT } from './shaders/gbuffer';
import { postFragment } from './shaders/post';
import { CLEAN_FRAG } from './shaders/cleanup';
import { RESOLVE_FRAG } from './shaders/resolve';
import { LampShadows } from './lampShadows';
import { buildWindowLight, type WindowLight } from './windowLight';
import { FLUID_FRAG, FLUID_VERT } from './shaders/water';
import { linearColor } from './geometry';
import { buildFluidMap, type FluidMap } from './fluidMap';
import { instanceData, MAX_HIGHLIGHTS, MIRROR_X, MOTION_ATTRIBUTES, OBJECT_ATTRIBUTES, ObjectBatch, PixelObject } from './objects';

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

/** Construction-time budgets. Omitted options preserve the original renderer's output. */
export interface PixelRendererOptions {
  /** Positive integer array capacities. Use the same limits when collecting fluids. */
  limits?: Partial<RendererLimits>;
  /** Samples per art pixel along each axis. Default 3; 1 is cheaper but thin features can flicker. */
  supersample?: 1 | 3;
  /** 0 = majority; k >= 1 = near-priority needing k + 1 of the 9 samples. Default 1. */
  resolvePolicy?: number;
  /** Restrict near-priority to thin-marked surfaces. Default true. */
  resolveThinOnly?: boolean;
  /** Square sun shadow map side, in texels. Default 4096. Clamped by three.js to the GPU's maximum. */
  shadowMapSize?: number;
  /** Square moving-object shadow map side. Defaults to shadowMapSize. Allocated with the first object. */
  objectShadowMapSize?: number;
  /**
   * Compile the object highlight shaders (`PixelObject.highlight`) in the background once the renderer has objects, so the
   * first highlight doesn't stall on them (seconds on a software GPU). Default false: they compile on first use.
   */
  warmHighlight?: boolean;
}

const positiveInteger = (name: string, value: number) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
};

/** What `pick` finds under a point of the canvas. */
export interface PickResult {
  /** The art pixel, from the top left of the canvas. */
  x: number; y: number;
  /**
   * World position of the surface drawn at the pixel's centre, or null over the sky. Fluids are seen through: this is the
   * surface below. So are objects drawn with an opacity below 1: this is the surface behind them.
   */
  world: THREE.Vector3 | null;
  /** Its world normal, or null over the sky. */
  normal: THREE.Vector3 | null;
  /**
   * The object drawn there, or null for the baked scene, the sky or an object removed since the last `renderGeometry`.
   * Never an object that was drawn with an opacity below 1.
   */
  object: PixelObject | null;
}

/** Patch a three.js shader chunk; fail loudly if a three upgrade renames it, rather than silently drawing unposed. */
const patch = (src: string, find: string, put: string) => {
  if (!src.includes(find)) throw new Error(`posed shadow: three's shader has no '${find}'`);
  return src.replace(find, put);
};

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
  readonly pixelScene: ResolvedPixelScene;
  readonly limits: Readonly<RendererLimits>;
  readonly shadowMapSize: number;
  readonly objectShadowMapSize: number;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300);
  /** Image translation from the snapped camera to the requested camera, in art pixels (+x right, +y down). */
  readonly snapShift = new THREE.Vector2();
  readonly scene = new THREE.Scene();
  readonly light = new THREE.DirectionalLight(0xffffff, 1);

  /** Supersampled G-buffer (S x S per art pixel) and sun-shadow mask, rasterised by `renderGeometry`. */
  private gbufHi!: THREE.WebGLRenderTarget;
  private shadowHi!: THREE.WebGLRenderTarget;
  /** Resolved to art resolution: albedo+flag, normal+depth, shadow (alpha) + object id (red). What the post shader reads. */
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
  /** The same mask for objects without motion, dropping the pixels a see-through object's dither drops. */
  private objectShadowMat: THREE.ShadowMaterial;
  private postMat: THREE.ShaderMaterial;
  private cleanMat: THREE.ShaderMaterial;
  /** The same two with the highlight code (`HIGHLIGHT`) and the same uniforms, drawn while an object is highlighted. */
  private postHiMat: THREE.ShaderMaterial;
  private cleanHiMat: THREE.ShaderMaterial;
  /** Whether the highlight variants still have to be compiled ahead of the first hover (`warmHighlight`, renderStyle). */
  private highlightWarmPending: boolean;
  /** The background compile `warmHighlight` started, until it settles: `dispose` waits for it (three polls the materials). */
  private warming: Promise<unknown> | null = null;
  private disposed = false;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private shadowDirty = true;
  /** Objects the game added, one instanced batch per geometry, drawn with `objectMat`. */
  private batches = new Map<THREE.BufferGeometry, ObjectBatch>();
  /** Every live object by its id, for `pick`. Ids start at 1 (0 in the G-buffer means no object) and are never reused. */
  private objectsById = new Map<number, PixelObject>();
  private nextObjectId = 1;
  /**
   * The highlighted objects (`PixelObject.highlight`), their ids in `uHighlight`. Only the HIGHLIGHT variants of the post
   * and clean-up shaders do the highlight work, and they are drawn only while this is not empty, so it costs nothing otherwise.
   */
  private highlighted = new Set<PixelObject>();
  /** The camera the G-buffer was last rendered with (`placeCamera` may have moved it since): what `pick` reads against. */
  private drawnCamera = { position: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3(), texel: 1 };
  private pickBuf = new Float32Array(4);
  /** The ids of the objects drawn see-through (opacity below 1) by the last `renderGeometry`: `pick` looks behind them. */
  private seeThroughIds = new Set<number>();
  /** A copy of the camera the G-buffer was last rendered with, and the small G-buffer `pick` renders behind see-through objects. */
  private pickCamera = new THREE.OrthographicCamera();
  /** The night level the last G-buffer was drawn at (fireflies show only at night); `setLook` may change it before a pick. */
  private drawnNight = 0;
  private pickTargets?: { hi: THREE.WebGLRenderTarget; resolved: THREE.WebGLRenderTarget };
  /**
   * Batch meshes replaced (growth) or emptied (last object removed) since the last `renderGeometry`. They stay in the scene,
   * still holding that frame's instances, until the next one, so `pick` can render the frame it describes behind a
   * see-through object; `renderGeometry` then drops them.
   */
  private retired: THREE.InstancedMesh[] = [];
  /** False until `renderGeometry` has filled the G-buffer at the current size: `pick` finds nothing before that. */
  private gbufDrawn = false;
  private objectMat: THREE.ShaderMaterial;
  /** Objects with ambient motion (see POSE_OBJECT): the G-buffer, their sun-shadow caster and their shadow-mask receiver. */
  private objectMotionMat: THREE.ShaderMaterial;
  private objectDepthMat: THREE.MeshDepthMaterial;
  private objectMaskMat: THREE.ShadowMaterial;
  /** A visible object spins or swings, so the object shadow map follows the clock; the clock it was last drawn at. */
  private rigidObjectsShown = false;
  private objectShadowTime = NaN;
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

  constructor(readonly canvas: HTMLCanvasElement, scene: PixelScene, options: PixelRendererOptions = {}) {
    const pixelScene = this.pixelScene = resolveScene(scene);
    this.limits = resolveLimits(options.limits);
    this.shadowMapSize = positiveInteger('shadowMapSize', options.shadowMapSize ?? 4096);
    this.objectShadowMapSize = positiveInteger('objectShadowMapSize', options.objectShadowMapSize ?? this.shadowMapSize);
    this.supersample = options.supersample ?? 3;
    this.highlightWarmPending = options.warmHighlight ?? false;
    if (this.supersample !== 1 && this.supersample !== 3) throw new RangeError('supersample must be 1 or 3');
    this.resolvePolicy = options.resolvePolicy ?? 1;
    if (!Number.isSafeInteger(this.resolvePolicy) || this.resolvePolicy < 0 || this.resolvePolicy > 8) {
      throw new RangeError('resolvePolicy must be an integer from 0 to 8');
    }
    this.resolveThinOnly = options.resolveThinOnly ?? true;
    // Fail before allocating a WebGL context or scene resources when a scene exceeds its shader capacities.
    for (const [key, count] of [
      ['lamps', pixelScene.lamps.length], ['grooves', pixelScene.grooves?.positions.length ?? 0],
      ['fluidMaterials', pixelScene.fluids.materials.length], ['fluidSources', pixelScene.fluids.sources.length],
    ] as const) {
      if (count > this.limits[key]) throw new RangeError(`Scene ${key}: at most ${this.limits[key]} entries are supported, got ${count}`);
    }
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
    // Count one vector per scalar/vec uniform or array entry, a conservative budget without relying on GPU packing.
    const uniformVectors = 64 + 2 * this.limits.lamps + this.limits.grooves
      + 4 * this.limits.fluidMaterials + 2 * this.limits.fluidSources;
    const context = this.renderer.getContext();
    const maxUniformVectors = context.getParameter(context.MAX_FRAGMENT_UNIFORM_VECTORS) as number;
    if (uniformVectors > maxUniformVectors) {
      this.renderer.forceContextLoss();
      this.renderer.dispose();
      throw new RangeError(`Renderer limits need up to ${uniformVectors} fragment uniform vectors, but this GPU supports ${maxUniformVectors}; lower the limits`);
    }
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

    this.objectMat = new THREE.ShaderMaterial({ vertexShader: GBUF_OBJECT_VERT, fragmentShader: GBUF_FRAG, glslVersion: THREE.GLSL3, side: THREE.FrontSide, uniforms: { uSS: { value: 1 }, uSeeThrough: { value: 0 } } });
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
    this.setupSun(this.light, radius, this.shadowMapSize);
    this.scene.add(this.light, this.light.target);

    // Writes shadow occlusion (0 = lit, 1 = shadowed) into alpha, no blending. The mask pass gives it to the static world
    // and the objects in place of their own material, so it also decides their sides in the object shadow map drawn then.
    this.shadowMat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 1 });
    this.shadowMat.transparent = false; this.shadowMat.blending = THREE.NoBlending; this.shadowMat.shadowSide = THREE.DoubleSide;
    // Objects drawn see-through (PixelObject.opacity) drop the same pixels from the mask as from the G-buffer, so the mask
    // there is the surface behind. Opaque objects drop none.
    const opacityVarying = 'flat varying float vOpacity;';
    const opacity = 'vOpacity = 1.0 - float(uint(instanceColor.b) & 255u) / 255.0;';
    const ditherOut = `${opacityVarying}\nuniform int uSS;\n${BAYER4}\nvoid main() {\n  if (vOpacity < 0.999 && vOpacity < bayer4(ivec2(gl_FragCoord.xy) / uSS)) discard;`;
    this.objectShadowMat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 1 });
    this.objectShadowMat.transparent = false; this.objectShadowMat.blending = THREE.NoBlending; this.objectShadowMat.shadowSide = THREE.DoubleSide;
    this.objectShadowMat.onBeforeCompile = (shader) => {
      shader.uniforms.uSS = this.objectMat.uniforms.uSS;
      const v = patch(shader.vertexShader, '#include <common>', `#include <common>\n${opacityVarying}`);
      shader.vertexShader = patch(v, '#include <begin_vertex>', `#include <begin_vertex>\n  ${opacity}`);
      shader.fragmentShader = patch(shader.fragmentShader, 'void main() {', ditherOut);
    };
    this.objectShadowMat.customProgramCacheKey = () => 'pixel3d-object-shadow';
    // The same mask for the rigid moving parts (spin, swing): three's shadow shader with each vertex posed by the G-buffer's
    // motion code (POSE), sharing its time uniforms. Other dynamic modes are discarded and keep the mask behind them.
    this.dynShadowMat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 1, side: THREE.DoubleSide });
    this.dynShadowMat.transparent = false; this.dynShadowMat.blending = THREE.NoBlending;
    this.dynShadowMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.dynMat.uniforms.uTime; shader.uniforms.uNight = this.dynMat.uniforms.uNight;
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
    // Objects with motion attributes, posed by POSE_OBJECT in every pass: the shared clock, an id-phased copy per instance.
    const motionUniforms = { uTime: this.dynMat.uniforms.uTime, uNight: this.dynMat.uniforms.uNight };
    this.objectMotionMat = new THREE.ShaderMaterial({
      vertexShader: GBUF_OBJECT_MOTION_VERT, fragmentShader: GBUF_FRAG, glslVersion: THREE.GLSL3, side: THREE.FrontSide,
      uniforms: { ...motionUniforms, uSS: { value: 1 }, uSeeThrough: this.objectMat.uniforms.uSeeThrough },
    });
    this.objectMotionMat.shadowSide = THREE.DoubleSide;
    const poseHeader = `uniform float uTime; uniform float uNight;
attribute float aMode; attribute vec3 aAnchor; attribute vec4 aAnim;
varying float vMode;
${POSE_OBJECT}`;
    const posed = 'vec3 posedW, posedN; float posedA;\n  poseObject(modelMatrix * instanceMatrix, instanceColor.r, posedW, posedN, posedA); vMode = aMode;';
    const project = 'vec4 mvPosition = viewMatrix * vec4(posedW, 1.0);\n  gl_Position = projectionMatrix * mvPosition;';
    // The caster: spin and swing at their pose, still parts and sway at rest (a gently swaying crop keeps its shadow,
    // and the map isn't redrawn every frame for it), and the small moving bits (conveyor, smoke, wings) cast none.
    this.objectDepthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.objectDepthMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, motionUniforms);
      let v = patch(shader.vertexShader, '#include <common>', `#include <common>\n${poseHeader}`);
      v = patch(v, '#include <begin_vertex>', `#include <begin_vertex>\n  ${posed}\n  if (aMode < 5.5) posedW = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;`);
      shader.vertexShader = patch(v, '#include <project_vertex>', project);
      shader.fragmentShader = patch(shader.fragmentShader, 'void main() {', 'varying float vMode;\nvoid main() {\n  if (vMode > 1.5 && vMode < 5.5) discard;');
    };
    this.objectDepthMat.customProgramCacheKey = () => 'pixel3d-object-depth';
    // The receiver: the mask at the posed surface. Smoke, wings and fireflies are dropped and borrow the mask behind them,
    // as the baked ones do.
    this.objectMaskMat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 1 });
    this.objectMaskMat.transparent = false; this.objectMaskMat.blending = THREE.NoBlending; this.objectMaskMat.shadowSide = THREE.DoubleSide;
    this.objectMaskMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, motionUniforms, { uSS: this.objectMat.uniforms.uSS });
      let v = patch(shader.vertexShader, '#include <common>', `#include <common>\n${poseHeader}\n${opacityVarying}`);
      v = patch(v, '#include <beginnormal_vertex>', `${posed}\n  ${opacity}\n  #include <beginnormal_vertex>`);
      v = patch(v, '#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalize(mat3(viewMatrix) * posedN);');
      v = patch(v, '#include <project_vertex>', project);
      shader.vertexShader = patch(v, '#include <worldpos_vertex>', 'vec4 worldPosition = vec4(posedW, 1.0);');
      shader.fragmentShader = patch(shader.fragmentShader, 'void main() {', `varying float vMode;\n${ditherOut}\n  if (vMode > 2.5 && vMode < 5.5) discard;`);
    };
    this.objectMaskMat.customProgramCacheKey = () => 'pixel3d-object-mask';

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
    const maps = pixelScene.maps;
    this.fluidMap = maps ? { texture: maps.fluids.texture.clone(), height: maps.fluids.height.clone(), bounds: [...maps.fluids.bounds] }
      : buildFluidMap(fluids, pixelScene.staticGeometry);
    const mats = fluids.materials, src = fluids.sources;
    const fluidVec = (pick: (m: typeof mats[number]) => [number, number, number, number]) =>
      padded(mats.map((m) => new THREE.Vector4(...pick(m))), this.limits.fluidMaterials, () => new THREE.Vector4());
    const gl = this.renderer.getContext();
    this.lampShadows = new LampShadows(lamps, pixelScene.staticGeometry,
      Math.min(this.renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number));
    this.windowLight = maps ? { texture: maps.windows.texture.clone(), source: maps.windows.source.clone(),
      bounds: [...maps.windows.bounds], panes: maps.windows.panes } : buildWindowLight(pixelScene.staticGeometry, lamps);
    const common = { glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false } as const;
    this.postMat = new THREE.ShaderMaterial({
      ...common, vertexShader: POST_VERT, fragmentShader: postFragment(this.limits),
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
        // Position and radius share one vec4 per lamp, to keep the fragment uniform count low.
        uLamp: { value: padded(lamps.map((l) => new THREE.Vector4(l.position.x, l.position.y, l.position.z, l.radius)), this.limits.lamps, () => new THREE.Vector4(0, 0, 0, 1)) },
        uLampCol: { value: padded(lamps.map((l) => new THREE.Vector3(...l.color)), this.limits.lamps, () => new THREE.Vector3()) },
        tWindow: { value: this.windowLight.texture }, tWindowSource: { value: this.windowLight.source },
        uWindowBounds: { value: new THREE.Vector4(...this.windowLight.bounds) },
        uPass: { value: 0 }, uDeferGrade: { value: 0 }, tImage: { value: null }, tFluidN: { value: null }, tFluidF: { value: null },
        tFluidMap: { value: this.fluidMap.texture }, tFluidHeight: { value: this.fluidMap.height }, uFluidBounds: { value: new THREE.Vector4(...this.fluidMap.bounds) },
        // Packed four vec4 per material and one per source (see waterGLSL in shaders/water.ts).
        uFluidA: { value: fluidVec((m) => [...linearColor(m.shallow), m.clarity]) },
        uFluidB: { value: fluidVec((m) => [...linearColor(m.deep), m.reflectivity]) },
        uFluidC: { value: fluidVec((m) => [...linearColor(m.foam), m.roughness]) },
        uFluidD: { value: fluidVec((m) => [m.waveScale, m.foamAmount, m.emission, 0]) },
        uSourceCount: { value: src.length },
        uSources: { value: padded(src.map((o) => new THREE.Vector4(o.x, o.z, o.rings ? o.radius : -o.radius, o.strength)), this.limits.fluidSources, () => new THREE.Vector4()) },
        uSourceY: { value: padded(src.map((o) => o.y ?? -1e4), this.limits.fluidSources, () => -1e4) },
        uGrooveCount: { value: grooves?.positions.length ?? 0 },
        uGrooves: { value: padded(grooves?.positions ?? [], this.limits.grooves, () => 0) },
        uGrooveAxis: { value: new THREE.Vector3(...(grooves?.axis ?? [1, 0, 0])) },
        uGrooveY: { value: new THREE.Vector2(...(grooves?.yRange ?? [0, 0])) },
        uHighlight: { value: new THREE.Vector4() },
      },
    });
    this.cleanMat = new THREE.ShaderMaterial({
      ...common, vertexShader: POST_VERT, fragmentShader: CLEAN_FRAG,
      uniforms: { tImage: { value: null }, tAlbedo: { value: null }, tNormal: { value: null }, tShadow: { value: null }, tFluid: { value: null }, uRes: { value: new THREE.Vector2() }, uOn: { value: 1 },
        // Shared with the post material, which sets them (setHighlight, renderStyle): the highlight test needs the camera.
        ...Object.fromEntries(['uHighlight', 'uTexel', 'uRight', 'uUp', 'uFwd'].map((k) => [k, this.postMat.uniforms[k]])) },
    });
    this.resolveMat = new THREE.ShaderMaterial({
      ...common, vertexShader: POST_VERT, fragmentShader: RESOLVE_FRAG,
      uniforms: {
        tAlbedo: { value: null }, tNormal: { value: null }, tShadow: { value: null }, tObjectId: { value: null }, uS: { value: 1 }, uPolicy: { value: 0 }, uThinOnly: { value: 0 }, uTexel: { value: 0.05 },
        uRight: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3() },
      },
    });
    const highlightVariant = (m: THREE.ShaderMaterial) => new THREE.ShaderMaterial({
      ...common, vertexShader: POST_VERT, fragmentShader: m.fragmentShader, uniforms: m.uniforms, defines: { HIGHLIGHT: '' },
    });
    this.postHiMat = highlightVariant(this.postMat); this.cleanHiMat = highlightVariant(this.cleanMat);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** A shadow-casting sun covering the scene's shadow area, rendered only when asked (see `renderGeometry`). */
  private setupSun(light: THREE.DirectionalLight, radius: number, mapSize: number) {
    light.castShadow = true;
    light.shadow.autoUpdate = false;
    light.shadow.mapSize.set(mapSize, mapSize);
    const sc = light.shadow.camera;
    sc.left = -radius; sc.right = radius; sc.top = radius; sc.bottom = -radius; sc.near = 1; sc.far = 140;
    light.shadow.bias = -0.0004; light.shadow.normalBias = 0.03;
  }

  /**
   * Add an object the game moves. `geometry` is in the object's local space, with the attributes `GeometryCollector`
   * builds (position, normal, aColor, aFlag; quantise its colours together with the scene's). Many objects may share
   * one geometry; the renderer never disposes it. At most 2^24 objects can be added over the renderer's life (ids are never reused).
   * A geometry from a dynamic collector (`new GeometryCollector(true)`, a `motion.*` per part, anchors in local space)
   * has ambient motion, driven by the `renderGeometry` clock; each object's copy is out of step with the others.
   * The renderer reads the geometry's attributes when its first object is added.
   */
  addObject(geometry: THREE.BufferGeometry): PixelObject {
    const missing = OBJECT_ATTRIBUTES.filter((a) => !geometry.getAttribute(a));
    if (missing.length) throw new Error(`addObject: geometry has no ${missing.join(', ')} attribute`);
    const motion = MOTION_ATTRIBUTES.filter((a) => geometry.getAttribute(a));
    if (motion.length && motion.length < MOTION_ATTRIBUTES.length) {
      throw new Error(`addObject: geometry has ${motion.join(', ')} but not all of ${MOTION_ATTRIBUTES.join(', ')}`);
    }
    if (motion.length) for (const [name, size] of [['aMode', 1], ['aAnchor', 3], ['aAnim', 4]] as const) {
      const n = geometry.getAttribute(name).itemSize;
      if (n !== size) throw new Error(`addObject: ${name} has ${n} components, not ${size}`);
    }
    // Ids travel through float32 targets, which hold every integer only up to 2^24.
    if (this.nextObjectId > 2 ** 24) throw new RangeError('addObject: more than 2^24 objects added over this renderer\'s life');
    if (!this.objectLight) {
      const light = this.objectLight = new THREE.DirectionalLight(0xffffff, 1);
      this.setupSun(light, this.pixelScene.shadow.radius, this.objectShadowMapSize);
      light.position.copy(this.light.position); light.target.position.copy(this.light.target.position);
      light.target.updateMatrixWorld();
      this.scene.add(light, light.target);
    }
    let batch = this.batches.get(geometry);
    if (!batch) {
      batch = new ObjectBatch(geometry, motion.length ? { gbuffer: this.objectMotionMat, depth: this.objectDepthMat } : { gbuffer: this.objectMat });
      this.batches.set(geometry, batch);
      this.scene.add(...batch.meshes);
    }
    const o = new PixelObject(batch, this.nextObjectId++, (o) => this.removeObject(o), (o, on) => this.setHighlight(o, on));
    batch.objects.push(o);
    this.objectsById.set(o.id, o);
    const old = batch.grow();
    if (old.length) { this.retired.push(...old); this.scene.add(...batch.meshes); }
    this.objectShadowDirty = true;
    return o;
  }

  /** Turn `o`'s highlight on or off; false if `o` was removed (so it can't hold a slot). */
  private setHighlight(o: PixelObject, on: boolean): boolean {
    if (on && this.objectsById.get(o.id) !== o) return false;
    if (on && this.highlighted.size >= MAX_HIGHLIGHTS) {
      throw new RangeError(`PixelObject.highlight: at most ${MAX_HIGHLIGHTS} objects can be highlighted at once`);
    }
    if (on) this.highlighted.add(o); else this.highlighted.delete(o);
    const ids = Array.from(this.highlighted, (h) => h.id);
    this.postMat.uniforms.uHighlight.value.set(ids[0] ?? 0, ids[1] ?? 0, ids[2] ?? 0, ids[3] ?? 0);
    return true;
  }

  private removeObject(o: PixelObject) {
    const batch = o.batch, i = batch.objects.indexOf(o);
    if (i < 0) return;
    batch.objects.splice(i, 1);
    this.objectsById.delete(o.id);
    if (o.drawnCasts) this.objectShadowDirty = true;
    if (!batch.objects.length) { this.retired.push(...batch.meshes); this.batches.delete(batch.geometry); }
  }

  /**
   * Pack every visible object's transform, id, tint and opacity into its batch for this frame, its origin snapped to the
   * art-pixel grid, and note whether the object shadow map changed: a caster moved, appeared or went. An object with a
   * zero scale component or a zero opacity is not drawn.
   */
  private poseObjects() {
    const texel = this.viewHeight / this.height, w = this.camera.matrixWorld;
    const right = new THREE.Vector3().setFromMatrixColumn(w, 0), up = new THREE.Vector3().setFromMatrixColumn(w, 1), fwd = new THREE.Vector3().setFromMatrixColumn(w, 2);
    const p = new THREE.Vector3(), m = new THREE.Matrix4(), mm = new THREE.Matrix4();
    this.rigidObjectsShown = false;
    this.seeThroughIds.clear();
    for (const batch of this.batches.values()) {
      const counts = [0, 0, 0, 0];
      for (const o of batch.objects) {
        const shown = o.visible && o.opacity > 0 && o.scale.x !== 0 && o.scale.y !== 0 && o.scale.z !== 0;
        const casts = shown && o.castShadow && o.opacity >= 1;
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
          const mirrored = m.determinant() < 0, slot = ObjectBatch.slot(mirrored, casts), i = counts[slot]++;
          const mesh = batch.meshes[slot], [id, tint, extra] = instanceData(o);
          mesh.instanceColor!.setXYZ(i, id, tint, extra);
          mesh.setMatrixAt(i, mirrored ? mm.multiplyMatrices(MIRROR_X, m) : m);
          if (o.opacity < 1) this.seeThroughIds.add(o.id);
        }
        if (casts !== o.drawnCasts || (casts && !m.equals(o.drawn))) this.objectShadowDirty = true;
        if (shown) o.drawn.copy(m);
        o.drawnVisible = shown; o.drawnCasts = casts;
      }
      batch.meshes.forEach((mesh, k) => {
        mesh.count = counts[k];
        if (!counts[k]) return;   // nothing of it is drawn, so its stale instances don't matter
        for (const a of [mesh.instanceMatrix, mesh.instanceColor!]) {
          a.clearUpdateRanges(); a.addUpdateRange(0, counts[k] * a.itemSize); a.needsUpdate = true;
        }
      });
      if (batch.rigid && counts[0] + counts[1] > 0) this.rigidObjectsShown = true;
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
    this.width = w; this.height = h; this.gbufDrawn = false;
    this.renderer.setSize(w, h, false);
    const S = this.supersample === 3 ? 3 : 1;
    const mk = (opts: THREE.RenderTargetOptions, count = 1, k = 1) => new THREE.WebGLRenderTarget(w * k, h * k, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false, count, ...opts });
    for (const t of [this.gbufHi, this.shadowHi, this.gbuf, this.stylised, this.fluidBuf, this.withFluids, this.linearImage]) t?.dispose();
    // Full float depth avoids false depth discontinuities on planar roof/paving edges.
    // Albedo + flag, normal + depth, and the object id (R32F: exact to 2^24, a quarter of an RGBA float target).
    this.gbufHi = mk({ type: THREE.FloatType }, 3, S);
    this.gbufHi.textures[2].format = THREE.RedFormat;
    this.shadowHi = mk({ type: THREE.UnsignedByteType }, 1, S);
    this.gbuf = mk({ type: THREE.FloatType, depthBuffer: false }, 3);
    this.stylised = mk({ type: THREE.UnsignedByteType, depthBuffer: false });
    if (this.hasFluids) {   // a scene without fluids never needs these
      this.fluidBuf = mk({ type: THREE.FloatType }, 2);
      this.withFluids = mk({ type: THREE.UnsignedByteType, depthBuffer: false });
      this.linearImage = mk({ type: THREE.FloatType, depthBuffer: false });
    }
    this.staticMat.uniforms.uSS.value = S; this.objectMat.uniforms.uSS.value = S; this.objectMotionMat.uniforms.uSS.value = S; this.dynMat.uniforms.uSS.value = S; this.resolveMat.uniforms.uS.value = S;
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
    for (const m of this.retired) { this.scene.remove(m); m.dispose(); }
    this.retired = [];
    this.lampShadows.render(r);
    this.dynMat.uniforms.uTime.value = time;
    this.poseObjects();
    // Spinning and swinging objects cast a shadow that moves with the clock.
    if (this.rigidObjectsShown && time !== this.objectShadowTime) this.objectShadowDirty = true;
    this.objectShadowTime = time;
    const batches = [...this.batches.values()], objects = batches.flatMap((b) => b.meshes), casters = batches.flatMap((b) => b.casters);
    // Only the casting meshes go in the object shadow map; the others never cast.
    const setCasters = (staticWorld: boolean, objs: boolean) => { this.staticMesh.castShadow = staticWorld; for (const m of casters) m.castShadow = objs; };

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
    // Each mesh swaps in its mask material for this render (objects with motion need their posed one, so no override).
    r.setClearColor(0xffffff, 1);
    const autoClear = r.autoClear;
    try {
      setCasters(false, true);
      this.dynMesh.visible = false;
      this.staticMesh.material = this.shadowMat;
      for (const b of batches) for (const m of b.meshes) m.material = b.motion ? this.objectMaskMat : this.objectShadowMat;
      r.setRenderTarget(this.shadowHi); r.clear(); r.render(this.scene, this.camera);
      if (this.hasRigidParts) {
        // Then the rigid moving parts over it, depth-tested against the static world and the objects (no clear in between).
        this.dynMesh.visible = true; this.staticMesh.visible = false; this.scene.overrideMaterial = this.dynShadowMat;
        for (const m of objects) m.visible = false;
        r.autoClear = false; r.render(this.scene, this.camera);
      }
    } finally {
      r.autoClear = autoClear; this.scene.overrideMaterial = null;
      this.staticMesh.material = this.staticMat;
      for (const b of batches) for (const m of b.meshes) m.material = b.motion ? this.objectMotionMat : this.objectMat;
      r.shadowMap.needsUpdate = false; if (this.objectLight) this.objectLight.shadow.needsUpdate = false;
      setCasters(true, true);
      this.staticMesh.visible = true; this.dynMesh.visible = true;
      for (const m of objects) m.visible = true;
    }

    const ru = this.resolveMat.uniforms;
    ru.tAlbedo.value = this.gbufHi.textures[0]; ru.tNormal.value = this.gbufHi.textures[1]; ru.tShadow.value = this.shadowHi.texture;
    ru.tObjectId.value = this.gbufHi.textures[2];
    ru.uPolicy.value = this.resolvePolicy; ru.uThinOnly.value = this.resolveThinOnly ? 1 : 0; ru.uTexel.value = this.viewHeight / this.height;
    ru.uRight.value.setFromMatrixColumn(this.camera.matrixWorld, 0);
    ru.uUp.value.setFromMatrixColumn(this.camera.matrixWorld, 1);
    ru.uFwd.value.setFromMatrixColumn(this.camera.matrixWorld, 2).negate();
    this.quad.material = this.resolveMat;
    r.setRenderTarget(this.gbuf); r.render(this.quadScene, this.quadCam);
    const dc = this.drawnCamera;
    this.gbufDrawn = true;
    dc.position.copy(this.camera.position); dc.right.copy(ru.uRight.value); dc.up.copy(ru.uUp.value); dc.fwd.copy(ru.uFwd.value); dc.texel = ru.uTexel.value;
    if (this.seeThroughIds.size) { this.pickCamera.copy(this.camera); this.drawnNight = this.dynMat.uniforms.uNight.value; }

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

  /** Stylise the G-buffer. `renderStyle(time)` uses DEFAULT_SETTINGS; time drives clouds and fluids. */
  renderStyle(time?: number): void;
  renderStyle(settings: RenderSettings | undefined, time?: number): void;
  renderStyle(settings: RenderSettings | number = DEFAULT_SETTINGS, time = 0) {
    const s = typeof settings === 'number' ? DEFAULT_SETTINGS : settings;
    const lit = this.highlighted.size > 0, postMat = lit ? this.postHiMat : this.postMat, cleanMat = lit ? this.cleanHiMat : this.cleanMat;
    if (typeof settings === 'number') time = settings;
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
    this.quad.material = postMat;
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
    this.cleanMat.uniforms.tShadow.value = this.gbuf.textures[2];
    this.cleanMat.uniforms.uOn.value = s.cleanup ? 1 : 0;
    this.quad.material = cleanMat;
    r.setRenderTarget(null); r.render(this.quadScene, this.quadCam);
    if (this.highlightWarmPending && this.batches.size) this.warmHighlight();
  }

  /**
   * Compile the highlight variants in the background (`warmHighlight`). Each is compiled against the target it draws to,
   * which is part of three's program key.
   */
  private warmHighlight() {
    this.highlightWarmPending = false;
    const r = this.renderer, target = r.getRenderTarget();
    const compiles = ([[this.postHiMat, this.linearImage ?? this.stylised], [this.cleanHiMat, null]] as const).map(([m, to]) => {
      const scene = new THREE.Scene().add(new THREE.Mesh(this.quad.geometry, m));
      r.setRenderTarget(to);
      return r.compileAsync(scene, this.quadCam).catch(() => {});   // a failure shows when the variant is first drawn instead
    });
    r.setRenderTarget(target);
    const warming: Promise<unknown> = this.warming = Promise.all(compiles).finally(() => { if (this.warming === warming) this.warming = null; });
  }

  /**
   * What is drawn under a point of the page (`clientX`/`clientY` of a mouse or pointer event), as of the last
   * `renderGeometry`; null outside the canvas, or before the first `renderGeometry` since the last `resize`.
   * Reads one pixel back from the GPU, so call it on input, not every frame.
   */
  pick(clientX: number, clientY: number): PickResult | null {
    const rect = this.canvas.getBoundingClientRect();
    return this.pickPixel((clientX - rect.left) / rect.width * this.width, (clientY - rect.top) / rect.height * this.height);
  }

  /** `pick` for an art pixel (from the top left of the canvas; fractions are dropped). */
  pickPixel(px: number, py: number): PickResult | null {
    const x = Math.floor(px), y = Math.floor(py);
    if (!this.gbufDrawn || !(x >= 0 && y >= 0 && x < this.width && y < this.height)) return null;   // also rejects NaN
    const gy = this.height - 1 - y, read = (i: number) => {   // the G-buffer's rows go bottom up
      this.renderer.readRenderTargetPixels(this.gbuf, x, gy, 1, 1, this.pickBuf, undefined, i);
      return this.pickBuf;
    };
    const res: PickResult = { x, y, world: null, normal: null, object: null };
    if (read(0)[3] < 0.5) return res;   // albedo alpha 0: sky (flags.ts)
    let [nx, ny, nz, depth] = read(1);
    let id = Math.round(read(2)[0]);
    if (this.seeThroughIds.has(id)) {   // a see-through object: what is behind it
      const behind = this.pickBehind(x, gy);
      if (behind[0][3] < 0.5) return res;   // sky behind it
      [nx, ny, nz, depth] = behind[1]; id = Math.round(behind[2][0]);
    }
    // The resolved depth is the surface's depth at the pixel centre, as in post.ts's worldAt().
    const c = this.drawnCamera;
    res.normal = new THREE.Vector3(nx, ny, nz);
    res.world = c.position.clone()
      .addScaledVector(c.right, (x + 0.5 - 0.5 * this.width) * c.texel)
      .addScaledVector(c.up, (gy + 0.5 - 0.5 * this.height) * c.texel)
      .addScaledVector(c.fwd, depth);
    res.object = this.objectsById.get(id) ?? null;
    return res;
  }

  /**
   * The resolved G-buffer at art pixel (x, gy) (rows bottom up) without the see-through objects, as of the last
   * `renderGeometry`: albedo + flag, normal + depth and object id. Renders the scene again, at the same supersampling, into
   * the 4 x 4 block of art pixels holding it (aligned so dithered surfaces keep their pattern), and resolves it as
   * `renderGeometry` does.
   */
  private pickBehind(x: number, gy: number): [Float32Array, Float32Array, Float32Array] {
    const r = this.renderer, x0 = x - (x & 3), y0 = gy - (gy & 3), cam = this.pickCamera;
    const S = this.staticMat.uniforms.uSS.value as number;
    const make = (size: number) => new THREE.WebGLRenderTarget(size, size, { count: 3, type: THREE.FloatType, minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false });
    if (this.pickTargets?.hi.width !== 4 * S) {
      this.pickTargets?.hi.dispose(); this.pickTargets?.resolved.dispose();
      this.pickTargets = { hi: make(4 * S), resolved: make(4) };
    }
    const { hi, resolved } = this.pickTargets;
    cam.setViewOffset(this.width, this.height, x0, this.height - y0 - 4, 4, 4);
    const ru = this.resolveMat.uniforms, inputs = [ru.tAlbedo.value, ru.tNormal.value, ru.tShadow.value, ru.tObjectId.value];
    const target = r.getRenderTarget(), clear = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    const night = this.dynMat.uniforms.uNight, nightNow = night.value;
    try {
      this.objectMat.uniforms.uSeeThrough.value = 1; night.value = this.drawnNight;
      r.setClearColor(0x000000, 0); r.setRenderTarget(hi); r.clear(); r.render(this.scene, cam);
      // The shadow input is unused here (only the albedo, normal and id are read back).
      ru.tAlbedo.value = hi.textures[0]; ru.tNormal.value = hi.textures[1]; ru.tShadow.value = hi.textures[0]; ru.tObjectId.value = hi.textures[2];
      this.quad.material = this.resolveMat;
      r.setRenderTarget(resolved); r.render(this.quadScene, this.quadCam);
    } finally {
      this.objectMat.uniforms.uSeeThrough.value = 0; night.value = nightNow;
      [ru.tAlbedo.value, ru.tNormal.value, ru.tShadow.value, ru.tObjectId.value] = inputs;
      r.setRenderTarget(target); r.setClearColor(clear, alpha);
    }
    return [0, 1, 2].map((i) => {
      const out = new Float32Array(4);
      r.readRenderTargetPixels(resolved, x - x0, gy - y0, 1, 1, out, undefined, i);
      return out;
    }) as [Float32Array, Float32Array, Float32Array];
  }

  /** Debug and tools: the albedo + flag G-buffer the post shader reads (RGBA float, bottom row first). */
  readAlbedo(): Float32Array {
    const out = new Float32Array(this.width * this.height * 4);
    this.renderer.readRenderTargetPixels(this.gbuf, 0, 0, this.width, this.height, out, undefined, 0);
    return out;
  }

  /** Free GPU resources (later calls do nothing). The scene's geometries are disposed too; object geometries belong to the game and are not. */
  dispose() {
    if (this.disposed) return;   // once: a second call would queue a second deferred release
    this.disposed = true;
    this.gbufDrawn = false; this.objectsById.clear(); this.highlightWarmPending = false;
    for (const t of [this.gbufHi, this.shadowHi, this.gbuf, this.stylised, this.fluidBuf, this.withFluids, this.linearImage, this.pickTargets?.hi, this.pickTargets?.resolved]) t?.dispose();
    this.light.shadow.map?.dispose(); this.objectLight?.shadow.map?.dispose(); this.lampShadows.dispose(); this.windowLight.texture.dispose(); this.windowLight.source.dispose();
    this.fluidMap.texture.dispose(); this.fluidMap.height.dispose(); this.noFluid.dispose();
    for (const m of [this.staticMesh, this.dynMesh, this.fluidMesh, this.quad]) m.geometry.dispose();
    for (const b of this.batches.values()) for (const m of b.meshes) m.dispose();
    for (const m of this.retired) m.dispose();
    for (const m of [this.staticMat, this.objectMat, this.objectMotionMat, this.objectDepthMat, this.objectMaskMat, this.dynMat, this.dynShadowMat, this.shadowMat, this.objectShadowMat, this.postMat, this.cleanMat, this.resolveMat, this.fluidMat]) (m as THREE.Material).dispose();
    // three polls a background compile's materials on a timer, so they and the renderer go only once it has finished.
    const last = () => { this.postHiMat.dispose(); this.cleanHiMat.dispose(); this.renderer.dispose(); };
    if (this.warming) this.warming.then(last); else last();
  }
}
