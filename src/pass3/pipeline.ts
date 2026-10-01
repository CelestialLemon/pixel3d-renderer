import * as THREE from 'three';
import { CHIMNEY_TOP, LAMPS } from './world';
import type { Look } from './tod';

export interface Settings {
  pixel: number; // CSS pixels per art pixel
  outlines: boolean;
  dither: boolean;
  cleanup: boolean;
  clouds: boolean;
  contacts: boolean;
  glow: boolean;
  vignette: boolean;
  animate: boolean;
}

// ---------------------------------------------------------------------------------
// G-buffers. Albedo(rgb) + flag, world normal(xyz) + linear view depth.
// The static world is one merged mesh; a small dynamic mesh carries everything that
// moves (grass, smoke, belt cookies, butterflies, fireflies) and is animated in its
// vertex shader. Transparency is "pixel art transparency": ordered-dither discard.
// ---------------------------------------------------------------------------------
const GBUF_STATIC_VERT = /* glsl */ `
in vec3 aColor; in float aFlag;
out vec3 vN; out vec3 vC; out float vF; out float vD; out float vA;
void main(){
  vN = normal; vC = aColor; vF = aFlag; vA = 1.0;
  vec4 vp = viewMatrix * vec4(position, 1.0);
  vD = -vp.z;
  gl_Position = projectionMatrix * vp;
}`;

const GBUF_DYN_VERT = /* glsl */ `
uniform float uTime; uniform float uNight; uniform vec3 uChimney;
in vec3 aColor; in float aFlag; in float aMode; in vec4 aAnim;
out vec3 vN; out vec3 vC; out float vF; out float vD; out float vA;
const float GY = 0.48;
float wind(vec2 p, float t){ return sin(p.x*0.42 + p.y*0.27 + t*1.5)*0.6 + sin(p.x*0.91 - p.y*0.63 + t*2.6)*0.4; }
void main(){
  vec3 pos = position; vec3 nrm = normal; float alpha = 1.0;
  int mode = int(aMode + 0.5);
  if (mode == 1) {                       // wind sway: tips lean with travelling gusts
    float w = aAnim.x, g = wind(aAnim.yz, uTime);
    pos.xz += vec2(1.0, 0.35) * g * 0.13 * w;
    pos.y -= abs(g) * 0.025 * w;
  } else if (mode == 2) {                // belt cookie: emerges from the oven, rides, drops off
    float x0 = aAnim.x, x1 = 3.38, L = 2.45;
    float nx = x1 + mod(x0 - x1 + uTime * 0.27, L);
    float sc = smoothstep(x1, x1 + 0.3, nx) * (1.0 - smoothstep(x1 + L - 0.3, x1 + L, nx));
    pos = aAnim.xyz + (position - aAnim.xyz) * sc;
    pos.x += nx - x0;
  } else if (mode == 3) {                // chimney smoke puff: rises, swells, dissolves
    float u = fract(uTime * 0.09 + aAnim.x), sd = aAnim.y;
    float sc = mix(0.2, 0.8, smoothstep(0.0, 0.78, u)) * (0.85 + 0.3 * sd);
    vec3 c = uChimney + vec3(0.28 * u + 0.55 * u * u + 0.2 * sin(u * 7.0 + sd * 20.0), u * 2.5, 0.1 * sin(u * 5.0 + sd * 11.0));
    pos = c + position * sc;
    alpha = (1.0 - smoothstep(0.45, 0.98, u)) * smoothstep(0.0, 0.07, u);
  } else if (mode == 4) {                // butterfly: wandering loop with flapping wings
    float k = fract(aAnim.w * 7.0), a = uTime * (0.32 + 0.2 * k) + aAnim.z * 6.2832;
    float R = 1.2 + 1.7 * fract(aAnim.w * 3.7);
    vec3 c = vec3(aAnim.x + cos(a) * R, GY + 0.55 + 0.25 * sin(a * 2.1 + aAnim.z * 9.0), aAnim.y + sin(a * 1.37) * R * 0.8);
    float yaw = atan(-sin(a) * R, cos(a * 1.37) * 1.37 * R * 0.8);
    float flap = sin(uTime * 19.0 + aAnim.z * 30.0) * 0.85;
    vec3 l = position; float ax = abs(l.x);
    l.x = sign(l.x) * ax * cos(flap); l.y += ax * sin(flap);
    float cy = cos(yaw), sy = sin(yaw);
    pos = c + vec3(l.x * cy + l.z * sy, l.y, -l.x * sy + l.z * cy);
    nrm = vec3(0.0, 1.0, 0.0);
  } else if (mode == 5) {                // firefly: drifting, blinking, night only
    float a = uTime * (0.2 + 0.15 * fract(aAnim.w * 5.0)) + aAnim.z * 6.2832;
    vec3 c = vec3(aAnim.x + sin(a * 1.1) * 2.2, GY + 0.55 + 0.45 * sin(a * 1.7 + aAnim.z * 5.0), aAnim.y + cos(a * 0.9) * 2.0);
    alpha = step(0.25, 0.5 + 0.5 * sin(uTime * 2.3 + aAnim.z * 40.0)) * step(0.3, uNight);
    pos = c + position;
  }
  vN = nrm; vC = aColor; vF = aFlag; vA = alpha;
  vec4 vp = viewMatrix * vec4(pos, 1.0);
  vD = -vp.z;
  gl_Position = projectionMatrix * vp;
}`;

