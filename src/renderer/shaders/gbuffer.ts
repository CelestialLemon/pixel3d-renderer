import { BAYER4 } from './common';

// G-buffer pass. Albedo(rgb) + flag, world normal(xyz) + linear view depth, and object id (R32F).
// The static world is one merged mesh; a small dynamic mesh carries the ambient motion (wind, wheels, smoke) and is
// animated here; objects the game moves are meshes of their own. Transparency is "pixel art transparency": ordered-dither discard.

export const GBUF_STATIC_VERT = /* glsl */ `
in vec3 aColor; in float aFlag;
out vec3 vN; out vec3 vC; out float vF; out float vD; out float vA;
flat out float vObjectId;
void main(){
  vObjectId = 0.0;
  vN = normal; vC = aColor; vF = aFlag; vA = 1.0;
  vec4 vp = viewMatrix * vec4(position, 1.0);
  vD = -vp.z;
  gl_Position = projectionMatrix * vp;
}`;

// Objects the game moves (objects.ts): local-space geometry, instanced, placed by each instance's matrix. The inverse
// transpose keeps normals right under non-uniform scale.
export const GBUF_OBJECT_VERT = /* glsl */ `
in vec3 aColor; in float aFlag;
out vec3 vN; out vec3 vC; out float vF; out float vD; out float vA;
flat out float vObjectId;
void main(){
  vObjectId = instanceColor.r;
  mat4 model = modelMatrix * instanceMatrix;
  vN = transpose(inverse(mat3(model))) * normal; vC = aColor; vF = aFlag; vA = 1.0;
  vec4 vp = viewMatrix * model * vec4(position, 1.0);
  vD = -vp.z;
  gl_Position = projectionMatrix * vp;
}`;

// Ambient motion, shared by the G-buffer passes and the sun-shadow passes (renderer.ts), so they always pose a vertex
// identically. Modes and parameter layouts match motion.ts. The including shader declares uTime, uNight and the
// aMode / aAnchor / aAnim attributes.
export const POSE = /* glsl */ `
float wind(vec2 p, float t){ return sin(p.x*0.42 + p.y*0.27 + t*1.5)*0.6 + sin(p.x*0.91 - p.y*0.63 + t*2.6)*0.4; }
// Rotate v by angle a about the unit axis k (Rodrigues).
vec3 rotateAxis(vec3 v, vec3 k, float a){ float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
// Move a vertex (pos, nrm: its rest pose) by motion mode m at time uTime; alpha < 1 fades it out by dithering.
// The parameters shadow the attributes and the clock, so the mode code reads the same for every caller.
void poseAt(inout vec3 pos, inout vec3 nrm, out float alpha, float m, vec3 aAnchor, vec4 aAnim, float uTime){
  vec3 position = pos, normal = nrm;
  alpha = 1.0;
  int mode = int(m + 0.5);
  if (mode == 1) {                       // sway: tips lean with travelling gusts. anim = (weight, base x, base z)
    float w = aAnim.x, g = wind(aAnim.yz, uTime);
    pos.xz += vec2(1.0, 0.35) * g * 0.13 * w;
    pos.y -= abs(g) * 0.025 * w;
  } else if (mode == 2) {                // conveyor along +x: grows in, rides, shrinks away. anim = (start x, length, speed)
    float x0 = aAnchor.x, x1 = aAnim.x, L = aAnim.y;
    float nx = x1 + mod(x0 - x1 + uTime * aAnim.z, L);
    float sc = smoothstep(x1, x1 + 0.3, nx) * (1.0 - smoothstep(x1 + L - 0.3, x1 + L, nx));
    pos = aAnchor + (position - aAnchor) * sc;
    pos.x += nx - x0;
  } else if (mode == 3) {                // smoke puff: rises from the anchor, swells, dissolves. anim = (phase, seed)
    float u = fract(uTime * 0.09 + aAnim.x), sd = aAnim.y;
    float sc = mix(0.2, 0.8, smoothstep(0.0, 0.78, u)) * (0.85 + 0.3 * sd);
    vec3 c = aAnchor + vec3(0.28 * u + 0.55 * u * u + 0.2 * sin(u * 7.0 + sd * 20.0), u * 2.5, 0.1 * sin(u * 5.0 + sd * 11.0));
    pos = c + position * sc;
    alpha = (1.0 - smoothstep(0.45, 0.98, u)) * smoothstep(0.0, 0.07, u);
  } else if (mode == 4) {                // butterfly: wandering loop around the anchor, flapping wings. anim = (phase, seed)
    float k = fract(aAnim.y * 7.0), a = uTime * (0.32 + 0.2 * k) + aAnim.x * 6.2832;
    float R = 1.2 + 1.7 * fract(aAnim.y * 3.7);
    vec3 c = vec3(aAnchor.x + cos(a) * R, aAnchor.y + 0.55 + 0.25 * sin(a * 2.1 + aAnim.x * 9.0), aAnchor.z + sin(a * 1.37) * R * 0.8);
    float yaw = atan(-sin(a) * R, cos(a * 1.37) * 1.37 * R * 0.8);
    float flap = sin(uTime * 19.0 + aAnim.x * 30.0) * 0.85;
    vec3 l = position; float ax = abs(l.x);
    l.x = sign(l.x) * ax * cos(flap); l.y += ax * sin(flap);
    float cy = cos(yaw), sy = sin(yaw);
    pos = c + vec3(l.x * cy + l.z * sy, l.y, -l.x * sy + l.z * cy);
    nrm = vec3(0.0, 1.0, 0.0);
  } else if (mode == 5) {                // firefly: drifting around the anchor, blinking, night only. anim = (phase, seed)
    float a = uTime * (0.2 + 0.15 * fract(aAnim.y * 5.0)) + aAnim.x * 6.2832;
    vec3 c = vec3(aAnchor.x + sin(a * 1.1) * 2.2, aAnchor.y + 0.55 + 0.45 * sin(a * 1.7 + aAnim.x * 5.0), aAnchor.z + cos(a * 0.9) * 2.0);
    alpha = step(0.25, 0.5 + 0.5 * sin(uTime * 2.3 + aAnim.x * 40.0)) * step(0.3, uNight);
    pos = c + position;
  } else if (mode == 6 || mode == 7) {   // spin / swing about an axis through the anchor. anim = (axis xyz, speed or amplitude)
    float a = mode == 6 ? uTime * aAnim.w : aAnim.w * sin(uTime * 1.3 + dot(aAnchor, vec3(1.7, 0.3, 2.1)));
    pos = aAnchor + rotateAxis(position - aAnchor, aAnim.xyz, a);
    nrm = rotateAxis(normal, aAnim.xyz, a);
  }
}
// The baked dynamic mesh: world space, the scene clock.
void pose(inout vec3 pos, inout vec3 nrm, out float alpha){ poseAt(pos, nrm, alpha, aMode, aAnchor, aAnim, uTime); }`;

