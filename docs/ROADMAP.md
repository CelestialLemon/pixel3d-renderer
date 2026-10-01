# Roadmap: next improvements

Goal: turn this experiment into a reusable renderer module that several games can use. Items are roughly in priority order within each section.

**Done in the 2026-10-01 restructure:** the renderer core (`src/renderer/`) is split from scene content (`src/scenes/`) and the demo pages
(`src/app/`). Nothing scene-specific lives in the renderer any more: lamps, water drip points, door grooves, the shadow area, the chimney
and every animation anchor are `PixelScene` data or per-vertex attributes. Scenes are registered and selectable (`?scene=`), passes are a
registry, Passes 0–1 are frozen in `src/reference/`, Pass 2 is archived, and `tools/golden.mjs` gives pixel-exact regression checks.
The restructure changed no output pixels.

## 1. Test scenes (in progress)

The renderer has only ever been judged on one cozy daytime meadow, so a change can look good there and break on content it has never seen.

1. **Done (2026-10-01): the test-chart scene** (`?scene=test-chart`, `src/scenes/test-chart/`). Six bays on a 1 m checker: thin
   features (poles, rails, ladder, wires, fence, mullions at 0.02–0.16 widths), curves, ink and creases, AO and self-shadowing, palette
   stress, and terraces with a lit room and seven coloured lamps. Each bay is a camera preset (`?view=thin|curves|ink|ao|palette|lamps`),
   and `tools/golden.mjs` has 12 `chart-*` shots. **What it showed on first run:**
   - Rails and poles under ~0.04 render as broken dotted lines (the sub-pixel problem of section 2, now measurable per width).
   - All six near-identical colour pairs collapse to one palette colour each, and the two darkest greys merge.
   - Lamp light ignores occlusion: the room's lamp makes a dithered pool on top of its own roof and speckles outside its walls.
   - Lamp colour is ignored (section 3): seven differently coloured lamps cast identical orange pools.
   - Metals read as flat coloured balls: there is no specular or metal treatment.
   - The broad low mound renders as one flat band at noon (no visible gradient on a gentle slope).
   - Found on the props gallery: contact occlusion (`contactAt` in `shaders/post.ts`) paints a false checker on the faceted, curved
     deck of `stone_arch_bridge`. It disappears with `contacts=0`. Repro: `pass3.html?scene=props&view=stone_arch_bridge&zoom=5&hour=12`.
2. **Modeled props (in progress, with a second agent):** purpose-made Blender props per `docs/ASSET_BRIEF.md`, coordinated on
   `docs/BOARD.md`. Next on the renderer side: name-prefix loader rules (`decor_`, `water_`, `glass_`, `thin_`, `move_`, `lamp_`)
   and a `?scene=props` gallery.
3. **CC0 low-poly packs** (Kenney, Quaternius, KayKit) through `collectGltf`. These are the first real-world assets, and they need:
   - **Textures:** today only `material.color` is read, so a textured model renders as one flat colour per material. Sample the base-colour
     texture per vertex or face before quantisation, or add a UV/albedo-texture path to the G-buffer.
   - **Skinned meshes and node animation:** the dynamic mesh only knows the fixed motion modes.
4. **A second hero scene** in a different setting (night village street, snow, an interior) to check that the look generalises.

## 2. Sub-pixel stability (found 2026-10-01)

**The problem.** The renderer decides each art pixel from the surface at that pixel's centre, so any feature thinner than a pixel is only
hit when a pixel centre lands on it, and that changes with every tiny camera movement. We saw it on the cookie-shop door: its five plank
grooves are 0.015 units wide (~40% of a pixel at default zoom) and popped in and out while orbiting. This is inherent to rasterising 3D into
a low-resolution grid, not a bug in one shader. Every 3D-to-pixel pipeline has it. A sub-pixel feature has no correct answer, only a policy:
always show it, never show it, or show it sometimes (flicker).

**What was done so far (a workaround, not a fix).** The groove meshes are skipped and the post shader draws grooves at fixed world positions
on surfaces flagged `GROOVED`, always exactly one screen pixel wide. The positions are now scene data (`PixelScene.grooves`), but only one
groove set per scene is supported. Passes 0–1 are frozen and still flicker. `node tools/door-strip.mjs <px> <name>` shows 8 tiny camera steps side by side.

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
   Generalise `tools/door-strip.mjs` into a test that renders every asset (the test chart first) at many sub-pixel camera offsets and fails
   on pixels that come and go.
5. **Replace shader-drawn detail with authored data.** Plank patterns and similar should be material/texture data aligned to the pixel grid
   (a detail or ID channel), not a list of positions in a uniform.

## 3. Finish the reusable module

- **Animation hook.** Motion is a fixed list of modes in `shaders/gbuffer.ts` (sway, conveyor, smoke, butterfly, firefly). Let a scene
  supply its own vertex-animation GLSL instead, and drop the Cookie Co.-flavoured modes from the core.
- **Lamp colour.** `Lamp.color` reaches the shader but is unused: lamp light is one fixed warm tint. Use it once a scene has coloured lights.
- **Look per scene.** The day-cycle keyframes in `look.ts` are global; a scene (or game) should be able to supply its own.
- **Asset pipeline.** Blender → glTF export → flags by node name or custom property (`collectGltf` rules handle names today) → merge and
  palette as a build step instead of at page load (Cookie Co. takes seconds to build in the browser).
- **Package it** (npm workspace or published package) with the demo as a consumer, a smaller public API (`src/renderer/index.ts` is the
  start), unit tests for palette/geometry, and the golden and browser checks in CI. Golden images would need to be stored or generated in
  CI rather than only in the git-ignored `out/`.

## 4. Performance and fairness

- **Profile on a real GPU.** Everything so far ran in headless Chrome on SwiftShader (software rendering). Pass 3 re-rasterises the G-buffer every
  frame because the world moves, and "Compare all" runs three WebGL contexts with 4096² shadow maps each. Measure frame time, memory and
  mobile behaviour; consider caching static geometry and re-rendering only the dynamic mesh.
- **Comparison fairness.** Pass 3 uses its own world (pond, leaf-clump trees, motion), so the comparison mixes renderer and content
  changes. Future passes should all draw the same `PixelScene`; the frozen references cannot.
- Moving objects take the shadow of whatever static surface is behind them; add a real shadow for dynamic casters if it matters.

## 5. Visual and art ideas not yet done

- Tune the foliage, water and lamp look further; add a night moon and stars if the camera ever sees the sky.
- A transparency policy beyond ordered-dither discard (water depth, particles) if the scene needs it.
- Depth cues: Pass 2's screen-wide haze was disliked (it washes everything out, see `archive/pass2-atmosphere/`), and a constant-depth
  step shows as a seam on flat ground, so any future depth cue needs a different approach.
