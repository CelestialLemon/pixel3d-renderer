# Roadmap: next improvements

Goal: turn this experiment into a reusable renderer module that several games can use. Today it is a Vite demo of one scene (Cookie Co.) with
four renderer passes; the work below moves it toward a library plus demo app. Items are roughly in priority order within each section.

## 1. Sub-pixel stability (found 2026-10-01)

**The problem.** The renderer decides each art pixel from the surface at that pixel's centre, so any feature thinner than a pixel is only
hit when a pixel centre lands on it, and that changes with every tiny camera movement. We saw it on the cookie-shop door: its five plank
grooves are 0.015 units wide (~40% of a pixel at default zoom) and popped in and out while orbiting. This is inherent to rasterising 3D into
a low-resolution grid, not a bug in one shader. Every 3D-to-pixel pipeline has it. A sub-pixel feature has no correct answer, only a policy:
always show it, never show it, or show it sometimes (flicker).

**What was done so far (a workaround, not a fix).** In Pass 3 only, the groove meshes are skipped and the post shader draws them at fixed
world positions on a surface flagged `DOOR`, always exactly one screen pixel wide. The positions are hard-coded in the shader, which does not
scale. Passes 0–2 are deliberately left unchanged and still flicker (they are frozen reference passes; `verify.mjs` checks they stay pixel-identical).
Use `node door_strip.mjs <px> <name>` to see 8 tiny camera steps side by side.

**Proper fixes to build and measure** (none of these is implemented yet; the expected effects below are untested here):

1. **Supersampled G-buffer with a majority resolve.** Rasterise the geometry at 2×–4× the art resolution and pick each art pixel from the
   surface covering most of it. A feature under ~50% coverage then disappears *consistently* and one over 50% always appears, which is far
   less distracting than flicker. Cost: 4–16× geometry fill. Prototype on the door, fence slats and window mullions, then judge with
   contact sheets.
2. **Minimum-width expansion for designated thin things.** Flag wires, fence slats, rails and reeds so the vertex shader widens them to at
   least one pixel (or use conservative rasterisation if available). They stay visible but wobble between 1 and 2 pixels wide.
3. **Camera and object snapping policy.** Flicker is worst under smooth orbiting. A fixed camera, or a camera that rotates in discrete steps,
   removes it for static geometry. Moving objects still shimmer unless their positions are snapped to the pixel grid. The camera already
   snaps its *target* to the pixel grid, which does not help during a continuous rotation.
4. **Asset rules plus an automated check.** Pixel scale is a fixed design constant in a game, so assets can have a minimum feature size.
   Generalise `door_strip.mjs` into a test that renders every asset at many sub-pixel camera offsets and fails on pixels that come and go.
5. **Replace hard-coded detail with authored data.** Things like plank patterns should be material/texture data aligned to the pixel grid
   (a detail or ID channel), not constants in a shader.

## 2. Make it a reusable module

- Split the **renderer core** (G-buffer, post shader, palette quantisation, time-of-day, dynamic-mesh animation) from the **demo app** and from
  **Cookie Co. scene content**. Cookie Co. specifics currently baked into the core: lamp positions, chimney position, pond, door-groove
  positions, belt-cookie bounds (`src/pass3/world.ts`, `pipeline.ts`).
- Define the public API (for example `createPixelRenderer(canvas, options)`), a scene description with per-object flags (decor, emissive, water,
  steam, glow, door-like detail surfaces), and typed settings. Replace the hard-coded animation modes (sway, belt, smoke, butterfly, firefly)
  with a small hook for user-defined vertex animation.
- An **asset pipeline**: Blender → glTF export (`export_glb.py`), flags by node name or custom property, merge + palette quantisation as a
  build step. Note that three.js turns node-name spaces into underscores, so match names with `[ _]`.
- Package it (npm workspace or published package), with the demo as a consumer; add unit and image tests to CI.
- Decide what happens to Passes 0–2: keep them as frozen reference renderers in a `reference/` area, or drop them once nothing depends on them.

## 3. Performance and fairness

- **Profile on a real GPU.** Everything so far ran in headless Chrome on SwiftShader (software rendering). Pass 3 re-rasterises the G-buffer every
  frame because the world moves, and "Compare all" runs four WebGL contexts with 4096² shadow maps each. Measure frame time, memory and
  mobile behaviour; consider caching static geometry and re-rendering only the dynamic mesh.
- **Comparison fairness.** Pass 3 uses its own world (pond, leaf-clump trees, motion), so the 2 × 2 comparison mixes renderer and content
  changes. Porting Pass 3's world to the other passes, or making the other passes consume it, would isolate renderer differences.
- Moving objects take the shadow of whatever static surface is behind them; add a real shadow for dynamic casters if it matters.

## 4. Visual and art ideas not yet done

- Other thin details at risk of the same flicker: fence slats, window mullions, reeds, railings (see section 1).
- Tune the foliage, water and lamp look further; add a night moon and stars if the camera ever sees the sky.
- A transparency policy beyond ordered-dither discard (water depth, particles) if the scene needs it.
- A cleaner second look at Pass 2's depth haze: it was disliked as implemented (washes everything out), and a constant-depth step shows as a seam
  on flat ground, so any future depth cue needs a different approach than screen-wide haze or hard steps.

## Reference

- `docs/A_SHORT_HIKE_RENDERING.md`: research behind Pass 2.
- `README.md`: passes, controls, query parameters and checks.
