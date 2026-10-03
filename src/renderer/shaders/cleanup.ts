// Clean-up: removes orphan pixels (a pixel unlike 3+ identical neighbours), which is the classic
// "pixel noise" an artist would hand-fix. Restricted to the interior of flat NORMAL/EMISSIVE surfaces not under a fluid.
export const CLEAN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tImage; uniform sampler2D tAlbedo; uniform sampler2D tNormal; uniform sampler2D tFluid; uniform vec2 uRes; uniform int uOn;
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
    bool interior = a.a > 0.5 && a.a < 2.5 && texelFetch(tFluid, p, 0).a < 0.5;   // not under a fluid
    const ivec2 offsets[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));
    for (int k = 0; k < 4; k++) {
      ivec2 q = clamp(p + offsets[k], ivec2(0), ivec2(uRes) - 1);
      vec4 aq = texelFetch(tAlbedo, q, 0), nq = texelFetch(tNormal, q, 0);
      if (floor(a.a + 0.5) != floor(aq.a + 0.5) || distance(a.rgb, aq.rgb) > 0.01 || dot(nd.xyz, nq.xyz) < 0.97) interior = false;
    }
    for (int i = 0; i < 4 && interior; i++) {
      int cnt = 0;
      for (int j = 0; j < 4; j++) if (same(n[i], n[j])) cnt++;
      if (cnt >= 3 && !same(n[i], c)) { c = n[i]; break; }
    }
  }
  outColor = vec4(c, 1.0);
}`;
