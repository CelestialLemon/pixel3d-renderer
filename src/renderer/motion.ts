// Vertex animation for the dynamic mesh. Every dynamic vertex carries a mode, an anchor point and four
// parameters; the G-buffer vertex shader (shaders/gbuffer.ts) moves it. Keep the modes and parameter
// layouts in sync with that shader.
export const MODE = { STATIC: 0, SWAY: 1, CONVEYOR: 2, SMOKE: 3, BUTTERFLY: 4, FIREFLY: 5 } as const;

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export interface Motion {
  mode: number;
  /** Anchor point in world space (aAnchor). */
  anchor?: Vec3;
  /** Mode parameters (aAnim): constant, or computed per vertex from its world position. */
  anim?: Vec4 | ((x: number, y: number, z: number) => Vec4);
}

export const motion = {
  /** Wind sway. The lean grows from 0 at `groundY` to full at `height` above it. */
  sway: (baseX: number, baseZ: number, groundY: number, height = 0.5): Motion => ({
    mode: MODE.SWAY,
    anim: (_x, y) => [Math.pow(Math.min(Math.max((y - groundY) / height, 0), 1.6), 1.3), baseX, baseZ, 0],
  }),
  /** Item riding a conveyor along +x: it grows in at `startX`, travels `length`, then shrinks away and repeats. */
  conveyor: (home: Vec3, startX: number, length: number, speed: number): Motion => ({ mode: MODE.CONVEYOR, anchor: home, anim: [startX, length, speed, 0] }),
  /** Smoke puff rising from `emitter`; `phase` in [0, 1) spaces the puffs, `seed` varies the drift. */
  smoke: (emitter: Vec3, phase: number, seed: number): Motion => ({ mode: MODE.SMOKE, anchor: emitter, anim: [phase, seed, 0, 0] }),
  /** Butterfly wandering around `home` (on the ground) with flapping wings. Geometry is one wing in local space. */
  butterfly: (home: Vec3, phase: number, seed: number): Motion => ({ mode: MODE.BUTTERFLY, anchor: home, anim: [phase, seed, 0, 0] }),
  /** Firefly drifting around `home` (on the ground), blinking, visible at night only. */
  firefly: (home: Vec3, phase: number, seed: number): Motion => ({ mode: MODE.FIREFLY, anchor: home, anim: [phase, seed, 0, 0] }),
};
