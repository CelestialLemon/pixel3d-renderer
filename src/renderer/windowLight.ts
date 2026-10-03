import * as THREE from 'three';
import { FLAG } from './flags';
import type { RGB } from './geometry';
import type { Lamp } from './scene';

export interface WindowPane {
  center: THREE.Vector3;
  normal: THREE.Vector3;
  color: RGB;
  area: number;
}

export interface WindowLight {
  /** Linear RGB × strength; alpha is the strength-weighted source height, padded one texel beyond coverage. */
  texture: THREE.DataTexture;
  /** World XZ edges: UV = (world.xz - bounds.xy) / (bounds.zw - bounds.xy). */
  bounds: [number, number, number, number];
  panes: WindowPane[];
}

const TEXEL = 0.12, MAX_SIZE = 1024, OFFSET = 0.4;
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Build once from the static, world-space geometry. Connected coplanar emissive triangles become panes;
 * narrow box edges, tiny bulbs and existing lamp fixtures are excluded. This adds no shadow-atlas lamps.
 * It is an approximation: outward half-disc pools and source-height attenuation, not per-window shadows.
 */
export function buildWindowLight(geometry: THREE.BufferGeometry, lamps: readonly Lamp[]): WindowLight {
  const pos = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const flags = geometry.getAttribute('aFlag'), colors = geometry.getAttribute('aColor'), index = geometry.index;
  const count = index?.count ?? pos?.count ?? 0;
  const vertex = (i: number) => index ? index.getX(i) : i;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
  const faces: { vertices: number[]; center: THREE.Vector3; normal: THREE.Vector3; color: RGB; area: number; parent: number }[] = [];
  const connected = new Map<string, number>();
  const root = (i: number): number => {
    let r = i;
    while (faces[r].parent !== r) r = faces[r].parent;
    while (faces[i].parent !== i) { const next = faces[i].parent; faces[i].parent = r; i = next; }
    return r;
  };
  if (pos && normals && flags && colors) for (let t = 0; t + 2 < count; t += 3) {
    const ids = [vertex(t), vertex(t + 1), vertex(t + 2)];
    if (ids.some((i) => Math.round(flags.getX(i)) !== FLAG.EMISSIVE)) continue;
    a.fromBufferAttribute(pos, ids[0]); b.fromBufferAttribute(pos, ids[1]); c.fromBufferAttribute(pos, ids[2]);
    normal.copy(ab.subVectors(b, a).cross(ac.subVectors(c, a)));
    const area = normal.length() * 0.5;
    if (area < 1e-7) continue;
    normal.normalize();
    if (Math.abs(normal.y) > 0.35) continue;
    const color: RGB = [colors.getX(ids[0]), colors.getY(ids[0]), colors.getZ(ids[0])];
    if (Math.max(...color) < 0.08) continue;
    const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    const i = faces.length;
    faces.push({ vertices: ids, center, normal: normal.clone(), color, area, parent: i });
    // Exact shared positions join triangulated faces while their normals keep opposite sides separate.
    const faceKey = [normal.x, normal.y, normal.z].map((v) => Math.round(v * 100)).join(',') + ':' +
      color.map((v) => Math.round(v * 1000)).join(',');
    for (const p of [a, b, c]) {
      const key = faceKey + ':' + [p.x, p.y, p.z].map((v) => Math.round(v * 1000)).join(',');
      const other = connected.get(key);
      if (other !== undefined) faces[root(i)].parent = root(other);
      else connected.set(key, i);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < faces.length; i++) {
    const r = root(i), group = groups.get(r);
    if (group) group.push(i); else groups.set(r, [i]);
  }
  const candidates: (WindowPane & { probes: THREE.Vector3[] })[] = [];
  for (const group of groups.values()) {
    const f = faces[group[0]], center = new THREE.Vector3(), color: RGB = [0, 0, 0];
    let area = 0, y0 = Infinity, y1 = -Infinity, u0 = Infinity, u1 = -Infinity;
    for (const i of group) {
      const face = faces[i]; area += face.area; center.addScaledVector(face.center, face.area);
      for (let k = 0; k < 3; k++) color[k] += face.color[k] * face.area;
      for (const j of face.vertices) {
        const y = pos.getY(j), u = pos.getX(j) * f.normal.z - pos.getZ(j) * f.normal.x;
        y0 = Math.min(y0, y); y1 = Math.max(y1, y); u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      }
    }
    if (area < 0.07 || y1 - y0 < 0.2 || u1 - u0 < 0.18) continue;
    center.multiplyScalar(1 / area);
    for (let k = 0; k < 3; k++) color[k] /= area;
    if (lamps.some((l) => center.distanceTo(l.position) < (l.clearance ?? 0.45) + 0.12)) continue;
    // Face centroids avoid the crossbar at the pane centre. Probe both ends of its triangulation.
    const probes = [faces[group[0]].center, faces[group[group.length - 1]].center];
    candidates.push({ center, normal: f.normal, color, area, probes });
  }

  // Interior/back faces of solid emissive boxes must not spill through their building's wall. Index only
  // the metre-wide XZ cells containing probes, then test a short outward segment against nearby solids.
  // This is a build-time face rejection, not a shadow map or a per-texel visibility pass.
  const buckets = new Map<string, number[]>();
  const bucketKey = (x: number, z: number) => `${Math.floor(x)},${Math.floor(z)}`;
  for (const pane of candidates) for (const p of pane.probes) {
    const end = p.clone().addScaledVector(pane.normal, 0.65);
    for (let x = Math.floor(Math.min(p.x, end.x)); x <= Math.floor(Math.max(p.x, end.x)); x++)
      for (let z = Math.floor(Math.min(p.z, end.z)); z <= Math.floor(Math.max(p.z, end.z)); z++)
        buckets.set(`${x},${z}`, []);
  }
  if (buckets.size) for (let t = 0; t + 2 < count; t += 3) {
    const i = vertex(t), j = vertex(t + 1), k = vertex(t + 2), flag = Math.round(flags.getX(i));
    if (flag !== FLAG.NORMAL && flag !== FLAG.GROOVED) continue;
    const x0 = Math.floor(Math.min(pos.getX(i), pos.getX(j), pos.getX(k)));
    const x1 = Math.floor(Math.max(pos.getX(i), pos.getX(j), pos.getX(k)));
    const z0 = Math.floor(Math.min(pos.getZ(i), pos.getZ(j), pos.getZ(k)));
    const z1 = Math.floor(Math.max(pos.getZ(i), pos.getZ(j), pos.getZ(k)));
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) buckets.get(`${x},${z}`)?.push(t);
  }
  const hit = new THREE.Vector3(), ray = new THREE.Ray();
  const panes: WindowPane[] = candidates.filter((pane) => pane.probes.some((p) => {
    ray.set(p.clone().addScaledVector(pane.normal, 0.015), pane.normal);
    const end = p.clone().addScaledVector(pane.normal, 0.65);
    const nearby = new Set<number>();
    for (let x = Math.floor(Math.min(p.x, end.x)); x <= Math.floor(Math.max(p.x, end.x)); x++)
      for (let z = Math.floor(Math.min(p.z, end.z)); z <= Math.floor(Math.max(p.z, end.z)); z++)
        for (const t of buckets.get(bucketKey(x, z)) ?? []) nearby.add(t);
    for (const t of nearby) {
      a.fromBufferAttribute(pos, vertex(t)); b.fromBufferAttribute(pos, vertex(t + 1)); c.fromBufferAttribute(pos, vertex(t + 2));
      if (ray.intersectTriangle(a, b, c, false, hit) && hit.distanceTo(ray.origin) < 0.635) return false;
    }
    return true;
  })).map(({ center, normal, color, area }) => ({ center, normal, color, area }));

  // Bounds cover each complete pool, rather than potentially enormous empty terrain. Reject outside UVs
  // in the shader; a 1x1 zero map handles scenes without panes at negligible cost.
  const radius = (pane: WindowPane) => THREE.MathUtils.clamp(1.0 + Math.sqrt(pane.area) * 0.6, 1.2, 2.1);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const pane of panes) {
    const r = radius(pane), x = pane.center.x + pane.normal.x * OFFSET, z = pane.center.z + pane.normal.z * OFFSET;
    x0 = Math.min(x0, x - r - TEXEL); z0 = Math.min(z0, z - r - TEXEL);
    x1 = Math.max(x1, x + r + TEXEL); z1 = Math.max(z1, z + r + TEXEL);
  }
  if (!panes.length) { x0 = z0 = 0; x1 = z1 = 1; }
  const width = panes.length ? Math.min(MAX_SIZE, Math.ceil((x1 - x0) / TEXEL)) : 1;
  const height = panes.length ? Math.min(MAX_SIZE, Math.ceil((z1 - z0) / TEXEL)) : 1;
  const dx = (x1 - x0) / width, dz = (z1 - z0) / height;
  const values = new Float32Array(width * height * 4), weights = new Float32Array(width * height);
  for (const pane of panes) {
    const r = radius(pane), cx = pane.center.x + pane.normal.x * OFFSET, cz = pane.center.z + pane.normal.z * OFFSET;
    const maxColor = Math.max(...pane.color), strength = Math.min(0.8, 0.35 + 0.28 * Math.sqrt(pane.area));
    for (let z = Math.max(0, Math.floor((cz - r - z0) / dz)); z < Math.min(height, Math.ceil((cz + r - z0) / dz)); z++)
      for (let x = Math.max(0, Math.floor((cx - r - x0) / dx)); x < Math.min(width, Math.ceil((cx + r - x0) / dx)); x++) {
        const wx = x0 + (x + 0.5) * dx, wz = z0 + (z + 0.5) * dz;
        const distance = Math.hypot(wx - cx, wz - cz) / r;
        if (distance >= 1) continue;
        const outward = (wx - pane.center.x) * pane.normal.x + (wz - pane.center.z) * pane.normal.z;
        const w = strength * (1 - smooth(0, 1, distance)) * smooth(-0.08, 0.18, outward);
        const texel = z * width + x, k = texel * 4;
        for (let c = 0; c < 3; c++) values[k + c] += w * pane.color[c] / maxColor;
        values[k + 3] += w * pane.center.y; weights[texel] += w;
      }
  }
  const data = new Uint16Array(values.length);
  for (let i = 0; i < weights.length; i++) {
    const k = i * 4, peak = Math.max(1, values[k], values[k + 1], values[k + 2]);
    for (let c = 0; c < 3; c++) data[k + c] = THREE.DataUtils.toHalfFloat(values[k + c] / peak);
    data[k + 3] = THREE.DataUtils.toHalfFloat(weights[i] > 0 ? values[k + 3] / weights[i] : 0);
  }
  // Linear filtering touches empty neighbours at a pool rim. Pad only the height, so a 3 m window's
  // height stays 3 m as its RGB fades to zero, instead of being blended with a fictitious 0 m source.
  // Consult the original coverage mask, never the padded data: dilation stops after one texel.
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const i = z * width + x;
    if (weights[i] > 0) continue;
    let nearest = -1, distance = Infinity, strongest = 0;
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      const nx = x + ox, nz = z + oz;
      if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
      const j = nz * width + nx, d = ox * ox + oz * oz;
      if (weights[j] > 0 && (d < distance || (d === distance && weights[j] > strongest))) {
        nearest = j; distance = d; strongest = weights[j];
      }
    }
    if (nearest >= 0) data[i * 4 + 3] = data[nearest * 4 + 3];
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, bounds: [x0, z0, x1, z1], panes };
}
