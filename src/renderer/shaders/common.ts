// GLSL snippets shared by several shaders.

/** 4x4 ordered-dither threshold in (0, 1). */
export const BAYER4 = /* glsl */ `
float bayer4(ivec2 p){
  const int M[16] = int[16](0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5);
  return (float(M[(p.x & 3) + (p.y & 3) * 4]) + 0.5) / 16.0;
}`;

/** Full-screen triangle pair for the post passes. */
export const POST_VERT = /* glsl */ `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;
