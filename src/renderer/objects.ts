import * as THREE from 'three';

/**
 * A rigid object the game adds, moves and removes at runtime (`PixelRenderer.addObject`). The game owns the transform
 * and changes it whenever it likes, through `setTransform` or by writing `position`, `quaternion` and `scale`
 * directly; the renderer reads it at the next `renderGeometry`.
 */
export class PixelObject {
  /** World position of the object's origin. */
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly scale = new THREE.Vector3(1, 1, 1);
  visible = true;
  /**
   * Draw the object with its origin snapped to the art-pixel grid (in the camera's image plane), so it moves in
   * whole art pixels and doesn't shimmer. Its height in the world is kept (it is slid along the view direction instead).
   * `position` itself is never changed.
   */
  snap = true;
  /**
   * Cast a sun shadow. An object that casts none (items on a belt, a build preview) can move every frame without
   * redrawing the object shadow map. It still receives shadows. An object with `opacity` below 1 casts none either way.
   */
  castShadow = true;
  /**
   * Mix the object's surface colours towards this colour (linear, like any `THREE.Color`) by `tintStrength`, or null
   * for none. The mixed colour is shaded by the same ramps as any other, so the object stays in the pixel look. Per
   * object, so one of many copies of a geometry can be tinted alone. Read at the next `renderGeometry`, like
   * `position`, so it can be changed in place. Stored at 8 bits per channel (sRGB).
   */
  tint: THREE.Color | null = null;

  /** @internal The transform drawn last frame, to tell whether the object sun-shadow map needs redrawing. */
  readonly drawn = new THREE.Matrix4();
  /** @internal Whether the object was drawn last frame, and whether it was in the object shadow map. */
  drawnVisible = false;
  /** @internal */
  drawnCasts = false;

  private highlighted = false;
  private strength = 0.5;
  private alpha = 1;

  /**
   * @internal Created by `PixelRenderer.addObject`. `id` (from 1, never reused by that renderer) is what the
   * G-buffer stores where the object is drawn, so `pick` can tell which object is under a pixel.
   */
  constructor(readonly batch: ObjectBatch, readonly id: number, private readonly detach: (o: PixelObject) => void,
    private readonly onHighlight: (o: PixelObject, on: boolean) => boolean) {}

  /**
   * Draw a light rim around the object where it is visible, e.g. while the pointer is over it (see `pick`). Per object,
   * so one of many copies of a geometry can be highlighted alone. At most `MAX_HIGHLIGHTS` objects of a renderer are
   * highlighted at once: turning on one more throws a RangeError. Cheap to change. A removed object loses its
   * highlight and can't be highlighted again (setting it does nothing).
   */
  get highlight() { return this.highlighted; }
  set highlight(on: boolean) {
    if (on === this.highlighted) return;
    // False for a removed object; throws before anything changes if the renderer is full.
    if (this.onHighlight(this, on)) this.highlighted = on;
  }

  /**
   * How far `tint` moves the colours towards it, from 0 (unchanged) to 1 (the tint colour, shaded). Default 0.5.
   * Throws a RangeError outside 0 to 1. Stored at 8 bits.
   */
  get tintStrength() { return this.strength; }
  set tintStrength(v: number) { this.strength = unit('tintStrength', v); }

  /**
   * How opaque the object is, from 0 to 1 (default 1). Below 1 the object is drawn see-through with ordered-dither
   * discard, like the renderer's other transparency (a 4 x 4 pattern per art pixel, so 16 visible steps), and it casts no
   * sun shadow and `pick` sees through it (it finds what is behind). At 0 it is not drawn at all. Throws a RangeError
   * outside 0 to 1.
   */
  get opacity() { return this.alpha; }
  set opacity(v: number) { this.alpha = unit('opacity', v); }

  /** Copy a new transform. `rotation` and `scale` keep their current values when left out. */
  setTransform(position: THREE.Vector3, rotation?: THREE.Quaternion | THREE.Euler, scale?: THREE.Vector3 | number) {
    this.position.copy(position);
    if (rotation instanceof THREE.Euler) this.quaternion.setFromEuler(rotation);
    else if (rotation) this.quaternion.copy(rotation);
    if (typeof scale === 'number') this.scale.setScalar(scale);
    else if (scale) this.scale.copy(scale);
    return this;
  }

  /** Take the object out of the renderer. Its geometry belongs to the caller and is not disposed. */
  remove() { this.highlight = false; this.detach(this); }
}

const unit = (name: string, v: number) => {
  if (!(v >= 0 && v <= 1)) throw new RangeError(`PixelObject.${name} must be from 0 to 1, got ${v}`);   // also rejects NaN
  return v;
};

