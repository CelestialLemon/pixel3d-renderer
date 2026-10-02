# pixel3d-renderer

A WebGL (three.js) renderer that draws 3D scenes as proper pixel art: a low-resolution G-buffer, palette-controlled hue-shifted ramps,
selective outlines, gradient-aware dithering, time of day and a living, animated world. It started as an experiment inside the Farm
Frenzy / Harvest Frenzy repo, moved here on 2026-10-01, and is on its way to becoming a module that several games can use.
Next steps are in [`docs/ROADMAP.md`](docs/ROADMAP.md).

```sh
npm install
npm run dev          # http://127.0.0.1:5180 (pinned: the tools use this address)
npm run typecheck
npm run build
npm run check        # typecheck + golden images + browser checks (needs the dev server running)
```

## Pages

| URL | What it is |
| --- | --- |
| `/` | **Comparison page.** Every pass draws the same Cookie Co. view with one shared camera, sun, art-pixel size and clock. Side by side (default) or a wipe with draggable boundaries. |
| `/pass3.html` | **The current renderer on its own**, full window, with time-of-day controls and an optional wipe against Pass 1. `?scene=<id>` picks a scene. |
| `/pass0.html` | Pass 0's original standalone page (kept for the pixel-preservation check). |

Controls: drag to orbit, wheel to zoom, shift/right-drag to pan, A/D or arrows turn 45°, H hides the controls. Save PNG exports at
native art resolution (comparisons are labelled).

## Layout

```
src/
  renderer/            the reusable core (import from src/renderer/index.ts only)
    renderer.ts        PixelRenderer: G-buffer, shadow mask, post shader, clean-up
    shaders/           GLSL: gbuffer.ts (static + animated vertex shaders), post.ts (the pixel-art stylisation), cleanup.ts
    scene.ts           PixelScene: what a scene hands the renderer (geometry, lamps, ripples, grooves, shadow area)
    flags.ts           surface flags (NORMAL, EMISSIVE, DECOR, STEAM, WATER, GLOW, GROOVED)
    motion.ts          vertex animation modes for moving geometry (sway, conveyor, smoke, butterfly, firefly)
    geometry.ts        GeometryCollector and helpers for building scene geometry
    palette.ts         OKLab palette reduction (minimax merging)
    gltf.ts            glTF loading and per-mesh rules (flags, motion, skip)
    look.ts            time of day: sun, colour grade, sky, lamps
  scenes/              scene content: one folder per scene, registered in scenes/index.ts
    cookie-co/         the factory, meadow, trees, pond and wildlife
    village/           Lantern Row, a night village street: layout, paving, walls, canal, trees, and placement of the modelled buildings
    test-chart/        calibration bays (thin features, curves, ink, AO, palette, lamps)
    props/             gallery of every modelled prop in assets/props/
    shared/            seeded randomness and noise for building scenes
  app/                 the demo pages: compare/ (index.html), viewer/ (pass3.html), shared orbit camera, params, pass registry
  reference/           FROZEN: Pass 0 and Pass 1 pipelines and their world. Never edit (golden images prove they are unchanged).
archive/pass2-atmosphere/   Pass 2, archived (not built)
assets/cookie-factory/      Blender source, build script and export_glb.py for public/cookie_factory_current.glb
assets/props/, assets/village/   Blender build scripts for the batch 1 props and the Lantern Row models (GLBs in public/props/, public/village/)
tools/                      headless-Chrome capture and check scripts
docs/ROADMAP.md
```

## How the renderer works

Each frame, `PixelRenderer` (`src/renderer/renderer.ts`):

1. **Rasterises a G-buffer** at art resolution (one canvas pixel per art pixel; CSS scales it up with nearest-neighbour). Two targets:
   albedo + surface flag, and world normal + linear view depth. The static world is one merged mesh. A second, dynamic mesh holds
   everything that moves and is animated in its vertex shader. Transparency is ordered-dither discard.
