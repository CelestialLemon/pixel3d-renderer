# Lantern Row models

Deterministic Blender sources for the night village. Each model has its own `build.py`, GLB in `public/village/`, architecture-only `.blend`, inspected front/back previews, and `metadata.json` with evaluated bounds, triangle count and lamps.

```sh
/opt/homebrew/bin/blender -b --factory-startup --python assets/village/house_A/build.py
node assets/village/build-all.mjs --verify
node assets/village/build-all.mjs --batch3 --verify  # new canal-town models only
node assets/village/build-all.mjs --verify chapel  # one model
node assets/village/validate.mjs
node assets/village/scene-check.mjs
node assets/village/propose-baselines.mjs
```

`village_common.py` imports the established batch-one mesh helpers without modifying them. Its shared palette keeps plaster, slate, timber, stone and warm emission consistent across the street. The exporter retains the **footprint origin** instead of recentering around asymmetrical decorations: Blender Z=0 is ground, −Y is the front. Footprint envelopes include roof eaves, shutters, steps and mounted fixtures. GLBs include normals, flat material colours, emission and lamp extras; no textures, UVs, cameras or preview lights.

`propose-baselines.mjs` prepares the five village regression views in ignored `review/` for visual approval; it never changes `golden/` references. Review captures, build logs, Python caches and Blender backup files are disposable and may be removed after QA. Keep the model sources, `.blend` files, metadata, per-model previews, GLBs and these reusable scripts.

## Batch 2: the original street

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

Batch 2 total: **17 assets, 67,962 triangles and 14 authored lamps**, before scene reuse and procedural geometry. Every GLB passed an identical fresh-process SHA-256 rebuild.

The layout-dependent retaining wall, stairs, railings, canal, cobbles and trees are owned by the scene code. No additional Blender wall/stair assembly is exported.

Final scene review passed all six camera presets with no browser/shader/asset errors. The approved five village reference images are in `golden/`; all 24 earlier references stayed unchanged. `npm run check` passes all 29 screenshot comparisons, type checking, lamp shadows, depth resolution, viewer/export/mobile checks and deterministic animation. The production build also passes.

## Batch 3: the canal town

Twenty-four new assets add civic buildings, cottages, workshops, working waterside props, relics and everyday clutter. Sources are grouped in `canal_assets.py`, `town_buildings.py` and `edge_assets.py`; each model retains a directly runnable `build.py`. The larger windmill has its own source. Roofs include red clay tile, thick curved thatch and blue slate; walls include fieldstone relief, red brick, red boards, whitewash and tarred timber. Shared `Village ...` material names are stable for per-placement recolouring.

| ID | Envelope X × Y (m) | Height above origin (m) | Triangles | Lamps |
| --- | --- | ---: | ---: | ---: |
| bridge_stone | 4.5 × 13 | 3.295 | 4,768 | 2 |
| footbridge | 1.8 × 8 | 1.899 | 2,160 | 0 |
| watermill | 8 × 6 | 7.255 | 7,496 | 1 |
| rowboat | 1.3 × 3.2 | 0.425 | 516 | 0 |
| barge | 2.2 × 8 | 1.595 | 1,944 | 1 |
| jetty | 4 × 2.5 | 0.303 | 560 | 0 |
| town_hall | 10 × 7 | 12.150 | 9,260 | 2 |
| chapel | 6 × 11 | 10.550 | 8,190 | 1 |
| watch_tower | 4 × 4 | 14.530 | 8,672 | 1 |
| smithy | 6 × 5 | 6.855 | 5,124 | 1 |
| cottage_thatch | 5 × 4 | 4.755 | 3,228 | 1 |
| cottage_long | 7 × 4.5 | 4.755 | 3,176 | 1 |
| barn | 8 × 6 | 6.485 | 2,220 | 0 |
| market_hall | 7 × 4.5 | 4.580 | 4,292 | 2 |
| guardian_statue | 2 × 2 | 4.500 | 1,388 | 1 |
| wardstone | 2 × 2 | 2.560 | 672 | 1 |
| ruins | 9 × 8 | 4.040 | 7,458 | 0 |
| hay_bales | 2.2 × 1.6 | 1.410 | 272 | 0 |
| woodpile | 2.5 × 2.2 | 1.722 | 1,644 | 0 |
| laundry_line | 5.1 × 0.5 | 2.640 | 334 | 0 |
| notice_board | 2.1 × 1.1 | 2.820 | 1,360 | 0 |
| market_stall_lit | 3 × 2 | 2.647 | 1,308 | 1 |
| mooring_bollard | 0.25 × 0.25 | 0.287 | 180 | 0 |
| windmill_large | 9 × 5.4 | 12.556 | 3,524 | 0 |

Batch 3 total: **24 assets, 79,746 triangles and 16 authored lamps**, before scene reuse. Every new GLB passed an identical fresh-process SHA-256 rebuild.

Waterside origins are deliberately explicit:

- Stone bridge spans **Y**, envelope **X=4.5, Y=13**, landing at `(0, ±6.5, 0)`. Three actual arches open through its full width. The central three metres clear a +0.6 m soffit, giving 1.6 m above the −1 m waterline. Bed-reaching piers/cutwaters extend to −1.5 m. Footbridge spans Y, lands at ±4 m and clears the same navigable centre.
- Watermill origin stays at footprint centre/quay height. Local X=2.5 is the quay edge. `move_spin_wheel` pivots at Blender `(3.02, 0, 0.5)`, on the +X shaft, and dips below the −1 m waterline. A top-fed flume and fieldstone relief distinguish its working side.
- Boats originate at the **waterline**, bow facing −Y, so place at world Y=−1. Their hulls are closed shells around genuinely hollow interiors, with an inner floor 3.5 cm above waterline to cover the scene's continuous water plane. The barge has tapered cargo decks, a low lit cabin, crates and a short elbow stovepipe. Its 1.595 m air draft clears both bridges over the entire beam, with at least 5 cm margin.
- Jetty origin is its **back/quay edge**, Y=0, Z=0. Its 4 m wide deck extends toward −Y to −2.5, at Z=−0.55; the ladder reaches the quay and piles reach Z=−1.5. Metadata provides asymmetric XY bounds.
- Large windmill base diameter is 3.8 m, cap 10.72 m, sail pivot `(0, −2.25, 8.35)`. The 9 × 5.4 m export envelope includes sail clearance. The sail motion root's local X aims down Blender −Y, with named `thin_` lattice children.

`export_village` defaults preserve batch-2 ground-centred contracts. Non-ground assets opt into `minHeightMetres`, `footprintBoundsBlender` and `origin`; all bounds are enforced before export and by the runtime-loader validator. Custom attachment coordinates remain Blender Z-up.

`move_spin_*` and `move_sway_*` roots carry local-X pivots. Multi-material moving roots export as groups, and motion must reach every material primitive and named thin child. Laundry has four separate top-edge pivots; town-hall banners keep their emblems parented to the cloth. The scene supplies all water and terrain. The optional village well reuses `public/props/well.glb`.

The validator checks geometry/normal/texture contracts, envelopes, triangle and authored lamp budgets, complete bridge headroom and ramp landings, side-arch openings, wheel pivot/depth, dry boat hollows over a continuous water plane, actual barge clearance beneath both exported bridges, jetty deck/piles, open town-hall arcades, the smithy's visible forge and smoke mouth, three stained-glass hues, the crystal's lamp fixture, cloth upper-edge pivots and the windmill shaft/lattice. Per-model front/back previews are retained for visual review. Build logs, contact sheets and scene captures are scratch outputs and are removed before the PR.
