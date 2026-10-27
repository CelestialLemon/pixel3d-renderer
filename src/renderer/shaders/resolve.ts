import { SURFACE_NORMAL } from './common';

// Resolve: turns the S x S supersampled G-buffer and sun-shadow mask into one coherent sample per art pixel.
// Samples are grouped into surfaces: same flag and albedo AND on one plane (a palette colour is not an object id,
// so two overlapping slabs of one colour stay apart). The winning surface's sample nearest the pixel centre is
// copied, with its depth moved along its own tangent plane to the pixel centre so that the post shader's
// worldAt() reconstruction stays exact. With S = 3 a surface interior keeps the centre sample it had at S = 1.
// See docs/THIN_FEATURES.md.
//
// The source is generated so that every sample index is a literal: GPU compilers handle the dynamically indexed arrays of
// the straightforward form badly. The 36 symmetric colour tests and each sample's plane terms are computed once, and the
// selections are chains of ifs. The maths is the original's, in the same form and order, so the output is bit-identical.
// The one addition is the centre guard: when sample 0 is the same surface as every other sample in both directions, the
// comparisons are skipped and the centre sample is emitted, which is what they would have chosen.
const ORD = [[1, 1], [0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2]];
const K = ORD.map((_, i) => i), REST = K.slice(1);
const each = (list: number[], f: (i: number) => string) => list.map(f).join('');
const at = (i: number) => `base + ivec2(${ORD[i]})`;

// Depth plane i has at an offset o from its own sample, in art pixels (planeDepth in the straightforward form).
const planeAt = (i: number, o: string) => `(n${i}.w - (r${i} * (${o}).x + u${i} * (${o}).y) * uTexel / nf${i})`;
// sameSurface(i, j) is a colour test, symmetric and computed once per pair, and a directional plane test.
const colour = (i: number, j: number) => `c${Math.min(i, j)}_${Math.max(i, j)}`;
const plane = (i: number, j: number) => `(s${i} || abs(n${j}.w - ${planeAt(i, `o${j} - o${i}`)}) < eps)`;
const same = (i: number, j: number) => `${colour(i, j)} && ${plane(i, j)}`;

const load = (i: number) => `
  vec4 a${i} = texelFetch(tAlbedo, ${at(i)}, 0); vec4 n${i} = texelFetch(tNormal, ${at(i)}, 0);
  vec3 f${i} = surfaceNormal(n${i}.xyz, texelFetch(tObjectId, ${at(i)}, 0).gb);
  bool s${i} = a${i}.a < 0.5; float d${i} = s${i} ? 1e9 : n${i}.w; vec2 o${i} = (vec2(ivec2(${ORD[i]})) - 1.0) / 3.0;
  float r${i} = dot(f${i}, uRight), u${i} = dot(f${i}, uUp), nf${i} = dot(f${i}, uFwd);
  nf${i} = (nf${i} < 0.0 ? -1.0 : 1.0) * max(abs(nf${i}), 1e-3);`;

const colourTests = each(K, (i) => each(K.filter((j) => j > i), (j) => `
  bool c${i}_${j} = (s${i} || s${j}) ? (s${i} && s${j}) : !(abs(a${i}.a - a${j}.a) > 0.5 || any(greaterThan(abs(a${i}.rgb - a${j}.rgb), vec3(1e-4))));`));

// Per sample: how many samples share its surface (itself included), the nearest of them, and its representative (the first
// in ORD order, nearest the centre).
const group = (i: number) => `
  int cnt${i} = 1, rep${i} = ${i}; float nr${i} = d${i};` + each(K.filter((j) => j !== i), (j) => `
  if (${same(i, j)}) { cnt${i}++; nr${i} = min(nr${i}, d${j});${j < i ? ` rep${i} = min(rep${i}, ${j});` : ''} }`);

