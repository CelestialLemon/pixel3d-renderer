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
   and `tools/golden.mjs` has 11 `chart-*` shots. **What it showed on first run:**
   - Rails and poles under ~0.04 render as broken dotted lines (the sub-pixel problem of section 2, now measurable per width).
     **Fixed 2026-10-01** by the thin-feature resolve (section 2).
   - All six near-identical colour pairs collapse to one palette colour each, and the two darkest greys merge.
     **Improved 2026-10-02:** the palette is chosen by minimax merging instead of k-means (`quantizePalette`), so a
     colour on a small object is no longer absorbed into a clearly different one, and the default size is now 80 colours
     (`DEFAULT_PALETTE_SIZE`). At 80 the darkest greys and the other distinct colours (dark teal, navy/purple, pink/peach,
     mint/cream, white/off-white) separate; the six near-identical pairs and the two ground checker tiles still merge, because
     they are the closest colours in the chart. `tools/palette-check.mjs` reports each scene's worst colour shift;
     `?compare=palette&left-k=56&k=80` wipes two palettes against each other.
   - Lamp light ignores occlusion: the room's lamp makes a dithered pool on top of its own roof and speckles outside its walls.
     **Fixed 2026-10-01:** per-lamp distance cube maps (`src/renderer/lampShadows.ts`), with `Lamp.clearance` for the lamp's own fixture.
   - Lamp colour is ignored (section 3): seven differently coloured lamps cast identical orange pools. **Fixed 2026-10-01:** each pool
     takes its strongest lamp's colour, with dithered borders between pools.
   - Metals read as flat coloured balls: there is no specular or metal treatment.
   - The broad low mound renders as one flat band at noon (no visible gradient on a gentle slope).
   - Found on the props gallery: contact occlusion (`contactAt` in `shaders/post.ts`) paints a false checker on the faceted, curved
     deck of `stone_arch_bridge`. It disappears with `contacts=0`. Repro: `pass3.html?scene=props&view=stone_arch_bridge&zoom=5&hour=12`.
     **Fixed 2026-10-01** (Sol): taps fade out by world distance (0.43–0.55 m), and taps outside the frame are skipped.
2. **Modeled props (batch 1 done, 2026-10-01):** 13 purpose-made Blender props per `docs/ASSET_BRIEF.md`, viewable in the
   `?scene=props` gallery. The loader's name-prefix rules (`decor_`, `water_`, `glass_`, `thin_`, `lamp_`) are in place; `move_*` is
   recognised but has no motion yet (section 3, animation hook).
3. **CC0 low-poly packs** (Kenney, Quaternius, KayKit) through `collectGltf`. These are the first real-world assets, and they need:
   - **Textures:** today only `material.color` is read, so a textured model renders as one flat colour per material. Sample the base-colour
     texture per vertex or face before quantisation, or add a UV/albedo-texture path to the G-buffer.
   - **Skinned meshes and node animation:** the dynamic mesh only knows the fixed motion modes.
4. **Done (2026-10-02): the second hero scene, Lantern Row** (`?scene=village`, `src/scenes/village/`). A night village street of about
   30 × 24 m on two levels: a cobbled street, a square with a fountain and a festoon, a stair and gateway up to an upper lane behind a
   1.6 m retaining wall, a canal with a bridge on the camera side, and backdrop houses past both ends. Sol modelled the 17 buildings and
   props (`assets/village/`, one GLB each, placed by footprint in `layout.ts`); paving, walls, stairs, canal, trees, smoke and fireflies
   are built in code. It starts at 22:00 (`SceneDefinition.hour`), has six `?view=` presets and `village-*` golden shots, and needed
   `LIMITS.lamps` raised from 16 to 32 (22 lamps). **What it showed:**
   - The Golden Hour look carries over to a night street and a dense town without changes to the renderer.
   - Warm lamp light on grass and bushes turns olive (lamp colour multiplies green albedo). Natural, but less pretty than on stone.
   - Side-wall window mullions break up at oblique angles (thin features, section 2).
