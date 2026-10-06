import { POOL_NORMAL_Y } from '../fluids';
import type { RendererLimits } from '../scene';

// Fluids (see fluids.ts). Two pieces:
// 1. FLUID_VERT/FRAG rasterise the fluid surfaces into their own small G-buffer at art resolution, after the opaque
//    G-buffer has been resolved, so the opaque one keeps what lies under the surface. The opaque depth test is done by
//    hand against the resolved depth, so a fluid edge agrees with the pixel the resolve chose.
// 2. waterGLSL is the composite: post.ts runs a second time with uPass = 1, and every pixel a fluid covers is drawn
//    from the first pass's image (the bed, seen through the fluid, and the world above it, mirrored in it).

export const FLUID_VERT = /* glsl */ `
in vec3 aFlow; in float aFluid;
out vec3 vN; flat out vec3 vFlow; flat out float vSlot; out float vD;   // flow and slot are per triangle
void main(){
  vN = normal; vFlow = aFlow; vSlot = aFluid;
  vec4 vp = viewMatrix * vec4(position, 1.0);
  vD = -vp.z;
  gl_Position = projectionMatrix * vp;
}`;

export const FLUID_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tAlbedo; uniform sampler2D tNormal;   // the resolved opaque G-buffer
uniform vec3 uFwd;
in vec3 vN; flat in vec3 vFlow; flat in float vSlot; in float vD;
layout(location = 0) out vec4 fNormal;   // xyz: normal facing the camera, w: depth
layout(location = 1) out vec4 fFlow;     // xyz: velocity (m/s, world), w: 1 + material slot (0: no fluid)
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (texelFetch(tAlbedo, p, 0).a > 0.5 && vD > texelFetch(tNormal, p, 0).w - 0.002) discard;
  vec3 n = normalize(vN);
  if (dot(n, uFwd) > 0.0) n = -n;   // a falling sheet is seen from either side
  fNormal = vec4(n, vD);
  fFlow = vec4(vFlow, 1.0 + floor(vSlot + 0.5));
}`;

/** Uniform declarations and the composite. Included by post.ts after its lighting functions. */
export const waterGLSL = (limits: Readonly<RendererLimits>) => /* glsl */ `
#define MAX_FLUIDS ${limits.fluidMaterials}
#define MAX_SOURCES ${limits.fluidSources}
#define POOL_NORMAL_Y ${POOL_NORMAL_Y.toFixed(4)}
uniform int uPass;
uniform sampler2D tImage;                       // pass 0's output: linear, unclipped, alpha 1 where it takes the grade
uniform sampler2D tFluidN; uniform sampler2D tFluidF;   // the fluid G-buffer (see FLUID_FRAG)
uniform sampler2D tFluidMap; uniform sampler2D tFluidHeight; uniform vec4 uFluidBounds;   // fluidMap.ts
// Four vec4 per material, to keep the fragment uniform count low (colours linear RGB):
// (shallow, clarity), (deep, reflectivity), (foam, roughness), (wave scale, foam amount, emission, -).
uniform vec4 uFluidA[MAX_FLUIDS]; uniform vec4 uFluidB[MAX_FLUIDS]; uniform vec4 uFluidC[MAX_FLUIDS]; uniform vec4 uFluidD[MAX_FLUIDS];
uniform int uSourceCount; uniform vec4 uSources[MAX_SOURCES];   // x, z, radius (negative: no rings), strength
uniform float uSourceY[MAX_SOURCES];                            // the surface height each stirs (-1e4: any)

vec3 imageAt(ivec2 q){ return texelFetch(tImage, clampP(q), 0).rgb; }
bool fluidAt(ivec2 q){ return texelFetch(tFluidF, clampP(q), 0).a > 0.5; }
// A pass-0 pixel, finished as pass 0 would have done without a fluid pass (see emitColor): exactly the same output.
vec4 passThrough(ivec2 p){
  vec4 c = texelFetch(tImage, p, 0);
  return vec4(toSRGB(c.a > 0.75 ? finish(c.rgb, p) : c.rgb), 1.0);
}
float opaqueDepth(ivec2 q){ return A(q).a < 0.5 ? 1e4 : N(q).w; }

