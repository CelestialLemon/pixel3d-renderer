# Asset brief: models for testing the renderer

Who this is for: whoever builds 3D models in this workspace. To change a rule, edit this file in the same PR as the work that
needs the change.

## Why these models exist

pixel3d-renderer turns 3D scenes into pixel art (three.js, an orthographic camera, a low-resolution G-buffer, then a stylising post
shader). So far it has only been judged on one scene, `cookie-co`, a cookie factory in a sunny meadow. We need varied content that targets
specific weaknesses, so that renderer changes can be judged on more than one cozy daytime picture. Each model should have a **purpose**
(what it tests), not just look nice. It should still look nice: these models double as the art of future test scenes.

Read first: `README.md`, `docs/ROADMAP.md` (section 1 is this work; section 2 explains the sub-pixel flicker problem), and
`assets/cookie-factory/build_cookie_factory.py` plus `export_glb.py`, the existing model, which shows the style and the export settings that work.

## The pipeline contract (what the renderer can read today)

The loader is `collectGltf` in `src/renderer/gltf.ts`. It reads only **mesh positions, normals, the material base colour, and the material
emission**. Everything else is thrown away. So:

- **Build with a Blender Python script** (Blender 5.2 is at `/opt/homebrew/bin/blender`). The script is the source of truth. It must be
  deterministic (`random.seed(...)` with a fixed seed) and runnable headless:
  `blender -b --python assets/props/<name>/build.py`. Commit-ready output is the script, an exported `.glb`, and a preview PNG.
  Saving a `.blend` is optional.
- **Export:** GLB, Y-up, `export_apply=True`, no cameras, no lights, `export_image_format='NONE'`, `export_texcoords=False`,
  and **`export_extras=True`** (custom properties carry lamp data, see below). Write to `public/props/<name>.glb`.
- **Colour = one flat Principled *Base Color* per material.** No textures, no UVs, no vertex colours, no procedural shader nodes. All of these are
  ignored. For variation, use several materials (the factory uses 5 terracotta tile materials and 4 brick materials, for example). Give
  materials descriptive names ("Weathered pine plank"). The renderer reduces every scene to a palette of about 80 colours, so dozens of
  near-identical shades are wasted. Pick colours deliberately.
- **Self-lit surfaces** (lit windows, lantern glass, glowing signs): give the material an Emission colour with strength of about 0.3 or more. The loader flags them
  emissive automatically.
- **Units and scale:** 1 Blender unit = 1 metre. A person is about 1.7 m and a door about 2 m. At the default zoom **one art pixel is about 0.04 m**.
  Any feature thinner than about **0.05 m** flickers or vanishes as the camera moves (see ROADMAP section 2). That's allowed only when
  it's deliberate, and then the object name must start with `thin_` (see the naming table).
- **Placement:** each prop sits on the ground plane (Blender z = 0) and is centred on the origin. Its front faces Blender **-Y**, the standard
  front view. Put no ground slab or base under it: the scene supplies the ground. A paved patch that *belongs* to the prop is fine.
- **Budget:** about 5k triangles per prop at most. Bevels with 1–2 segments are fine. Smooth curves need enough segments to show banding
  (24–32 around a sphere or cylinder).
- **Lighting is not yours to set.** The renderer has its own sun, sky and day cycle. Preview lighting in Blender is only for your own check.

### Object naming → how the renderer treats it

The loader has a generic name-based rule, so these prefixes on **object names** become renderer behaviour automatically
(note that three.js turns spaces into underscores, so use underscores):

| Prefix | Meaning |
|---|---|
| *(none)* | Ordinary solid surface. |
| `decor_` | Small ground cover or plants: no outlines or creases. |
| `water_` | A fluid surface (see `src/renderer/fluids.ts`). An upward-facing surface is a pool: still unless the scene gives it a flow. A sloped or upright one (a spill, a jet, a waterfall) falls down its own slope, so it needs no flow data. `water_<preset>_` (e.g. `water_acid_`, `water_lava_`) picks a `FLUIDS` preset; plain `water_` is clear water. Model what lies under a pool (a bed, steps), since it shows through. |
| `glass_` | Window glass. For now it is skipped (see-through). Put the lit interior *behind* it. |
| `thin_` | Deliberately thinner than 0.05 m (wires, spokes, railings): a flicker-test feature. |
| `move_<kind>_` | A moving part (`move_spin_` sails/wheels, `move_sway_` cloth/signs). Make it a separate object with its **origin at the pivot** and its **local X axis along the axle or hinge**: it turns about that axis (custom props `speed` rad/s, `amplitude` rad). A scene opts in to motion. |
| `lamp_` | An **Empty** (not a mesh) marking a light source. Custom properties: `color` (3 floats, linear RGB), `radius` (metres the light reaches) and optional `clearance` (metres, default 0.45). Solid geometry blocks lamp light; anything within `clearance` of the empty counts as the lamp's own fixture and doesn't. Set a smaller `clearance` for a lamp mounted near a wall or ceiling that must still block it. |