const GBUF_FRAG = /* glsl */ `
precision highp float;
in vec3 vN; in vec3 vC; in float vF; in float vD; in float vA;
layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
float bayer4(ivec2 p){
  const int M[16] = int[16](0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5);
  return (float(M[(p.x & 3) + (p.y & 3) * 4]) + 0.5) / 16.0;
}
void main(){
  if (vA < 0.999 && vA < bayer4(ivec2(gl_FragCoord.xy))) discard;
  gAlbedo = vec4(vC, 1.0 + floor(vF + 0.5));
  gNormal = vec4(normalize(vN), vD);
}`;

// ---------------------------------------------------------------------------------
// The pixel-art "brain": turns the G-buffer into a palette-controlled, outlined,
// dithered image with hue-shifted shading ramps and a time-of-day grade.
// ---------------------------------------------------------------------------------
const POST_VERT = /* glsl */ `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FRAG = /* glsl */ `
precision highp float; precision highp int;
uniform sampler2D tAlbedo; uniform sampler2D tNormal; uniform sampler2D tShadow;
uniform vec2 uRes; uniform float uTexel; uniform float uFocus;
uniform vec3 uRight; uniform vec3 uUp; uniform vec3 uFwd; uniform vec3 uCamPos;
uniform vec3 uSun; uniform float uTime;
uniform int uOutline; uniform int uDither; uniform int uClouds; uniform int uContact; uniform int uGlow; uniform int uVignette;
uniform float uSunI; uniform float uAmbient; uniform float uExpo; uniform float uChroma; uniform float uNight; uniform float uLampOn;
uniform vec2 uLitTint; uniform vec2 uShadeTint;
uniform vec3 uSkyTop; uniform vec3 uSkyBot; uniform vec3 uHaze;
uniform vec3 uLampPos[4]; uniform vec3 uLampCol[4]; uniform float uLampRad[4];
out vec4 outColor;

// flags (alpha = 1 + flag)
const int F_NORMAL = 0, F_EMISSIVE = 1, F_DECOR = 2, F_STEAM = 3, F_WATER = 4, F_GLOW = 5, F_DOOR = 6;
int flagOf(float a){ return int(floor(a + 0.5)) - 1; }
bool inkSource(int f){ return f == F_NORMAL || f == F_EMISSIVE || f == F_STEAM || f == F_DOOR; }
bool solid(int f){ return f == F_NORMAL || f == F_EMISSIVE || f == F_DOOR; }