const MAIN = `
  ivec2 base = p * 3;
  float eps = 0.004 + 0.1 * uTexel, margin = max(0.10, uTexel * 3.0);
${each(K, load)}
${colourTests}
  // Sample 0 is the same surface as all the others, in both directions: nothing to group.
  if (${REST.map((k) => `${colour(0, k)} && ${plane(0, k)} && ${plane(k, 0)}`).join('\n      && ')}) {
    emit(${at(0)}, a0, n0, o0, r0, u0, nf0, margin);
    return;
  }
${each(K, group)}
  // A: majority; ties go to the nearer surface, then to the one nearer the centre.
  int best = 0, bc = cnt0; float bn = nr0;${each(REST, (i) => `
  if (cnt${i} > bc || (cnt${i} == bc && nr${i} < bn - 1e-4)) { best = ${i}; bc = cnt${i}; bn = nr${i}; }`)}
  int m = rep0;${each(REST, (i) => ` if (best == ${i}) m = rep${i};`)}
  // B: a surface clearly in front of the majority's plane wins with uPolicy + 1 samples, so thin things stay visible.
  if (uPolicy >= 1) {
    vec2 mo = o0; float mw = n0.w, mr = r0, mu = u0, mnf = nf0, md = d0; bool ms = s0;${each(REST, (i) => `
    if (m == ${i}) { mo = o${i}; mw = n${i}.w; mr = r${i}; mu = u${i}; mnf = nf${i}; md = d${i}; ms = s${i}; }`)}
    int fg = best; float fgD = md;${each(K, (i) => `
    if (!(cnt${i} < uPolicy + 1 || rep${i} != ${i}) && !(uThinOnly == 1 && fract(a${i}.a) < 0.1)) {
      vec2 o = o${i} - mo; float behind = ms ? 1e9 : mw - (mr * o.x + mu * o.y) * uTexel / mnf;
      if (d${i} < behind - margin && d${i} < fgD) { fg = ${i}; fgD = d${i}; }
    }`)}
    if (fg != best) m = fg;
  }
  vec4 wa = a0, wn = n0; vec2 wo = o0; float wr = r0, wu = u0, wnf = nf0; ivec2 wq = ivec2(${ORD[0]});${each(REST, (i) => `
  if (m == ${i}) { wa = a${i}; wn = n${i}; wo = o${i}; wr = r${i}; wu = u${i}; wnf = nf${i}; wq = ivec2(${ORD[i]}); }`)}
  emit(base + wq, wa, wn, wo, wr, wu, wnf, margin);
}`;

export const RESOLVE_FRAG = /* glsl */ `
precision highp float; precision highp int;
uniform sampler2D tAlbedo; uniform sampler2D tNormal; uniform sampler2D tShadow; uniform sampler2D tObjectId;
uniform int uS; uniform int uPolicy; uniform float uTexel;   // policy 0 majority, k >= 1 near-priority with k + 1 samples
uniform int uThinOnly;                                       // 1: near-priority only for thin-marked surfaces
uniform vec3 uRight; uniform vec3 uUp; uniform vec3 uFwd;
layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oNormal;
layout(location = 2) out vec4 oShadow;

${SURFACE_NORMAL}

// Writes the resolved sample: albedo a and normal/depth n at sub-sample offset o (in art pixels, from the art-pixel centre),
// whose surface plane has the terms r, u, nf (normal . right, up, forward; nf sign-fixed and kept off zero), fetched at q.
// The depth moves along the plane to the pixel centre so that the post shader's worldAt() reconstruction stays exact.
void emit(ivec2 q, vec4 a, vec4 n, vec2 o, float r, float u, float nf, float margin){
  // A near edge-on plane would extrapolate far past where the surface ends: cap the move at two silhouette margins
  // (exact down to |n.fwd| ~ 0.1 for a corner sample at any zoom). Unlike predictDepth in post.ts (a neighbourhood
  // heuristic that clamps the slope), the slope itself is the true one: grouping and the emitted depth must stay exact on
  // surfaces seen at a grazing angle.
  float m = 2.0 * margin;
  float dc = clamp(n.w - (r * (-o).x + u * (-o).y) * uTexel / nf, n.w - m, n.w + m);
  oAlbedo = a;
  oNormal = vec4(n.xyz, a.a < 0.5 ? n.w : dc);
  // Carry the representative's id without changing surface grouping or the shadow alpha used by post/water.
  oShadow = vec4(texelFetch(tObjectId, q, 0).rgb, texelFetch(tShadow, q, 0).a);
}

void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (uS == 1) {
    oAlbedo = texelFetch(tAlbedo, p, 0); oNormal = texelFetch(tNormal, p, 0);
    oShadow = vec4(texelFetch(tObjectId, p, 0).rgb, texelFetch(tShadow, p, 0).a);
    return;
  }${MAIN}`;