// Ripple height (0..1, mostly 0.3..0.7) at surface coordinates s, moving with the flow f (m/s) without stretching: two copies of
// the pattern, each dragged along the flow for one period and then reset, cross-faded so neither reset shows (Vlachos,
// "Water Flow in Portal 2", 2010). A slowly varying phase offset keeps the whole surface from pulsing in step, and a
// current stretches the pattern along itself into streaks.
float rippleField(vec2 s, vec2 f, float scale){
  const float PERIOD = 2.0;
  float t = uTime / PERIOD + 0.8 * vn(s / (scale * 4.0) + 17.0), h = 0.0, v = length(f);
  vec2 along = v > 0.08 ? f / v : vec2(1.0, 0.0), across = vec2(-along.y, along.x);
  float stretch = 1.0 + 1.4 * smoothstep(0.08, 1.2, v);
  for (int k = 0; k < 2; k++) {
    float ph = fract(t + 0.5 * float(k)), w = 1.0 - abs(2.0 * ph - 1.0);
    vec2 x = s - f * ph * PERIOD;
    vec2 q = vec2(dot(x, along) / stretch, dot(x, across)) / scale + float(k) * vec2(3.7, 1.3);
    h += w * (0.65 * vn(q) + 0.35 * vn(q * 2.3 + 5.1));
  }
  return h;
}