// ---- colour science ----------------------------------------------------------------
vec3 toLab(vec3 c){
  float l = pow(max(0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b, 0.0), 1.0/3.0);
  float m = pow(max(0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b, 0.0), 1.0/3.0);
  float s = pow(max(0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b, 0.0), 1.0/3.0);
  return vec3(0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
              1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
              0.0259040371*l + 0.7827717662*m - 0.8086757660*s);
}
vec3 fromLab(vec3 c){
  float l = c.x + 0.3963377774*c.y + 0.2158037573*c.z;
  float m = c.x - 0.1055613458*c.y - 0.0638541728*c.z;
  float s = c.x - 0.0894841775*c.y - 1.2914855480*c.z;
  l = l*l*l; m = m*m*m; s = s*s*s;
  return vec3( 4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
              -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
              -0.0041960863*l - 0.7034186147*m + 1.7076147010*s);
}
vec3 toSRGB(vec3 c){
  c = clamp(c, 0.0, 1.0);
  return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
}

// Hue-shifted ramp, band -1 (ink) .. 4 (glint). The time-of-day grade adds a warm
// tint to the lit bands and a cool one to the shadow bands; lamp light ignores both
// and glows warm. "self" colours (windows, fireflies) ignore exposure.
vec3 ramp(vec3 lin, int band, int mode){          // mode 0 normal, 1 self-lit, 2 lamp-lit, 3 steam
  int i = band + 1;
  if (mode == 2) lin *= vec3(1.0, 0.66, 0.34) * 1.7;   // warm light multiplies the surface colour
  const float LM[6] = float[6](0.57, 0.72, 0.86, 1.00, 1.065, 1.12);
  const float CM[6] = float[6](0.72, 0.86, 0.96, 1.00, 0.92, 0.82);
  const vec2  TT[6] = vec2[6](vec2(0.012,-0.020), vec2(0.012,-0.018), vec2(0.006,-0.009), vec2(0.0), vec2(0.002, 0.012), vec2(0.003, 0.018));
  vec3 lab = toLab(lin);
  float expo = (mode == 0 || mode == 3) ? uExpo : 1.0;
  lab.x = min(lab.x * LM[i] * expo, 0.98);
  lab.yz = lab.yz * CM[i] * (mode == 0 ? uChroma : 1.0) + TT[i];
  if (mode == 0) lab.yz += mix(uShadeTint, uLitTint, smoothstep(1.0, 3.0, float(band) + 1.0));
  if (mode == 2) { lab.yz *= 1.05; lab.yz += vec2(0.006, 0.016); }
  return fromLab(lab);
}

float bayer4(ivec2 p){
  const int M[16] = int[16](0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5);
  return (float(M[(p.x & 3) + (p.y & 3) * 4]) + 0.5) / 16.0;
}

ivec2 clampP(ivec2 q){ return clamp(q, ivec2(0), ivec2(uRes) - 1); }
vec4 A(ivec2 q){ return texelFetch(tAlbedo, clampP(q), 0); }
vec4 N(ivec2 q){ return texelFetch(tNormal, clampP(q), 0); }

// depth a neighbour at pixel offset o would have if it lay on the plane of (n, d)
float predictDepth(vec3 n, float d, vec2 o){
  float nf = dot(n, uFwd);
  nf = (nf < 0.0 ? -1.0 : 1.0) * max(abs(nf), 0.25);
  return d - (dot(n, uRight) * o.x + dot(n, uUp) * o.y) * uTexel / nf;
}
vec3 worldAt(vec2 pc, float d){
  return uCamPos + uRight * ((pc.x - 0.5 * uRes.x) * uTexel) + uUp * ((pc.y - 0.5 * uRes.y) * uTexel) + uFwd * d;
}

float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
}
float cloudField(vec2 p){ return 0.62*vn(p) + 0.38*vn(p*2.3+7.0); }

float sunlight(ivec2 p, vec3 n){
  // ShadowMaterial alpha is occlusion: 0 = exposed, 1 = shadowed.
  float visibility = 1.0 - texelFetch(tShadow, clampP(p), 0).a;
  return max(dot(n, uSun), 0.0) * visibility;
}

