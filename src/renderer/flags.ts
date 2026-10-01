// Surface flags: how the post shader treats a surface. Stored per vertex (`aFlag`) and written to the
// G-buffer albedo alpha as 1 + flag (0 means sky). Keep in sync with the F_* constants in shaders/post.ts.
export const FLAG = {
  /** Ordinary solid surface: banded lighting, outlines, creases, contact shadows. */
  NORMAL: 0,
  /** Self-lit (lit windows): always the lit tone, ignores exposure, glows after dusk. */
  EMISSIVE: 1,
  /** Ground cover and small plants: never casts ink or creases, never dithered. */
  DECOR: 2,
  /** Smoke and steam: soft ink, three tones from the sun angle, no lamp light. */
  STEAM: 3,
  /** Water: animated ripples, sparkles and drip rings (see PixelScene.ripples). */
  WATER: 4,
  /** Tiny self-lit sparks (fireflies). */
  GLOW: 5,
  /** Flat panel with shader-drawn groove lines (see PixelScene.grooves); no dither or contact speckle. */
  GROOVED: 6,
} as const;

export type Flag = typeof FLAG[keyof typeof FLAG];
