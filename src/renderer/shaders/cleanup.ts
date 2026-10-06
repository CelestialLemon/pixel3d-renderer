// Clean-up: removes orphan pixels (a pixel unlike 3+ identical neighbours), which is the classic
// "pixel noise" an artist would hand-fix. Restricted to the interior of flat NORMAL/EMISSIVE surfaces not under a fluid.
export const CLEAN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tImage; uniform sampler2D tAlbedo; uniform sampler2D tNormal; uniform sampler2D tShadow; uniform sampler2D tFluid; uniform vec2 uRes; uniform int uOn;
out vec4 outColor;
vec3 F(ivec2 q){ return texelFetch(tImage, clamp(q, ivec2(0), ivec2(uRes) - 1), 0).rgb; }
bool same(vec3 a, vec3 b){ return all(lessThan(abs(a - b), vec3(0.002))); }
#ifdef HIGHLIGHT
// As in post.ts: the highlight rim is never "noise".
uniform vec4 uHighlight; uniform float uTexel; uniform vec3 uRight; uniform vec3 uUp; uniform vec3 uFwd;
float objectId(ivec2 q){ return texelFetch(tShadow, q, 0).r; }
bool highlit(ivec2 q){
  float id = objectId(q);
  return id > 0.5 && any(lessThan(abs(uHighlight - id), vec4(0.5)));
}
float predictDepth(vec3 n, float d, vec2 o){   // as in post.ts
  float nf = dot(n, uFwd);
  nf = (nf < 0.0 ? -1.0 : 1.0) * max(abs(nf), 0.25);
  return d - (dot(n, uRight) * o.x + dot(n, uUp) * o.y) * uTexel / nf;
}
// Does post.ts step 0 draw the rim here, inside or outside the object? Mirrors that test (p is never sky: only
// interior pixels ask), so the rest of the object, lifted a band, and the pixels of other objects level with it are
// cleaned up as usual.
bool rimmed(ivec2 p, vec3 n, float d){
  bool lifted = highlit(p);
  float THR = max(0.10, uTexel * 3.0);
  const ivec2 offsets[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));
  for (int k = 0; k < 4; k++) {
    ivec2 q = clamp(p + offsets[k], ivec2(0), ivec2(uRes) - 1);
    if (highlit(q) == lifted) continue;
    vec4 nq = texelFetch(tNormal, q, 0);
    if (lifted ? texelFetch(tAlbedo, q, 0).a > 0.5 && (nq.w < d - THR || (nq.w <= d + THR &&
                   (objectId(q) > 0.5 || predictDepth(nq.xyz, nq.w, -vec2(offsets[k])) < d - 0.5 * uTexel)))
               : d > nq.w + THR || (d >= nq.w - THR &&
                   objectId(p) < 0.5 && predictDepth(n, d, vec2(offsets[k])) >= nq.w - 0.5 * uTexel)) return true;
  }
  return false;
}
#endif
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = F(p);
  if (uOn == 1) {
    vec3 n[4] = vec3[4](F(p + ivec2(1,0)), F(p + ivec2(-1,0)), F(p + ivec2(0,1)), F(p + ivec2(0,-1)));
    vec4 a = texelFetch(tAlbedo, p, 0);
    vec4 nd = texelFetch(tNormal, p, 0);
    bool interior = a.a > 0.5 && a.a < 2.5 && texelFetch(tFluid, p, 0).a < 0.5;   // not under a fluid
    const ivec2 offsets[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));
    for (int k = 0; k < 4; k++) {
      ivec2 q = clamp(p + offsets[k], ivec2(0), ivec2(uRes) - 1);
      vec4 aq = texelFetch(tAlbedo, q, 0), nq = texelFetch(tNormal, q, 0);
      if (floor(a.a + 0.5) != floor(aq.a + 0.5) || distance(a.rgb, aq.rgb) > 0.01 || dot(nd.xyz, nq.xyz) < 0.97) interior = false;
    }
#ifdef HIGHLIGHT
    if (interior && rimmed(p, nd.xyz, nd.w)) interior = false;
#endif
    for (int i = 0; i < 4 && interior; i++) {
      int cnt = 0;
      for (int j = 0; j < 4; j++) if (same(n[i], n[j])) cnt++;
      if (cnt >= 3 && !same(n[i], c)) { c = n[i]; break; }
    }
  }
  outColor = vec4(c, 1.0);
}`;
