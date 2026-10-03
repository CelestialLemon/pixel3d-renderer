// Ready-made clips for tools/timelapse.ts. A clip is a scene, a length and camera/hour keyframes:
//   { scene, seconds, keys: [{ at, view?, az?, el?, zoom?, tx?, tz?, hour? }], linear?: [channels], time?, query? }
// `at` is in seconds. `view` starts a key from a scene preset (by name); az/el/zoom/tx/tz/hour override it. A channel a key
// leaves out keeps its previous value, and the first key starts from the page's camera (its URL parameters).
// Channels ease in and out at the ends and pass smoothly through the middle keys; channels listed in `linear` move at
// a constant rate instead. Azimuth is not wrapped, so 0 -> 360 is one full turn.
export type Channel = 'az' | 'el' | 'zoom' | 'tx' | 'tz' | 'hour';
export type Key = { at: number; view?: string } & Partial<Record<Channel, number>>;
export interface Clip { scene?: string; seconds?: number; keys: Key[]; linear?: Channel[]; time?: number; query?: string }

export const PRESETS: Record<string, Clip> = {
  // The whole town from 8:00 to 22:00, camera still, so the light is the only thing that changes.
  'day-to-night': {
    scene: 'village', seconds: 20, linear: ['hour'],
    keys: [{ at: 0, view: 'overview', hour: 8 }, { at: 20, hour: 22 }],
  },
  // One slow turn around the statue in the market square at golden hour.
  'square-orbit': {
    scene: 'village', seconds: 24,
    keys: [{ at: 0, view: 'square', el: 32, hour: 17.5 }, { at: 24, az: 340 }],
  },
  // Along the canal from the mill, under the road bridge, past the jetty and the footbridge, at dusk.
  'canal-fly': {
    scene: 'village', seconds: 24,
    keys: [
      { at: 0, view: 'canal', tx: -27, tz: 3, az: 60, el: 34, zoom: 12, hour: 18.5 },
      { at: 12, tx: 3, tz: 1.5, az: 40, el: 38, zoom: 13 },
      { at: 24, tx: 28, tz: 1, az: 20, el: 34, zoom: 12, hour: 19.5 },
    ],
  },
};
