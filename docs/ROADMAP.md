# Roadmap

Goal: one pixel-art 3D renderer, built once and reused by every hobby game. The first game to use it is **Soil n Silo**
([CelestialLemon/Soil-n-Silo](https://github.com/CelestialLemon/Soil-n-Silo)), a point-and-click farming and production game. More
games will follow, but none are planned yet.

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

1. **Done (2026-10-05): dynamic objects API.** `r.addObject(geometry)` returns a `PixelObject` (`src/renderer/objects.ts`) that the
   game moves with `setTransform(position, rotation?, scale?)` or by writing its `position`, `quaternion` and `scale`; `visible` hides
   it and `remove()` takes it out. The geometry is local-space `GeometryCollector` output whose colours the game quantises together with
   the scene's; the renderer never disposes it. The baked `PixelScene` is unchanged, so scenes without objects draw exactly as before.
   - **Instancing.** Objects sharing a geometry are one `InstancedMesh` (one draw call), with the visible ones packed into it each
     frame. Instanced against separate meshes, measured on the RX 570 with `tools/object-bench.ts` (480×360 G-buffer, 4096² sun map
     and mask, every object moving, median; its own minimal shader, not the full `addObject` path): separate meshes cost 0.4 / 2.6 / 10.1 ms at 50 / 500 / 2000 boxes, instances 0.1 / 0.1 / 0.3 ms. A crop field is
     exactly the many-copies case.
   - **Snapping** (section 2, option 3). Each object's origin is drawn snapped to the art-pixel grid in the camera's image plane
     (`snap`, on by default), so it moves in whole art pixels. It is then slid along the view direction, which doesn't move it in the
     image, back to its own height, so grounded objects don't sink or float. Rotation and scale are not snapped. Negative scale
     (mirroring) works; a zero scale component hides the object.
   - **Sun shadows** (section 4). A second sun light holds a shadow map of the objects only and re-renders when an object, the sun or the
     camera (snapping) changes; the static map still renders only when the sun moves. The mask multiplies the two, so where an object's
     soft shadow edge overlaps the world's, the two penumbras combine slightly differently from one merged map.
   - **Not yet:** objects neither block lamp light nor cast lamp shadows (the lamp atlas is static), and they have no ambient motion
     (sway, spin). The object shadow map is a second fixed 4096² map, allocated with the first object (which also recompiles the mask
     shader once), and it re-renders whenever the camera moves, since snapping moves the objects; a game-chosen size would help on
     phones. Add these when the game needs them.
   - Demo: `?scene=objects` (a cart on a loop, bouncing balls, a turning crate and a field of crops that grow and are harvested).
     `BuiltScene.populate` (`src/scenes/types.ts`) plays the game: it adds the objects and moves them to the clock each frame.
2. **Done (2026-10-05): picking.** `r.pick(clientX, clientY)` (a pointer event's coordinates) or `r.pickPixel(x, y)` (an art pixel,
   top left origin) returns the art pixel, the world position and normal of the surface drawn there, and the `PixelObject` drawn there
   (null for the baked scene and the sky). It reads one pixel back from the GPU, so the game calls it on input, not every frame, and it
   describes the last `renderGeometry` (with the camera of that render). It is null outside the canvas and until the first
   `renderGeometry` after a `resize`.
   - **Object ids.** Each object gets an id (`o.id`, from 1, never reused). It rides per instance in the batch meshes'
     `instanceColor.r` (the geometry is the game's, and shared by a batch's normal and mirrored meshes), into an R32F third target of
     the supersampled G-buffer, and the resolve copies the id of the sample it chose for the pixel into the resolved shadow target's
     spare red channel. Surface grouping still ignores the id, so no pixel changes; float32 holds ids exactly to 2^24, so `addObject`
     stops there.
   - **World position** is the resolved depth at the pixel centre, which the resolve already moves along the surface's plane, so it
     projects back to the same art pixel.
   - **Not yet:** fluids are seen through (the pick is the surface below the water), and the baked scene is one id (0), so a game
     that wants to click parts of it (tiles, doors) maps the world position to them itself.
   - Demo: in `?scene=objects`, clicking a crop harvests it early, and the panel shows the pixel, world position and object id.
     `BuiltScene.populate` now returns `{ update, click }`. `npm run pick-check` (`tools/pick-check.ts`) checks the API and the resolve.
3. **Done (2026-10-06): game-supplied settings.** With none of them given, the renderer draws exactly as before (the one
   visible change is a fix: `nearestPreset` now measures around the clock, so 01:00 is "Night", not "Morning").
   - **Look.** `dayCycle(keys, presets)` (`src/renderer/look.ts`) turns a game's keyframes (`LookKey`: a `Look` at an hour, with
     sRGB sky colours) into a `DayCycle` with `lookAt(hour)`, its named `presets` and `nearestPreset`. Keys may sit at any hours: the
     look wraps through midnight, so one key gives a fixed look. `DEFAULT_DAY_CYCLE` is the old table, and `lookAt`/`PRESETS` are
     its shorthands. A scene can carry its own (`SceneDefinition.look`), which the demo pages use for the look and the time buttons.
   - **Renderer options.** `new PixelRenderer(canvas, scene, options)` takes `PixelRendererOptions`: `limits` (lamps, grooves,
     fluid materials and sources; `resolveLimits` fills in `DEFAULT_LIMITS`), `supersample` (1 or 3), the resolve policy, and
     `shadowMapSize` / `objectShadowMapSize` (4096 by default; smaller maps for phones). The shaders are compiled to the instance's
     limits, and a scene over them is rejected with a clear error: its lamp, groove and fluid counts before a WebGL context is
     created, and the limits against the device's fragment uniform budget right after. Collect fluids with the same limits
     (`new FluidCollector(limits)`); `SceneDefinition.limits` does this for the demo scenes. `npm run settings-check` checks them.
   - **Palette size** was already the game's: `quantizePalette(geometries, size)`. A demo scene's default is
     `SceneDefinition.paletteSize`, which the viewer shows when `?k=` is absent.
   - **Camera.** The orbit camera stays in the demo app; a game places the camera itself with `placeCamera`.
4. **Done (2026-10-06): startup cost.** Measured on the RX 570 (median of 3 warm-cache runs, 160×120 first frame, default 4096²
   shadows, `node tools/startup-bench.ts [--baked]`): from loading the scene's assets to the first frame (not counting page and
   module start-up or a cold network cache), Cookie Co. went from 1101 ms to 449 ms and the
   canal town from 3451 ms to 450 ms.
   - **Baked scenes.** `npm run bake` (`tools/bake.ts`) builds each demo scene once in the browser, through its real asset
     pipeline, and writes it as an exact binary (`encodeScene`: attribute bytes, quantized colours, fluid slots, lamps, the
     prepared fluid and window-light maps, and objects' local geometry), gzip-compressed, to `public/baked/<scene>-<hash>.p3dz`
     (about 6 MiB each; git-ignored). The production build (`npm run build:baked` = bake, then `vite build`) loads it with
     `decodeScene`: about 210 ms to fetch and decompress, and the renderer no longer scans the geometry for its maps (the canal
     town's constructor now takes 33 ms). A palette size or limits other than the baked defaults build live.
   - **Staleness.** The bake records a SHA-256 of the scene and renderer sources and the GLB assets. Dev always builds live; a
     build with no bake builds live too (so CI needs no browser); a build with a stale bake fails and says to rebake.
   - **Lamp-shadow pass.** It no longer draws the triangles the lamp shader discards anyway (DECOR and the other non-occluders):
     Cookie Co. 512,688 → 330,198 triangles per cube face, the canal town 497,810 → 342,310. Every solid occluder stays, with no
     cut-off by lamp radius, because lamp reflections on water look up occlusion far from the lamp.
   - `npm run startup-check` checks every scene's binary round trip and that the live and decoded first frames match pixel for
     pixel. Games can bake their own scenes with the same `encodeScene` / `decodeScene`.
5. **Done (2026-10-06): package it.** `src/renderer/index.ts` is the public API, grouped into drawing, building a scene and time
   of day. Internals only the check tools need (`buildFluidMap`, `atlasLayout`, `POOL_NORMAL_Y`, `fluidFromName`) are no longer
   exported. `npm run build:lib` builds `lib/pixel3d-renderer.js` (one ES module, three.js external) and `lib/types/*.d.ts`
   (`tools/lib-types.ts` adds `.js` to their relative imports, for games on `"moduleResolution": "nodenext"`). `package.json` has
   `exports`, three.js as a peer dependency (`@types/three` an optional one) and a `prepare` script, so installing from a git tag
   builds `lib/`. `npm test` runs unit tests (`test/`, Node's test runner, no browser) for the palette, geometry, day cycle and
   limits against the built package, imported by its name as a game would. CI (`.github/workflows/ci.yml`) runs the typecheck,
   the unit tests and the demo build on every PR, and a second job checks ten pinned views rendered in software (SwiftShader)
   against a golden set made once from a known-good commit (`npm run golden -- --ci`). Releases are `v<version>` tags (README, "Using it in a game"); the first,
   `v0.1.0`, is tagged once this phase is merged.
6. **Done (2026-10-06): a minimal example game,** `examples/walker/` (`npm run example`). A walker on a walled garden with a pond,
   lamps and swaying flowers: WASD or arrows walk (relative to the camera, sliding along walls), Q/E turn the camera in 45°
   steps, a click places a crate, pumpkin or lantern on the tile under the pointer (a hover frame shows it) and a click on a
   placed thing removes it, and the day passes. It imports only `pixel3d-renderer`, which its Vite config points at the built
   `lib/`, and its `tsconfig` resolves the types through the package's `exports`. `npm run example-check` drives it in the browser.
   **What it showed about the API:** a game with no ambient motion, fluids or grooves had to fill in empty ones and the demo's
   `stats` in `PixelScene`, and import `DEFAULT_SETTINGS` just to draw. Now `PixelScene` needs only `staticGeometry` and `shadow`
   (the renderer fills in the rest), and `renderStyle(time)` uses the default settings.

**Done when:** the example game runs against the package, and a separate repo can install it from a tag.

### Phase 2: Soil n Silo

The game lives in its own repo and installs the renderer from a tag (v0.1.0 to start). It is point-and-click: there is no player
character, and the player turns the orthographic camera between preset 90° views and pans it with the mouse. From here on, the game
drives the renderer's priorities: each gap it hits comes back here as an issue labelled `soil-n-silo`. Expected needs (confirm them
against the game; its `docs/ROADMAP.md` keeps the current list):

- **Things that change state:** crops growing through stages, tilled tiles, placed machines. Object swaps, spawning and removing
  objects (done in Phase 1).
- **Pointing at tiles:** picking and a hover highlight (done in Phase 1).
- **Pointing at objects:** done (2026-10-06, #22). `PixelObject.highlight` draws a pale one-pixel rim around the object's visible
  part and lifts its surfaces one band. The post pass finds the object by the id the G-buffer already carries for `pick`, so a
  change is one uniform write, and a shader variant (`HIGHLIGHT`) keeps the cost at zero while nothing is highlighted. The variant
  compiles on first use (1.8 s under SwiftShader); the opt-in `PixelRendererOptions.warmHighlight` compiles it in the background
  once there are objects, bringing the first highlighted frame to about 20 ms there, while a game that never highlights compiles
  nothing extra. The rim goes
  outside the object against sky, ground and anything clearly behind it, and inside it against anything nearer and other objects
  touching it, so it never paints an occluder or a touching copy. The rim colour is the object's own ramp lifted to a pale tint (lightness at least 0.90,
  chroma ×0.6): the ramp's own top band didn't read on dark objects. Up to `MAX_HIGHLIGHTS` (4) at once. `tools/highlight-check.ts`.
  - **Limits:** an object cut by the edge of the canvas has no rim along that edge. "Level with" means within the depth threshold
    the outlines use (`max(0.10, 3 texels)`), so under a camera pitched below about 30° the rim at an object's feet moves from the
    ground onto the object's lowest row.
- **Soil colour per tile** that changes with fertility: a per-object tint, or one geometry per band.
- **Machines that show they are running:** smoke and glow on objects, so ambient motion for objects, and perhaps lamps on them.
- **Seeing behind buildings:** fading or cutting away buildings and trees, if the 90° views are not enough.
- **Animals:** chickens moving about, as rigid parts or skinned meshes.
- **UI** over the canvas, built in the game.

### Phase 3: harden the renderer

Work that matters more once a real game depends on the renderer, in any order the game suggests:

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

When the next game starts, look at what it needs from Soil n Silo's code. Anything both games need in the same form moves into a
small shared module, most likely a pixel-art UI kit first, then perhaps input or audio helpers. Each module is independent and
optional, and games call them; nothing sits in the middle and imposes a structure. The renderer gets a new minor version for anything
the second game needs, and Soil n Silo upgrades only if it wants to.

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
- The ambient-motion mesh's small moving bits still take the shadow of whatever static surface is behind them. Game objects
  (`addObject`) cast and receive real sun shadows (Phase 1, item 1).

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
