# Changelog

What changed in the renderer between versions, newest first. Games install the renderer from a tag, so this is the list to
read before moving a game to a newer one. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/). Each change goes under **Unreleased** in the same PR that makes it.
Design notes and measurements live in `docs/ROADMAP.md`.

## Unreleased

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