2. **Renders a shadow mask** from the sun's shadow map (static world only; moving bits take the shadow of the surface behind them).
3. **Stylises** in one post shader: silhouette ink drawn on the far pixel, a banded sky, water, hue-shifted OKLab ramps, gradient-aware
   dithering (only where the light really forms a smooth gradient), cloud shadows, contact occlusion, convex/concave creases, lamp pools,
   groove lines and corner shading. Each surface flag changes which of these apply.
4. **Cleans up** orphan pixels on flat surfaces.

The geometry carries one flat colour per vertex. Scenes reduce all colours to a small palette (`quantizePalette`: minimax merging in
OKLab, 80 colours by default), so the image uses a controlled set of base colours that the ramps then shade. Minimax keeps the worst shift
of any input colour small, so a colour on a small object is not absorbed into a clearly different one.

### Scenes

A scene module builds a `PixelScene` (`src/renderer/scene.ts`) and registers a `SceneDefinition` (`src/scenes/types.ts`) with its camera
framing. Nothing scene-specific lives in the renderer: lamps, water ripple points, groove lines, the shadow area and every animation anchor
are scene data. To add one:

1. Create `src/scenes/<id>/index.ts`. Use two `GeometryCollector`s (static, and dynamic for moving parts), fill them with
   `collectGltf` and/or procedural geometry, give moving parts a `motion.*` and surfaces a `FLAG`, then `build()` them and run
   `quantizePalette`.
2. Use one seeded `mulberry32` generator per build (and consume it in a fixed order), so the scene and its palette are reproducible.
3. Add it to `SCENES` in `src/scenes/index.ts`. `/pass3.html?scene=<id>` shows it, and a scene picker appears once there are two.

Shader limits per scene: 32 lamps, 4 ripple points, 8 groove positions (`LIMITS` in `scene.ts`). A scene can set `hour`, the time of day
the viewer starts at (Lantern Row starts at night).

### Passes

The comparison page shows every entry of `PASSES` in `src/app/passes.ts`, wrapped in one `PassView` interface. To try a new renderer
iteration side by side with the current one, add an entry there. The pages, layouts, wipe dividers and exports adapt to the count.

- **Pass 0 — Original** and **Pass 1 — Refined** (correct shadows, float depth, restrained ramps, contact occlusion, selective edges):
  frozen references in `src/reference/`.
- **Pass 2 — Atmosphere:** archived. Its depth haze washed the scene out. See `archive/pass2-atmosphere/`.
- **Pass 3 — Golden Hour:** the current renderer, `src/renderer/` + `src/scenes/cookie-co/`. It adds a living world (swaying grass,
  flowers and reeds; chimney smoke; belt cookies; butterflies; fireflies at night; a rippling pond), time of day (keyframed sun path,
  warm/cool band tints, exposure, sky, lamps; presets Morning, Noon, Golden hour, Dusk, Night), lamp light that multiplies the surface
  colour after dusk, scalloped leaf-clump foliage, and quieter finishing (cloud shadows darken by one band, two hard corner rings, no depth haze).

Passes 0–1 draw their own static world without the pond, leaf-clump trees and motion, so the comparison mixes renderer and content changes.

## Checks and tools

All tools drive headless Chrome with SwiftShader (`tools/lib.mjs`; set `CHROME_PATH` and `DEMO_URL` to override). They need the dev server.