5. **Done (2026-10-02): Lantern Row v2, the canal town.** The user found v1 monotonous and cramped, so the scene was rebuilt at about
   68 × 62 m around a 6 m canal: quays, a 3-arch stone bridge and a footbridge, boats, a jetty, a watermill with a turning wheel, a
   market square with a town hall, market hall and a glowing guardian statue, a chapel, a watch tower, overgrown ruins with a wardstone,
   thatched cottages, a smithy, a barn, gardens, an orchard, a pond, fields with a windmill, and gentle terrain (`groundY` is a height
   field that stays flat under paths, water and buildings). Sol built 24 new models (batch 3 in `docs/ASSET_BRIEF.md`). Renderer
   additions: `move_spin_`/`move_sway_` motion (`movingPartMotion`, opt-in per scene), lamp light and broken lamp reflections on water,
   and `LIMITS.lamps` 64 (44 used). **Open:** about 500k triangles, and the lamp-shadow pass redraws the static mesh once per cube
   face (264 times). Culling DECOR ground from that pass or using coarser slope cells would cut startup cost.
6. **Done (2026-10-03): night lighting.** The night grade drains colour under moonlight (greens most, via `uNight` in the post shader's
   `ramp`), with neutral blue night tints in `look.ts`, so the canal town reads as night rather than dark green; lamp-lit greens lose
   some chroma too, so warm pools on grass go ochre instead of lime. Lit windows cast small warm pools on the ground, quay or wall below
   them from a top-down window light map (`windowLight.ts`): panes are found from EMISSIVE geometry at build time and splatted once,
   so they add no lamps and no shadow cube maps. Pool-band dithering is now gated like the sun's: only where the light is a smooth
   gradient on one plane. A second map stores each pool's source position, so walls light only on the side facing the window
   (the builder moves a pane's source just outside the facade around it, keeping the wall below lit). Window pools have no shadows; a
   pane with an obstacle right in front of it can still light the obstacle's near side, and past it. Each texel keeps one averaged
   source, so where pools of windows facing each other across a narrow gap overlap, a wall between them can be lit or darkened wrongly.
   - The tavern's hanging sign (`move_sway_`) is static: the loader has no motion for `move_*` parts yet (section 3, animation hook).
7. **Done (2026-10-03): fluids.** Water is no longer an opaque flagged floor. `src/renderer/fluids.ts` defines a `FluidMaterial`
   (colours, clarity, reflectivity, roughness, ripple size, foam, emission) with `FLUIDS` presets (water, canal, pond, swamp, acid,
   lava) and a `FluidCollector`; `PixelScene.fluids` replaces `ripples`, and `water_` assets become fluids (`water_<preset>_` picks a
   preset). Fluid surfaces are drawn into their own small G-buffer after the opaque one, then composited in a second run of the post
   shader (`shaders/water.ts`): the bed shows through by depth and clarity; flow-mapped ripples travel with the current and stretch
   along it; reflections come from a screen-space march that is exact for flat water under our orthographic camera (a plane hit
   inside the sampled pixel's footprint); lamps draw their mirror image, spot-like on calm water and a broken dashed column on rough
   water; roughness (material + flow speed + turbulence) breaks and weakens the mirror; foam forms where the water is stirred. Sloped
   and upright fluid (spills, waterfalls) falls down its own slope and froths. A top-down map baked once (`fluidMap.ts`) deflects the
   current round piers, hulls and banks, slows it at the edges, and holds turbulence from sources, wakes and falls. The village canal
   flows with the mill wheel, the basin and pond lie still, the fountain spills; `?scene=fluids` shows every preset side by side.
   `tools/water-check.mjs` checks the map, the mirror's projected position, rough reflections, misses and the flow direction.

## 2. Sub-pixel stability (found 2026-10-01)

**The problem.** The renderer decides each art pixel from the surface at that pixel's centre, so any feature thinner than a pixel is only
hit when a pixel centre lands on it, and that changes with every tiny camera movement. We saw it on the cookie-shop door: its five plank
grooves are 0.015 units wide (~40% of a pixel at default zoom) and popped in and out while orbiting. This is inherent to rasterising 3D into
a low-resolution grid, not a bug in one shader. Every 3D-to-pixel pipeline has it. A sub-pixel feature has no correct answer, only a policy:
always show it, never show it, or show it sometimes (flicker).

**What was done so far (a workaround, not a fix).** The groove meshes are skipped and the post shader draws grooves at fixed world positions
on surfaces flagged `GROOVED`, always exactly one screen pixel wide. The positions are now scene data (`PixelScene.grooves`), but only one
groove set per scene is supported. Passes 0–1 are frozen and still flicker. `node tools/door-strip.mjs <px> <name>` shows 8 tiny camera steps side by side.

**Proper fixes to build and measure.** Option 1 is done and is the default (see `docs/THIN_FEATURES.md`, measured with
`npm run thin-check`). The others are not built yet:

1. **Done (2026-10-01): supersampled G-buffer with a coherent resolve.** It is 3×3, with near-priority for `thin_`-marked surfaces
   and majority for everything else. The original idea: Rasterise the geometry at 2×–4× the art resolution and pick each art pixel from the
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
- **Lamp placement.** Since lamps are occluded, a lamp must sit inside its fixture, because a light offset in front of its post is
  shadowed by the post (seen and fixed on the test chart). Cookie Co.'s window lights still sit just outside the glass; audit the
  geometry before moving them inside.
- **Look per scene.** The day-cycle keyframes in `look.ts` are global; a scene (or game) should be able to supply its own.
- **Asset pipeline.** Blender → glTF export → flags by node name or custom property (`collectGltf` rules handle names today) → merge and
  palette as a build step instead of at page load (Cookie Co. takes seconds to build in the browser).
- **Package it** (npm workspace or published package) with the demo as a consumer, a smaller public API (`src/renderer/index.ts` is the
  start), unit tests for palette/geometry, and the golden and browser checks in CI. The golden images are already tracked in `golden/`,
  but CI would render on a different GPU path than the local SwiftShader runs, so expect to regenerate or tolerance-match them there.

## 4. Performance and fairness

- **Profile on a real GPU.** Everything so far ran in headless Chrome on SwiftShader (software rendering). Pass 3 re-rasterises the G-buffer every
  frame because the world moves, and "Compare all" runs three WebGL contexts with 4096² shadow maps each. Measure frame time, memory and
  mobile behaviour; consider caching static geometry and re-rendering only the dynamic mesh.
- **Comparison fairness.** Pass 3 uses its own world (pond, leaf-clump trees, motion), so the comparison mixes renderer and content
  changes. Future passes should all draw the same `PixelScene`; the frozen references cannot.
- Moving objects take the shadow of whatever static surface is behind them; add a real shadow for dynamic casters if it matters.

## 5. Visual and art ideas not yet done

- Tune the foliage and lamp look further; add a night moon and stars if the camera ever sees the sky.
- A transparency policy beyond ordered-dither discard (particles) if a scene needs it. Fluids have their own layer (section 1, item 7).
- Fluids, later: moving obstacles in the flow map (today a moving part needs a `FluidSource`); sources tied to one body of water
  (a `FluidSource` stirs every pool surface at its height within its radius, so a separate basin alongside is stirred too); gently sloped rivers (a fluid surface
  steeper than ~18° counts as falling water and runs straight down its slope, ignoring any authored flow, and the flow map covers
  only flat pools); splashes as particles, wet shore darkening, underwater fog for a camera below the surface, and a fluid casting
  light (lava lighting its surroundings needs scene lamps today).
- Depth cues: Pass 2's screen-wide haze was disliked (it washes everything out, see `archive/pass2-atmosphere/`), and a constant-depth
  step shows as a seam on flat ground, so any future depth cue needs a different approach.