void water(ivec2 p){
  vec4 fn = texelFetch(tFluidN, p, 0), ff = texelFetch(tFluidF, p, 0);
  int slot = int(ff.a + 0.5) - 1;
  float d = fn.w, THR = max(0.10, uTexel * 3.0);
  // A solid standing in front of the surface keeps the ink the first pass drew on this pixel.
  if (uOutline == 1) {
    const ivec2 OFF[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));
    for (int i = 0; i < 4; i++) {
      ivec2 q = p + OFF[i];
      vec4 aq = A(q);
      if (aq.a > 0.5 && inkSource(flagOf(aq.a)) && N(q).w < d - THR && !fluidAt(q)) { outColor = passThrough(p); return; }
    }
  }
  vec4 opt = vec4(uFluidA[slot].w, uFluidB[slot].w, uFluidC[slot].w, uFluidD[slot].x);   // clarity, reflectivity, roughness, wave scale
  vec2 extra = uFluidD[slot].yz;                                                           // foam amount, emission
  vec3 wp = worldAt(vec2(p) + 0.5, d), n0 = fn.xyz, flow = ff.xyz;
  bool pool = abs(n0.y) >= POOL_NORMAL_Y;

  // Flow and turbulence: the top-down map knows the banks and obstacles; elsewhere the surface's own flow.
  float turb = 0.0, shore = 99.0;
  if (pool) {
    vec2 uv = (wp.xz - uFluidBounds.xy) / (uFluidBounds.zw - uFluidBounds.xy);
    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))) && abs(textureLod(tFluidHeight, uv, 0.0).r - wp.y) < 0.05) {
      vec4 m = textureLod(tFluidMap, uv, 0.0);
      flow = vec3(m.r, 0.0, m.g); turb = m.b; shore = m.a;
    }
  }
  float ring = 0.0;
  for (int k = 0; k < MAX_SOURCES; k++) {
    if (k >= uSourceCount) break;
    if (!pool || (uSourceY[k] > -9e3 && abs(wp.y - uSourceY[k]) > 0.05)) continue;   // pools at its height only
    vec4 s = uSources[k];
    bool rings = s.z > 0.0;
    s.z = abs(s.z);
    float r = length(wp.xz - s.xy);
    turb = max(turb, s.w * (1.0 - smoothstep(0.0, s.z, r)));
    if (rings) {   // rings expanding from the source, evenly out of phase
      float ph = fract(uTime * 0.45 + float(k) * 0.37), R = s.z * 2.6 * ph;
      ring = max(ring, (1.0 - smoothstep(0.0, 0.07, abs(r - R))) * (1.0 - ph) * s.w);
    }
  }
  float speed = length(flow);
  float rough = clamp(opt.z + 0.22 * speed + 0.75 * turb + 0.5 * ring, 0.0, 1.0);

  // Surface frame: a pool uses world xz; a falling sheet uses (across, down its slope), and its flow runs down.
  vec3 T = vec3(1.0, 0.0, 0.0), B = vec3(0.0, 0.0, 1.0);
  vec2 s = wp.xz, f = flow.xz + (pool ? vec2(0.05, 0.03) : vec2(0.0));   // still water still drifts in the air
  if (!pool) {
    B = speed > 1e-3 ? flow / speed : vec3(0.0, -1.0, 0.0);
    T = normalize(cross(n0, B));
    s = vec2(dot(wp, T), dot(wp, B)); f = vec2(0.0, speed);
  }

  // Ripple normal from the height field's slope. Calm water barely tilts; rough water tilts a lot.
  float sc = opt.w * (pool ? 1.0 : 0.5), e = 0.12 * sc;
  float h = rippleField(s, f, sc);
  vec2 gr = vec2(rippleField(s + vec2(e, 0.0), f, sc) - h, rippleField(s + vec2(0.0, e), f, sc) - h) / e;
  float amp = 0.32 * rough * sc;   // zero roughness is a true mirror
  vec3 n = normalize(n0 - (T * gr.x + B * gr.y) * amp);
  int tone = h > 0.57 && h < 0.63 ? 3 : h < 0.4 ? 1 : 2;   // thin bright crest lines, darker troughs
  if (ring > 0.4) tone = 3;

  // What lies under the surface, bent by the ripples and fading with depth.
  vec3 dn = n - n0;
  float thick = opaqueDepth(p) - d;
  ivec2 rq = p + ivec2(round(vec2(dot(dn, uRight), dot(dn, uUp)) * 6.0 * min(thick, 1.0)));
  if (rq != p && (!fluidAt(rq) || opaqueDepth(rq) < texelFetch(tFluidN, clampP(rq), 0).w)) rq = p;   // stay on this fluid
  float thickR = max(opaqueDepth(rq) - d, 0.0);
  float trans = exp(-thickR / max(opt.x, 1e-3)) * (pool ? 1.0 : 0.4);   // a falling sheet is aerated, nearly opaque
  vec3 shallow = uFluidA[slot].rgb, deep = uFluidB[slot].rgb;

  // The body: the deep colour, lit by the sky and sun (shadowed where the bed is) and by lamps; a self-lit fluid glows.
  float shadow = texelFetch(tShadow, p, 0).a;
  int band = clamp(tone - (shadow > 0.5 && uSunI > 0.5 ? 1 : 0), 0, 3);
  vec3 body = ramp(deep, band, 0);
  if (uLampOn > 0.01 && extra.y < 0.5) {
    vec4 L = lampAt(wp, n0, uDither == 1 ? (bayer4(p) - 0.5) * 0.6 : 0.0);
    if (L.a > 0.18) body = mix(body, ramp(deep, min(band + 1, 3), 2, L.rgb), uLampOn * (L.a > 0.45 ? 0.7 : 0.4));
  }
  body = mix(body, ramp(mix(deep, shallow, 0.35 * float(tone - 1)), 3, 1), extra.y);
  vec3 bed = imageAt(rq) * mix(vec3(1.0), shallow / max(max(shallow.r, shallow.g), max(shallow.b, 1e-3)), 0.55);
  float tq = floor(trans * 4.0 + 0.5) / 4.0;   // four clean steps: a dither here reads as a screen door
  vec3 col = mix(body, bed, tq);

  // Reflection. In this orthographic view the mirrored ray climbs the screen in a straight line (straight up its column
  // when the surface is flat), so walk up that line a pixel at a time. A pixel is the hit when the ray crosses the plane
  // of the surface seen there inside that pixel's own footprint, so a calm mirror is exact to the pixel. Past 128 rows the
  // walk takes two-pixel steps, with a footprint to match.
  vec3 r = reflect(uFwd, n);
  float up = dot(r, uUp);
  // A miss mirrors the sky: nearer the horizon colour where a ripple tilts the ray down, the zenith where it tilts up,
  // in three clean steps, so ripples read as bands of sky and a calm surface as one even tone.
  float sk = clamp(floor(1.5 + (r.y - reflect(uFwd, n0).y) * 9.0), 0.0, 2.0);
  // From this high a view the water mirrors the upper sky more than the horizon, seen through the water's own tint.
  vec3 refl = mix(uSkyBot, uSkyTop, 0.95 - 0.2 * sk) * mix(vec3(1.0), deep / max(max(deep.r, deep.g), max(deep.b, 1e-3)), 0.3);
  float skyW = 0.45;   // the sky mirrors faintly: a bright day sky would wash the water out
  if (up > 0.02 && opt.y > 0.0) {
    // Rough water breaks the image into rows that shiver sideways (the long broken streaks under a lamp at night).
    float row = floor(float(p.y) * 0.5);
    float shiver = (h21(vec2(row, floor(uTime * 5.0) + float(slot))) - 0.5) * 9.0 * rough * rough;
    vec2 dir = vec2(dot(r, uRight) / up, 1.0);
    float rows = 0.0;
    for (int i = 0; i < 192; i++) {
      float stp = i < 128 ? 1.0 : 2.0;
      rows += stp;
      vec2 pc = vec2(p) + 0.5 + vec2(shiver, 0.0) + dir * rows;
      if (pc.y >= uRes.y || pc.x < 0.0 || pc.x >= uRes.x) break;
      ivec2 q = ivec2(pc);
      if (A(q).a < 0.5 || fluidAt(q)) continue;
      vec4 nq = N(q);
      float den = dot(r, nq.xyz);
      if (abs(den) < 1e-3) continue;
      vec3 Q = worldAt(vec2(q) + 0.5, nq.w);
      float t = dot(Q - wp, nq.xyz) / den;
      if (t <= 0.0) continue;
      vec3 X = wp + r * t - Q;
      vec2 o = vec2(dot(X, uRight), dot(X, uUp)) / uTexel;
      float foot = 0.5 * stp + 0.25;   // the pixel, a step's width, and the resolve's sub-pixel shift
      if (abs(o.x) <= foot && abs(o.y) <= foot) { refl = imageAt(q); skyW = 1.0; break; }
    }
  }
  float fres = pow(1.0 - clamp(dot(-uFwd, n), 0.0, 1.0), 5.0);
  float R = clamp(opt.y * skyW * (1.0 - 0.55 * rough) * (0.75 + 2.5 * fres), 0.0, 0.95);
  float Rq = floor(R * 3.0 + 0.5) / 3.0;   // three clean steps; ripples move the step edges
  col = mix(col, refl, Rq);
  // Ripple crests catch the light and troughs sink a little, so the pattern reads even when the mirror dominates.
  vec3 lab = toLab(col);
  lab.x *= tone == 3 ? 1.16 : tone == 1 ? 0.9 : 1.0;
  col = fromLab(lab);

  // Lamps on the water. Each lamp's mirror image (as far below the surface as the lamp is above it) is drawn where it
  // projects: a compact spot on calm water that ripples stretch into a broken column of dashes running towards the
  // viewer, shivering sideways. Only where the lamp really lights this point (its shadow map): a lamp behind a quay wall
  // shows none. Drawn even where the lantern itself is hidden from the mirror, since its glow lights the water.
  if (pool && uLampOn > 0.01 && opt.y > 0.0) {   // mirrored across a level surface: pools only
    float stretch = smoothstep(0.08, 0.6, rough);
    for (int i = 0; i < MAX_LAMPS; i++) {
      if (i >= uLampCount) break;
      vec3 lp = uLamp[i].xyz;
      float hgt = lp.y - wp.y;
      if (hgt <= 0.0) continue;
      vec3 dv = vec3(lp.x, wp.y - hgt, lp.z) - wp;
      float sx = dot(dv, uRight), sy = dot(dv, uUp), rows = floor(sy / uTexel * 0.5);
      float ry = max(mix(0.07, 0.3 + 0.25 * hgt, stretch), 2.0 * uTexel), taper = 1.0 - abs(sy) / ry;
      if (taper <= 0.0) continue;
      float shiver = (h21(vec2(rows, floor(uTime * 3.0) + float(i))) - 0.5) * 0.25 * stretch;
      float gap = h21(vec2(rows * 1.7 + float(i), floor(uTime * 2.0)));
      bool dash = stretch < 0.2 || mod(rows, 2.0) < 0.5 || gap > 0.75 * (1.0 - taper);
      if (!dash || abs(sx + shiver) > max(mix(0.06, 0.04 + 0.12 * taper * taper, stretch), 0.5 * uTexel)) continue;
      if (lampVisible(i, wp, vec3(0.0, 1.0, 0.0)) < 0.5) continue;
      vec3 c = uLampCol[i] / max(max(uLampCol[i].r, uLampCol[i].g), max(uLampCol[i].b, 1e-3));
      col = mix(col, ramp(c * 0.7, taper > 0.6 ? 3 : 2, 1), uLampOn * (taper > 0.3 ? 1.0 : 0.6) * clamp(opt.y * 2.0, 0.0, 1.0));
      break;
    }
  }

  // Sun and moon glints where a ripple faces the light just right.
  float g = dot(r, uSun);
  if (opt.y > 0.15 && uSunI > 0.2 && g > 0.995 - 0.02 * rough && h21(floor(wp.xz * 8.0) + floor(uTime * 3.0)) > 0.4) col = ramp(mix(uSkyBot, vec3(1.0), 0.6), 4, 1);

  // Foam where the fluid is stirred: at sources, obstacles and falls, along the banks only where the water moves,
  // and wherever it runs fast. A noise pattern travels with the flow and shows above a threshold.
  float bankFoam = (1.0 - smoothstep(0.03, 0.25, shore)) * clamp((speed - 0.7) * 1.2 + turb, 0.0, 1.0);
  float stir = clamp(turb + bankFoam + max(speed - 1.2, 0.0) * 0.35 + ring * 0.3 + (pool ? 0.0 : 0.6), 0.0, 1.0) * extra.x;   // falling water froths
  if (stir > 0.08) {   // faint turbulence only roughens the surface
    float fz = rippleField(s * 2.7 + 11.0, f * 2.7, sc);   // a finer copy of the ripples
    float cut = 0.76 - 0.46 * stir;
    if (fz > cut) {
      vec3 foam = uFluidC[slot].rgb;
      int fb = fz > cut + 0.06 ? 3 : 2;
      vec3 fc = ramp(foam, fb - (shadow > 0.5 && uSunI > 0.5 ? 1 : 0), 0);
      if (uLampOn > 0.01) {
        vec4 L = lampAt(wp, vec3(0.0, 1.0, 0.0), 0.0);
        if (L.a > 0.18) fc = ramp(foam, fb, 2, L.rgb);
      }
      col = fc;
    }
  }
  outColor = vec4(toSRGB(finish(col, p)), 1.0);
}`;
