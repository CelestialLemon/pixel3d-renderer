import * as THREE from 'three';

export interface Settings {
  pixel: number; // CSS pixels per art pixel
  outlines: boolean;
  dither: boolean;
  cleanup: boolean;
  clouds: boolean;
  contacts: boolean;
  sunAz: number; // degrees
  sunEl: number; // degrees
}

// ---------------------------------------------------------------------------------
// G-buffer: albedo(rgb)+flag, world normal(xyz)+linear view depth. Drawn in one pass
// with MRT so the post shader can reason about every pixel of the low-res image.
// ---------------------------------------------------------------------------------
const GBUF_VERT = /* glsl */ `
in vec3 aColor; in float aFlag;
out vec3 vN; out vec3 vC; out float vF; out float vD;
void main(){
  vN = normal; vC = aColor; vF = aFlag;
  vec4 vp = viewMatrix * vec4(position, 1.0);
  vD = -vp.z;
  gl_Position = projectionMatrix * vp;
}`;
const GBUF_FRAG = /* glsl */ `
precision highp float;
in vec3 vN; in vec3 vC; in float vF; in float vD;
layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
void main(){
  gAlbedo = vec4(vC, 1.0 + floor(vF + 0.5));
  gNormal = vec4(normalize(vN), vD);
}`;

// ---------------------------------------------------------------------------------
// The pixel-art "brain": turns the G-buffer into a palette-controlled, outlined,
// dithered image with hue-shifted shading ramps.
// ---------------------------------------------------------------------------------
const POST_VERT = /* glsl */ `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FRAG = /* glsl */ `
precision highp float; precision highp int;
uniform sampler2D tAlbedo; uniform sampler2D tNormal; uniform sampler2D tShadow;
uniform vec2 uRes; uniform float uTexel;
uniform vec3 uRight; uniform vec3 uUp; uniform vec3 uFwd; uniform vec3 uCamPos;
uniform vec3 uSun; uniform float uTime;
uniform int uOutline; uniform int uDither; uniform int uClouds; uniform int uContact;
uniform vec3 uSkyTop; uniform vec3 uSkyBot;
out vec4 outColor;

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

// Hue-shifted ramp. band -1 (outline ink) .. 4 (specular glint). Shadows drift cool
// and saturated, light drifts warm and slightly desaturated, like hand-made ramps.
vec3 ramp(vec3 lin, int band){
  int i = band + 1;
  const float LM[6] = float[6](0.57, 0.72, 0.86, 1.00, 1.065, 1.12);
  const float CM[6] = float[6](0.72, 0.86, 0.96, 1.00, 0.92, 0.82);
  const vec2  TT[6] = vec2[6](vec2(0.012,-0.020), vec2(0.012,-0.018), vec2(0.006,-0.009), vec2(0.0), vec2(0.002, 0.012), vec2(0.003, 0.018));
  vec3 lab = toLab(lin);
  lab.x = min(lab.x * LM[i], 0.97);
  lab.yz = lab.yz * CM[i] + TT[i];
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

float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
}
float cloudField(vec2 p){ return 0.62*vn(p) + 0.38*vn(p*2.3+7.0); }

float sunlight(ivec2 p, vec3 n){
  // ShadowMaterial alpha is occlusion: 0 = exposed, 1 = shadowed.
  float visibility = 1.0 - texelFetch(tShadow, p, 0).a;
  return max(dot(n, uSun), 0.0) * visibility;
}

// scalar "how lit is this pixel" used for band selection
float shadeAt(ivec2 q){
  vec4 nq = N(q);
  vec3 nn = nq.xyz;
  float s = 0.34 + 0.14 * max(nn.y, 0.0) + 0.55 * sunlight(clampP(q), nn);
  if (uClouds == 1 && nn.y > 0.95) {
    vec3 wp = uCamPos + uRight * ((float(q.x) + 0.5 - 0.5 * uRes.x) * uTexel) + uUp * ((float(q.y) + 0.5 - 0.5 * uRes.y) * uTexel) + uFwd * nq.w;
    float cl = smoothstep(0.63, 0.69, cloudField(wp.xz * 0.11 + vec2(uTime * 0.010, uTime * 0.004)));
    s -= 0.14 * cl;
  }
  return s;
}

