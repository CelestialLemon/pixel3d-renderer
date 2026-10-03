import * as THREE from 'three';
import { POOL_NORMAL_Y, type SceneFluids } from './fluids';

export interface FluidMap {
  /** RG = world XZ velocity (m/s), B = visual turbulence [0,1], A = shore distance (m, capped at 4). */
  texture: THREE.DataTexture;
  /** Pool height, -1e4 outside coverage. Highest flat pool wins where pools overlap in XZ. */
  height: THREE.DataTexture;
  /** World XZ edges. Reject UVs outside these bounds before sampling. */
  bounds: [number, number, number, number];
}

const TEXEL = 0.15, MAX_SIZE = 1024, NO_POOL = -1e4, MAX_DISTANCE = 4;
const clamp = THREE.MathUtils.clamp;
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
interface Face { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; flow: [number, number]; level: number }
interface Segment { x0: number; z0: number; x1: number; z1: number; sign: number; group: number }

/** Closed outward contours are independent solids. Enclosed inward contours are holes in the
 * smallest enclosing solid; orphan inward contours describe liquid cavities. Welding is much
 * finer than a map cell. Open chains cannot establish an inside and are conservatively ignored. */
function solidContours(segments: Segment[]): Segment[] {
  const key = (x: number, z: number) => `${Math.round(x * 1e5)},${Math.round(z * 1e5)}`;
  const starts = segments.map((s) => key(s.x0, s.z0)), ends = segments.map((s) => key(s.x1, s.z1));
  const outgoing = new Map<string, number[]>();
  segments.forEach((_, i) => { const list = outgoing.get(starts[i]); if (list) list.push(i); else outgoing.set(starts[i], [i]); });
  const used = new Uint8Array(segments.length);
  const contours: { edges: number[]; area: number; bounds: number[]; group: number }[] = [];
  for (let seed = 0; seed < segments.length; seed++) {
    if (used[seed]) continue;
    let current = seed;
    const path: number[] = [], nodes = new Map<string, number>();
    while (current >= 0 && !used[current]) {
      const node = starts[current];
      nodes.set(node, path.length); path.push(current); used[current] = 1;
      const s = segments[current], candidates = (outgoing.get(ends[current]) ?? []).filter((i) => !used[i]);
      // Prefer the leftmost continuation at a junction; retain coincident segment multiplicity.
      const turn = (i: number) => {
        const t = segments[i], ux = s.x1 - s.x0, uz = s.z1 - s.z0, vx = t.x1 - t.x0, vz = t.z1 - t.z0;
        return Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz);
      };
      candidates.sort((a, b) => turn(b) - turn(a) || a - b);
      current = candidates[0] ?? -1;
      const closing = nodes.get(ends[path[path.length - 1]]);
      if (closing !== undefined) {
        const edges = path.splice(closing), bounds = [Infinity, Infinity, -Infinity, -Infinity];
        let area = 0;
        for (const i of edges) {
          const e = segments[i]; area += e.x0 * e.z1 - e.x1 * e.z0;
          bounds[0] = Math.min(bounds[0], e.x0); bounds[1] = Math.min(bounds[1], e.z0);
          bounds[2] = Math.max(bounds[2], e.x0); bounds[3] = Math.max(bounds[3], e.z0);
        }
        if (Math.abs(area) > 2e-8) contours.push({ edges, area: area * .5, bounds, group: contours.length });
        // Continue unused edges at a touching junction as a separate closed contour.
        nodes.clear(); path.forEach((i, n) => nodes.set(starts[i], n));
      }
    }
  }
  const positives = contours.filter((c) => c.area > 0);
  const inside = (x: number, z: number, edges: number[]) => {
    let result = false;
    for (const i of edges) {
      const s = segments[i];
      if ((s.z0 > z) !== (s.z1 > z) && x < s.x0 + (z - s.z0) * (s.x1 - s.x0) / (s.z1 - s.z0)) result = !result;
    }
    return result;
  };
  const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) =>
    (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const intersects = (a: Segment, b: Segment) => {
    if (Math.max(a.x0, a.x1) < Math.min(b.x0, b.x1) || Math.max(b.x0, b.x1) < Math.min(a.x0, a.x1) ||
        Math.max(a.z0, a.z1) < Math.min(b.z0, b.z1) || Math.max(b.z0, b.z1) < Math.min(a.z0, a.z1)) return false;
    return cross(a.x0, a.z0, a.x1, a.z1, b.x0, b.z0) * cross(a.x0, a.z0, a.x1, a.z1, b.x1, b.z1) <= 0 &&
      cross(b.x0, b.z0, b.x1, b.z1, a.x0, a.z0) * cross(b.x0, b.z0, b.x1, b.z1, a.x1, a.z1) <= 0;
  };
  const result: Segment[] = [];
  for (const contour of contours) {
    let group = contour.group;
    if (contour.area < 0) {
      const [x0, z0, x1, z1] = contour.bounds;
      const enclosing = positives.filter((c) => c.bounds[0] < x0 && c.bounds[1] < z0 && c.bounds[2] > x1 && c.bounds[3] > z1)
        .sort((a, b) => a.area - b.area)
        .find((c) => contour.edges.every((i) => inside(segments[i].x0, segments[i].z0, c.edges)) &&
          !contour.edges.some((i) => c.edges.some((j) => intersects(segments[i], segments[j]))));
      if (!enclosing) continue;
      group = enclosing.group;
    }
    for (const i of contour.edges) { segments[i].group = group; result.push(segments[i]); }
  }
  return result;
}

