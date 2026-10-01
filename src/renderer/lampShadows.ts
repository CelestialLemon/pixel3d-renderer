import * as THREE from 'three';
import type { Lamp } from './scene';

/** Pixel size of one cube face in the lamp shadow atlas. */
export const LAMP_TILE = 256;
/** Default `Lamp.clearance`: a street lantern from its lamp to the corners of its tray. */
export const DEFAULT_CLEARANCE = 0.45;
/** Cube faces per atlas row (two lamps). */
const COLS = 12;

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
  private rendered = false;

  constructor(private lamps: Lamp[], private geometry: THREE.BufferGeometry) {
    const tiles = Math.max(lamps.length, 1) * 6;
    this.size.set(Math.min(tiles, COLS) * LAMP_TILE, Math.ceil(tiles / COLS) * LAMP_TILE);
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
        const t = li * 6 + fi, x = (t % COLS) * LAMP_TILE, y = Math.floor(t / COLS) * LAMP_TILE;
        cam.position.copy(lamp.position);
        cam.up.set(...u);
        cam.lookAt(lamp.position.clone().add(new THREE.Vector3(...f)));
        cam.updateMatrixWorld();
        this.target.viewport.set(x, y, LAMP_TILE, LAMP_TILE);
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
