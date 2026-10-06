// Public API of the pixel-art renderer: what the package exports. Scenes, apps and games import from here, never from the
// files directly (the check tools may reach into internals).

// Drawing, objects the game moves, picking, and construction options.
export { PixelRenderer, DEFAULT_SETTINGS, type PixelRendererOptions, type RenderSettings, type PickResult } from './renderer';
export { PixelObject } from './objects';
export { DEFAULT_LIMITS, LIMITS, resolveLimits, type RendererLimits, type PixelScene, type ResolvedPixelScene, type Lamp, type Grooves } from './scene';
export type { FluidMap } from './fluidMap';
export type { WindowLight } from './windowLight';
export { encodeScene, decodeScene, type BakedScene } from './baked';

// Building a scene: geometry, surface flags, ambient motion, fluids, glTF models and the palette.
export { GeometryCollector, linearColor, place, flip, type RGB } from './geometry';
export { FLAG, THIN_MARK, thin, type Flag } from './flags';
export { MODE, motion, type Motion, type Vec3, type Vec4 } from './motion';
export { FLUIDS, FluidCollector, type FluidMaterial, type FluidPreset, type FluidSource, type SceneFluids } from './fluids';
export { loadGltf, collectGltf, namedMeshRule, movingPartMotion, collectLamps, meshNodeName, type MeshRule } from './gltf';
export { DEFAULT_PALETTE_SIZE, quantizePalette } from './palette';

// Time of day.
export { dayCycle, DEFAULT_DAY_CYCLE, lookAt, nearestPreset, hourLabel, PRESETS, type DayCycle, type Look, type LookKey } from './look';