// scalar "how lit is this pixel" used for band selection
float shadeAt(ivec2 q){
  vec4 nq = N(q);
  vec3 nn = nq.xyz;
  float s = uAmbient + 0.14 * max(nn.y, 0.0) + 0.55 * uSunI * sunlight(clampP(q), nn);
  if (uClouds == 1 && nn.y > 0.95) {
    vec3 wp = worldAt(vec2(q) + 0.5, nq.w);
    float cl = smoothstep(0.60, 0.66, cloudField(wp.xz * 0.10 + vec2(uTime * 0.028, uTime * 0.011)));
    s -= 0.34 * cl * clamp(uSunI * 1.2, 0.0, 1.0);
  }
  return s;
}

// Warm light from the windows, lantern and oven: a falloff pool on walls and ground.
float lampAt(vec3 wp, vec3 n){
  float L = 0.0;
  for (int i = 0; i < 4; i++) {
    vec3 dv = uLampPos[i] - wp; float dist = length(dv);
    float att = 1.0 - clamp(dist / uLampRad[i], 0.0, 1.0);
    L += att * att * (0.3 + 0.7 * max(dot(n, dv / max(dist, 1e-3)), 0.0));
  }
  return L * uLampOn;
}

// Sparse screen-space contact occlusion. Plane-relative depth rejects coplanar
// tiles; world-sized taps keep the footprint consistent when zooming.
float contactAt(ivec2 p, vec3 n, float d){
  if (uContact == 0) return 0.0;
  const vec2 taps[12] = vec2[12](
    vec2(1,0), vec2(-1,0), vec2(0,1), vec2(0,-1),
    vec2(0.707,0.707), vec2(-0.707,0.707), vec2(0.707,-0.707), vec2(-0.707,-0.707),
    vec2(0.924,0.383), vec2(-0.383,0.924), vec2(-0.924,-0.383), vec2(0.383,-0.924));
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    float radius = i < 4 ? 0.10 : i < 8 ? 0.24 : 0.43;
    ivec2 offset = ivec2(round(taps[i] * max(radius / uTexel, 1.0)));
    ivec2 q = p + offset;
    vec4 aq = A(q), nq = N(q);
    if (aq.a < 0.5 || !solid(flagOf(aq.a))) continue;
    float delta = predictDepth(n, d, vec2(offset)) - nq.w;
    occ += smoothstep(0.025, 0.09, delta) * (1.0 - smoothstep(0.5, 1.35, delta));
  }
  return occ / 12.0;
}

// Final per-pixel grade: only the very corners of the frame step down in brightness (two
// hard rings, with a one-pixel dither on their edges). There is deliberately no depth
// haze: a constant-depth step shows up as a seam across flat ground.
vec3 finish(vec3 lin, float d, ivec2 p){
  if (uVignette == 0) return lin;
  vec3 lab = toLab(lin);
  vec2 q = (gl_FragCoord.xy / uRes - 0.5) * vec2(1.15, 1.0);
  float vg = length(q) * 1.35 + (bayer4(p) - 0.5) * 0.05;
  lab.x *= 1.0 - 0.055 * (vg > 0.98 ? 2.0 : vg > 0.80 ? 1.0 : 0.0);
  return fromLab(lab);
}