**Hierarchies:** a mesh's *motion* comes from its nearest `move_*` ancestor (or from itself), pivoting at that ancestor's origin. Its
*flags* (`thin_`, `decor_`, ...) come from its own name. Example: `move_spin_wheel_L` (rim and hub, origin at the axle) with
`thin_spoke_*` children spins as one piece, and the spokes are still marked thin.

## Batch 1: the prop gallery (done)

Separate props, one folder each under `assets/props/<name>/`. Each one targets a risk. All 12 (13 with the lamp variant) are built
and shown in the gallery scene (`?scene=props`); the list stays here as the record of what each prop is for:

1. **street_lamp**: a cast-iron post (about 0.08 m thick) with a lantern head, emissive glass panes and a `lamp_` empty inside (warm colour).
   *Tests:* emissive, a thin vertical pole, a lamp. Make a second variant, **street_lamp_cool**, with a cool blue-white lamp colour (coloured lamp light works since 2026-10-01).
2. **fence_set**: a run of picket fence (slats 0.08 m), a wrought-iron railing (bars 0.03 m → `thin_`), and a rope barrier between posts
   (`thin_`). *Tests:* thin features at three widths, side by side.
3. **cart**: a wooden hand cart with two spoked wheels (each wheel a `move_spin_` object, spokes `thin_` at about 0.03 m, rims thicker). *Tests:* curves, spokes, overlapping depth.
4. **market_stall**: a counter with a striped awning that overhangs about 0.6 m. Use two *close* colours in the stripes (for example two reds) and produce
   crates of saturated fruit. *Tests:* overhang shadow, ambient occlusion, palette near-neighbours and saturated hues.
5. **stone_arch_bridge**: a small arched footbridge. Leave a 1.5 m × 1.5 m patch under it free for a `water_` plane. *Tests:* ambient occlusion
   under an arch, curved stonework, water.
6. **well**: a round stone well with a little roof, a crank and a rope (`thin_`). The inside must be a real hollow (concave). *Tests:* concave interior, creases.
7. **metal_props**: a copper pot, an iron anvil on a stump, a brass bell and a silver/steel kettle. Set Metallic on the materials (which will be
   ignored, so the colour must carry the metal look). *Tests:* the metal palette, small curved objects.
8. **villagers**: 3–4 low-poly standing figures with different skin tones (light to deep), clothing colours and a hat on one. No faces needed,
   but the hands and head must read clearly at about 40 pixels tall. *Tests:* skin tones, small features.
9. **shop_front**: a narrow shop facade with a big `glass_` window, a lit interior behind it (emissive warm back wall, shelves and items),
   a hanging sign (`move_sway_`) and a `lamp_` inside. *Tests:* a lit interior behind glass, emissive versus lamp light.
10. **telegraph_pole**: two poles with crossbars and 3 sagging wires (`thin_`, about 0.02 m). *Tests:* the worst case for thin features.
11. **windmill**: a small windmill whose sails are one `move_spin_` object pivoting on the hub. *Tests:* a large moving part, thin sail lattice.
12. **snow_hut**: a hut with a snow-covered roof, a snowman and a snowy pine. Use several *near-white* materials (snow in shade and in light, ice). *Tests:* white-on-white contrast, palette at the bright end.

After each prop: render a preview PNG (Workbench or EEVEE, front three-quarter view, transparent or plain background) to
`assets/props/<name>/preview.png`, look at it yourself before moving on.

## Batch 2: Lantern Row (done, 2026-10-02)

