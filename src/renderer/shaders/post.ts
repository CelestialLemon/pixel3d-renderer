import { LIMITS } from '../scene';
import { BAYER4 } from './common';

// The pixel-art "brain": turns the G-buffer into a palette-controlled, outlined, dithered image with
// hue-shifted shading ramps and a time-of-day grade.
export const POST_FRAG = /* glsl */ `
precision highp float; precision highp int;
#define MAX_LAMPS ${LIMITS.lamps}
#define MAX_RIPPLES ${LIMITS.ripples}
#define MAX_GROOVES ${LIMITS.grooves}
uniform sampler2D tAlbedo; uniform sampler2D tNormal; uniform sampler2D tShadow;
uniform vec2 uRes; uniform float uTexel;
uniform vec3 uRight; uniform vec3 uUp; uniform vec3 uFwd; uniform vec3 uCamPos;
uniform vec3 uSun; uniform float uTime;
uniform int uOutline; uniform int uDither; uniform int uClouds; uniform int uContact; uniform int uGlow; uniform int uVignette;
uniform float uSunI; uniform float uAmbient; uniform float uExpo; uniform float uChroma; uniform float uNight; uniform float uLampOn;
uniform vec2 uLitTint; uniform vec2 uShadeTint;
uniform vec3 uSkyTop; uniform vec3 uSkyBot;
uniform int uLampCount; uniform vec4 uLamp[MAX_LAMPS]; uniform vec3 uLampCol[MAX_LAMPS];   // uLamp: position, radius
uniform sampler2D tLampShadow; uniform vec3 uLampAtlas;   // atlas width, height, face tile size
uniform sampler2D tWindow; uniform vec4 uWindowBounds;   // window light map (windowLight.ts): rgb light, a source height; world xz bounds
uniform int uRippleCount; uniform vec2 uRipples[MAX_RIPPLES];
uniform int uGrooveCount; uniform float uGrooves[MAX_GROOVES]; uniform vec3 uGrooveAxis; uniform vec2 uGrooveY;
out vec4 outColor;

// flags (alpha = 1 + flag), matching flags.ts
const int F_NORMAL = 0, F_EMISSIVE = 1, F_DECOR = 2, F_STEAM = 3, F_WATER = 4, F_GLOW = 5, F_GROOVED = 6;
int flagOf(float a){ return int(floor(a + 0.5)) - 1; }
bool inkSource(int f){ return f == F_NORMAL || f == F_EMISSIVE || f == F_STEAM || f == F_GROOVED; }
bool solid(int f){ return f == F_NORMAL || f == F_EMISSIVE || f == F_GROOVED; }

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
// and takes the lamp's colour. "self" colours (windows, fireflies) ignore exposure.
vec3 ramp(vec3 lin, int band, int mode, vec3 lampTint){   // mode 0 normal, 1 self-lit, 2 lamp-lit, 3 steam
  int i = band + 1;
  if (mode == 2) lin *= lampTint * 1.7;               // lamp light multiplies the surface colour
  const float LM[6] = float[6](0.57, 0.72, 0.86, 1.00, 1.065, 1.12);
  const float CM[6] = float[6](0.72, 0.86, 0.96, 1.00, 0.92, 0.82);
  const vec2  TT[6] = vec2[6](vec2(0.012,-0.020), vec2(0.012,-0.018), vec2(0.006,-0.009), vec2(0.0), vec2(0.002, 0.012), vec2(0.003, 0.018));
  vec3 lab = toLab(lin);
  float expo = (mode == 0 || mode == 3) ? uExpo : 1.0;
  lab.x = min(lab.x * LM[i] * expo, 0.98);
  lab.yz = lab.yz * CM[i] * (mode == 0 ? uChroma : 1.0) + TT[i];
  if ((mode == 0 || mode == 2) && uNight > 0.0) {
    // Night vision: colour drains out under moonlight, greens most of all, so fields and foliage read as night, not dark
    // green. Lamp-lit greens keep more colour but lose enough that a warm pool on grass turns ochre rather than lime.
    float green = smoothstep(0.3, 0.85, dot(lab.yz / max(length(lab.yz), 1e-4), vec2(-0.74, 0.67)));
    lab.yz *= 1.0 - uNight * (mode == 0 ? 0.32 + 0.40 * green : 0.45 * green);
  }
  if (mode == 0) lab.yz += mix(uShadeTint, uLitTint, smoothstep(1.0, 3.0, float(band) + 1.0));
  if (mode == 2) { lab.yz *= 1.05; lab.yz += 0.017 * normalize(toLab(lampTint).yz + vec2(1e-4, 0.0)) * min(length(toLab(lampTint).yz) * 8.0, 1.0); }
  return fromLab(lab);
}
vec3 ramp(vec3 lin, int band, int mode){ return ramp(lin, band, mode, vec3(1.0)); }   // lamp tint unused outside mode 2
${BAYER4}

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

// Is the segment lamp i -> wp blocked? The lamp's distance cube map (see lampShadows.ts) holds the
// nearest solid surface in each direction; 0 means nothing there. Face table matches FACES in lampShadows.ts.
float lampVisible(int i, vec3 wp, vec3 n){
  vec3 v = wp + n * 0.03 - uLamp[i].xyz;          // nudge off the surface against self-shadowing
  vec3 av = abs(v);
  int face; vec3 F, U;
  if (av.x >= av.y && av.x >= av.z) { face = v.x > 0.0 ? 0 : 1; F = vec3(sign(v.x), 0, 0); U = vec3(0, 1, 0); }
  else if (av.y >= av.z)            { face = v.y > 0.0 ? 2 : 3; F = vec3(0, sign(v.y), 0); U = vec3(0, 0, 1); }
  else                              { face = v.z > 0.0 ? 4 : 5; F = vec3(0, 0, sign(v.z)); U = vec3(0, 1, 0); }
  vec3 R = cross(F, U);
  float fw = dot(v, F);
  vec2 uv = clamp(vec2(dot(v, R), dot(v, U)) / fw * 0.5 + 0.5, 0.0, 0.9999);
  int t = i * 6 + face, cols = int(uLampAtlas.x / uLampAtlas.z);
  ivec2 px = ivec2(t % cols, t / cols) * int(uLampAtlas.z) + ivec2(uv * uLampAtlas.z);
  float stored = texelFetch(tLampShadow, px, 0).r;
  float dist = length(v);
  // Slope-scaled bias: a surface seen at a grazing angle spans a long depth range inside one cube texel.
  float cosA = max(dot(n, -v / max(dist, 1e-4)), 0.2);   // capped: at most 0.02 + 0.06 x distance
  float texel = 2.0 * dist / uLampAtlas.z;
  return (stored <= 0.0 || dist < stored + 0.02 + texel * 1.5 / cosA) ? 1.0 : 0.0;
}

// Light from the lit windows: a small pool on the ground, quay or wall below each one, read from the top-down window map.
// A wall reads the map 0.4 m out along its normal (the pools' offset from their pane, see windowLight.ts), on the line
// below its windows rather than at the pool's clipped back edge; a wall facing away from the pools reads nothing. Fades
// out above the window (no light on the roof or the floors above); on a wall the pool fades out within ~1.4 m below it.
vec4 windowAt(vec3 wp, vec3 n){
  vec2 uv = (wp.xz + n.xz * 0.4 - uWindowBounds.xy) / (uWindowBounds.zw - uWindowBounds.xy);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  vec4 w = textureLod(tWindow, uv, 0.0);   // explicit LOD: also called from non-uniform control flow
  float k = max(max(w.r, w.g), w.b);
  if (k < 0.01) return vec4(0.0);
  float below = w.a - wp.y, up = max(n.y, 0.0);   // how far below the (weighted) window height; 1 on the ground, 0 on a wall
  float reach = mix(1.0 - smoothstep(0.5, 1.4, below), 1.0 - smoothstep(2.2, 4.5, below), up);   // a wall pool stays compact
  k *= 0.4 * (1.0 - smoothstep(-0.6, 0.0, -below)) * reach * mix(0.7, 1.0, up) * smoothstep(-0.35, -0.05, n.y);   // no undersides
  return vec4(w.rgb / max(max(w.r, w.g), w.b), k);
}

// Light from the scene's lamps: a coloured falloff pool on walls and ground, blocked by solid geometry.
// Distance below the lamp counts half, so a lamp on a tall post still reaches the ground around it.
// Returns (colour of the strongest lamp, summed strength): one hue per pool keeps the palette small, and
// the ordered dither \`jit\` breaks the border where two pools meet into a pixel pattern.
vec4 lampAt(vec3 wp, vec3 n, float jit){
  vec4 L = vec4(vec3(1.0), 0.0);
  float best = 0.0;
  for (int i = 0; i < MAX_LAMPS; i++) {
    if (i >= uLampCount) break;
    vec3 dv = uLamp[i].xyz - wp; float dist = length(dv);
    float att = 1.0 - clamp(length(dv * vec3(1.0, dv.y > 0.0 ? 0.5 : 1.0, 1.0)) / uLamp[i].w, 0.0, 1.0);
    if (att <= 0.0) continue;
    float ndl = dot(n, dv / max(dist, 1e-3));         // surfaces facing away from the lamp get nothing
    float k = ndl > 0.0 ? att * att * (0.3 + 0.7 * ndl) : 0.0;
    if (k < 0.02) continue;
    k *= lampVisible(i, wp, n);
    vec3 c = uLampCol[i];
    float score = k * (1.0 + jit * (fract(float(i) * 0.618034) * 2.0 - 1.0));   // per-lamp phase so the winner varies
    if (score > best) { best = score; L.rgb = c / max(max(c.r, c.g), max(c.b, 1e-3)); }
    L.a += k;
  }
  vec4 W = windowAt(wp, n);
  if (W.a * (1.0 + jit * 0.3) > best) L.rgb = W.rgb;
  L.a += W.a;
  L.a *= uLampOn;
  return L;
}

// Sparse screen-space contact occlusion. Plane-relative depth rejects coplanar
// tiles; a world-distance bound keeps screen taps from shadowing unrelated surfaces
// far along the view ray (e.g. a parapet coping across a curved bridge deck).
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
    if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, ivec2(uRes)))) continue;
    vec4 aq = A(q), nq = N(q);
    if (aq.a < 0.5 || !solid(flagOf(aq.a))) continue;
    vec3 separation = (uRight * float(offset.x) + uUp * float(offset.y)) * uTexel + uFwd * (nq.w - d);
    float rangeWeight = 1.0 - smoothstep(0.43, 0.55, length(separation));
    float delta = predictDepth(n, d, vec2(offset)) - nq.w;
    occ += rangeWeight * smoothstep(0.025, 0.09, delta) * (1.0 - smoothstep(0.5, 1.35, delta));
  }
  return occ / 12.0;
}

// Final per-pixel grade: only the very corners of the frame step down in brightness (two
// hard rings, with a one-pixel dither on their edges). There is deliberately no depth
// haze: a constant-depth step shows up as a seam across flat ground.
vec3 finish(vec3 lin, ivec2 p){
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
    outColor = vec4(toSRGB(finish(ink, p)), 1.0);
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

  // ---- 3a. animated water: three-tone ripples, sun/moon sparkle, drip rings ---------
  if (fl == F_WATER) {
    vec2 uv = wp.xz;
    float w = 0.7 * vn(uv * 1.15 + vec2(uTime * 0.18, uTime * 0.10)) + 0.3 * vn(uv * 2.6 - vec2(uTime * 0.24, -uTime * 0.13));
    int wb = w > 0.70 ? 3 : w > 0.36 ? 2 : 1;
    // rings expanding from the scene's drip points, evenly out of phase
    for (int k = 0; k < MAX_RIPPLES; k++) {
      if (k >= uRippleCount) break;
      vec2 c = uRipples[k];
      float r = length((uv - c) * vec2(1.0, 1.35)), ph = fract(uTime * 0.18 + float(k) / float(uRippleCount));
      if (abs(r - ph * 1.7) < 0.06 && ph < 0.9) wb = 3;
    }
    if (h21(floor(uv * 6.0) + floor(uTime * 2.0)) > mix(0.994, 0.985, uNight)) wb = 4;
    vec3 wc = ramp(a.rgb, wb, 0);
    // reflect the lit sky a little: a lighter water in the sun's direction
    wc = mix(wc, uSkyBot, 0.06 * clamp(uSunI, 0.0, 1.0));
    wc *= mix(1.0, wb == 4 ? 1.0 : 0.5, uNight);
    if (uLampOn > 0.01) {
      // Lamp light on the water: a pool of lit ripples around each nearby lamp.
      vec4 L = lampAt(wp, vec3(0.0, 1.0, 0.0), uDither == 1 ? (bayer4(p) - 0.5) * 0.6 : 0.0);
      if (L.a > 0.18) wc = mix(wc, ramp(a.rgb, min(wb + 1, 3), 2, L.rgb), uLampOn * (L.a > 0.45 ? 0.75 : 0.45));
      // Reflections: in an orthographic view the water shows the mirrored world straight along the view ray, so a lamp's
      // reflection sits where its mirror image (as far below the water as the lamp is above) projects onto the screen.
      // Ripples break it into a column of horizontal dashes that shiver sideways, longer the higher the lamp.
      for (int i = 0; i < MAX_LAMPS; i++) {
        if (i >= uLampCount) break;
        vec3 lp = uLamp[i].xyz;
        float hgt = lp.y - wp.y;
        if (hgt <= 0.0 || length(lp.xz - wp.xz) > hgt * 2.2 + uLamp[i].w) continue;
        vec3 dv = vec3(lp.x, wp.y - hgt, lp.z) - wp;
        float sx = dot(dv, uRight), sy = dot(dv, uUp), rows = floor(sy / uTexel * 0.5);
        float ry = max(0.3 + 0.22 * hgt, 3.0 * uTexel), taper = 1.0 - abs(sy) / ry;
        if (taper <= 0.0) continue;
        float shiver = (h21(vec2(rows, floor(uTime * 3.0) + float(i))) - 0.5) * 0.2;
        float gap = h21(vec2(rows * 1.7 + float(i), floor(uTime * 2.0)));
        bool dash = mod(rows, 2.0) < 0.5 || gap > 0.75 * (1.0 - taper);
        if (!dash || abs(sx + shiver) > max(0.04 + 0.13 * taper * taper, 0.5 * uTexel)) continue;   // never under an art pixel
        if (lampVisible(i, wp, vec3(0.0, 1.0, 0.0)) < 0.5) continue;
        vec3 c = uLampCol[i] / max(max(uLampCol[i].r, uLampCol[i].g), max(uLampCol[i].b, 1e-3));
        wc = mix(wc, ramp(c * 0.7, taper > 0.6 ? 3 : 2, 1), uLampOn * (taper > 0.3 ? 1.0 : 0.6));
        break;
      }
    }
    outColor = vec4(toSRGB(finish(wc, p)), 1.0);
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
  // Neighbours on the same plane with the same flag: only across these can a light gradient be smooth. The sun gradient
  // also asks for the same colour.
  bool plane[4];
  float g = 0.0;
  for (int i = 0; i < 4; i++) {
    ivec2 q = p + OFF[i];
    vec4 aq = A(q);
    plane[i] = flagOf(aq.a) == fl && dot(n, N(q).xyz) >= 0.94 && abs(N(q).w - predictDepth(n, d, vec2(OFF[i]))) <= THR;
    if (plane[i] && distance(aq.rgb, a.rgb) <= 0.01) g = max(g, abs(shadeAt(q) - s));
  }
  float dw = (uDither == 1 && fl != F_DECOR && fl != F_GROOVED && g > 0.003 && g < 0.075) ? 0.045 : 0.0;
  float sd = s + (bayer4(p) - 0.5) * dw;
  int band = sd < 0.32 ? 0 : sd < 0.52 ? 1 : sd < 0.82 ? 2 : 3;
  if (fl != F_GROOVED) {                   // a flat panel stays clean: no contact speckle
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
  vec3 lampTint = vec3(1.0);
  if (uLampOn > 0.01 && fl != F_EMISSIVE) {
    vec4 L = lampAt(wp, n, uDither == 1 ? (bayer4(p) - 0.5) * 0.6 : 0.0);
    float raw = L.a, h = 0.0;
    if (uGlow == 1) {                       // halo around lit glass, in the glass colour
      float near = 0.0, spark = 0.0;
      vec3 glass = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float ang = float(i) * 0.785398;
        vec2 dir = vec2(cos(ang), sin(ang));
        vec4 aq = A(p + ivec2(round(dir * 3.0)));
        if (aq.a > 0.5 && flagOf(aq.a) == F_EMISSIVE) { near += 0.125; glass += aq.rgb; }
        vec4 ab = A(p + ivec2(round(dir * 2.0)));
        if (ab.a > 0.5 && flagOf(ab.a) == F_GLOW) { spark = 0.45; glass += ab.rgb * 4.0; }
      }
      h = 0.7 * near * uLampOn + spark;
      if (h > L.a) L.rgb = glass / max(max(glass.r, glass.g), max(glass.b, 1e-3));
      L.a += h;
    }
    // Dither the band borders only where the pool is a smooth gradient on one plane, as for sunlight: a hard lamp-shadow
    // or window-map edge stays crisp. The test costs four more lamp lookups, so only pixels near a band border pay for it.
    // The glass halo is a stylised screen-space glow and keeps its dithered rings. Unlike sunlight, flat DECOR ground (lawns,
    // fields) dithers too: its pools are as smooth as any, and the plane test keeps tufts and blades clean.
    bool dl = uDither == 1 && fl != F_GROOVED;
    if (dl && h <= 0.0) {
      float t = L.a, edge = min(min(abs(t - 0.12), abs(t - 0.30)), abs(t - 0.60)), gl = 0.0;
      dl = edge < 0.07;
      for (int i = 0; i < 4; i++) {
        if (!dl || !plane[i]) continue;
        ivec2 q = p + OFF[i];
        gl = max(gl, abs(lampAt(worldAt(vec2(q) + 0.5, N(q).w), n, 0.0).a - raw));
      }
      dl = dl && gl > 0.003 && gl < 0.14;
    }
    float lj = L.a + (dl ? (bayer4(p) - 0.5) * 0.14 : 0.0);
    int lb = lj > 0.60 ? 3 : lj > 0.30 ? 2 : lj > 0.12 ? 1 : 0;
    if (lb > 0 && fl != F_STEAM) {
      band = max(band, lb); mode = 2;
      lampTint = L.rgb;
    }
  }

  // Grooves (door planks): fixed world positions, but always exactly one screen pixel wide, so
  // they cannot pop in and out the way a sub-pixel-wide mesh does as the camera moves.
  if (fl == F_GROOVED && wp.y > uGrooveY.x && wp.y < uGrooveY.y) {
    float across = max(abs(dot(uRight, uGrooveAxis)), 0.35);   // groove axis -> screen x
    float along = dot(wp, uGrooveAxis), nearest = 9.0;
    for (int k = 0; k < MAX_GROOVES; k++) {
      if (k >= uGrooveCount) break;
      nearest = min(nearest, abs(along - uGrooves[k]));
    }
    if (nearest * across < 0.5 * uTexel) band = -1;
  }

  vec3 col = ramp(a.rgb, band, mode, lampTint);
  outColor = vec4(toSRGB(finish(col, p)), 1.0);
}`;
