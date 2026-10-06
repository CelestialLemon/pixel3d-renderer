import * as THREE from 'three';
import { resolveScene, type PixelScene, type ResolvedPixelScene } from './scene';
import { buildFluidMap } from './fluidMap';
import { buildWindowLight } from './windowLight';

/** A scene and optional local-space object geometry, baked together into one exact binary asset. */
export interface BakedScene extends ResolvedPixelScene {
  objectGeometries?: Record<string, THREE.BufferGeometry>;
}

const ARRAY_TYPES = { Float32Array, Float64Array, Uint32Array, Int32Array, Uint16Array, Int16Array, Uint8Array, Int8Array };
type ArrayType = keyof typeof ARRAY_TYPES;
interface AttributeData { type: ArrayType; offset: number; length: number; itemSize: number; normalized: boolean }
interface GeometryData { attributes: Record<string, AttributeData>; index?: AttributeData;
  drawRange?: { start: number; count: number | null } }
interface TextureData { array: AttributeData; width: number; height: number; format: THREE.PixelFormat; type: THREE.TextureDataType;
  minFilter: THREE.MinificationTextureFilter; magFilter: THREE.MagnificationTextureFilter }
const align = (n: number) => Math.ceil(n / 8) * 8;

/** Preserve attribute bytes (including quantized colours), fluid slots and metadata; no lossy JSON geometry conversion. */
export function encodeScene(input: PixelScene & Pick<BakedScene, 'objectGeometries'>): ArrayBuffer {
  const scene = { ...resolveScene(input), objectGeometries: input.objectGeometries };
  const parts: { offset: number; bytes: Uint8Array }[] = [];
  let length = 0;
  const attribute = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): AttributeData => {
    if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) throw new Error('Bake: interleaved attributes are not supported');
    const arr = (a as THREE.BufferAttribute).array, type = arr.constructor.name as ArrayType;
    if (!Object.hasOwn(ARRAY_TYPES, type)) throw new Error(`Bake: unsupported attribute array ${type}`);
    const offset = length, bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    parts.push({ offset, bytes }); length = align(length + bytes.byteLength);
    return { type, offset, length: arr.length, itemSize: a.itemSize, normalized: a.normalized };
  };
  const geometry = (g: THREE.BufferGeometry): GeometryData => {
    const attributes = Object.fromEntries(Object.entries(g.attributes).map(([name, a]) => [name, attribute(a)]));
    return { attributes, ...(g.index ? { index: attribute(g.index) } : {}),
      drawRange: { start: g.drawRange.start, count: g.drawRange.count === Infinity ? null : g.drawRange.count } };
  };
  const texture = (t: THREE.DataTexture): TextureData => ({
    array: attribute(new THREE.BufferAttribute(t.image.data as THREE.TypedArray, 1)), width: t.image.width, height: t.image.height,
    format: t.format as THREE.PixelFormat, type: t.type, minFilter: t.minFilter, magFilter: t.magFilter,
  });
  const maps = scene.maps ?? { fluids: buildFluidMap(scene.fluids, scene.staticGeometry), windows: buildWindowLight(scene.staticGeometry, scene.lamps) };
  const metadata = {
    staticGeometry: geometry(scene.staticGeometry), dynamicGeometry: geometry(scene.dynamicGeometry),
    fluidGeometry: geometry(scene.fluids.geometry),
    objects: Object.fromEntries(Object.entries(scene.objectGeometries ?? {}).map(([name, g]) => [name, geometry(g)])),
    materials: scene.fluids.materials, sources: scene.fluids.sources,
    lamps: scene.lamps.map((l) => ({ ...l, position: l.position.toArray() })), grooves: scene.grooves,
    shadow: { center: scene.shadow.center.toArray(), radius: scene.shadow.radius }, stats: scene.stats,
    maps: { fluidTexture: texture(maps.fluids.texture), fluidHeight: texture(maps.fluids.height), fluidBounds: maps.fluids.bounds,
      windowTexture: texture(maps.windows.texture), windowSource: texture(maps.windows.source), windowBounds: maps.windows.bounds,
      panes: maps.windows.panes.map((p) => ({ ...p, center: p.center.toArray(), source: p.source.toArray(), normal: p.normal.toArray() })) },
  };
  const json = new TextEncoder().encode(JSON.stringify(metadata)), start = align(16 + json.length);
  const buffer = new ArrayBuffer(start + length), bytes = new Uint8Array(buffer), header = new DataView(buffer);
  header.setUint32(0, 0x50334442, true); header.setUint32(4, 1, true); // P3DB, version 1
  header.setUint32(8, json.length, true); header.setUint32(12, start, true);
  bytes.set(json, 16);
  for (const part of parts) bytes.set(part.bytes, start + part.offset);
  if (!scene.maps) for (const t of [maps.fluids.texture, maps.fluids.height, maps.windows.texture, maps.windows.source]) t.dispose();
  return buffer;
}