void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = A(p);
  bool sky = a.a < 0.5;
  int fl = sky ? -1 : flagOf(a.a);
  vec4 nd = N(p);
  vec3 n = nd.xyz; float d = sky ? 1e4 : nd.w;
  const ivec2 OFF[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));
  float THR = max(0.10, uTexel * 3.0);

  // ---- 1. silhouette outline: drawn on the FAR pixel, inked from the near object ----
  float bestD = 1e9; ivec2 bestQ = p; bool sil = false;
  if (uOutline == 1) {
    for (int i = 0; i < 4; i++) {
      ivec2 q = p + OFF[i];
      vec4 aq = A(q);
      if (aq.a < 0.5 || !inkSource(flagOf(aq.a))) continue;     // sky, or decor that never casts ink
      float dn = N(q).w;
      float dp = sky ? 1e4 : predictDepth(n, d, vec2(OFF[i]));
      if (dn < dp - THR && dn < bestD) { bestD = dn; bestQ = q; sil = true; }
    }
  }
  if (sil) {
    vec4 nq = A(bestQ);
    vec3 nearColor = nq.rgb;
    int nf = flagOf(nq.a);
    // Softer botanical silhouettes; solid architecture keeps its crisp ink.
    bool foliage = nearColor.g > nearColor.r * 1.25 && nearColor.g > nearColor.b * 1.2;
    vec3 ink = ramp(nearColor, nf == F_STEAM ? 1 : foliage ? 0 : -1, nf == F_STEAM ? 3 : 0);
    outColor = vec4(toSRGB(finish(ink, bestD, p)), 1.0);
    return;
  }

  // ---- 2. sky: dithered banded gradient --------------------------------------------
  if (sky) {
    float t = 1.0 - gl_FragCoord.y / uRes.y;
    float v = t * 6.0 + (uDither == 1 ? (bayer4(p) - 0.5) * 0.55 : 0.0);
    float b = clamp(floor(v), 0.0, 5.0) / 5.0;
    outColor = vec4(toSRGB(mix(uSkyTop, uSkyBot, b)), 1.0);
    return;
  }

  vec3 wp = worldAt(vec2(p) + 0.5, d);

  // ---- 3a. animated water: three-tone ripples, sun/moon sparkle, drifting foam ------
  if (fl == F_WATER) {
    vec2 uv = wp.xz;
    float w = 0.7 * vn(uv * 1.15 + vec2(uTime * 0.18, uTime * 0.10)) + 0.3 * vn(uv * 2.6 - vec2(uTime * 0.24, -uTime * 0.13));
    int wb = w > 0.70 ? 3 : w > 0.36 ? 2 : 1;
    // rings expanding from a couple of drips
    for (int k = 0; k < 2; k++) {
      vec2 c = vec2(-6.0 + 1.6 * float(k), 6.2 + 0.5 * float(k));
      float r = length((uv - c) * vec2(1.0, 1.35)), ph = fract(uTime * 0.18 + float(k) * 0.5);
      if (abs(r - ph * 1.7) < 0.06 && ph < 0.9) wb = 3;
    }
    if (h21(floor(uv * 6.0) + floor(uTime * 2.0)) > mix(0.994, 0.985, uNight)) wb = 4;
    vec3 wc = ramp(a.rgb, wb, 0);
    // reflect the lit sky a little: a lighter water in the sun's direction
    wc = mix(wc, uSkyBot, 0.06 * clamp(uSunI, 0.0, 1.0));
    wc *= mix(1.0, wb == 4 ? 1.0 : 0.5, uNight);
    outColor = vec4(toSRGB(finish(wc, d, p)), 1.0);
    return;
  }

  // ---- 3b. fireflies: tiny self-lit sparks -------------------------------------------
  if (fl == F_GLOW) { outColor = vec4(toSRGB(ramp(a.rgb, 4, 1)), 1.0); return; }

  // ---- 4. banded lighting with gradient-aware ordered dithering ---------------------
  float ndl = dot(n, uSun);
  float s = shadeAt(p);
  float contact = contactAt(p, n, d);

  // Dither only where the light really forms a smooth gradient (round shapes, bevels,
  // cloud edges). Flat surfaces and hard shadow edges stay clean, as an artist would.
  float g = 0.0;
  for (int i = 0; i < 4; i++) {
    ivec2 q = p + OFF[i];
    vec4 aq = A(q);
    if (aq.a != a.a || distance(aq.rgb, a.rgb) > 0.01 || dot(n, N(q).xyz) < 0.94 || abs(N(q).w - predictDepth(n, d, vec2(OFF[i]))) > THR) continue;
    g = max(g, abs(shadeAt(q) - s));
  }
  float dw = (uDither == 1 && fl != F_DECOR && fl != F_DOOR && g > 0.003 && g < 0.075) ? 0.045 : 0.0;
  float sd = s + (bayer4(p) - 0.5) * dw;
  int band = sd < 0.32 ? 0 : sd < 0.52 ? 1 : sd < 0.82 ? 2 : 3;
  if (fl != F_DOOR) {                      // a flat wooden door stays clean: no contact speckle
    if (contact > 0.13) band = max(0, band - 1);
    if (contact > 0.40) band = max(0, band - 1);
  }

  int mode = 0;
  if (fl == F_EMISSIVE) { band = 3; mode = 1; }
  if (fl == F_STEAM) { band = ndl < 0.2 ? 1 : ndl < 0.65 ? 2 : 3; mode = 3; }

  // ---- 5. creases: convex edges catch light, concave ones sink into shadow ---------
  if (uOutline == 1 && solid(fl)) {
    int hi = 0, lo = 0;
    for (int i = 0; i < 4; i++) {
      ivec2 q = p + OFF[i];
      vec4 aq = A(q);
      if (aq.a < 0.5 || !solid(flagOf(aq.a))) continue;
      vec4 nq = N(q);
      // Ignore bevel facets and foliage: outlining every little normal change
      // turns roof tiles and round leaves into disconnected confetti.
      if (dot(n, nq.xyz) > 0.55 || distance(a.rgb, aq.rgb) < 0.025) continue;
      float dp = predictDepth(n, d, vec2(OFF[i]));
      if (abs(nq.w - dp) > THR) continue;
      float dd = nq.w - dp;
      float ndlq = dot(nq.xyz, uSun);
      if (dd > 0.006 && ndl > ndlq) hi++;
      if (dd < -0.006 && ndl < ndlq) lo++;
    }
    if (lo > 0) band = max(band - 1, 0) - (band == 0 ? 1 : 0);
    else if (hi > 0) band = min(band + 1, 4);
  }

  // ---- 6. lamp pools: warm light that survives the cool night grade -----------------
  if (uLampOn > 0.01 && fl != F_EMISSIVE) {
    float lamp = lampAt(wp, n);
    if (uGlow == 1) {                       // halo around lit glass
      float near = 0.0, spark = 0.0;
      for (int i = 0; i < 8; i++) {
        float ang = float(i) * 0.785398;
        vec2 dir = vec2(cos(ang), sin(ang));
        vec4 aq = A(p + ivec2(round(dir * 3.0)));
        if (aq.a > 0.5 && flagOf(aq.a) == F_EMISSIVE) near += 0.125;
        vec4 ab = A(p + ivec2(round(dir * 2.0)));
        if (ab.a > 0.5 && flagOf(ab.a) == F_GLOW) spark = 0.45;
      }
      lamp += 0.7 * near * uLampOn + spark;
    }
    float lj = lamp + (uDither == 1 ? (bayer4(p) - 0.5) * 0.14 : 0.0);
    int lb = lj > 0.60 ? 3 : lj > 0.30 ? 2 : lj > 0.12 ? 1 : 0;
    if (lb > 0 && fl != F_STEAM) { band = max(band, lb); mode = 2; }
  }

  // Door plank grooves: fixed world positions, but always exactly one screen pixel wide, so
  // they cannot pop in and out the way a 0.015-unit-wide mesh does as the camera moves.
  if (fl == F_DOOR && wp.y > 0.72 && wp.y < 2.78) {
    float across = max(abs(dot(uRight, vec3(1.0, 0.0, 0.0))), 0.35);   // world x -> screen x
    float nearest = 9.0;
    for (int g = 0; g < 5; g++) nearest = min(nearest, abs(wp.x - (-0.4 + 0.2 * float(g))));
    if (nearest * across < 0.5 * uTexel) band = -1;
  }

  vec3 col = ramp(a.rgb, band, mode);
  outColor = vec4(toSRGB(finish(col, d, p)), 1.0);
}`;

// ---------------------------------------------------------------------------------
// Clean-up: removes orphan pixels (a pixel unlike 3+ identical neighbours), which is
// the classic "pixel noise" an artist would hand-fix. Restricted to flat solid surfaces.
// ---------------------------------------------------------------------------------
const CLEAN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tImage; uniform sampler2D tAlbedo; uniform sampler2D tNormal; uniform vec2 uRes; uniform int uOn;
out vec4 outColor;
vec3 F(ivec2 q){ return texelFetch(tImage, clamp(q, ivec2(0), ivec2(uRes) - 1), 0).rgb; }
bool same(vec3 a, vec3 b){ return all(lessThan(abs(a - b), vec3(0.002))); }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = F(p);
  if (uOn == 1) {
    vec3 n[4] = vec3[4](F(p + ivec2(1,0)), F(p + ivec2(-1,0)), F(p + ivec2(0,1)), F(p + ivec2(0,-1)));
    vec4 a = texelFetch(tAlbedo, p, 0);
    vec4 nd = texelFetch(tNormal, p, 0);
    bool interior = a.a > 0.5 && a.a < 2.5;
    const ivec2 offsets[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));
    for (int k = 0; k < 4; k++) {
      ivec2 q = clamp(p + offsets[k], ivec2(0), ivec2(uRes) - 1);
      vec4 aq = texelFetch(tAlbedo, q, 0), nq = texelFetch(tNormal, q, 0);
      if (a.a != aq.a || distance(a.rgb, aq.rgb) > 0.01 || dot(nd.xyz, nq.xyz) < 0.97) interior = false;
    }
    for (int i = 0; i < 4 && interior; i++) {
      int cnt = 0;
      for (int j = 0; j < 4; j++) if (same(n[i], n[j])) cnt++;
      if (cnt >= 3 && !same(n[i], c)) { c = n[i]; break; }
    }
  }
  outColor = vec4(c, 1.0);
}`;

