# Asset brief: models for testing the renderer

Who this is for: whichever agent builds 3D models in this workspace (usually **Sol**). **Opus** (the renderer agent) maintains this
file. To change a rule, propose it on `docs/BOARD.md` first, so neither side is surprised.

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
| `water_` | Water surface (animated ripples and sparkles). Must be a flat, upward-facing surface. |
| `glass_` | Window glass. For now it is skipped (see-through). Put the lit interior *behind* it. |
| `thin_` | Deliberately thinner than 0.05 m (wires, spokes, railings): a flicker-test feature. |
| `move_<kind>_` | A part meant to move later (`move_spin_` sails/wheels, `move_sway_` cloth/signs). Make it a separate object with its **origin at the pivot**. |
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
`assets/props/<name>/preview.png`, look at it yourself, then post on the board.

## Batch 2: Lantern Row (done, 2026-10-02)

The models of the night village scene (`?scene=village`), one folder each under `assets/village/<id>/`, exported to
`public/village/<id>.glb`, with shared materials in `assets/village/village_common.py` and `architecture.py`. Validate them with
`node assets/village/validate.mjs`. Each building is built to a footprint (`BUILDINGS` in `src/scenes/village/layout.ts`): the envelope
includes eaves, steps, signs and fixtures, the origin is the footprint centre on the ground, and the front faces Blender −Y. The scene
turns and places them, so a model can move without a re-export.

- Buildings: `house_A`–`house_E`, `tavern` (two facades, rose `move_sway_` sign), `clock_tower`, `bakery`, `stair_arch` (gateway, 1.9 m
  clear opening). About 2 `lamp_` empties per building at most; other lit windows are emission only.
- Square and street: `fountain` (teal lamp), `closed_stall`, `festoon` (emissive bulbs, no lamps), `bench`, `barrel`, `crate`,
  `flower_box`, `signpost`.
- The scene finds chimney smoke emitters by node name (`chimney_mouth` or `dark_flue`), so keep those names.
- Buildings are also reused as backdrop copies past the street, with their lamps dropped.

## Ownership (to avoid editing each other's files)

Ownership is agreed on `docs/BOARD.md` at the start of each piece of work. These are the defaults for modelling work:

- **The modelling agent owns:** `assets/props/**`, `assets/village/**`, `assets/<future-scene>/**`, `public/props/**`, `public/village/**`.
- **The renderer agent owns:** `src/**`, `tools/**`, `index.html`, `pass*.html`, `docs/ROADMAP.md`, this brief.
- **Never touch without agreement:** `src/reference/**`, `assets/cookie-factory/**`, `public/cookie_factory.glb` (frozen),
  `public/cookie_factory_current.glb`, `golden/**`.
- **Shared:** `docs/BOARD.md` (append only, never committed with posts in it).
- **Git:** nobody commits, pushes or branches unless the user says so for that piece of work (see the board's rules). Don't run
  `git checkout`/`reset`/`clean`/`stash` either: the other agent's uncommitted work lives in the same tree.
- **Dev server:** `npm run dev` serves on 127.0.0.1:5180. If it's already running, use it. Don't kill it.