// Sparse screen-space contact occlusion. Plane-relative depth rejects coplanar
// tiles; world-sized taps keep the footprint consistent when zooming. Quantised
// below, so contacts still use a finite colour ramp rather than a blurry overlay.
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
    if (aq.a < 0.5 || aq.a > 2.5) continue; // tiny grass never dirties the ground
    float delta = predictDepth(n, d, vec2(offset)) - nq.w;
    float hit = smoothstep(0.025, 0.09, delta) * (1.0 - smoothstep(0.5, 1.35, delta));
    occ += hit;
  }
  return occ / 12.0;
}

void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = A(p);
  bool sky = a.a < 0.5;
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
      if (aq.a < 0.5 || aq.a > 2.5) continue;          // sky, or decor that never casts ink
      float dn = N(q).w;
      float dp = sky ? 1e4 : predictDepth(n, d, vec2(OFF[i]));
      if (dn < dp - THR && dn < bestD) { bestD = dn; bestQ = q; sil = true; }
    }
  }
  if (sil) {
    vec3 nearColor = A(bestQ).rgb;
    // Softer botanical silhouettes; solid architecture keeps its crisp ink.
    bool foliage = nearColor.g > nearColor.r * 1.25 && nearColor.g > nearColor.b * 1.2;
    bool steam = A(bestQ).a > 1.5 && toLab(nearColor).x > 0.85;
    vec3 ink = ramp(nearColor, steam ? 1 : foliage ? 0 : -1);
    outColor = vec4(toSRGB(ink), 1.0);
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

  // ---- 3. banded lighting with gradient-aware ordered dithering ---------------------
  float ndl = dot(n, uSun);
  float s = shadeAt(p);
  float contact = contactAt(p, n, d);
  float flagEmissive = a.a > 1.5 && a.a < 2.5 ? 1.0 : 0.0;

  // Dither only where the light really forms a smooth gradient (round shapes, bevels,
  // cloud edges). Flat surfaces and hard shadow edges stay clean, as an artist would.
  float g = 0.0;
  for (int i = 0; i < 4; i++) {
    ivec2 q = p + OFF[i];
    vec4 aq = A(q);
    if (aq.a != a.a || distance(aq.rgb, a.rgb) > 0.01 || dot(n, N(q).xyz) < 0.94 || abs(N(q).w - predictDepth(n, d, vec2(OFF[i]))) > THR) continue;
    g = max(g, abs(shadeAt(q) - s));
  }
  // A small transition zone, with no dither on the meadow. Broad flat colour
  // clusters carry the picture; texture comes from the existing world geometry.
  float dw = (uDither == 1 && a.a < 2.5 && g > 0.003 && g < 0.075) ? 0.045 : 0.0;
  float sd = s + (bayer4(p) - 0.5) * dw;
  int band = sd < 0.32 ? 0 : sd < 0.52 ? 1 : sd < 0.82 ? 2 : 3;
  if (contact > 0.13) band = max(0, band - 1);
  if (contact > 0.40) band = max(0, band - 1);
  if (flagEmissive > 0.5) {
    // The original flags steam as emissive as well as bakery windows. Give pale
    // steam volume while keeping amber glass luminous, without altering the asset.
    bool steam = toLab(a.rgb).x > 0.85;
    band = steam ? (ndl < 0.2 ? 1 : ndl < 0.65 ? 2 : 3) : 3;
  }

  // ---- 4. creases: convex edges catch light, concave ones sink into shadow ---------
  if (uOutline == 1 && a.a < 2.5) {
    int hi = 0, lo = 0;
    for (int i = 0; i < 4; i++) {
      ivec2 q = p + OFF[i];
      vec4 aq = A(q);
      if (aq.a < 0.5 || aq.a > 2.5) continue;
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

  vec3 col = ramp(a.rgb, band);
  outColor = vec4(toSRGB(col), 1.0);
}`;

// ---------------------------------------------------------------------------------
// Clean-up: removes orphan pixels (a pixel unlike 3+ identical neighbours), which is
// the classic "pixel noise" an artist would hand-fix.
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
    for (int i = 0; i < 4; i++) {
      int cnt = 0;
      for (int j = 0; j < 4; j++) if (same(n[i], n[j])) cnt++;
      // Only repair lighting speckles within one material and one surface.
      // Preserve single-pixel flowers, chips, text, and silhouette highlights.
      vec4 a = texelFetch(tAlbedo, p, 0);
      vec4 nd = texelFetch(tNormal, p, 0);
      bool interior = a.a > 0.5 && a.a < 2.5;
      const ivec2 offsets[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));
      for (int k = 0; k < 4; k++) {
        ivec2 q = clamp(p + offsets[k], ivec2(0), ivec2(uRes) - 1);
        vec4 aq = texelFetch(tAlbedo, q, 0), nq = texelFetch(tNormal, q, 0);
        if (a.a != aq.a || distance(a.rgb, aq.rgb) > 0.01 || dot(nd.xyz, nq.xyz) < 0.97) interior = false;
      }
      if (interior && cnt >= 3 && !same(n[i], c)) { c = n[i]; break; }
    }
  }
  outColor = vec4(c, 1.0);
}`;

const srgbToLinear = (hex: number) => new THREE.Color(hex);

export class PixelPipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300);
  readonly scene = new THREE.Scene();
  readonly light = new THREE.DirectionalLight(0xffffff, 1);

  private gbuf!: THREE.WebGLRenderTarget;
  private shadowRT!: THREE.WebGLRenderTarget;
  private stylised!: THREE.WebGLRenderTarget;
  private mesh!: THREE.Mesh;
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

  constructor(readonly canvas: HTMLCanvasElement, geometry: THREE.BufferGeometry) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    const gmat = new THREE.ShaderMaterial({ vertexShader: GBUF_VERT, fragmentShader: GBUF_FRAG, glslVersion: THREE.GLSL3, side: THREE.FrontSide });
    gmat.shadowSide = THREE.DoubleSide;
    this.mesh = new THREE.Mesh(geometry, gmat);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

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
        uRes: { value: new THREE.Vector2() }, uTexel: { value: 0.05 },
        uRight: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3() }, uCamPos: { value: new THREE.Vector3() },
        uSun: { value: this.sun }, uTime: { value: 0 },
        uOutline: { value: 1 }, uDither: { value: 1 }, uClouds: { value: 1 }, uContact: { value: 1 },
        uSkyTop: { value: srgbToLinear(0x79b6dc) }, uSkyBot: { value: srgbToLinear(0xf6e6c2) },
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

  setSun(azDeg: number, elDeg: number) {
    const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
    this.sun.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    this.light.position.copy(this.sun).multiplyScalar(60).add(new THREE.Vector3(0.8, 0, 0));
    this.light.target.position.set(0.8, 0, 0);
    this.light.target.updateMatrixWorld();
    this.shadowDirty = true;
  }

  resize(w: number, h: number) {
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    const mk = (opts: THREE.RenderTargetOptions, count = 1) => new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false, count, ...opts });
    this.gbuf?.dispose(); this.shadowRT?.dispose(); this.stylised?.dispose();
    // Full float depth avoids 1/16-world-unit rounding at this camera distance.
    // Half float turned planar roof/paving edges into false depth discontinuities.
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

  /** Re-rasterise the scene into the G-buffer and shadow mask (only when the view changed). */
  renderGeometry() {
    const r = this.renderer;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.gbuf); r.clear(); r.render(this.scene, this.camera);

    if (this.shadowDirty) { r.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    r.setClearColor(0xffffff, 1);
    this.scene.overrideMaterial = this.shadowMat;
    r.setRenderTarget(this.shadowRT); r.clear(); r.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;
  }

  /** Stylise the cached G-buffer into the final pixel image. Cheap, runs every frame. */
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
    u.uContact.value = s.contacts ? 1 : 0;
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
