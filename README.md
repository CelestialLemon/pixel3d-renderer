# pixel3d-renderer

A WebGL (three.js) renderer that draws 3D scenes as proper pixel art: low-resolution G-buffer, palette-controlled hue-shifted ramps, selective outlines,
gradient-aware dithering and more. Started as an experiment inside the Farm Frenzy / Harvest Frenzy repo and moved here on 2026-10-01 so it can be
iterated on separately and eventually used as a module in several games.

- **Run:** `npm install && npm run dev` then open http://localhost:5180 (compare all four passes) or `/pass3.html`.
- **Next steps:** see [`docs/ROADMAP.md`](docs/ROADMAP.md) (sub-pixel stability, making it a reusable module, performance).
- **Layout:** `src/` renderer passes and demo, `public/cookie_factory.glb` the model, `assets/cookie-factory/` its Blender source and build script
  (`export_glb.py` regenerates the GLB: `blender -b assets/cookie-factory/cookie_factory.blend --python export_glb.py`), `docs/` research and roadmap,
  `*.mjs` capture and verification tools.
- The cookie-factory model was built for Harvest Frenzy (the game lives in `../farm-frenzy`, which keeps its own 2D sprite versions).

---

# Four-pass pixel-art 3D renderer experiment

Cookie Co. in a meadow, comparing four independent renderers on the same GLB, camera, sun, pixel size, and animation clock. Passes 0–2 share identical geometry and palette; Pass 3 adds its own scenery and motion (see below).

```sh
npm install
npm run dev              # http://localhost:5180 (Vite selects the next port if occupied)
npm run build            # comparison demo and preserved standalone Pass 0
npm run typecheck
```

The demo opens on **Compare all** in a **2 × 2 grid**. Select **Pass 0**, **Pass 1**, **Pass 2**, **Pass 3**, or **Compare all**:

- **Pass 0 — Original:** the previously named Before renderer, preserved in `src/pass0/`. `/pass0.html` runs its standalone page; `/before.html` remains a compatibility URL.
- **Pass 1 — Refined:** the previously named After renderer, preserved in `src/pass1/pipeline.ts`. Correct cast shadows, full-float depth, restrained color ramps, contact occlusion, selective edges, and surface-aware cleanup.
- **Pass 3 — Golden Hour:** `src/pass3/` (also standalone at `/pass3.html`). See the Pass 3 section below.
- **Pass 2 — Atmosphere:** new renderer in `src/pass2/pipeline.ts`, inspired by the documented A Short Hike techniques. Brighter, flatter three-band surface lighting; softer silhouette ink; smooth focus-relative distance fog; attenuated distant dithering; reduced distant crease contrast.

## Comparing

The **Compare** menu offers a **2 × 2 grid** (default), **four columns**, or a **four-way wipe** (`layout=grid|panels|wipe`). The grid defaults to 2px art pixels so each quarter-screen scene stays detailed. In the wipe: Drag either divider or use the two sliders. Divider arrow keys move the boundary without rotating the camera. Boundaries cannot cross; either historical pass can be exposed across the entire scene. Each segment uses identical projected coordinates and pixel size.

In the grid and column layouts all four complete scenes are visible at once. Orbit, zoom, pan, and sunlight changes apply to all three. At narrow widths the scenes stack vertically. The controls sit outside the scene panels. H hides controls and expands the panel comparison; H restores it.

The **Factory** preset shows the building closely. **Landscape** widens the view and lowers the camera to reveal trees and ground across multiple depths. The model and meadow are shared unchanged between all three passes, so renderer differences remain directly comparable.