The models of the night village scene (`?scene=village`), one folder each under `assets/village/<id>/`, exported to
`public/village/<id>.glb`, with shared materials in `assets/village/village_common.py` and `architecture.py`. Validate them with
`node assets/village/validate.mjs`. Each building is built to a footprint (`BUILDINGS` in `src/scenes/village/layout.ts`): the envelope
includes eaves, steps, signs and fixtures, the origin is the footprint centre on the ground, and the front faces Blender −Y. The scene
turns and places them, so a model can move without a re-export.

- Buildings: `house_A`–`house_E`, `tavern` (two facades, rose `move_sway_` sign), `clock_tower`, `bakery`, `stair_arch` (gateway, 1.9 m
  clear opening). About 2 `lamp_` empties per building at most; other lit windows are emission only.
- Square and street: `fountain` (four teal rim lamps), `closed_stall`, `festoon` (emissive bulbs, no lamps), `bench`, `barrel`, `crate`,
  `flower_box`, `signpost`.
- The scene finds chimney smoke emitters by node name (`chimney_mouth` or `dark_flue`), so keep those names.
- Buildings are also reused as backdrop copies past the street, with their lamps dropped.

## Batch 3: Lantern Row, the canal town (in progress, 2026-10-02)

The user's verdict on batch 2: the render is good, but the scene is monotonous and cramped. The houses look alike, there's no air
between things, and the canal and its bridge are too small. Batch 3 rebuilds Lantern Row as a canal town that feels like a real village.
A wide canal runs through the middle of town, a market square and town hall stand on the north bank, cottages, gardens and a mill
on the south bank, and countryside and old ruins at the edges. Keep the fireflies and trees.

**Variety is the point of this batch.** Each new building should read as a different *kind* of building at a glance, through its
silhouette, roof shape, wall material and height, not just its trim. Roofs come in three families: the existing blue slate, **red clay
tile** and **thatch**. Walls add **rough fieldstone**, **red-brown brick** and **tarred or red-painted timber** to the batch-2
plaster. Add the new shared materials to `village_common.py`, with names that start `Village ` like the existing ones.
The scene may recolour placed copies by material name (for example a batch-2 house with a red-tile roof), so **keep material names
stable** once published.

### The canal contract

The scene builds the canal procedurally, and models that touch it must fit this cross-section (heights relative to the quay = 0):

- Water surface at **y = −1.0**, bed at −1.5, vertical stone quay walls. Water is **6 m wide** on the straight reaches. Quays
  (stone towpaths) at y = 0 run along both sides.
- Boats need **1.6 m** of headroom above the water under every bridge (arch soffit at y ≥ +0.6 over the navigable 3 m centre).

### Models

Envelopes are w × d in metres, front facing Blender −Y, origin at the footprint centre on the ground (y = 0 = quay or street level)
unless stated. The scene places them (`src/scenes/village/layout.ts`), so positions aren't part of the contract.

Buildings (each a distinct type):

1. **town_hall** (about 10 × 7, up to 13 m): the grandest building. Stone arcaded ground floor (open arches you can see into), a
   timber or plaster upper floor, a red-tile hipped roof, a central gable with a balcony and a small bell or clock turret, banners.
   Up to 2 lamps (under the arcade).
2. **chapel** (about 6 × 11): a fieldstone nave with a steep slate roof, a small bell tower at the front, and tall pointed windows with
   **coloured** emissive glass (deep blue, rose, gold), the scene's only stained glass. 1 lamp over the door.
3. **watch_tower** (about 4 × 4, 14–15 m): square fieldstone, tapering, with a timber hoarding/lookout on top and a lit brazier
   (`lamp_`, warm orange, large radius). It stands on the upper level at the town's edge.
4. **ruins** (about 9 × 8): a collapsed old keep or chapel with broken walls at varied heights, a broken arch, fallen rubble blocks,
   no roof. Ivy and vines as `decor_vine_*` objects draped over the tops and down the faces, in two or three greens.
5. **watermill** (about 8 × 6 *including the wheel*): fieldstone ground floor, timber upper floor, a thatch or tile roof. The wheel
   (`move_spin_wheel`, origin on the axle, radius about 1.7 m, paddles more than 0.05 m thick) sits on the building's **+X side**, hanging
   past the quay over the water. Its axle is at y ≈ +0.5, so the wheel dips below the water surface at −1.0. A wooden mill race (flume)
   feeds the top of the wheel. Lit windows, 1 lamp.
