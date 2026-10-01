// Public API of the pixel-art renderer. Scenes and apps import from here, never from the files directly.
export { PixelRenderer, DEFAULT_SETTINGS, type RenderSettings } from './renderer';
export { LIMITS, type PixelScene, type Lamp, type Grooves } from './scene';
export { FLAG, THIN_MARK, thin, type Flag } from './flags';
export { MODE, motion, type Motion, type Vec3, type Vec4 } from './motion';
export { GeometryCollector, linearColor, place, flip, type RGB } from './geometry';
export { quantizePalette } from './palette';
export { loadGltf, collectGltf, namedMeshRule, collectLamps, type MeshRule } from './gltf';
export { lookAt, nearestPreset, hourLabel, PRESETS, type Look } from './look';
