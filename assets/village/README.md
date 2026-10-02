# Lantern Row models

Deterministic Blender sources for the night village. Each model has its own `build.py`, GLB in `public/village/`, architecture-only `.blend`, inspected front/back previews, and `metadata.json` with evaluated bounds, triangle count and lamps.

```sh
/opt/homebrew/bin/blender -b --factory-startup --python assets/village/house_A/build.py
node assets/village/build-all.mjs --verify
node assets/village/validate.mjs
node assets/village/scene-check.mjs
node assets/village/propose-baselines.mjs
```

`village_common.py` imports the established batch-one mesh helpers without modifying them. Its shared palette keeps plaster, slate, timber, stone and warm emission consistent across the street. The exporter retains the **footprint origin** instead of recentering around asymmetrical decorations: Blender Z=0 is ground, −Y is the front. Footprint envelopes include roof eaves, shutters, steps and mounted fixtures. GLBs include normals, flat material colours, emission and lamp extras; no textures, UVs, cameras or preview lights.

`propose-baselines.mjs` prepares the five village regression views in ignored `review/` for visual approval; it never changes `golden/` references. Review captures, build logs, Python caches and Blender backup files are disposable and may be removed after QA. Keep the model sources, `.blend` files, metadata, per-model previews, GLBs and these reusable scripts.

`house_A` is the first style check: two floors, a jetty, front/back gables, teal shutters, flower boxes, a slate roof and chimney. Envelope 5 × 5 m, maximum height 7.74 m; front door at `(0, −2.05, 0)`. Only the left ground-floor front window and doorstep lantern cast light; other warm surfaces are emissive. Windows are actual gaps in the wall with recessed interior panels behind `glass_`, and the validator checks a light ray through the opening plus the solid interior behind it.

Workbench previews check the geometry and flat colours; they do not reproduce the renderer's night lighting. `scene-check.mjs` uses the running dev server for six frozen-clock in-scene captures, saved in ignored `review/`, and fails on browser/shader/asset errors. `build-all.mjs --verify` launches a fresh Blender process for each model and checks that every GLB has an identical SHA-256 after rebuilding; set `BLENDER_PATH` to override the executable.

| ID | Envelope w × d (m) | Height (m) | Triangles | Lamps | Character |
| --- | --- | ---: | ---: | ---: | --- |
| house_A | 5 × 5 | 7.740 | 7,876 | 2 | Front gable, jetty, teal shutters, marigold boxes |
| house_B | 5.5 × 5 | 8.854 | 9,904 | 2 | Three-storey apothecary, stocked teal display, dormer |
| tavern | 7 × 6 | 9.354 | 7,764 | 2 | Hipped slate roof, front and west entrances, pivoted rose tankard sign |
| clock_tower | 4 × 4 | 13.630 | 4,226 | 0 | Four emissive clock faces, open belfry, slate spire |
| house_C | 6 × 5 | 8.354 | 6,996 | 2 | Wide ivory townhouse with twin dormers |
| house_D | 5 × 5 | 8.865 | 9,016 | 2 | Tall rose townhouse with front gable |
| stair_arch | 2.5 × 0.8 | 3.741 | 492 | 0 | Clear 1.9 m passage to 2.5 m spring line; 3.45 m centre headroom |
| bakery | 4.5 × 4 | 5.555 | 4,940 | 1 | Low warm building, loaf display and striped canopy |
| house_E | 5 × 4.5 | 7.405 | 6,488 | 2 | Lower sage townhouse with a dormer |
| fountain | 3 × 3 | 2.110 | 3,556 | 1 | Hollow basin, upward water disc, teal rim lanterns |
| barrel | 0.85 × 0.85 | 1.000 | 624 | 0 | Sixteen oak staves, four iron hoops |
| crate | 1.1 × 0.95 | 0.760 | 264 | 0 | Open slatted crate with diagonal braces |
| bench | 1.9 × 0.75 | 1.050 | 252 | 0 | Oak slats, iron arms and legs |
| flower_box | 1.5 × 0.7 | 0.675 | 1,228 | 0 | Sage foliage and golden marigolds |
| signpost | 1.45 × 0.55 | 2.490 | 312 | 0 | Teal and rose direction arrows |
| closed_stall | 2.9 × 1.9 | 2.463 | 576 | 0 | Closed shutters, striped canopy and rose sign |
| festoon | 6 × 0.65 | 3.910 | 3,448 | 0 | Fifteen glowing bulbs, sagging thin wire, two iron posts |

All buildings stay below 10,000 triangles and small props below 5,000. Lamp positions, radii and fixture clearances are in each model's metadata. Every building has finished side/back facades. Window lights sit inside genuine wall apertures with solid emissive interior panels behind skipped glass; the loader validator checks outward passage and inward occlusion. It also checks the fountain's hollow basin and upward water normal, the arch's clear passage, the tavern sign hierarchy, and the four clock faces.

Batch total: **17 assets, 67,962 triangles and 14 authored lamps**, before scene reuse and procedural geometry. Every GLB passed an identical fresh-process SHA-256 rebuild.

The layout-dependent retaining wall, stairs, railings, canal, cobbles and trees are owned by the scene code. No additional Blender wall/stair assembly is exported.

Final scene review passed all six camera presets with no browser/shader/asset errors. The approved five village reference images are in `golden/`; all 24 earlier references stayed unchanged. `npm run check` passes all 29 screenshot comparisons, type checking, lamp shadows, depth resolution, viewer/export/mobile checks and deterministic animation. The production build also passes.
