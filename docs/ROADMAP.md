# Roadmap

Goal: one pixel-art 3D renderer, built once and reused by every hobby game. The first game to use it is the **3D port of Harvest
Frenzy**. More games will follow, but none are planned yet.

The **Direction** and **Phases** below are the plan (decided 2026-10-05). The numbered sections after them are the renderer's
detailed backlog and the record of what has been done. Items are roughly in priority order within each section.

## Direction

The games are code-only (no engine, no editor) hobby projects for the web, shared with friends as a link (GitHub Pages or itch.io).
They are not meant to be sold.

1. **A renderer library, not an engine.** The game owns the main loop, the game state, the timing, input, audio, physics and UI, and
   *calls* the renderer: "here is the world and where everything is, draw it". The renderer never calls into the game and never owns
   game objects. This keeps it usable by very different games.
2. **Share only what must look the same.** The renderer is shared because the look *is* the point, and it is hard to rebuild. Most
   other systems are small or already exist as good libraries, so each game writes or picks its own.
3. **Extract code only after a game has proved it.** The renderer came out of Harvest Frenzy once it had proved itself there, and
   other shared code follows the same rule. Nothing is designed for games that don't exist yet. When a second game needs the same
   thing as the first, it moves into a small, independent module (a kit, not a framework).
4. **Finished games stay frozen.** A game depends on the renderer through a git dependency pinned to a tag
   (`"pixel3d-renderer": "github:CelestialLemon/pixel3d-renderer#vX.Y"`). While a game and the renderer change together, it points at
   a local checkout instead (`npm link` or a `file:` path). A renderer change never breaks an old game until that game chooses to
   upgrade.
5. **The demo scenes stay the test bed.** Cookie Co., the canal town, the test chart, fluids and the props gallery are the renderer's
   own regression suite (golden images, check tools). A game never replaces them.

**Who owns what:**

| Concern | Owner | Notes |
|---|---|---|
| Drawing: look, light, palette, outlines, shadows, water, pixel snapping | renderer | the shared part |
| Ambient motion (grass, smoke, fireflies, wheels) | renderer | GPU, driven only by time |
| Character animation | split | the game picks the clip and the time (three.js `AnimationMixer` or its own code), and the renderer skins the mesh from bone matrices |
| Positions, spawning, game state | game | sent to the renderer each frame |
| Mouse to world (picking) | renderer | only the renderer knows which art pixel shows what |
| UI | game | HTML/CSS over the canvas to start with; a pixel-art UI kit is the first candidate for a shared module (it is part of the look) |
| Audio, input, physics, save/load, game loop | game | Web Audio or Howler; tile or box collision, or Rapier if a game needs real physics; copy small code from game to game |

## Phases

### Phase 1: make the renderer usable by a game

Today a scene is baked once into a `PixelScene` (one static mesh, one dynamic mesh), and each frame only takes a camera, a look and a
time. A game can't move, add or remove anything. This phase fixes that and turns the repo into a package.

1. **Dynamic objects API.** A game registers meshes as objects and adds, removes and moves them at runtime. The static world stays
   baked and merged for speed. Moving objects snap to the pixel grid (section 2, option 3), and dynamic casters get real shadows
   (section 4). Decide between per-object draw calls and instancing while building it. Roughly:
   ```ts
   const r = new PixelRenderer(canvas, { look, palette });
   r.setStatic(levelGeometry);
   const cart = r.addObject(cartMesh);
   cart.setTransform(position, rotation);   // every frame, from the game
   r.render(camera, time);
   ```
2. **Picking.** Map a screen point to the art pixel and the world position, plus the object under it (an object-ID channel in the
   G-buffer). Clicking a tile or a crop needs this, and the game can't work it out by itself.
3. **Game-supplied settings.** Look keyframes per game or scene (today `look.ts` is global), the palette size and the limits. The
   orbit camera stays in the demo app; a game places the camera itself with `placeCamera`.
4. **Startup cost.** Merge and palette at build time instead of at page load (the asset pipeline: Blender → glTF → naming rules →
   baked data). Cookie Co. takes seconds to build in the browser, and the canal town's lamp-shadow pass redraws the static mesh 264
   times (section 1, item 5).
5. **Package it.** A small public API (`src/renderer/index.ts`), a library build (ES modules plus `.d.ts`, with three.js as a peer
   dependency), version tags, unit tests for the palette and geometry, and CI that runs the typecheck and tests. Golden images need
   a set of their own for CI, made once from a known-good commit.
6. **A minimal example game** in this repo (a character walking around a small level with the keyboard, clicking to place things).
   It uses only the public API, the way a real game would, and it is the check for this phase: if the example is awkward to write,
   the API is wrong.

**Done when:** the example game runs against the package, and a separate repo can install it from a tag.

### Phase 2: Harvest Frenzy 3D

The port lives in its own repo and installs the renderer from a tag. From here on, the game drives the renderer's priorities: each
gap it hits comes back here as a backlog item. Expected needs (confirm them against the game):

- **Characters:** skinned meshes in the renderer, with clip playback on the game side.
- **Things that change state:** crops growing, items being picked up. Object swaps, scaling, and spawning and removing objects.
- **Textures,** if the port uses CC0 packs (Kenney, Quaternius, KayKit) rather than models made for it (section 1, item 3).
- **UI** over the canvas, built in the game.

### Phase 3: harden the renderer

Work that matters more once a real game depends on the renderer, in any order the port suggests:

- **Ambient motion hook.** Make the list of vertex-animation modes pluggable: a scene or game registers a mode (a GLSL snippet with
  the `pose()` contract, a parameter packer, and whether it casts a moving shadow), and the renderer builds `pose()` from the core
  modes plus the registered ones. The core keeps static, sway, spin and swing. The conveyor, butterfly, smoke and firefly modes move
  out to the scenes. The moving-part shadow pass checks the "casts shadow" setting instead of the mode number (`mode > 5.5` today). It
  should change no pixels, and the golden images prove that.