/**
 * Build-time visual flow field, not a fluid simulation. Flat pools inherit their authored current, deflected and
 * slowed at banks / static solids intersecting their water level. Elevated bridge decks never become obstacles.
 * Sources and falling-sheet endpoints stir the receiving pool. Moving obstacles need an explicit FluidSource.
 * Sloping pools (>5 cm height variation per triangle) and lower overlapping pools retain G-buffer flow instead.
 */
export function buildFluidMap(fluids: SceneFluids, staticGeometry: THREE.BufferGeometry): FluidMap {
  const pools: Face[] = [], impacts: THREE.Vector3[] = [], levels: number[] = [];
  const falls: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
  const pos = fluids.geometry.getAttribute('position'), flow = fluids.geometry.getAttribute('aFlow');
  const index = fluids.geometry.index, count = index?.count ?? pos?.count ?? 0;
  const vertex = (i: number) => index ? index.getX(i) : i;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let t = 0; t + 2 < count; t += 3) {
    const ids = [vertex(t), vertex(t + 1), vertex(t + 2)];
    const [a, b, c] = ids.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i));
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if (Math.abs(normal.y) < POOL_NORMAL_Y) {
      falls.push([a, b, c]);
      const lo = Math.min(a.y, b.y, c.y);
      // Lower edge vertices, not a sheet's centre: a waterfall disturbs its foot, never its top.
      for (const p of [a, b, c]) if (p.y <= lo + 0.02) impacts.push(p);
      continue;
    }
    if (Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y) > 0.05) continue;
    const y = (a.y + b.y + c.y) / 3;
    let level = levels.findIndex((h) => Math.abs(h - y) < 0.025);
    if (level < 0) { level = levels.length; levels.push(y); }
    pools.push({ a, b, c, level, flow: [flow?.getX(ids[0]) ?? 0, flow?.getZ(ids[0]) ?? 0] });
    for (const p of [a, b, c]) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  }

  // A modelled sheet can end under water: stir where it crosses the receiving surface,
  // not only at its lower endpoints. Keep the endpoint proxy for spills ending just above it.
  for (const face of falls) for (const y of levels) {
    for (const [p, q] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]]) {
      if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) impacts.push(p.clone().lerp(q, (y - p.y) / (q.y - p.y)));
    }
  }
  if (!pools.length) { x0 = z0 = 0; x1 = z1 = 1; }
  else { x0 -= TEXEL; z0 -= TEXEL; x1 += TEXEL; z1 += TEXEL; }
  const width = pools.length ? Math.min(MAX_SIZE, Math.ceil((x1 - x0) / TEXEL)) : 1;
  const height = pools.length ? Math.min(MAX_SIZE, Math.ceil((z1 - z0) / TEXEL)) : 1;
  const dx = (x1 - x0) / width, dz = (z1 - z0) / height, size = width * height;
  const heights = new Float32Array(size).fill(NO_POOL), owner = new Int32Array(size).fill(-1);
  const velocity = new Float32Array(size * 2), data = new Float32Array(size * 4);
  const wx = (x: number) => x0 + (x + 0.5) * dx, wz = (z: number) => z0 + (z + 0.5) * dz;
  const span = (lo: number, hi: number, origin: number, step: number, max: number) =>
    [Math.max(0, Math.ceil((lo - origin) / step - 0.5)), Math.min(max - 1, Math.floor((hi - origin) / step - 0.5))];
  for (const { a, b, c, level, flow: current } of pools) {
    const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(det) < 1e-10) continue;
    const [loX, hiX] = span(Math.min(a.x, b.x, c.x), Math.max(a.x, b.x, c.x), x0, dx, width);
    const [loZ, hiZ] = span(Math.min(a.z, b.z, c.z), Math.max(a.z, b.z, c.z), z0, dz, height);
    for (let z = loZ; z <= hiZ; z++) for (let x = loX; x <= hiX; x++) {
      const px = wx(x), pz = wz(z);
      const u = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / det;
      const v = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / det;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      const i = z * width + x, y = u * a.y + v * b.y + (1 - u - v) * c.y;
      if (y <= heights[i]) continue;
      heights[i] = y; owner[i] = level;
      velocity[i * 2] = current[0]; velocity[i * 2 + 1] = current[1];
    }
  }

  // Slice triangle shells at each water level. Oriented scanline winding unions overlapping solids;
  // unlike a top-down silhouette it preserves water under bridges and ignores the submerged bed.
  const sp = staticGeometry.getAttribute('position'), si = staticGeometry.index;
  const sn = si?.count ?? sp?.count ?? 0, sv = (i: number) => si ? si.getX(i) : i;
  const blocked = new Uint8Array(size);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let l = 0; l < levels.length; l++) {
    const y = levels[l], slices: Segment[] = [];
    const segments: Segment[][] = Array.from({ length: height }, () => []);
    for (let t = 0; t + 2 < sn; t += 3) {
      a.fromBufferAttribute(sp, sv(t)); b.fromBufferAttribute(sp, sv(t + 1)); c.fromBufferAttribute(sp, sv(t + 2));
      if (Math.min(a.y, b.y, c.y) > y || Math.max(a.y, b.y, c.y) <= y) continue;
      const hits: THREE.Vector3[] = [];
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) hits.push(p.clone().lerp(q, (y - p.y) / (q.y - p.y)));
      }
      if (hits.length !== 2) continue;
      let [p, q] = hits;
      const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
      const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      // Outward slices run counterclockwise in XZ; inward slices run clockwise.
      if (nx * (q.z - p.z) - nz * (q.x - p.x) < 0) [p, q] = [q, p];
      slices.push({ x0: p.x, z0: p.z, x1: q.x, z1: q.z, sign: nx < 0 ? 1 : -1, group: -1 });
    }
    for (const s of solidContours(slices)) {
      if (Math.abs(s.z0 - s.z1) < 1e-9) continue;
      const [lo, hi] = span(Math.min(s.z0, s.z1), Math.max(s.z0, s.z1), z0, dz, height);
      for (let z = lo; z <= hi; z++) segments[z].push(s);
    }
    for (let z = 0; z < height; z++) {
      const pz = wz(z), events: { x: number; sign: number; group: number }[] = [];
      for (const s of segments[z]) {
        if (pz < Math.min(s.z0, s.z1) || pz >= Math.max(s.z0, s.z1)) continue;
        events.push({ x: s.x0 + (pz - s.z0) / (s.z1 - s.z0) * (s.x1 - s.x0), sign: s.sign, group: s.group });
      }
      events.sort((a, b) => a.x - b.x);
      // Classify each solid (including its holes) before unioning solids. A negative
      // cavity cannot cancel a separate pier, even when it crosses that pier's boundary.
      const winding = new Map<number, number>();
      let active = 0, e = 0;
      for (let x = 0; x < width; x++) {
        while (e < events.length && events[e].x <= wx(x)) {
          const end = events[e].x;
          do {
            const event = events[e++], before = winding.get(event.group) ?? 0, after = before + event.sign;
            winding.set(event.group, after);
            active += Number(after > 0) - Number(before > 0);
          } while (e < events.length && Math.abs(events[e].x - end) < 1e-9);
        }
        const i = z * width + x;
        if (owner[i] === l && active > 0) blocked[i] = 1;
      }
    }
  }

  // Two directional nearest-boundary sweeps. Each pool level has its own domain, so disconnected /
  // stacked bodies cannot donate current or wakes to another pool. This is a bounded visual approximation.
  const nearest = new Int32Array(size).fill(-1);
  for (let i = 0; i < size; i++) if (owner[i] < 0 || blocked[i]) nearest[i] = i;
  const relax = (i: number, j: number) => {
    if (j < 0 || j >= size) return;
    let n = nearest[j];
    if (owner[j] !== owner[i]) n = j;
    if (n < 0) return;
    const ix = i % width, iz = Math.floor(i / width), nx = n % width, nz = Math.floor(n / width);
    const old = nearest[i];
    const d2 = ((ix - nx) * dx) ** 2 + ((iz - nz) * dz) ** 2;
    const old2 = old < 0 ? Infinity : ((ix - old % width) * dx) ** 2 + ((iz - Math.floor(old / width)) * dz) ** 2;
    if (d2 < old2) nearest[i] = n;
  };
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const i = z * width + x; if (owner[i] < 0 || blocked[i]) continue;
    if (x) relax(i, i - 1);
    if (z) { relax(i, i - width); if (x) relax(i, i - width - 1); if (x + 1 < width) relax(i, i - width + 1); }
  }
  for (let z = height - 1; z >= 0; z--) for (let x = width - 1; x >= 0; x--) {
    const i = z * width + x; if (owner[i] < 0 || blocked[i]) continue;
    if (x + 1 < width) relax(i, i + 1);
    if (z + 1 < height) { relax(i, i + width); if (x) relax(i, i + width - 1); if (x + 1 < width) relax(i, i + width + 1); }
  }
  // Same-height pools can be separated by dry ground. A wake must stay in its connected water body.
  const component = new Int32Array(size).fill(-1), queue = new Int32Array(size);
  let components = 0;
  for (let seed = 0; seed < size; seed++) {
    if (owner[seed] < 0 || blocked[seed] || component[seed] >= 0) continue;
    let head = 0, tail = 1; queue[0] = seed; component[seed] = components;
    const visit = (i: number) => {
      if (owner[i] === owner[seed] && !blocked[i] && component[i] < 0) {
        component[i] = components; queue[tail++] = i;
      }
    };
    while (head < tail) {
      const i = queue[head++], x = i % width;
      if (x) visit(i - 1); if (x + 1 < width) visit(i + 1);
      if (i >= width) visit(i - width); if (i + width < size) visit(i + width);
    }
    components++;
  }
  const wakes: { x: number; z: number; component: number; vx: number; vz: number; strength: number }[] = [];
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const i = z * width + x; if (owner[i] < 0 || blocked[i]) continue;
    const n = nearest[i], nx = n < 0 ? 0 : (x - n % width) * dx, nz = n < 0 ? 0 : (z - Math.floor(n / width)) * dz;
    const d = Math.hypot(nx, nz), distance = n < 0 ? MAX_DISTANCE : Math.max(0, d - Math.min(dx, dz) * 0.5);
    const vx = velocity[i * 2], vz = velocity[i * 2 + 1], speed = Math.hypot(vx, vz);
    const dot = d ? (vx * nx + vz * nz) / d : 0;
    const deflect = Math.exp(-distance / 0.65), slow = 0.35 + 0.65 * smooth(distance / 0.6);
    data[i * 4] = (vx - Math.min(0, dot) * (d ? nx / d : 0) * deflect) * slow;
    data[i * 4 + 1] = (vz - Math.min(0, dot) * (d ? nz / d : 0) * deflect) * slow;
    data[i * 4 + 2] = clamp(speed * 0.2 * Math.exp(-distance / 0.35) + Math.max(0, -dot) * 0.65 * deflect, 0, 1);
    data[i * 4 + 3] = Math.min(MAX_DISTANCE, distance);
    if (n >= 0 && blocked[n] && distance < Math.max(dx, dz) && dot < -0.25 && (x + z) % 3 === 0)
      wakes.push({ x: wx(x), z: wz(z), component: component[i], vx: vx / speed, vz: vz / speed, strength: Math.min(0.65, speed * 0.45) });
  }
  const splat = (x: number, z: number, radius: number, strength: number, eligible: (i: number) => boolean) => {
    if (!(radius > 0) || !(strength > 0)) return;
    const [loX, hiX] = span(x - radius, x + radius, x0, dx, width), [loZ, hiZ] = span(z - radius, z + radius, z0, dz, height);
    for (let iz = loZ; iz <= hiZ; iz++) for (let ix = loX; ix <= hiX; ix++) {
      const i = iz * width + ix; if (owner[i] < 0 || blocked[i] || !eligible(i)) continue;
      const d = Math.hypot(wx(ix) - x, wz(iz) - z) / radius;
      if (d < 1) data[i * 4 + 2] = Math.max(data[i * 4 + 2], clamp(strength, 0, 1) * (1 - smooth(d)));
    }
  };
  for (const w of wakes) for (let t = 0.3; t <= 3; t += 0.3)
    splat(w.x + w.vx * t, w.z + w.vz * t, 0.18 + t * 0.22, w.strength * (1 - t / 3.3), (i) => component[i] === w.component);
  for (const p of impacts) splat(p.x, p.z, 0.5, 0.9, (i) => p.y - heights[i] >= -0.05 && p.y - heights[i] <= 0.4);
  for (const s of fluids.sources) splat(s.x, s.z, s.radius, s.strength,
    (i) => s.y === undefined || Math.abs(heights[i] - s.y) < 0.05);

  // One-texel padding copies the nearest wet texel's height/current, keeping bilinear shoreline taps
  // meaningful. Read only original wet coverage; never propagate padding across the map or to a lower pool.
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const i = z * width + x; if (owner[i] >= 0 && !blocked[i]) continue;
    let best = -1, d2 = Infinity;
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      const xx = x + ox, zz = z + oz; if (xx < 0 || xx >= width || zz < 0 || zz >= height) continue;
      const j = zz * width + xx, d = (ox * dx) ** 2 + (oz * dz) ** 2;
      if (owner[j] >= 0 && !blocked[j] && d < d2) { best = j; d2 = d; }
    }
    if (best >= 0) { heights[i] = heights[best]; data.set(data.subarray(best * 4, best * 4 + 4), i * 4); data[i * 4 + 3] = 0; }
    else heights[i] = NO_POOL;
  }
  // WebGL2 can filter 16-bit floats without OES_texture_float_linear. Keep absolute heights
  // at full precision: half-float rounding at high elevations can exceed the shader's 5 cm gate.
  const texture = new THREE.DataTexture(Uint16Array.from(data, THREE.DataUtils.toHalfFloat), width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  const heightTexture = new THREE.DataTexture(heights, width, height, THREE.RedFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  heightTexture.minFilter = heightTexture.magFilter = THREE.NearestFilter;
  for (const t of [texture, heightTexture]) { t.generateMipmaps = false; t.needsUpdate = true; }
  return { texture, height: heightTexture, bounds: [x0, z0, x1, z1] };
}
