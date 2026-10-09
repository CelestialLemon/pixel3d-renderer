import { cookieCo } from './cookie-co';
import { fluidsScene } from './fluids';
import { objectLooksScene } from './object-looks';
import { objectsScene } from './objects';
import { objectsMotionScene } from './objects-motion';
import { propsGallery } from './props';
import { testChart } from './test-chart';
import { village } from './village';
import type { SceneDefinition } from './types';

export type { BuiltScene, SceneDefinition, SceneView } from './types';

/** Every scene the demo pages can show (`?scene=<id>`). The first one is the default. */
export const SCENES: SceneDefinition[] = [cookieCo, village, testChart, propsGallery, fluidsScene, objectsScene, objectsMotionScene, objectLooksScene];

export const sceneById = (id: string | null) => SCENES.find((s) => s.id === id) ?? SCENES[0];
