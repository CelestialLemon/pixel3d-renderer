// Resolve: turns the S x S supersampled G-buffer and sun-shadow mask into one coherent sample per art pixel.
// Samples are grouped into surfaces: same flag and albedo AND on one plane (a palette colour is not an object id,
// so two overlapping slabs of one colour stay apart). The winning surface's sample nearest the pixel centre is
// copied, with its depth moved along its own tangent plane to the pixel centre so that the post shader's
// worldAt() reconstruction stays exact. With S = 3 a surface interior keeps the centre sample it had at S = 1.
// See docs/THIN_FEATURES.md.
export const RESOLVE_FRAG = /* glsl */ `
precision highp float; precision highp int;
uniform sampler2D tAlbedo; uniform sampler2D tNormal; uniform sampler2D tShadow;
uniform int uS; uniform int uPolicy; uniform float uTexel;   // policy 0 majority, k >= 1 near-priority with k + 1 samples
uniform int uThinOnly;                                       // 1: near-priority only for thin-marked surfaces
uniform vec3 uRight; uniform vec3 uUp; uniform vec3 uFwd;
layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oNormal;
layout(location = 2) out vec4 oShadow;

// 3 x 3 sub-samples, nearest the pixel centre first: centre, edges, corners.
const ivec2 ORD[9] = ivec2[9](ivec2(1,1), ivec2(0,1), ivec2(2,1), ivec2(1,0), ivec2(1,2), ivec2(0,0), ivec2(2,0), ivec2(0,2), ivec2(2,2));

// Depth the plane (n, d) has at an offset o, in art pixels (same as predictDepth in post.ts).
float planeDepth(vec3 n, float d, vec2 o){
  float nf = dot(n, uFwd);
  nf = (nf < 0.0 ? -1.0 : 1.0) * max(abs(nf), 0.25);
  return d - (dot(n, uRight) * o.x + dot(n, uUp) * o.y) * uTexel / nf;
}
// Sub-sample position relative to the art-pixel centre, in art pixels.
vec2 offsetOf(int i){ return (vec2(ORD[i]) - 1.0) / 3.0; }

vec4 a[9]; vec4 nd[9];
float margin(){ return max(0.10, uTexel * 3.0); }
bool sameSurface(int i, int j){
  if (a[i].a < 0.5 || a[j].a < 0.5) return a[i].a < 0.5 && a[j].a < 0.5;   // sky matches only sky
  if (abs(a[i].a - a[j].a) > 0.5 || any(greaterThan(abs(a[i].rgb - a[j].rgb), vec3(1e-4)))) return false;
  // Same plane within prediction precision (sub-texel offsets, smooth normals), far tighter than the silhouette
  // margin: two same-colour slabs a centimetre apart are different surfaces.
  return abs(nd[j].w - planeDepth(nd[i].xyz, nd[i].w, offsetOf(j) - offsetOf(i))) < 0.004 + 0.1 * uTexel;
}

void emit(ivec2 q, int i){
  oAlbedo = a[i];
  oNormal = vec4(nd[i].xyz, a[i].a < 0.5 ? nd[i].w : planeDepth(nd[i].xyz, nd[i].w, -offsetOf(i)));
  oShadow = vec4(0.0, 0.0, 0.0, texelFetch(tShadow, q, 0).a);
}

void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (uS == 1) {
    oAlbedo = texelFetch(tAlbedo, p, 0); oNormal = texelFetch(tNormal, p, 0);
    oShadow = vec4(0.0, 0.0, 0.0, texelFetch(tShadow, p, 0).a);
    return;
  }
  ivec2 base = p * 3;
  float d[9];
  for (int i = 0; i < 9; i++) {
    a[i] = texelFetch(tAlbedo, base + ORD[i], 0);
    nd[i] = texelFetch(tNormal, base + ORD[i], 0);
    d[i] = a[i].a < 0.5 ? 1e9 : nd[i].w;
  }
  // Per key, its representative is the first sample in ORD order (nearest the centre).
  int cnt[9]; float near[9]; int rep[9];
  for (int i = 0; i < 9; i++) {
    rep[i] = i; cnt[i] = 0; near[i] = 1e9;
    for (int j = 0; j < 9; j++) if (sameSurface(i, j)) {
      cnt[i]++; near[i] = min(near[i], d[j]);
      if (j < rep[i]) rep[i] = j;
    }
  }
  // A: majority; ties go to the nearer surface, then to the one nearer the centre.
  int best = 0;
  for (int i = 1; i < 9; i++)
    if (cnt[i] > cnt[best] || (cnt[i] == cnt[best] && near[i] < near[best] - 1e-4)) best = i;
  // B: a surface clearly in front of the majority's plane wins with uPolicy + 1 samples, so thin things stay visible.
  if (uPolicy >= 1) {
    int m = rep[best], fg = best;
    for (int i = 0; i < 9; i++) {
      if (cnt[i] < uPolicy + 1 || i != rep[i]) continue;
      if (uThinOnly == 1 && fract(a[i].a) < 0.1) continue;
      float behind = a[m].a < 0.5 ? 1e9 : planeDepth(nd[m].xyz, nd[m].w, offsetOf(i) - offsetOf(m));
      if (d[i] < behind - margin() && d[i] < d[rep[fg]]) fg = i;
    }
    best = fg;
  }
  int w = rep[best];
  emit(base + ORD[w], w);
}`;
