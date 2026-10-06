import manifest from 'virtual:baked-scenes';
import { decodeScene } from '../../renderer/baked';
import { DEFAULT_PALETTE_SIZE } from '../../renderer/palette';
import { resolveLimits } from '../../renderer/scene';
import type { BuiltScene, SceneDefinition } from '../types';

/** Build live in dev and for overrides. Production defaults load the exact pre-merged, pre-quantized scene. */
export function sceneBuilder(def: () => SceneDefinition, live: (paletteSize: number) => Promise<BuiltScene>,
  hydrate?: (scene: BuiltScene) => BuiltScene): (paletteSize?: number) => Promise<BuiltScene> {
  return async (paletteSize = def().paletteSize ?? DEFAULT_PALETTE_SIZE) => {
    const d = def(), entry = manifest[d.id], limits = resolveLimits(d.limits);
    if (!entry || entry.paletteSize !== paletteSize || Object.entries(limits).some(([k, v]) => entry.limits[k] !== v)) {
      return live(paletteSize);
    }
    const response = await fetch(`${import.meta.env.BASE_URL}${entry.url.replace(/^\/+/, '')}`);
    if (!response.ok) throw new Error(`Could not load baked scene ${d.id}: HTTP ${response.status}`);
    const buffer = await new Response(response.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const scene = decodeScene(buffer);
    return hydrate ? hydrate(scene) : scene;
  };
}
