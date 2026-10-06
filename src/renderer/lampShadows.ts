import * as THREE from 'three';
import type { Lamp } from './scene';

/** Pixel size of one cube face in the lamp shadow atlas, when the device allows it. */
export const LAMP_TILE = 256;
/** Default `Lamp.clearance`: a street lantern from its lamp to the corners of its tray. */
export const DEFAULT_CLEARANCE = 0.45;
/** Cube faces per atlas row (two lamps), when the device allows it. */
const COLS = 12;
/** Smallest face size tried before giving up: below this, lamp shadows are too coarse to be worth drawing. */
const MIN_TILE = 32;

export interface AtlasLayout { tile: number; cols: number; width: number; height: number }

/**
 * Atlas layout for `lamps` lamps (six faces each) that fits a device whose textures and renderbuffers are at most
 * `maxSize` pixels on a side (the smaller of MAX_TEXTURE_SIZE and MAX_RENDERBUFFER_SIZE; WebGL2 guarantees 2048).
 * Uses LAMP_TILE faces in rows of COLS when they fit, and otherwise halves the face size until they do.
 */
export function atlasLayout(lamps: number, maxSize: number): AtlasLayout {
  const tiles = Math.max(lamps, 1) * 6;
  for (let tile = LAMP_TILE; tile >= MIN_TILE; tile /= 2) {
    const cols = Math.min(COLS, Math.floor(maxSize / tile), tiles), rows = Math.ceil(tiles / cols);
    if (cols >= 1 && rows * tile <= maxSize) return { tile, cols, width: cols * tile, height: rows * tile };
  }
  throw new Error(`lamp shadows: ${lamps} lamps do not fit a ${maxSize}px texture even at ${MIN_TILE}px faces`);
}

// Cube faces as (forward, up). The post shader's lampFace() uses the same table; right = cross(forward, up).
const FACES: [THREE.Vector3Tuple, THREE.Vector3Tuple][] = [
  [[1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1]], [[0, -1, 0], [0, 0, 1]],
  [[0, 0, 1], [0, 1, 0]], [[0, 0, -1], [0, 1, 0]],
];

// Distance from the lamp. Solid surfaces cast lamp shadows, lit windows (emissive) included; plants, water,
// steam and fireflies let the light through. Record both triangle sides so a lamp inside a closed shell,
// or behind a single-sided panel, is still blocked. Clearance skips fragments near the lamp (e.g. its
// lantern base or shade); farther parts of the same fixture still block light.
const VERT = /* glsl */ `
in float aFlag;
out vec3 vW; out float vF;
void main(){ vW = position; vF = aFlag; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uLamp; uniform float uClearance;
in vec3 vW; in float vF;
out vec4 outDist;
void main(){
  int f = int(floor(vF + 0.5));
  float d = distance(vW, uLamp);
  if ((f != 0 && f != 1 && f != 6) || d < uClearance) discard;
  outDist = vec4(d);
}`;

/** Remove triangles the distance shader always discards before submitting them to all six faces per lamp. */
function solidOccluders(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position'), flags = geometry.getAttribute('aFlag'), input = geometry.index;
  const indices: number[] = [];
  const count = input?.count ?? position.count;
  const start = Math.max(0, geometry.drawRange.start), end = Math.min(count, geometry.drawRange.start + geometry.drawRange.count);
  for (let t = start; t + 2 < end; t += 3) {
    const a = input ? input.getX(t) : t, b = input ? input.getX(t + 1) : t + 1, c = input ? input.getX(t + 2) : t + 2;
    // Collector flags are constant per triangle. Keep mixed flags conservatively: interpolation can produce a solid flag.
    const value = flags.getX(a), f = Math.floor(value + 0.5);
    if (flags.getX(b) !== value || flags.getX(c) !== value || f === 0 || f === 1 || f === 6) indices.push(a, b, c);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', position); result.setAttribute('aFlag', flags); result.setIndex(indices);
  return result;
}

/**
 * One distance cube map per lamp, packed into a single float atlas: six LAMP_TILE² faces per lamp, COLS faces per row.
 * Lamps and the static world never move, so this renders once.
 */
export class LampShadows {
  /** Triangles submitted per cube face, after filtering non-occluders. */
  readonly occluderTriangles: number;
  private occluders: THREE.BufferGeometry;
  readonly target: THREE.WebGLRenderTarget;
  readonly size = new THREE.Vector2();
  /** Face size and faces per row actually used (see `atlasLayout`); the post shader reads the face size from a uniform. */
  readonly tile: number;
  private readonly cols: number;
  private rendered = false;

  /** `maxSize`: the device's texture and renderbuffer size limit (the smaller of the two). */
  constructor(private lamps: Lamp[], geometry: THREE.BufferGeometry, maxSize: number) {
    const layout = atlasLayout(lamps.length, maxSize);
    if (layout.tile < LAMP_TILE) console.warn(`lamp shadows: ${lamps.length} lamps need ${layout.tile}px faces to fit this device's ${maxSize}px limit`);
    this.tile = layout.tile; this.cols = layout.cols;
    this.occluders = lamps.length ? solidOccluders(geometry) : new THREE.BufferGeometry().setIndex([]);
    this.occluderTriangles = this.occluders.index!.count / 3;
    this.size.set(layout.width, layout.height);
    this.target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, {
      type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true, generateMipmaps: false,
    });
  }

  render(renderer: THREE.WebGLRenderer) {
    if (this.rendered) return;
    this.rendered = true;
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, glslVersion: THREE.GLSL3, side: THREE.DoubleSide, uniforms: { uLamp: { value: new THREE.Vector3() }, uClearance: { value: 0 } } });
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(this.occluders, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const cam = new THREE.PerspectiveCamera(90, 1, 0.02, 200);
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    // 0 means "nothing in the way" (the shader skips it), which avoids relying on huge clear values.
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.autoClear = false;            // one clear for the whole atlas; each face then draws into its own tile
    this.lamps.forEach((lamp, li) => {
      mat.uniforms.uLamp.value.copy(lamp.position);
      mat.uniforms.uClearance.value = lamp.clearance ?? DEFAULT_CLEARANCE;
      FACES.forEach(([f, u], fi) => {
        const t = li * 6 + fi, x = (t % this.cols) * this.tile, y = Math.floor(t / this.cols) * this.tile;
        cam.position.copy(lamp.position);
        cam.up.set(...u);
        cam.lookAt(lamp.position.clone().add(new THREE.Vector3(...f)));
        cam.updateMatrixWorld();
        this.target.viewport.set(x, y, this.tile, this.tile);
        renderer.setRenderTarget(this.target);
        renderer.render(scene, cam);
      });
    });
    renderer.autoClear = prevAutoClear;
    this.target.viewport.set(0, 0, this.size.x, this.size.y);
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClear, prevAlpha);
    mat.dispose();
  }

  dispose() {
    this.target.dispose();
    // These buffers belong to the caller's static geometry; only our filtered index is owned here.
    this.occluders.deleteAttribute('position'); this.occluders.deleteAttribute('aFlag');
    this.occluders.dispose();
  }
}