/** sRGB transfer of one linear channel, to 8 bits. */
const srgb8 = (c: number) => {
  const v = Math.min(Math.max(c, 0), 1);
  return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
};

/**
 * @internal What an instance carries besides its matrix, in `instanceColor` (float32, exact to 2^24): the object id in
 * r, the tint as 24-bit sRGB in g, and in b the tint strength (8 bits, high) and the opacity's complement (8 bits, low;
 * 0 = opaque, so any opacity below 1 is at least 1). Decoded by INSTANCE_DATA (shaders/gbuffer.ts).
 */
export function instanceData(o: PixelObject): [number, number, number] {
  const t = o.tint, strength = t ? Math.round(o.tintStrength * 255) : 0;
  const rgb = t && strength ? (srgb8(t.r) << 16) | (srgb8(t.g) << 8) | srgb8(t.b) : 0;
  const clear = o.opacity < 1 ? Math.max(1, Math.round((1 - o.opacity) * 255)) : 0;
  return [o.id, rgb, strength * 256 + clear];
}

/** How many objects of one renderer can be highlighted at once (`PixelObject.highlight`). */
export const MAX_HIGHLIGHTS = 4;

/** The geometry attributes an object needs: what `GeometryCollector` (static, not dynamic) builds, in local space. */
export const OBJECT_ATTRIBUTES = ['position', 'normal', 'aColor', 'aFlag'] as const;
/**
 * The attributes a dynamic `GeometryCollector` adds. An object geometry with them has ambient motion (motion.ts), its
 * anchors in the object's local space.
 */
export const MOTION_ATTRIBUTES = ['aMode', 'aAnchor', 'aAnim'] as const;

/** How a batch draws: its G-buffer material, and for animated geometry the material posing it in the sun-shadow map. */
export interface BatchMaterials {
  gbuffer: THREE.Material;
  depth?: THREE.Material;
}

/** Mirror across x: turns a mirrored instance matrix into an unmirrored one (and back). */
export const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);

/**
 * Every object sharing one geometry, drawn as instanced meshes: one draw call per mesh however many there are. Visible
 * objects are packed into the first `count` instances each frame. Mirrored objects (negative scale) go in a mesh
 * mirrored across x itself holding `MIRROR_X * matrix`: three reverses the front face for a mesh whose world matrix is
 * mirrored, in every pass, which it can't do per instance. Objects that cast no sun shadow go in two meshes of their
 * own, left out of the shadow map. All four are replaced by ones twice the size when full.
 * Each instance's id, tint and opacity ride in `instanceColor` (per mesh, unlike a geometry attribute, and the geometry
 * is the game's; see `instanceData`).
 */
export class ObjectBatch {
  readonly objects: PixelObject[] = [];
  /** Casting, casting mirrored, not casting, not casting mirrored (see `slot`). */
  meshes: THREE.InstancedMesh[];

  /** The geometry has motion attributes (MOTION_ATTRIBUTES). */
  readonly motion: boolean;
  /** Some of its parts spin or swing, so its sun shadow moves with the clock. */
  readonly rigid: boolean;

  constructor(readonly geometry: THREE.BufferGeometry, private readonly materials: BatchMaterials, capacity = 16) {
    const modes = geometry.getAttribute('aMode');
    this.motion = !!modes;
    this.rigid = !!modes && Array.from(modes.array).some((m) => m > 5.5);
    this.meshes = this.makeMeshes(capacity);
  }

  /** The mesh an object goes in. */
  static slot(mirrored: boolean, casts: boolean) { return (mirrored ? 1 : 0) + (casts ? 0 : 2); }
  get mesh() { return this.meshes[0]; }
  get mirrored() { return this.meshes[1]; }
  /** The meshes in the object shadow map. */
  get casters() { return this.meshes.slice(0, 2); }

  private makeMeshes(capacity: number) {
    return [0, 1, 2, 3].map((slot) => {
      const m = new THREE.InstancedMesh(this.geometry, this.materials.gbuffer, capacity);
      if (this.materials.depth) m.customDepthMaterial = this.materials.depth;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
      m.castShadow = slot < 2; m.receiveShadow = true;
      m.frustumCulled = false;   // the instances move every frame; a stale bounding sphere would cull them
      m.count = 0;
      if (slot % 2) m.scale.x = -1;
      return m;
    });
  }

  /** Make room for every object in the batch. Returns the meshes it replaced, if it had to (the caller swaps them in the scene). */
  grow(): THREE.InstancedMesh[] {
    if (this.objects.length <= this.mesh.instanceMatrix.count) return [];
    const old = this.meshes;
    let capacity = this.mesh.instanceMatrix.count;
    while (capacity < this.objects.length) capacity *= 2;
    this.meshes = this.makeMeshes(capacity);
    return old;
  }
}