6. **smithy** (about 6 × 5): brick and timber, an **open front** with the forge visible inside: glowing coals (emissive) and a `lamp_`
   (deep orange, radius about 5 m) in the hearth, an anvil, a quench barrel, tools on the wall, and a tall brick chimney (keep the
   `chimney_mouth` name so it smokes).
7. **cottage_thatch** (about 5 × 4) and **cottage_long** (about 7 × 4.5, L-shaped or with a lean-to): low, one and a half storeys,
   fieldstone or whitewash walls, **thick rounded thatch** roofs (ridge cap, eaves at least 0.35 m deep), small deep-set windows. 1 lamp
   each at most.
8. **barn** (about 8 × 6): red-painted vertical boards, a big double door (one leaf ajar onto a dim interior), a hayloft opening with
   hay showing, a gambrel or steep roof. No lamps.
9. **market_hall** (about 7 × 4.5): an open timber hall on stone posts with a red-tile roof. Under it, two or three trestle tables with
   goods (fruit, cloth bolts, pottery). 1–2 hanging lanterns (lamps).

Waterside:

10. **bridge_stone** (about 13 long × 4.5 wide): the town's main road bridge. **Three arches**: a big centre arch over the navigable
    middle (soffit at least +0.6), two smaller side arches, cutwaters on the piers, solid parapets with coping, and a hump to about
    y = +1.3 at the crown, with ramps landing on both quays at y = 0. It spans along its own **Y** axis: water from −3 to +3, abutments
    beyond. Two lamp posts at the crown (lamps). Leave no water under it; the scene supplies the canal.
11. **footbridge** (about 8 × 1.8): a timber footbridge spanning the same 6 m, with a gentle arch, plank deck, and railings with posts
    above 0.05 m (rails may be `thin_`). It spans along Y and lands at y = 0 on both quays.
12. **rowboat** (about 3.2 × 1.3) and **barge** (about 8 × 2.2, a low cabin with a lit window, a stovepipe and a lantern `lamp_`): origin
    at the **waterline** (the scene puts it at y = −1.0), bow toward −Y.
13. **jetty** (about 4 × 2.5): timber landing stage at y = −0.55 on piles going down to the bed, with a short ladder up to the quay edge
    at local y = +1.25 (the jetty's back edge). Origin at the quay edge, deck extending toward −Y over the water. Two mooring posts.

Square, street and edges:

14. **guardian_statue** (plinth about 2 × 2, about 4.5 m tall): the town's fantasy relic in the square. A robed stone guardian holding up
    a glowing crystal (emissive, cool violet or teal, with a `lamp_` inside the crystal, radius about 6 m), weathered stone with moss
    (`decor_` greens), and runes carved into the plinth that glow faintly (emissive). It should look old and a little mysterious.
15. **wardstone** (about 2 × 2): a tall leaning runic monolith with glowing rune grooves (emissive, the same hue as the statue's
    crystal), ringed by three smaller broken standing stones. It goes inside the ruins. 1 dim lamp.
16. **Clutter**: `hay_bales` (a small stack), `woodpile` (stacked logs under a little lean-to roof), `laundry_line` (two posts and a
    `thin_` line with three or four cloth pieces as `move_sway_`), `notice_board` (a roofed board with paper notices), `market_stall_lit`
    (the batch-1 stall's look, *open*, with goods and a hanging lantern `lamp_`), `well_village` (optional: the batch-1 well is fine),
    `mooring_bollard` (iron, 0.25 m).

**Lamps.** The renderer allows 64 lamps per scene (`DEFAULT_LIMITS.lamps`), but keep authored lamps to the ones listed (a dozen or
so new ones). Every other glow is emission only.

**Budget.** About 10k triangles per building and 5k per prop, as in batch 2.

## Ground rules

- **Never touch without the user's agreement:** `src/reference/**`, `assets/cookie-factory/**`, `public/cookie_factory.glb`
  (frozen), `public/cookie_factory_current.glb`.
- **Goldens:** `golden/**` changes only through `npm run golden:update` on the work's branch (see `AGENTS.md`).
- **Dev server:** `npm run dev` serves on 127.0.0.1:5180. If it's already running, use it. Don't kill it.