/** Load a baked scene. Geometry arrays view the supplied buffer; keep it intact while using the scene. */
export function decodeScene(buffer: ArrayBuffer): BakedScene {
  if (buffer.byteLength < 16) throw new Error('Bake: truncated header');
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x50334442 || header.getUint32(4, true) !== 1) throw new Error('Bake: unsupported scene format');
  const jsonLength = header.getUint32(8, true), start = header.getUint32(12, true);
  if (start !== align(16 + jsonLength) || start > buffer.byteLength) throw new Error('Bake: invalid metadata length');
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 16, jsonLength))) as {
    staticGeometry: GeometryData; dynamicGeometry: GeometryData; fluidGeometry: GeometryData; objects: Record<string, GeometryData>;
    materials: BakedScene['fluids']['materials']; sources: BakedScene['fluids']['sources'];
    lamps: (Omit<BakedScene['lamps'][number], 'position'> & { position: [number, number, number] })[];
    grooves: BakedScene['grooves']; shadow: { center: [number, number, number]; radius: number }; stats: BakedScene['stats'];
    maps: { fluidTexture: TextureData; fluidHeight: TextureData; fluidBounds: [number, number, number, number];
      windowTexture: TextureData; windowSource: TextureData; windowBounds: [number, number, number, number];
      panes: { center: [number, number, number]; source: [number, number, number]; normal: [number, number, number]; color: [number, number, number]; area: number }[] };
  };
  const attribute = (a: AttributeData) => {
    if (!Object.hasOwn(ARRAY_TYPES, a.type) || !Number.isSafeInteger(a.length) || a.length < 0 ||
      !Number.isSafeInteger(a.offset) || a.offset < 0 || !Number.isSafeInteger(a.itemSize) || a.itemSize < 1 || a.length % a.itemSize) {
      throw new Error('Bake: invalid attribute descriptor');
    }
    const ArrayCtor = ARRAY_TYPES[a.type];
    if (a.offset % ArrayCtor.BYTES_PER_ELEMENT || start + a.offset + a.length * ArrayCtor.BYTES_PER_ELEMENT > buffer.byteLength) {
      throw new Error('Bake: attribute extends beyond its buffer');
    }
    return new THREE.BufferAttribute(new ArrayCtor(buffer, start + a.offset, a.length), a.itemSize, a.normalized);
  };
  const geometry = (data: GeometryData) => {
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(data.attributes)) g.setAttribute(name, attribute(a));
    if (data.index) g.setIndex(attribute(data.index));
    if (data.drawRange) g.setDrawRange(data.drawRange.start, data.drawRange.count ?? Infinity);
    return g;
  };
  const texture = (data: TextureData) => {
    const t = new THREE.DataTexture(attribute(data.array).array, data.width, data.height, data.format, data.type);
    t.minFilter = data.minFilter; t.magFilter = data.magFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  };
  return {
    staticGeometry: geometry(meta.staticGeometry), dynamicGeometry: geometry(meta.dynamicGeometry),
    fluids: { geometry: geometry(meta.fluidGeometry), materials: meta.materials, sources: meta.sources },
    objectGeometries: Object.fromEntries(Object.entries(meta.objects).map(([name, g]) => [name, geometry(g)])),
    lamps: meta.lamps.map((l) => ({ ...l, position: new THREE.Vector3(...l.position) })), grooves: meta.grooves,
    shadow: { center: new THREE.Vector3(...meta.shadow.center), radius: meta.shadow.radius }, stats: meta.stats,
    maps: { fluids: { texture: texture(meta.maps.fluidTexture), height: texture(meta.maps.fluidHeight), bounds: meta.maps.fluidBounds },
      windows: { texture: texture(meta.maps.windowTexture), source: texture(meta.maps.windowSource), bounds: meta.maps.windowBounds,
        panes: meta.maps.panes.map((p) => ({ ...p, center: new THREE.Vector3(...p.center), source: new THREE.Vector3(...p.source), normal: new THREE.Vector3(...p.normal) })) } },
  };
}
