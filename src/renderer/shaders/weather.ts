// Falling rain and snow (PixelRenderer.setWeather), drawn over the finished image by the clean-up pass (shaders/cleanup.ts),
// after the orphan-pixel clean-up so it never removes a drop. Procedural, per art pixel, driven only by the clock: no geometry.
//
// Each layer is a grid of cells in screen space that slides down the screen as the clock runs (slanted across it by the
// wind); a cell holds at most one streak or flake. The grid moves with the camera's pixel-snapped position, so drops stay put
// in the world while the camera pans. Each drop has a depth: it follows a vertical line in the world (its depth grows as it
// falls), so it is hidden behind anything nearer and ends where it meets the ground. Rain also splashes on upward-facing
// surfaces. The cells hash to the same drops every 1024 rows, so the fall can wrap without a jump.
export const PRECIPITATION = /* glsl */ `
uniform vec4 uPrecip;        // x: 0 none, 1 rain, 2 snow; y: intensity 0..1; z: slant (pixels across per pixel down)
uniform vec4 uPrecipDepth;   // x: the camera's distance from its target, y: half the depth range drops start in, z: tan(elevation)
uniform float uTime; uniform vec3 uCamPos; uniform vec3 uSkyTop; uniform vec3 uSkyBot; uniform float uNight;

float pHash(ivec3 p){
  uvec3 q = uvec3(p) * uvec3(1597334673u, 3812015801u, 2798796415u);
  uint n = (q.x ^ q.y ^ q.z) * 1597334673u;
  n ^= n >> 16u; n *= 2246822519u; n ^= n >> 13u;
  return float(n >> 8u) / 16777216.0;
}
vec3 pSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }

// Is the drop with hash id (and a depth in [lo, hi] of the start range) in front of the scene at this pixel? Depths are
// measured along the view direction from a fixed point in the world, not from the camera, so panning leaves them alone.
// qy is the pixel's world-anchored height on screen; the drop's depth grows as it goes down the screen, as a falling drop's
// does. A drop's depth is fixed in the world, but only within the window of depths around the camera's target that can be
// on screen (lo to hi times uPrecipDepth.y from the target's): it wraps round that window as the camera pans.
// A drop that wraps swaps places with another one, as if it were a new drop: the rain stays uniform, and every drop is
// always consistent with the scene it is drawn over.
bool pVisible(ivec3 id, float lo, float hi, float qy, float sceneDepth){
  float centre = dot(uCamPos, uFwd) + uPrecipDepth.x + uPrecipDepth.z * dot(uCamPos, uUp);   // the target's column depth
  float start = centre + lo * uPrecipDepth.y, width = (hi - lo) * uPrecipDepth.y;
  float h = start + mod(pHash(id + ivec3(0, 0, 101)) * width - start, width);
  return h - qy * uTexel * uPrecipDepth.z < sceneDepth;
}

// One layer of rain streaks: lanes cell.x pixels wide each hold one column of drops; along it, cells cell.y rows tall
// each hold a streak len pixels long with probability dens. Returns 1 on a streak pixel.
float rainLayer(vec2 q, float qy, float sceneDepth, vec2 cell, float len, float dens, float speed, int layer, float lo, float hi){
  float c = floor(q.x + uPrecip.z * q.y);   // constant along a slanted streak
  float lane = floor(c / cell.x);
  ivec3 laneId = ivec3(int(lane), layer, 7);
  if (c - lane * cell.x != floor(pHash(laneId) * cell.x)) return 0.0;
  float period = 1024.0 * cell.y;
  float fall = mod(uTime * speed * (0.8 + 0.4 * pHash(laneId + ivec3(0, 0, 1))) + pHash(laneId + ivec3(0, 0, 2)) * period, period);
  float row = floor(q.y + fall), cy = floor(row / cell.y);
  ivec3 id = ivec3(int(lane), int(mod(cy, 1024.0)), layer);
  if (pHash(id) >= dens) return 0.0;
  float k = row - cy * cell.y - floor(pHash(id + ivec3(0, 0, 3)) * (cell.y - len));
  if (k < 0.0 || k >= len) return 0.0;
  return pVisible(id, lo, hi, qy, sceneDepth) ? 1.0 : 0.0;
}

// One layer of snowflakes: square cells of size pixels, each holding a flake with probability dens that drifts from side
// to side as it falls. Big flakes are two pixels. Returns 1 on a flake pixel.
float snowLayer(vec2 q, float qy, float sceneDepth, float size, float dens, float speed, int layer, bool big, float lo, float hi){
  float c = floor(q.x + uPrecip.z * q.y);
  float lane = floor(c / size);
  ivec3 laneId = ivec3(int(lane), layer, 9);
  float period = 1024.0 * size;
  float fall = mod(uTime * speed * (0.75 + 0.5 * pHash(laneId)) + pHash(laneId + ivec3(0, 0, 1)) * period, period);
  float row = floor(q.y + fall), cy = floor(row / size);
  ivec3 id = ivec3(int(lane), int(mod(cy, 1024.0)), layer + 32);
  if (pHash(id) >= dens) return 0.0;
  float drift = floor(1.6 * sin(uTime * (0.7 + 0.6 * pHash(id + ivec3(0, 0, 4))) + pHash(id + ivec3(0, 0, 5)) * 6.2832) + 0.5);
  vec2 at = vec2(2.0 + floor(pHash(id + ivec3(0, 0, 6)) * (size - 4.0)) + drift, floor(pHash(id + ivec3(0, 0, 7)) * size));
  vec2 local = vec2(c - lane * size, row - cy * size);
  bool hit = local == at || (big && local == at + vec2(1.0, 0.0));
  return hit && pVisible(id, lo, hi, qy, sceneDepth) ? 1.0 : 0.0;
}

// A short-lived splash where rain lands on an upward-facing surface: cells of 6 x 4 pixels fixed to the world, each
// splashing now and then for a fraction of a second.
float rainSplash(vec2 q, float dens){
  vec2 cell = floor(q / vec2(6.0, 4.0));
  ivec3 cid = ivec3(ivec2(cell), 61);
  float t = uTime * 2.5 + pHash(cid) * 8.0, slot = floor(t);
  ivec3 id = ivec3(ivec2(cell), int(mod(slot, 4096.0)) + 64);
  if (fract(t) > 0.3 || pHash(id) >= dens) return 0.0;
  vec2 at = vec2(floor(pHash(id + ivec3(0, 0, 1)) * 5.0), floor(pHash(id + ivec3(0, 0, 2)) * 4.0));
  vec2 local = q - cell * vec2(6.0, 4.0);
  return local == at || (dens > 0.3 && local == at + vec2(1.0, 0.0)) ? 1.0 : 0.0;
}

// The finished pixel c (sRGB) at art pixel p with rain or snow over it. a is its albedo (alpha < 0.5: sky), nd its normal
// and depth.
vec3 precipitation(vec3 c, ivec2 p, vec4 a, vec4 nd){
  int kind = int(uPrecip.x + 0.5);
  if (kind == 0) return c;
  float i = uPrecip.y;
  bool sky = a.a < 0.5;
  // The camera is snapped to the pixel grid, so this shift is whole pixels and the drops stay put as it pans.
  vec2 q = vec2(p) + floor(vec2(dot(uCamPos, uRight), dot(uCamPos, uUp)) / uTexel + 0.5);
  float qy = q.y - 0.5 * uRes.y, depth = sky ? 1e9 : nd.w + dot(uCamPos, uFwd);
  // The drops take the sky's colour, a little lighter by day.
  vec3 skyCol = mix(uSkyBot, uSkyTop, 0.45);
  if (kind == 1) {
    // At night the sky is about as dark as the ground, so the drops stay a little lighter than it, dimmed.
    vec3 rain = pSRGB(mix(skyCol, vec3(0.86, 0.9, 1.0), 0.35) * (1.0 - 0.6 * uNight));
    float near = rainLayer(q, qy, depth, vec2(5.0, 36.0), 3.0 + floor(4.0 * i), mix(0.1, 0.85, i), 150.0, 0, -1.0, 0.3);
    float far = near > 0.0 ? 0.0 : rainLayer(q + vec2(2.0, 17.0), qy, depth, vec2(4.0, 28.0), 2.0 + floor(2.0 * i), mix(0.12, 0.9, i), 100.0, 1, -0.3, 1.0);
    float splash = (sky || nd.y < 0.9 || near + far > 0.0) ? 0.0 : rainSplash(q, mix(0.05, 0.45, i));
    return mix(c, rain, max(near * 0.55, max(far * 0.32, splash * 0.45)));
  }
  vec3 snow = pSRGB(mix(skyCol, vec3(0.94, 0.96, 1.0), 0.8) * (1.0 - 0.7 * uNight));
  float near = snowLayer(q, qy, depth, 9.0, mix(0.1, 0.75, i), 22.0, 0, i > 0.45, -1.0, 0.3);
  float far = near > 0.0 ? 0.0 : snowLayer(q + vec2(3.0, 5.0), qy, depth, 6.0, mix(0.12, 0.8, i), 13.0, 1, false, -0.3, 1.0);
  return mix(c, snow, max(near * 0.9, far * 0.6));
}`;
