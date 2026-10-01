# Pass 2 — Atmosphere (archived 2026-10-01)

A renderer pass inspired by A Short Hike: brighter, flatter three-band lighting, softer silhouette ink, and smooth focus-relative
distance haze (with dithering and crease contrast fading into the haze). It was built on Pass 1.

**Why it was archived:** the haze washed the whole scene out, and any hard constant-depth step shows up as a seam across flat ground.
Pass 3 deliberately has no depth haze. Kept here for reference only. It is not built, type-checked or tested, and it imports paths
that no longer exist (`pipeline.ts` expected the old `src/` layout and Pass 1's `Settings`).

- `pipeline.ts`: the renderer as it was when removed (focus-relative fog: start/end distances, strength, ink and colour settings).
- `A_SHORT_HIKE_RENDERING.md`: the research it was based on.

If a depth cue is ever revisited, see the "Visual and art ideas" section of `docs/ROADMAP.md` first.
