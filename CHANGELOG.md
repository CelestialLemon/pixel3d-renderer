# Changelog

What changed in the renderer between versions, newest first. Games install the renderer from a tag, so this is the list to
read before moving a game to a newer one. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/). Each change goes under **Unreleased** in the same PR that makes it.
Design notes and measurements live in `docs/ROADMAP.md`.

## Unreleased

### Fixed

- **Empty batch meshes are no longer submitted to three.js** ([#57](https://github.com/CelestialLemon/pixel3d-renderer/issues/57)).
  Each batch has four sibling meshes (casting × mirrored), most with no instances, and three still set up their program and
  vertex array before skipping the draw. `poseObjects` now hides a mesh (and its glass twin) while its count is 0, and the
  shadow-mask pass restores only the populated ones. Output is bit-identical; the CPU cost of `renderGeometry` drops by about
  half in a scene with hundreds of batches.

## 0.5.0 (2026-10-26)

### Added

- **Glass** ([#54](https://github.com/CelestialLemon/pixel3d-renderer/issues/54)). Panes you see through that are still
  visibly there. `FLAG.GLASS` marks a surface as glass, and `glassMeshRule` (a `collectGltf` rule, like `namedMeshRule`) turns
  `glass_` meshes into it instead of skipping them. `namedMeshRule` itself is unchanged and still skips `glass_`, so scenes
  that model windows that way draw exactly what they did.
  - Glass works in a scene's static geometry and in an object's geometry (`addObject`): the renderer splits the glass triangles
    out (`splitGlass`, also exported), so a game builds one geometry for the whole building, glass included. Glass casts no sun or
    lamp shadow, is left out of the lamp, window and fluid maps, and is never picked: a click goes to what is behind it.
  - Drawn in its own pass at art resolution (the nearest pane at each pixel, hidden by hand behind anything nearer, as for
    fluids), and laid over the finished image in the clean-up pass, so what is behind it (the frame's shadows, the crop inside,
    a lit interior) shows through unchanged. A pane gets a flat tint of its colour, a lighter rim where it ends at a bar or the
    edge of the roof or turns a corner, and thin diagonal glints on faces that look up. By night the tint and light follow the
    scene's `night`.
  - It takes the object's `tint`/`tintStrength` like any surface, so a roof whitened for snow whitens its glass too (a pane
    tinted towards white turns nearly opaque), and `opacity` thins it out by the same dither. It follows `visible`, snapping,
    mirroring and an object's motion attributes.
  - Costs: one more draw per batch with glass (sharing the batch's instance data) and an art-resolution target, allocated only
    while glass is drawn. A scene or frame without glass draws exactly what it did.
  - Model it with the panes between bars standing slightly proud of them (the frame in front hides the glass behind it, and so
    do bars flush with it, within 2 mm) and `glass_` meshes of one colour per material. Glass can't have ambient motion (`collectGltf`
    throws). Glass behind water is not hidden by it; glass in the dynamic collector is not supported.
  - Demo: `?scene=glass` (greenhouses, one under snow, one mirrored, one with a lit lantern). `npm run glass-check`. Three golden views.

## 0.4.0 (2026-10-23)

### Added

- **Runtime fluids: floods and ice** ([#50](https://github.com/CelestialLemon/pixel3d-renderer/issues/50)).
  `PixelRenderer.addFluid(material)` returns a `PixelFluid`: a layer of water the game adds, changes and removes while it plays,
  drawn with the scene's own fluids (it mirrors, shows the bed, takes lamps and hides behind the opaque world like them).
  - `setCells({ x, z, cell, cols, rows, heights }, flow?)`: a grid of square cells, each with a surface height (NaN: none), which
    is what a tile game has; runs of neighbouring cells at one height become one rectangle. `setGeometry(geometry, flow?)` takes
    any triangles in world space; `clear()` empties the layer. Change the surfaces when the shape changes (a few times a minute).
  - `y` (metres, added to every surface), `visible` and `material` are cheap and read each frame: a flood's level is `y`, and
    ground higher than it hides it by the usual depth test, so the shore follows the terrain. `remove()` takes the layer out.
  - `FLUIDS.flood` (silty brown water) and `FLUIDS.ice`. `FluidMaterial.frozen` (default 0) marks ice: motionless, no ripples,
    foam, glints or stirring, with a fixed pattern of streaks and cracks. Freezing the river is a second layer of ice cells a hair
    (at least 2 cm) above the baked water, shown and hidden or grown from the banks; or a layer's `material` changed to ice.
  - A layer takes a slot in the shader's table of fluid materials, shared with the scene's (`limits.fluidMaterials`, default 8);
    one more than fits throws a `RangeError` and changes nothing. A layer does not use the baked flow map: its current is the
    `flow` it is given, with no foam along banks.
  - A scene with no fluids of its own gets the fluid targets while a layer is drawn and frees them after, so its image is exactly
    what it was. The defaults draw exactly what earlier versions drew.
  - Demo: `?scene=floodplain` with `?flood=0..1`, `?ice=0..1` and `?cycle=1`. Two golden views.

- **Haze** ([#49](https://github.com/CelestialLemon/pixel3d-renderer/issues/49)). Three more fields of `Weather`, set with
  `setWeather` like the rest: `haze` (0 to 1, default 0: none; about 0.3 a thin mist, 0.6 a fog, 1 the thickest), `hazeColor`
  (sRGB hex, default `0xcfd6d8`: a cool grey for fog, a warm brown such as `0xc49a62` for dust) and `hazeTop` (the world height
  in metres where the layer ends, default 4). The defaults draw exactly what earlier versions drew.
  - It is a layer of fog lying on the ground. Under the orthographic camera the length of a view ray inside such a layer depends
    only on the height of the surface it ends on, so flat ground is veiled evenly with no depth step across it (the seam the
    renderer's old comment warned about) while roofs, tree tops and silos rise out of it, a wall clearing from its foot to its
    top. Drifting world-space patches give it structure.
  - Drawn in up to five clean steps, ragged where one meets the next (the sky's ordered dither), so it stays pixel art. A surface
    keeps at least a fifth of its own colour under the thickest haze, so it never hides the farm. The colour darkens at night.
    Water gets the same veil at its own surface; the sky and self-lit sparks (fireflies) are not hazed. Ease `haze` down over a morning to make a fog lift, and
    lower `hazeTop` to lift it off the ground.
  - Out-of-range values throw a `RangeError` and change nothing.
  - Demo: the Weather panel in `pass3.html` and `?haze=&hazeColor=&hazeTop=` (colour as hex, e.g. `c49a62`). Two golden views.

## 0.3.4 (2026-10-22)

### Added

- **Weather** ([#44](https://github.com/CelestialLemon/pixel3d-renderer/issues/44),
  [#45](https://github.com/CelestialLemon/pixel3d-renderer/issues/45),
  [#46](https://github.com/CelestialLemon/pixel3d-renderer/issues/46)). `PixelRenderer.setWeather(change)` sets any of the
  fields of a `Weather`; `PixelRenderer.weather` reads it back and `DEFAULT_WEATHER` holds the defaults, which draw exactly what
  earlier versions drew.
  - `precipitation` (`'none'`, `'rain'` or `'snow'`) and `intensity` (0 to 1: about 0.2 a light shower, 0.5 steady rain,
    1 a heavy storm or blizzard). Falling rain and snow drawn per art pixel over the finished image: small streaks and flakes,
    sparse enough to keep the farm in view (at most about 4% of the pixels), hidden behind anything nearer (water surfaces included) and ending at the
    ground, with splashes on the ground in rain. Driven only by the `renderStyle` clock, so a frozen clock freezes it.
  - `cloudCover` (0 clear to 1 overcast, default 0.2: the old cloud shadows) and `cloudSpeed` (0 to 10 times the old drift).
    Changing the speed never makes the clouds jump.
  - `wind` (0 to 3, default 0: a steady lean downwind) and `gusts` (0 to 3, default 1: the old gusts) for everything that
    sways (`motion.sway`), in the baked scene and on objects. Wind also slants the rain and snow.
  - A value out of range throws a `RangeError` and changes nothing.
  - Demo: the Weather panel in `pass3.html`, and `?precip=&intensity=&cover=&cloudSpeed=&wind=&gusts=`. Three golden views.

## 0.3.3 (2026-10-17)

### Fixed

- **Gentle terrain folds** ([#41](https://github.com/CelestialLemon/pixel3d-renderer/issues/41)). Outline ink and contact
  darkening tolerate shallow joined geometric planes, including diagonal folds in 1 m tiles with 0.25 m corner steps.
  Lighting stays smooth; sharp creases, silhouettes, separate objects and offset parallel surfaces retain their depth effects.

## 0.3.2 (2026-10-17)

### Fixed

- **Smooth terrain depth prediction** ([#38](https://github.com/CelestialLemon/pixel3d-renderer/issues/38)). Outlines,
  contact darkening, creases, dither plane tests and highlight rims use the rasterized triangle's geometric plane instead
  of its interpolated shading normal. The thin-feature resolve uses that plane too, including depth reconstruction for
  picking. Lighting and picked normals keep the smooth shading normals. Faceted terrain keeps the same rendered appearance.

## 0.3.1 (2026-10-17)

### Fixed

- **Repeated geometry in palette reduction** ([#35](https://github.com/CelestialLemon/pixel3d-renderer/issues/35)).
  `quantizePalette` counts and recolours each geometry once, even when the input array contains it more than once, avoiding
  a crash and keeping surface-area weighting consistent with a deduplicated input.

## 0.3.0 (2026-10-09)

### Added

- **Per-object tint** ([#30](https://github.com/CelestialLemon/pixel3d-renderer/issues/30)). `PixelObject.tint` (a
  `THREE.Color`, or null for none, the default) and `PixelObject.tintStrength` (0 to 1, default 0.5) mix the object's surface
  colours towards the tint in linear RGB: `mix(colour, tint, strength)`. The mixed colour goes through the same shading ramps
  as any other, so a tinted object keeps the pixel look. Per object, so one of many copies of a geometry can be tinted alone.
  For build previews, selected or unpowered buildings, and ground overlays (fertility, power coverage) without one geometry per
  colour band.
  - The tint is read at each `renderGeometry`, so it can be changed in place (`o.tint.set(...)`). It is stored at 8 bits per
    channel (sRGB) and the strength at 8 bits.
  - `tintStrength` outside 0 to 1 (or NaN) throws a `RangeError` and changes nothing.
- **Per-object dithered opacity** ([#30](https://github.com/CelestialLemon/pixel3d-renderer/issues/30)).
  `PixelObject.opacity` (0 to 1, default 1) draws the object see-through with ordered-dither discard, like the renderer's
  other transparency: a 4 x 4 pattern per art pixel, so 16 visible steps. Outside 0 to 1 it throws a `RangeError`.
  - Below 1, the object casts no sun shadow and `pick` sees through it: it returns the surface (and object) behind, or the sky.
    The pick then renders the last frame again, without the see-through objects, into the 4 x 4 block of art pixels around the
    point, at the same supersampling and through the same resolve, so it finds exactly what a frame without them would show;
    only picks that land on a see-through object pay for it. At 0 the object is not drawn at all.
  - Where the dither drops a pixel, the shadow mask is the surface behind, as in the G-buffer.
- **Objects that cast no sun shadow** ([#31](https://github.com/CelestialLemon/pixel3d-renderer/issues/31)).
  `PixelObject.castShadow` (default true). An object with `castShadow = false` still receives shadows, but it is left out of
  the object shadow map, so moving it (or spinning parts on it) never redraws that map. For many small moving things: items on
  belts, drones, build previews. Turning it on or off redraws the map once.
  - Measured with `node tools/object-bench.ts` (new second part, the full `addObject` path, see `docs/ROADMAP.md`).
- Demo: `?scene=object-looks` (fertility-tinted soil, selected and unpowered workshops, see-through build previews, a belt of
  crates that cast no shadow), with two golden views.

### Changed

- Opaque, untinted objects draw exactly as before. Internally each object batch now has four instanced meshes (casting or not,
  mirrored or not) instead of two, and uploads only the instances it draws each frame.

## 0.2.0 (2026-10-08)

### Added

- **Object highlight** ([#22](https://github.com/CelestialLemon/pixel3d-renderer/issues/22)). Set `PixelObject.highlight = true`
  to draw a pale one-pixel rim around the visible part of an object and lift its surfaces one band, e.g. while the pointer is
  over it (find it with `pick`).
  - It applies per object, so one of many copies of a geometry can be highlighted on its own.
  - The rim is drawn outside the object against the sky, the ground and anything clearly behind it. It is drawn inside the object
    where something nearer covers it or another object touches it, so it never paints over an occluder or a touching copy.
    Hidden parts show no rim.
  - At most `MAX_HIGHLIGHTS` (4) objects can be highlighted at once. Turning on a fifth throws a `RangeError` and changes nothing.
    A removed object loses its highlight, and setting it again on that object does nothing.
  - Changing which object is highlighted is a uniform write and needs no `renderGeometry`. With nothing highlighted, the shaders
    skip the highlight code entirely. The first highlight compiles the post and clean-up shaders' highlight variants once
    (about 1.8 s under SwiftShader). After that, switching between none and some reuses them. A game that highlights should
    set the new `PixelRendererOptions.warmHighlight: true`, which compiles them in the background once the renderer has objects.
  - Demo: hover an object in `?scene=objects`.
- **Ambient motion on objects** ([#23](https://github.com/CelestialLemon/pixel3d-renderer/issues/23)). An object geometry built
  with `new GeometryCollector(true)` and a `motion.*` per part, with anchors in the object's local space, is animated from the
  `renderGeometry` clock like the baked dynamic mesh. It stays instanced, and `pick` and `highlight` work on it as before.
  - Motion follows each object's transform. Spin, swing and conveyor turn with the object. Smoke, butterflies and fireflies leave
    from the placed anchor and drift in world space, so smoke rises straight up from a turned machine. Sway leans with the world
    wind, sampled at the object's base. A mirrored object's puffs and wings are mirrored too.
  - Each object runs on its own clock, shifted by a hash of its id, so copies of one geometry don't move in lockstep.
  - Spin and swing parts cast and receive sun shadows at their pose; while one is visible, the object shadow map redraws whenever
    the clock moves. Sway casts at rest. Conveyor items, smoke and wings cast none.
  - Objects without `aMode`/`aAnchor`/`aAnim` render exactly as before. `addObject` throws on a partial or wrongly sized set.
  - Demo: `?scene=objects-motion`.

### Fixed

- **Blank canvas on Windows Chrome (Direct3D 11)** ([#27](https://github.com/CelestialLemon/pixel3d-renderer/issues/27)). The
  post shader failed to compile under ANGLE's Direct3D 11 backend, so every frame failed and the canvas stayed white. Lamp
  shadows built their cube-face vectors with constructors mixing a float and int literals (`vec3(sign(v.x), 0, 0)`), which the
  HLSL compiler rejects as an ambiguous call. They now use float literals; output on other backends is unchanged. A unit test
  (`test/glsl.test.ts`) now rejects such constructors in the renderer's shaders.

## 0.1.0 (2026-10-06)

The first version a game can install (Phase 1 in `docs/ROADMAP.md`).

### Added

- **Dynamic objects.** `addObject(geometry)` returns a `PixelObject` that the game moves (`setTransform`, or by writing
  `position`/`quaternion`/`scale`), hides (`visible`) and removes (`remove()`). Copies of one geometry are instanced, origins are
  snapped to the art-pixel grid (`snap`), and objects cast sun shadows.
- **Picking.** `pick(clientX, clientY)` and `pickPixel(x, y)` return the art pixel, the world position and normal of the surface
  there, and the `PixelObject` drawn there.
- **Game-supplied settings.** A game can supply its own day cycle (`dayCycle(keys, presets)`), renderer limits, supersampling,
  resolve policy and shadow map sizes (`PixelRendererOptions`), and palette size.
- **Baked scenes** (`npm run bake`) for a faster start, with a staleness check against the scene and renderer sources.
- **Package.** `src/renderer/index.ts` is the public API, built with `npm run build:lib`.
- **Example game,** `examples/walker/` (`npm run example`).
