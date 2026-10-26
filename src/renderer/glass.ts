import * as THREE from 'three';
import { FLAG } from './flags';

// Glass: panes you see through that are still visibly there. Geometry flagged FLAG.GLASS (the `glass_` asset prefix, via
// `glassMeshRule`) is split out of the opaque geometry, so it casts no sun or lamp shadow and is never picked, and is drawn
// in its own pass at art resolution: the nearest glass surface in front of the resolved opaque world, hidden by hand
// behind whatever is nearer (the frame, like the fluids). The clean-up pass then lays it over the finished image
// (shaders/cleanup.ts): a flat tint of the pane's colour, a lighter rim where a pane ends or meets another, and thin
// diagonal glints. What is behind is left as it is, so the frame's shadows, the crop inside and the lit interior show
// through, and it stays on the pixel grid (no blending of palette colours into smooth ramps beyond that one tint).

/** Whether a vertex flag (it may carry the thin mark) is glass. */
const isGlass = (flag: number) => Math.round(flag) === FLAG.GLASS;

/**
 * Split the glass triangles out of a non-indexed geometry (what `GeometryCollector` builds): `solid` is every other
 * triangle and `glass` the glass ones (null: none). Every attribute is kept, so an object's motion attributes survive. A
 * geometry with no glass comes back as `solid` itself, untouched.
 */
export function splitGlass(geometry: THREE.BufferGeometry): { solid: THREE.BufferGeometry; glass: THREE.BufferGeometry | null } {
  const flags = geometry.getAttribute('aFlag') as THREE.BufferAttribute | undefined;
  if (!flags) return { solid: geometry, glass: null };
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  if (geometry.index) src.drawRange = { ...geometry.drawRange };   // toNonIndexed resets it; an index entry becomes a vertex
  const f = src.getAttribute('aFlag') as THREE.BufferAttribute;
  // Only the draw range is drawn, so only it is split (both halves are drawn whole).
  const first = Math.min(src.drawRange.start, f.count);   // triangles start at the draw call's own offset
  const end = Math.min(f.count, src.drawRange.start + src.drawRange.count);
  const vertices = Math.max(0, Math.floor((end - first) / 3) * 3);
  const glassTriangle: boolean[] = [];
  let glassVertices = 0;
  for (let t = 0; t < vertices; t += 3) {
    const glass = isGlass(f.getX(first + t));
    glassTriangle.push(glass);
    if (glass) glassVertices += 3;
  }
  if (!glassVertices) return { solid: geometry, glass: null };
  const take = (want: boolean, count: number) => {
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(src.attributes) as [string, THREE.BufferAttribute][]) {
      const size = a.itemSize, out = new (a.array.constructor as new (n: number) => THREE.TypedArray)(count * size);
      let o = 0;
      for (let t = 0; t < glassTriangle.length; t++) if (glassTriangle[t] === want) {
        out.set(a.array.subarray((first + t * 3) * size, (first + t * 3 + 3) * size), o); o += 3 * size;
      }
      g.setAttribute(name, new THREE.BufferAttribute(out, size, a.normalized));
    }
    return g;
  };
  return { solid: take(false, vertices - glassVertices), glass: take(true, glassVertices) };
}

// The glass G-buffer: the nearest glass surface at each art pixel, from the same camera. rgb: the pane's colour (an
// object's tint applied, as for opaque surfaces) with alpha 1; the second target: the pane's normal facing the camera and
// its depth. A pane is dropped where the resolved opaque world is nearer than it (hand depth test, as for fluids).
export const GLASS_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tAlbedo; uniform sampler2D tNormal;   // the resolved opaque G-buffer
uniform vec3 uFwd;
in vec3 vP; in vec3 vN; in vec3 vC; in float vF; in float vD; in float vA;
flat in float vObjectId;
layout(location = 0) out vec4 gColor;
layout(location = 1) out vec4 gNormal;
// The dither of PixelObject.opacity, as in the opaque pass.
float bayer4(ivec2 p){
  const int M[16] = int[16](0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5);
  return (float(M[(p.x & 3) + (p.y & 3) * 4]) + 0.5) / 16.0;
}
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (texelFetch(tAlbedo, p, 0).a > 0.5 && vD > texelFetch(tNormal, p, 0).w - 0.002) discard;
  if (vA < 0.999 && vA < bayer4(p)) discard;
  vec3 n = normalize(vN);
  if (dot(n, uFwd) > 0.0) n = -n;   // a pane is seen from either side
  gColor = vec4(vC, 1.0);
  gNormal = vec4(n, vD);
}`;

// The composite, included by the clean-up shader. `c` is the finished image's colour (sRGB).
export const GLASS_COMPOSITE = /* glsl */ `
uniform sampler2D tGlass; uniform sampler2D tGlassN;
uniform vec2 uGlass;   // x: 1 when glass is drawn this frame, y: how bright the day is (0.35 at night, 1 by day)
bool glassAt(ivec2 q){ return texelFetch(tGlass, clamp(q, ivec2(0), ivec2(uRes) - 1), 0).a > 0.5; }
vec3 glassSRGB(vec3 c){
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float glassHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 glassOver(vec3 c, ivec2 p){
  vec4 g = texelFetch(tGlass, p, 0);
  if (g.a < 0.5) return c;
  vec4 gn = texelFetch(tGlassN, p, 0);
  vec3 pane = glassSRGB(g.rgb) * uGlass.y;
  float lum = dot(glassSRGB(g.rgb), vec3(0.3, 0.55, 0.15));
  // A flat tint of the pane's colour. A pane tinted towards white (snow on a roof) turns nearly opaque.
  c = mix(c, pane, 0.2 + 0.55 * smoothstep(0.55, 0.9, lum));
  // A rim of light where the pane ends (frame, edge of the roof) or turns a corner.
  const ivec2 offsets[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));
  bool rim = false;
  for (int k = 0; k < 4; k++) {
    ivec2 q = p + offsets[k];
    if (!glassAt(q)) { rim = true; break; }
    vec4 nq = texelFetch(tGlassN, q, 0);
    if (dot(nq.xyz, gn.xyz) < 0.9 || abs(nq.w - gn.w) > 0.25) { rim = true; break; }
  }
  vec3 shine = vec3(0.9, 0.97, 1.0) * uGlass.y;
  if (rim) return mix(c, shine, 0.5);
  // Thin diagonal glints, in broken runs, on the faces that look up at the sun.
  float stripe = mod(float(p.x + p.y), 11.0);
  if (stripe < 1.0 && gn.y > 0.3 && glassHash(floor(vec2(p) / 5.0)) > 0.45) return mix(c, shine, 0.4);
  return c;
}`;