export class PixelPipeline3 {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300);
  readonly scene = new THREE.Scene();
  readonly light = new THREE.DirectionalLight(0xffffff, 1);

  private gbuf!: THREE.WebGLRenderTarget;
  private shadowRT!: THREE.WebGLRenderTarget;
  private stylised!: THREE.WebGLRenderTarget;
  private staticMesh: THREE.Mesh;
  private dynMesh: THREE.Mesh;
  private dynMat: THREE.ShaderMaterial;
  private shadowMat: THREE.ShadowMaterial;
  private postMat: THREE.ShaderMaterial;
  private cleanMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private shadowDirty = true;

  width = 1; height = 1;
  viewHeight = 13;
  sun = new THREE.Vector3(0, 1, 0);

  constructor(readonly canvas: HTMLCanvasElement, staticGeo: THREE.BufferGeometry, dynamicGeo: THREE.BufferGeometry) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    const smat = new THREE.ShaderMaterial({ vertexShader: GBUF_STATIC_VERT, fragmentShader: GBUF_FRAG, glslVersion: THREE.GLSL3, side: THREE.FrontSide });
    smat.shadowSide = THREE.DoubleSide;
    this.staticMesh = new THREE.Mesh(staticGeo, smat);
    this.staticMesh.castShadow = true; this.staticMesh.receiveShadow = true; this.staticMesh.frustumCulled = false;

    this.dynMat = new THREE.ShaderMaterial({
      vertexShader: GBUF_DYN_VERT, fragmentShader: GBUF_FRAG, glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uChimney: { value: CHIMNEY_TOP.clone() } },
    });
    this.dynMesh = new THREE.Mesh(dynamicGeo, this.dynMat);
    this.dynMesh.frustumCulled = false; this.dynMesh.castShadow = false;
    this.scene.add(this.staticMesh, this.dynMesh);

    this.light.castShadow = true;
    this.light.shadow.mapSize.set(4096, 4096);
    const sc = this.light.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 140;
    this.light.shadow.bias = -0.0004; this.light.shadow.normalBias = 0.03;
    this.scene.add(this.light, this.light.target);

    // Writes shadow occlusion (0 = lit, 1 = shadowed) into alpha, no blending.
    this.shadowMat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 1 });
    this.shadowMat.transparent = false; this.shadowMat.blending = THREE.NoBlending;

    const common = { glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false } as const;
    this.postMat = new THREE.ShaderMaterial({
      ...common, vertexShader: POST_VERT, fragmentShader: POST_FRAG,
      uniforms: {
        tAlbedo: { value: null }, tNormal: { value: null }, tShadow: { value: null },
        uRes: { value: new THREE.Vector2() }, uTexel: { value: 0.05 }, uFocus: { value: 100 },
        uRight: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3() }, uCamPos: { value: new THREE.Vector3() },
        uSun: { value: this.sun }, uTime: { value: 0 },
        uOutline: { value: 1 }, uDither: { value: 1 }, uClouds: { value: 1 }, uContact: { value: 1 }, uGlow: { value: 1 }, uVignette: { value: 1 },
        uSunI: { value: 1 }, uAmbient: { value: 0.34 }, uExpo: { value: 1 }, uChroma: { value: 1 }, uNight: { value: 0 }, uLampOn: { value: 0 },
        uLitTint: { value: new THREE.Vector2() }, uShadeTint: { value: new THREE.Vector2() },
        uSkyTop: { value: new THREE.Color(0x79b6dc) }, uSkyBot: { value: new THREE.Color(0xf6e6c2) }, uHaze: { value: new THREE.Color(0xcfe5e6) },
        uLampPos: { value: LAMPS.map((l) => l.pos.clone()) },
        uLampCol: { value: LAMPS.map((l) => new THREE.Vector3(...l.color)) },
        uLampRad: { value: LAMPS.map((l) => l.radius) },
      },
    });
    this.cleanMat = new THREE.ShaderMaterial({
      ...common, vertexShader: POST_VERT, fragmentShader: CLEAN_FRAG,
      uniforms: { tImage: { value: null }, tAlbedo: { value: null }, tNormal: { value: null }, uRes: { value: new THREE.Vector2() }, uOn: { value: 1 } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setLook(look: Look) {
    const u = this.postMat.uniforms;
    const az = THREE.MathUtils.degToRad(look.sunAz), el = THREE.MathUtils.degToRad(look.sunEl);
    this.sun.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    this.light.position.copy(this.sun).multiplyScalar(60).add(new THREE.Vector3(0.8, 0, 0));
    this.light.target.position.set(0.8, 0, 0);
    this.light.target.updateMatrixWorld();
    this.shadowDirty = true;
    u.uSunI.value = look.sunI; u.uAmbient.value = look.ambient; u.uExpo.value = look.expo; u.uChroma.value = look.chroma;
    u.uLitTint.value.set(...look.litTint); u.uShadeTint.value.set(...look.shadeTint);
    u.uLampOn.value = look.lampOn; u.uNight.value = look.night;
    u.uSkyTop.value.copy(look.skyTop); u.uSkyBot.value.copy(look.skyBot); u.uHaze.value.copy(look.haze);
    this.dynMat.uniforms.uNight.value = look.night;
  }

  resize(w: number, h: number) {
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    const mk = (opts: THREE.RenderTargetOptions, count = 1) => new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false, count, ...opts });
    this.gbuf?.dispose(); this.shadowRT?.dispose(); this.stylised?.dispose();
    // Full float depth avoids false depth discontinuities on planar roof/paving edges.
    this.gbuf = mk({ type: THREE.FloatType }, 2);
    this.shadowRT = mk({ type: THREE.UnsignedByteType });
    this.stylised = mk({ type: THREE.UnsignedByteType, depthBuffer: false });
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

  /** Rasterise into the G-buffer (+ static shadow mask). Runs each frame: the world is animated. */
  renderGeometry(time: number) {
    const r = this.renderer;
    this.dynMat.uniforms.uTime.value = time;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.gbuf); r.clear(); r.render(this.scene, this.camera);

    // The shadow mask only needs the static world; moving bits borrow the shadow of
    // whatever surface sits behind them, which is what a small tuft or puff would get.
    if (this.shadowDirty) { r.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    r.setClearColor(0xffffff, 1);
    this.dynMesh.visible = false;
    this.scene.overrideMaterial = this.shadowMat;
    r.setRenderTarget(this.shadowRT); r.clear(); r.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;
    this.dynMesh.visible = true;
  }

  /** Stylise the G-buffer into the final pixel image. */
  renderStyle(s: Settings, time: number) {
    const r = this.renderer, cam = this.camera;
    const u = this.postMat.uniforms;
    u.tAlbedo.value = this.gbuf.textures[0]; u.tNormal.value = this.gbuf.textures[1]; u.tShadow.value = this.shadowRT.texture;
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
}
