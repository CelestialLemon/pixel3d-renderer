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

  /** @internal The transform drawn last frame, to tell whether the object sun-shadow map needs redrawing. */
  readonly drawn = new THREE.Matrix4();
  /** @internal */
  drawnVisible = false;

  private highlighted = false;

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

/** How many objects of one renderer can be highlighted at once (`PixelObject.highlight`). */
export const MAX_HIGHLIGHTS = 4;

/** The geometry attributes an object needs: what `GeometryCollector` (static, not dynamic) builds, in local space. */
export const OBJECT_ATTRIBUTES = ['position', 'normal', 'aColor', 'aFlag'] as const;

/** Mirror across x: turns a mirrored instance matrix into an unmirrored one (and back). */
export const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);

/**
 * Every object sharing one geometry, drawn as instanced meshes: one draw call however many there are. Visible objects
 * are packed into the first `count` instances each frame. Mirrored objects (negative scale) go in `mirrored`, a mesh
 * mirrored across x itself holding `MIRROR_X * matrix`: three reverses the front face for a mesh whose world matrix is
 * mirrored, in every pass, which it can't do per instance. Both meshes are replaced by ones twice the size when full.
 * Each instance's object id rides in `instanceColor.r` (per mesh, unlike a geometry attribute, and the geometry is the game's).
 */
export class ObjectBatch {
  readonly objects: PixelObject[] = [];
  mesh: THREE.InstancedMesh;
  mirrored: THREE.InstancedMesh;

  constructor(readonly geometry: THREE.BufferGeometry, private readonly material: THREE.Material, capacity = 16) {
    this.mesh = this.makeMesh(capacity, false);
    this.mirrored = this.makeMesh(capacity, true);
  }

  get meshes() { return [this.mesh, this.mirrored]; }

  private makeMesh(capacity: number, mirrored: boolean) {
    const m = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false;   // the instances move every frame; a stale bounding sphere would cull them
    m.count = 0;
    if (mirrored) m.scale.x = -1;
    return m;
  }

  /** Make room for every object in the batch. Returns the meshes it replaced, if it had to (the caller swaps them in the scene). */
  grow(): THREE.InstancedMesh[] {
    if (this.objects.length <= this.mesh.instanceMatrix.count) return [];
    const old = this.meshes;
    let capacity = this.mesh.instanceMatrix.count;
    while (capacity < this.objects.length) capacity *= 2;
    this.mesh = this.makeMesh(capacity, false);
    this.mirrored = this.makeMesh(capacity, true);
    return old;
  }
}
