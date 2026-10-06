import type { DayCycle, PickResult, PixelRenderer, RendererLimits } from '../renderer';
import type { BakedScene } from '../renderer/baked';

/** Default camera framing and limits for a scene. Angles in degrees, sizes in world units of visible height. */
export interface SceneView {
  /** Initial orbit target on the ground (x, z), and the height above it the camera looks at. */
  target: { x: number; z: number; height: number };
  groundY: number;
  /** Pan limits for the orbit target. */
  pan: { minX: number; maxX: number; minZ: number; maxZ: number };
  /**
   * Named framings for the preset buttons; `?view=<name>` (case-insensitive) starts on one. The first one is the default.
   * `tx`/`tz` move the orbit target, `az` sets the azimuth (degrees); left out, they keep the current value.
   */
  presets: { name: string; size: number; el: number; tx?: number; tz?: number; az?: number }[];
  azimuth: number;
}

/** The game half of a scene with objects: what the demo page calls each frame and on a click. */
export interface SceneGame {
  /** Move the objects to the clock time (seconds), before each frame. */
  update(time: number): void;
  /** A click on the scene, with what `PixelRenderer.pick` found under it. */
  click?(hit: PickResult, time: number): void;
}

/** A built scene. `populate` stands in for a game: it adds the scene's moving objects to a renderer. */
export interface BuiltScene extends BakedScene {
  populate?(r: PixelRenderer): SceneGame;
}

export interface SceneDefinition {
  id: string;
  title: string;
  view: SceneView;
  /** Build the scene. `paletteSize` overrides the scene's default number of base colours. */
  build(paletteSize?: number): Promise<BuiltScene>;
  /** True if the frozen reference passes (src/reference/) draw this same scene and can be compared with it. */
  hasReference: boolean;
  /** Hour the demo pages start at when the URL gives none (default 17.5, golden hour). */
  hour?: number;
  /** The scene's day cycle (default `DEFAULT_DAY_CYCLE`): its looks and the demo pages' time presets. */
  look?: DayCycle;
  /** The scene's number of base colours when `build` is given none (default `DEFAULT_PALETTE_SIZE`). */
  paletteSize?: number;
  /** Capacities the scene needs beyond the defaults. `build` collects against them and the demo pages pass them to the renderer. */
  limits?: Partial<RendererLimits>;
}
