import { cookieCo } from './cookie-co';
import type { SceneDefinition } from './types';

export type { SceneDefinition, SceneView } from './types';

/** Every scene the demo pages can show (`?scene=<id>`). The first one is the default. */
export const SCENES: SceneDefinition[] = [cookieCo];

export const sceneById = (id: string | null) => SCENES.find((s) => s.id === id) ?? SCENES[0];