// The same motion on an object (objects.ts), whose anchors and sway bases are in its local space. Each instance runs on
// its own clock, shifted by a hash of its id (stable however the object moves), so copies of one geometry don't move in
// lockstep. Spin, swing and conveyor are posed locally, then placed by `model`. Smoke, butterflies and fireflies leave
// from the placed anchor and drift in world space, their shape neither turned nor scaled. Sway leans in world space, with
// the gust sampled at the placed base, like the baked grass beside it. Gives the world position and normal; the normal is
// left unnormalised, like the plain object shader's, so a still part shades exactly as on a plain object.
export const POSE_OBJECT = /* glsl */ `${POSE}
float instancePhase(float id){ return float((uint(id) * 2654435761u) >> 8u) / 16777216.0; }
void poseObject(mat4 model, float id, out vec3 wpos, out vec3 wnrm, out float alpha){
  float t = uTime + instancePhase(id) * 97.0;
  mat3 nm = transpose(inverse(mat3(model)));
  int mode = int(aMode + 0.5);
  if (mode >= 3 && mode <= 5) {
    // A mirrored instance is drawn with its front faces reversed (objects.ts); mirror the shape too, so it still faces out.
    vec3 mirror = vec3(determinant(mat3(model)) < 0.0 ? -1.0 : 1.0, 1.0, 1.0);
    wpos = position * mirror; wnrm = normal * mirror;
    poseAt(wpos, wnrm, alpha, aMode, (model * vec4(aAnchor, 1.0)).xyz, aAnim, t);
  } else if (mode == 1) {
    wpos = (model * vec4(position, 1.0)).xyz; wnrm = nm * normal;
    vec2 base = (model * vec4(aAnim.y, 0.0, aAnim.z, 1.0)).xz;
    poseAt(wpos, wnrm, alpha, aMode, aAnchor, vec4(aAnim.x, base, aAnim.w), t);
  } else {
    vec3 pos = position, nrm = normal;
    poseAt(pos, nrm, alpha, aMode, aAnchor, aAnim, t);
    wpos = (model * vec4(pos, 1.0)).xyz; wnrm = nm * nrm;
  }
}`;

// An object whose geometry carries motion attributes.
export const GBUF_OBJECT_MOTION_VERT = /* glsl */ `
uniform float uTime; uniform float uNight;
in vec3 aColor; in float aFlag; in float aMode; in vec3 aAnchor; in vec4 aAnim;
out vec3 vN; out vec3 vC; out float vF; out float vD; out float vA;
flat out float vObjectId;
${POSE_OBJECT}
void main(){
  vObjectId = instanceColor.r;
  vec3 pos, nrm; float alpha;
  poseObject(modelMatrix * instanceMatrix, instanceColor.r, pos, nrm, alpha);
  vN = nrm; vC = aColor; vF = aFlag; vA = alpha;
  vec4 vp = viewMatrix * vec4(pos, 1.0);
  vD = -vp.z;
  gl_Position = projectionMatrix * vp;
}`;

export const GBUF_DYN_VERT = /* glsl */ `
uniform float uTime; uniform float uNight;
in vec3 aColor; in float aFlag; in float aMode; in vec3 aAnchor; in vec4 aAnim;
out vec3 vN; out vec3 vC; out float vF; out float vD; out float vA;
flat out float vObjectId;
${POSE}
void main(){
  vObjectId = 0.0;
  vec3 pos = position; vec3 nrm = normal; float alpha;
  pose(pos, nrm, alpha);
  vN = nrm; vC = aColor; vF = aFlag; vA = alpha;
  vec4 vp = viewMatrix * vec4(pos, 1.0);
  vD = -vp.z;
  gl_Position = projectionMatrix * vp;
}`;

export const GBUF_FRAG = /* glsl */ `
precision highp float;
uniform int uSS;   // samples per art pixel along each axis: the dither threshold stays per art pixel
in vec3 vN; in vec3 vC; in float vF; in float vD; in float vA;
flat in float vObjectId;
layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out float gObjectId;
${BAYER4}
void main(){
  if (vA < 0.999 && vA < bayer4(ivec2(gl_FragCoord.xy) / uSS)) discard;
  float f = floor(vF + 0.5);
  gAlbedo = vec4(vC, 1.0 + f + (vF - f > 0.1 ? 0.25 : 0.0));   // + 0.25: thin mark (flags.ts)
  gNormal = vec4(normalize(vN), vD);
  gObjectId = vObjectId;
}`;
