// Public API of the pixel-art renderer. Scenes and apps import from here, never from the files directly.
export { PixelRenderer, DEFAULT_SETTINGS, type RenderSettings, type PickResult } from './renderer';
export { PixelObject } from './objects';
export { LIMITS, type PixelScene, type Lamp, type Grooves } from './scene';
export { FLAG, THIN_MARK, thin, type Flag } from './flags';
export { FLUIDS, FluidCollector, fluidFromName, POOL_NORMAL_Y, type FluidMaterial, type FluidPreset, type FluidSource, type SceneFluids } from './fluids';
export { buildFluidMap, type FluidMap } from './fluidMap';
export { MODE, motion, type Motion, type Vec3, type Vec4 } from './motion';
export { GeometryCollector, linearColor, place, flip, type RGB } from './geometry';
export { DEFAULT_PALETTE_SIZE, quantizePalette } from './palette';
export { loadGltf, collectGltf, namedMeshRule, movingPartMotion, collectLamps, meshNodeName, type MeshRule } from './gltf';
export { atlasLayout, LAMP_TILE, type AtlasLayout } from './lampShadows';
export { lookAt, nearestPreset, hourLabel, PRESETS, type Look } from './look';
