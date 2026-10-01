# Thin features: supersampled G-buffer with a coherent resolve

This is the default since 2026-10-01. It implements option 1 of roadmap §2, combined with the authored `thin_` rule (option 4).

**The problem.** A feature thinner than an art pixel only shows when a pixel centre happens to land on it, so as the camera moves,
wires, rails and slats break into dots and flicker.

**What the renderer does now.** `PixelRenderer` rasterises the G-buffer and the sun-shadow mask at 3×3 samples per art pixel
(`supersample = 3`). A resolve pass (`src/renderer/shaders/resolve.ts`) then reduces each block of 9 to one coherent sample, and the
post shader reads that sample unchanged.

## Resolve rules

1. **Group the 9 samples into surfaces.** Samples belong to the same surface when they have the same flag, the same albedo, and
   lie on one plane within `0.004 + 0.1 × texel`. Albedo alone is not an object id: palette colours repeat, and two slabs of one
   colour a few cm apart must stay separate.
2. **Pick the winner.** The surface with the most samples wins; ties go to the nearer one.
3. **Keep thin-marked surfaces visible.** A surface carrying the **thin mark** wins with 2 of 9 samples, provided it lies clearly in
   front of the majority surface's plane (by more than `max(0.10, 3 × texel)`).
   - Unmarked surfaces never get this priority, so the gaps between fence slats survive the way they do under majority.
4. **Emit one real sample.** The output is the winner's sample nearest the pixel centre. Its depth is moved along the surface's own
   plane to the pixel centre, so the post shader's `worldAt()` stays exact. Because S is odd, a surface interior keeps the same
   centre sample it had at S = 1.

The Bayer discard threshold (smoke, fireflies) uses the art-pixel coordinate, so all 9 sub-samples share one threshold.

## The thin mark

`thin(flag)` in `src/renderer/flags.ts` adds 0.25 to a flag, and the G-buffer alpha keeps the fraction. Every shader that rounds the
flag (`flagOf`) ignores the mark, and so does the palette key.

The mark is applied to:
- glTF meshes named `thin_*`: `MeshRule.thin`, set by `namedMeshRule`. The material's own flag, emissive included, is kept.
- test-chart rods, wires and thin-bay poles under 0.05 m: `thinIf` in `src/scenes/test-chart/kit.ts`.

The asset rule is in `docs/ASSET_BRIEF.md`.

## Measuring

`npm run thin-check -- [frames=16] [stepDeg=0.25] [query]`, for example `npm run thin-check -- 16 0.25 "zoom=20"`.

The tool samples 40 points along every rail and pole of the thin bay (8 widths, 0.02–0.16 m) over small orbit steps, reading
`PixelRenderer.readAlbedo()`:
- **gap** is the share of samples where the feature is missing.
- **toggle** is the share that appear or disappear between consecutive frames, i.e. flicker.

Results at zoom 20 (texel 0.075 m):

| mode (query) | gap % | toggle % |
|---|---|---|
| `ss=1` (one centre sample) | 16.9 | 23.1 |
| `resolve=majority` | 19.3 | 12.6 |
| **default** (`resolve=thin`) | **2.6** | **3.8** |

Fence-gap audit (Sol: 21 slits × 12 heights, share of slits that stay open / toggle %):

| zoom | `ss=1` | majority and default |
|---|---|---|
| 14 | 82.9 / 34.0 | 76.3 / 41.3 |
| 20 | 54.7 / 84.2 | 40.2 / 58.5 |

`resolve=near` and `near3` apply near-priority to every surface, so they close almost every slit. They are kept for comparison only.

## Trade-offs and limits

- **Lost gaps.** Some background gaps of about 1 px are lost. The user accepted this for the stability.
- **Cost.** G-buffer fill rises 9× (400×267 → 1200×801), and memory is ≈ 31 MB of extra targets. On SwiftShader, Cookie Co. went
  from 62 to 130 ms per frame. It has not been measured on a real GPU.
- **Unmarked features near the width limit.** Unmarked features at about 0.05 m (the edge of the `thin_` rule) still toggle about
  13% at zoom 20.
- **Features under 1/3 px.** Below one third of a pixel there is nothing left to resolve. That needs minimum-width expansion for
  `thin_` meshes (roadmap §2, option 2).
