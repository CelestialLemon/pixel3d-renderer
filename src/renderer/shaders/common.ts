// GLSL snippets shared by several shaders.

/** 4x4 ordered-dither threshold in (0, 1). */
export const BAYER4 = /* glsl */ `
float bayer4(ivec2 p){
  const int M[16] = int[16](0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5);
  return (float(M[(p.x & 3) + (p.y & 3) * 4]) + 0.5) / 16.0;
}`;

/** Full-screen triangle pair for the post passes. */
export const POST_VERT = /* glsl */ `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// The geometric plane is octahedrally encoded in two spare channels beside the object id. The +2 bias keeps
// every normal (including +Z) distinct from cleared channels. Zero falls back to the shading normal for
// cleared or synthetic inputs; every rasterized G-buffer surface writes its geometric plane.
export const SURFACE_NORMAL = /* glsl */ `
vec2 signNZ(vec2 v){ return mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), v)); }
vec2 encodeSurface(vec3 n){
  n /= abs(n.x) + abs(n.y) + abs(n.z);
  return 2.0 + (n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * signNZ(n.xy));
}
vec3 surfaceNormal(vec3 shading, vec2 encoded){
  if (encoded.x == 0.0) return shading;
  vec2 e = encoded - 2.0;
  vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * signNZ(n.xy);
  return normalize(n);
}`;