| Command | Checks |
| --- | --- |
| `npm run golden` | **Golden images** (`tools/golden.mjs`): 32 fixed views with a frozen clock, compared pixel for pixel with the approved images in `golden/` (tracked, so a PR shows reviewers every view it changes). Any difference fails and writes the new image to `golden/diff/` (git-ignored). Run it before and after every change: a refactor must stay identical, and a deliberate change shows exactly which views it touched. After an intended change, accept it with `npm run golden:update` on the work's branch, never directly on `main`: new baselines reach `main` only through a PR, where the reviewer sees each changed view. `node tools/golden.mjs pass3` runs a subset. |
| `npm run lamp-shadow-check` | Lamp shadow atlas: enclosed shells, back-facing panels, fixture clearance, and fitting small device limits (2048 and 512 px) with smaller faces. |
| `npm run moving-shadow-check` | Sun-shadow mask on rigid moving parts (`move_spin_`/`move_sway_`): a moving panel at rest, spun 90 degrees and mid-swing gets exactly the mask of the same panel as static geometry at that pose, over striped ground (no borrowing the background) and under a roof (no "always sunlit"), without painting over static geometry in front of it. |
| `npm run village-check` | Lantern Row: canopies clear every building, backdrop house, street, quay and the water, and buildings don't overlap or stand in the water (`layoutProblems` in `layout.ts`); models tied to layout features follow them; the mill wheel turns across the canal's flow in the main channel; moving parts spin about their node's local X axis; villager splitting keeps nested meshes single and parent prefixes; a missing or corrupt model fails the build visibly. |
| `node tools/verify.mjs` | Comparison page: Pass 0 matches its standalone page; modes; ordered wipe dividers; shared camera, sun and resolution; layouts; PNG export sizes; mobile; time of day; animation toggle; no browser or shader errors. |
| `node tools/check-viewer.mjs` | The viewer page's controls, compare wipe and mobile layout. |
| `node tools/anim-check.mjs` | The world moves between two clock times and renders identically at the same time. |
| `node tools/door-strip.mjs [px] [name]` | Sub-pixel flicker contact sheet: the door at 8 tiny camera steps (`out/<name>.png`). |
| `node tools/shot.mjs <name> "<query>" [WxH]` | Screenshot of `/pass3.html` (`PAGE=index.html` for the comparison page) plus the art resolution and colour count. |
| `node tools/palette-check.mjs` | Palette quality per scene: worst shift of any input colour, and each merged group whose worst shift or widest input pair is at least `REPORT_THRESHOLD` (default 0.05) (`K`, `MAX_ERROR`). Fails over `MAX_ERROR` (default 0.10). |
| `node tools/comparison-sheet.mjs` | The passes side by side at 2x (`out/passes.png`), from the captures `verify.mjs` writes. |

`out/` holds scratch captures and is git-ignored; it is safe to empty. The approved golden images are tracked in `golden/`.
Everything so far ran on SwiftShader only, never a real GPU.

## Query parameters

Both pages: `hour` (0–24, default 17.5), `time` (freeze the animation clock, e.g. `time=8`), `anim=0`, `cycle=1` (run the day), `az`, `el`
(degrees), `zoom` (visible world height), `px` (CSS pixels per art pixel), `auto=1` (auto-orbit), `clean-ui=1`, and
`outline|dither|clean|contacts|clouds|glow|vignette=0` to switch effects off.

- Comparison page: `mode=pass0|pass1|pass3` (one pass), `layout=grid|wipe`, `sun` / `sunEl` (override the sun, degrees), `k` (Pass 0–1
  palette size, default 44), `k3` (Pass 3 palette size, default 80).
- Viewer: `scene=<id>`, `compare=1` (wipe against Pass 1), `split` (wipe position, %), `k` (palette size, default 80), `compare=palette`
  (wipe against another palette size: `left-k`, default 56, on the left and `k` on the right).

## Sub-pixel flicker (door planks)

Geometry thinner than a screen pixel flickers as the camera moves, because whether a pixel centre lands on it changes every frame. The door's
five plank grooves are 0.015 units wide (about 40% of a pixel at default zoom), so in Pass 3 they are not meshes: the post shader draws them at
fixed world positions (`DOOR_GROOVES` in `src/scenes/cookie-co/layout.ts`) on the surface flagged `GROOVED`, always exactly one screen pixel
wide. `node tools/door-strip.mjs` shows they hold steady. Passes 0–1 still flicker. This is a workaround; proper fixes are on the roadmap.

## Assets

`public/cookie_factory_current.glb` (the Cookie Co. scene) comes from `assets/cookie-factory/cookie_factory.blend` (built by
`build_cookie_factory.py`). Regenerate it with
`blender -b assets/cookie-factory/cookie_factory.blend --python assets/cookie-factory/export_glb.py`. `public/cookie_factory.glb` is
the frozen export that the Pass 0/1 references load; it predates the fix to the door's inside-out winding and is never re-exported.
The model was built for Harvest Frenzy
(`../farm-frenzy` keeps its own 2D sprite versions). three.js turns spaces in node names into underscores, so match names with `[ _]`.
