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

/**
 * One distance cube map per lamp, packed into a single float atlas: six LAMP_TILE² faces per lamp, COLS faces per row.
 * Lamps and the static world never move, so this renders once.
 */
export class LampShadows {
  readonly target: THREE.WebGLRenderTarget;
  readonly size = new THREE.Vector2();
  /** Face size and faces per row actually used (see `atlasLayout`); the post shader reads the face size from a uniform. */
  readonly tile: number;
  private readonly cols: number;
  private rendered = false;

  /** `maxSize`: the device's texture and renderbuffer size limit (the smaller of the two). */
  constructor(private lamps: Lamp[], private geometry: THREE.BufferGeometry, maxSize: number) {
    const layout = atlasLayout(lamps.length, maxSize);
    if (layout.tile < LAMP_TILE) console.warn(`lamp shadows: ${lamps.length} lamps need ${layout.tile}px faces to fit this device's ${maxSize}px limit`);
    this.tile = layout.tile; this.cols = layout.cols;
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
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(this.geometry, mat);
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

  dispose() { this.target.dispose(); }
}