The **time of day** slider (Pass 3's grade, sky and lamps) also moves the sun for every pass, so all four are compared under the same light; the Sun slider then overrides the azimuth for all. Pass 2's atmosphere controls expose distance haze, intensity, start/end distances relative to the focus plane, outline ink strength, and haze color. Sun, cloud clock, outline/dither/cleanup toggles, and pixel size are shared. Contact shadows are unavailable in Pass 0.

## Pass 2 details and limits

- The existing G-buffer supplies linear camera depth. Haze is a smoothstep blend toward a linear-RGB atmospheric color, before output encoding. Defaults: start 2 units in front of focus, full haze 18 behind focus, maximum blend 85%, outline ink 60%.
- The focus depth is measured from the actual camera matrix. Its arbitrary 100-unit orthographic distance does not cause an immediate washout.
- Silhouette ink is painted onto a background pixel, but receives the outlined object's `bestD` depth. Foreground contours remain clear; distant contours fade with their objects.
- Dither amplitude attenuates with haze. Internal crease accents stop in substantial fog; distant shapes keep gentle silhouettes instead of noisy facet lines.
- The sky horizon follows the atmospheric color. Terrain fog uses depth rather than screen height, including when orbiting.
- Pixel cleanup is bypassed in Pass 2 while haze is enabled, because continuous fog gradients invalidate the historical cleanup's equal-color comparisons. Pass 0 and Pass 1 retain their original behavior. With haze disabled, Pass 2 can use cleanup normally.
- View-aligned camera snapping is retained. It helps panning, but rotation, zoom, and moving geometry still resample the scene. This does not promise perfect temporal pixel stability.
- The current scene is opaque, including stylized steam. Transparent water/particles would require an additional depth/compositing policy when introduced.

This is a style experiment, not an exact reconstruction of A Short Hike's source shaders or a measured production performance target. Comparison renders all three pipelines and shadow maps, requiring considerably more GPU memory and work than a single pass. Full float buffers and 4096² shadow maps remain in use. No Blender/model change was needed for this first renderer comparison.

## Controls and captures

Drag any visible scene to orbit; wheel to zoom; shift/right-drag to pan. A/D or arrows turn 45 degrees. H hides controls. Save PNG exports the active pass or a labelled comparison at native art resolution; panel exports preserve all three complete images.

Query parameters: `mode=pass0|pass1|pass2|pass3`, `compare=0` (single Pass 3), `layout=grid|wipe|panels`, `hour` (0–24, default 17.5), `sunEl`, `anim=0`, `cycle=1`, `glow=0`, `vignette=0`, `az`, `el` (degrees), `zoom` (visible world height), `px` (CSS pixels per art pixel), `sun`, `k` (base palette size), `auto=1`, `contacts=0`, `outline=0`, `dither=0`, `clean=0`, `clouds=0`, `clean-ui=1`, `time=8` (freeze the cloud clock). Pass 2: `fog=0`, `fogStart`, `fogEnd`, `haze` (0–1), `ink` (0–1), `fogColor` (URL-encoded hex color). These atmosphere parameters apply only to Pass 2.

```sh
node shot.mjs pass2 "mode=pass2&time=8&clean-ui=1"
node shot.mjs compare "compare=1&zoom=23&el=32&time=8"
node verify.mjs
node comparison-sheet.mjs # four labelled native captures, integer 2x enlargement
# If Vite uses another port:
DEMO_URL=http://127.0.0.1:5181 node verify.mjs
```

Tools use this project's `puppeteer-core` dev dependency and macOS Chrome. `verify.mjs` accepts `CHROME_PATH` and `DEMO_URL`. It checks exact Pass 0 preservation, Pass 1 against the pre-change native reference if present, distinct Pass 2 output, atmosphere isolation, both ordered dividers, camera/sun/resolution synchronization, panel visibility, PNG download dimensions, actual GPU-depth fog response, four camera views, high-DPI mobile stacking/export, and browser/shader errors. Captures go to `out/`.


---

# Pass 3 — Golden Hour

Built on Pass 1's renderer in `src/pass3/`; passes 0–2 are untouched (`node verify.mjs` still proves Pass 0/1 pixels are identical). It is part of the main
comparison page and also available standalone at `/pass3.html`, which has its own time-of-day UI and a wipe against Pass 1.

What Pass 3 adds over Pass 1:

- **A living world.** Grass, flowers and reeds sway in travelling gusts; chimney smoke rises, swells and dissolves with ordered-dither
  "pixel transparency"; belt cookies emerge from the oven and ride the conveyor; butterflies flutter; fireflies blink at night; the pond
  has drifting three-tone ripples, ring ripples and sparkles. Movers live in a small dynamic mesh animated in its vertex shader
  (`GBUF_DYN_VERT`), so the static world stays one merged mesh. The shadow mask comes from the static world only.
- **Time of day** (`src/pass3/tod.ts`): sun path, warm tint on lit bands, cool tint on shadow bands, exposure, sky, and lamp state are
  keyframed across 24h. Presets: Morning, Noon, Golden hour, Dusk, Night.
- **Lamp light.** Windows, lantern and oven cast warm falloff pools on walls and ground after dusk. The light multiplies the surface
  colour (so grass goes amber-olive, not lime) and is banded and dithered, never smooth.
- **Scalloped foliage.** Trees and bushes are clusters of small spheres whose normals point away from the mass centre, so they shade as
  one banded sphere while the silhouette stays leafy.
- **Pond, mushrooms, log, stump, lily pads, cattails**, plus more varied grass.
- **Quieter finishing.** Clouds now actually darken the ground by a band; corner shading is two hard rings. Pass 2's depth haze was
  deliberately *not* carried over: a constant-depth step shows as a seam across flat ground.

Things worth knowing:

- The G-buffer is re-rendered every frame (the world moves), unlike Pass 1 which caches it. Untested on a real GPU: only headless
  SwiftShader was available.
- The shadow mask ignores moving objects, so a swaying tuft takes the shadow of the ground behind it.
- Pass 1 in the wipe uses its own (static) world, so differences include geometry, not just shading.
- Checks: `node verify.mjs` (the merged page, including time-of-day sun sync and the animation toggle), `node interact3.mjs` (standalone page), `node anim_check.mjs` (motion + determinism), `node shot3.mjs <name> "<query>"`.
  Standalone-page query params: `hour`, `az`, `el`, `zoom`, `px`, `time` (freeze the clock), `compare=1`, `split`, `anim=0`, `cycle=1`, `clean-ui=1`,
  and `outline|dither|clean|contacts|clouds|glow|vignette=0`.

## Sub-pixel flicker (door planks)

Geometry thinner than a screen pixel flickers as the camera moves, because whether a pixel centre lands on it changes every frame. The door's five
plank grooves are 0.015 units wide (about 40% of a pixel at default zoom), so in Pass 3 they are no longer meshes: the shader draws them at fixed
world positions on the surface flagged `DOOR`, always exactly one screen pixel wide. `node door_strip.mjs <px> <name>` renders the door at 8 tiny
camera steps as a contact sheet (`out/<name>.png`); every frame should show the same planks. Passes 0-2 are deliberately left untouched and still
show the flicker. Note that three.js turns node names' spaces into underscores, so match names with `[ _]`.