- **Performance** on real GPUs and phones (friends may play on either). See section 4.
- **Sub-pixel stability**, the remaining options (section 2).
- **Lamp placement audit:** Cookie Co.'s window lights still sit just outside the glass and should move inside their fixtures.
- **Visual backlog** (section 5) and the open findings from the test chart (section 1, item 1): metals, gentle slopes, close colours.

### Phase 4: the second game

When the next game starts, look at what it needs from Harvest Frenzy's code. Anything both games need in the same form moves into a
small shared module, most likely a pixel-art UI kit first, then perhaps input or audio helpers. Each module is independent and
optional, and games call them; nothing sits in the middle and imposes a structure. The renderer gets a new minor version for anything
the second game needs, and Harvest Frenzy upgrades only if it wants to.

---

**Done in the 2026-10-01 restructure:** the renderer core (`src/renderer/`) is split from scene content (`src/scenes/`) and the demo pages
(`src/app/`). Nothing scene-specific lives in the renderer any more: lamps, water drip points, door grooves, the shadow area, the chimney
and every animation anchor are `PixelScene` data or per-vertex attributes. Scenes are registered and selectable (`?scene=`), passes are a
registry, Passes 0–1 are frozen in `src/reference/`, Pass 2 is archived, and `tools/golden.ts` gives pixel-exact regression checks.
The restructure changed no output pixels.

## 1. Test scenes (in progress)

The renderer has only ever been judged on one cozy daytime meadow, so a change can look good there and break on content it has never seen.

1. **Done (2026-10-01): the test-chart scene** (`?scene=test-chart`, `src/scenes/test-chart/`). Six bays on a 1 m checker: thin
   features (poles, rails, ladder, wires, fence, mullions at 0.02–0.16 widths), curves, ink and creases, AO and self-shadowing, palette
   stress, and terraces with a lit room and seven coloured lamps. Each bay is a camera preset (`?view=thin|curves|ink|ao|palette|lamps`),
   and `tools/golden.ts` has 11 `chart-*` shots. **What it showed on first run:**
   - Rails and poles under ~0.04 render as broken dotted lines (the sub-pixel problem of section 2, now measurable per width).
     **Fixed 2026-10-01** by the thin-feature resolve (section 2).
   - All six near-identical colour pairs collapse to one palette colour each, and the two darkest greys merge.
     **Improved 2026-10-02:** the palette is chosen by minimax merging instead of k-means (`quantizePalette`), so a
     colour on a small object is no longer absorbed into a clearly different one, and the default size is now 80 colours
     (`DEFAULT_PALETTE_SIZE`). At 80 the darkest greys and the other distinct colours (dark teal, navy/purple, pink/peach,
     mint/cream, white/off-white) separate; the six near-identical pairs and the two ground checker tiles still merge, because
     they are the closest colours in the chart. `tools/palette-check.ts` reports each scene's worst colour shift;
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
   - The tavern's hanging sign (`move_sway_`) was static when this was written. The village now opts in to `movingPartMotion`, so
     its `move_*` parts (the sign, the mill wheel, the windmill sails, the laundry) move; the batch-1 props in `?scene=props` stay static.
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
   `tools/water-check.ts` checks the map, the mirror's projected position, rough reflections, misses and the flow direction.

## 2. Sub-pixel stability (found 2026-10-01)

**The problem.** The renderer decides each art pixel from the surface at that pixel's centre, so any feature thinner than a pixel is only
hit when a pixel centre lands on it, and that changes with every tiny camera movement. We saw it on the cookie-shop door: its five plank
grooves are 0.015 units wide (~40% of a pixel at default zoom) and popped in and out while orbiting. This is inherent to rasterising 3D into
a low-resolution grid, not a bug in one shader. Every 3D-to-pixel pipeline has it. A sub-pixel feature has no correct answer, only a policy:
always show it, never show it, or show it sometimes (flicker).

**What was done so far (a workaround, not a fix).** The groove meshes are skipped and the post shader draws grooves at fixed world positions
on surfaces flagged `GROOVED`, always exactly one screen pixel wide. The positions are now scene data (`PixelScene.grooves`), but only one
groove set per scene is supported. Passes 0–1 are frozen and still flicker. `node tools/door-strip.ts <px> <name>` shows 8 tiny camera steps side by side.

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
   Generalise `tools/door-strip.ts` into a test that renders every asset (the test chart first) at many sub-pixel camera offsets and fails
   on pixels that come and go.
5. **Replace shader-drawn detail with authored data.** Plank patterns and similar should be material/texture data aligned to the pixel grid
   (a detail or ID channel), not a list of positions in a uniform.

## 3. Finish the reusable module

Moved into the phases above (2026-10-05): the animation hook, lamp placement and the visual items are in Phase 3; look per scene, the
asset pipeline and packaging are in Phase 1.

## 4. Performance and fairness

- **Checks on a real GPU (done 2026-10-03).** On Linux the tools render on the GPU through ANGLE Vulkan (`GL_BACKEND`, `tools/lib.ts`).
  The golden run takes 1m00s on a Radeon RX 570, against 8m50s on SwiftShader on the same machine (Ryzen 5 1600) and 4m on a
  MacBook Air. The GPU output is byte-identical from run to run, so each machine keeps a pixel-exact golden set of its own.
- **Profile on a real GPU.** Frame times have only been measured in headless Chrome on SwiftShader (software rendering). Pass 3 re-rasterises the G-buffer every
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
