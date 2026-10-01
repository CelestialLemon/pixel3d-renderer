# Reproducing A Short Hike's 3D pixel aesthetic

Research date: 1 October 2026. Scope: rendering research and an implementation plan. Repository observations describe the experiment before Pass 2 was added; see the experiment README for the implemented comparison.

The look combines a low-resolution 3D image with deliberate color shapes, controlled lighting, soft silhouettes, and distance fog. Pixelation provides the grid; the other choices make the image readable. The hazy distance is explained by fog suppressing contrast, rather than needing a blur across the picture.

## What the developer confirms

Adam Robinson-Yu describes the following in his [GDC postmortem](https://www.youtube.com/watch?v=ZW8gWgpptI8&t=300s). The rendering discussion is roughly 5–9 minutes; its spoken content was checked using a [mirror of the talk's captions](https://videodb.org/crafting-a-tiny-open-world-a-short-hike-postmortem/ZW8gWgpptI8).

- Render the world into a tiny Unity RenderTexture, then enlarge it with point filtering through another camera.
- Use a custom mostly unlit shader to control shadows and keep surfaces consistent. Its lighting ramp has steps and is raised toward white to preserve the original material colors.
- Use a palette sampled from Canadian Shield autumn photographs. Flat colors also allow fast UV mapping into a palette texture.
- Add fog to suppress distracting distant detail, edge detection to reveal background silhouettes, then color correction that adds blue to shadows. This is the sequence shown in the talk, not a recovered render graph.

In his own [PlayStation article](https://blog.playstation.com/2021/08/05/crafting-a-tiny-open-world-a-look-behind-the-scenes-at-the-creation-of-a-short-hike/), he separately confirms flat cohesive shading, disabled anti-aliasing, soft object outlines, and adjustable pixel size. These choices help objects remain readable with very few pixels.

His [technical thread, archived by Thread Reader](https://threadreaderapp.com/thread/1113100182655262721.html), confirms low-resolution rendering and two environment techniques: triplanar terrain mapping with the strongest terrain splatmap channel selected for sharp material boundaries, and shoreline foam based on the depth difference between water and the underlying terrain. These help the environment's graphic clarity; they are separate from screen pixelation.

The public material checked here does not establish the exact internal resolution, fog equation or density, outline kernel, production shader code, or camera-snapping method. The settings and algorithms below are proposals for our game, not claims about its implementation. There is no need to assume a fixed final-output palette, dithering, depth-of-field, or volumetric fog to reproduce the documented core look.

## Why it looks clean

Low-resolution rendering samples the scene sparsely. Small leaves, thin geometry, shiny highlights, textured surfaces, and shadows can become unrelated single pixels that flicker during movement. Broad material regions and simple light bands produce more coherent clusters of pixels.

Fog makes colors converge toward an atmospheric color with increasing depth. Between two surfaces at similar depth and fog amount `f`, their color difference is reduced approximately by `1 - f`. This quiets background texture and lighting while leaving the foreground readable. A silhouette treatment can retain the recognizable shape of a distant tree even as detail inside it disappears. That combination explains the crisp-but-hazy impression.

Soft outlines mean restrained color/contrast, not necessarily a spatially blurred line. A one-art-pixel silhouette can be crisp on the grid and still feel gentle when its color is related to the object and atmosphere. Outlining every facet or blade of grass would undermine this.

## Recommended rendering structure

This is a proposed structure for our existing custom renderer. It prioritizes predictable outline depth and lets us clean lighting speckles before fog introduces gradients.

```mermaid
flowchart LR
    A[Simple 3D geometry and broad colors] --> B[Low-resolution color / normal / depth buffers]
    B --> C[Restrained light bands and selective edges]
    C --> D[Optional surface-aware cleanup]
    D --> E[Depth fog including outline ink]
    E --> F[Color grade and output encoding]
    F --> G[Nearest-neighbor enlargement]
    G --> H[Readable HUD overlay]
```

The developer demonstrates fog followed by edge detection. Our proposed arrangement can still retain gentle distant silhouettes by giving outline ink a separately tuned fog response. A comparison against a fog-then-edge variant would resolve which treatment fits our art better. Avoid adding strong dark ink after haze without controlling its depth response.

## What this repository already provides

The shipped game uses Canvas 2D sprites, a 640×360 reference frame, CSS pixel scaling, and disabled image smoothing. See `farm-frenzy/src/engine/…` (display.ts), `farm-frenzy/src/game/…` (render.ts), and `farm-frenzy/src/main.ts`. It has no 3D depth buffer. A full transition to this rendering style would require a new world presentation layer, projection/picking, and assets; it is not a post-processing toggle for the current sprite game.

The separate [renderer project](../README.md) is the appropriate place to test the style:

| Component | Current experiment | Suggested direction |
| --- | --- | --- |
| Pixel grid | Low-resolution GPU buffers, nearest filtering, CSS enlargement | Retain; compare a few internal resolutions at the same framing |
| Materials | Base-color clustering and six ramp entries including ink | Compare fewer visible light bands and brighter shadow floor |
| Edges | Depth silhouettes, normal/depth crease heuristics | Retain selected silhouettes; soften ink and fade internal creases with depth |
| Atmosphere | Sky gradient and cloud shadows; no distance fog | Add depth-controlled haze matched to the horizon color |
| Dither | Restricted ordered dithering | Start with it off while establishing flat shapes and haze |
| Camera | Orthographic camera with view-grid snapping | Retain for panning; evaluate rotation and zoom separately |
| Cleanup | Surface-aware neighbor replacement | Optional; run before fog or compare its effect carefully |

These findings come from source inspection, not a new visual or performance benchmark. Main extension points are [pipeline.ts](../src/pass1/pipeline.ts), [main.ts](../src/main.ts), and [scene.ts](../src/scene.ts).

## Adding haze correctly

Our G-buffer already stores **linear camera-space depth** as `gNormal.w`: the vertex shader uses `-vp.z`. This is suitable for a depth fog calculation and avoids decoding hardware depth. Its world-position reconstruction is specific to the orthographic projection.

The camera is positioned 100 units from its focus. An initial focus-relative fog range could start five units behind that focus and become full thirty units behind it: camera depths 105 to 130. Those are illustrative tuning values, not measured defaults. The small existing meadow may need a much shorter range, and a convincing test requires scenery placed at several depths. Keep the near/far relationship valid and update the reference if the camera placement changes.

Conceptual GLSL for the current depth convention:

```glsl
// All colors are linear RGB here. uFocusDepth follows camera placement.
float fogAmount(float viewDepth) {
    float relativeDepth = viewDepth - uFocusDepth;
    return smoothstep(uFogStart, uFogEnd, relativeDepth);
}

vec3 applyFog(vec3 colorLinear, float viewDepth) {
    return mix(colorLinear, uFogColorLinear, fogAmount(viewDepth));
}

// Ordinary surface:
vec3 finalLinear = applyFog(shadedColorLinear, nd.w);
// Encode to sRGB once, after the final fog/grade operation.
```

Here `uFogStart=5`, `uFogEnd=30`, and `uFocusDepth=100` produce the example range. A smoothstep blend is a practical art control; [Three.js r180's fog shader](https://github.com/mrdoob/three.js/blob/r180/src/renderers/shaders/ShaderChunk/fog_fragment.glsl.js) uses smoothstep for its near/far fog and an exponential-squared alternative. It does not establish which curve A Short Hike uses.

Specific integration details:

1. **Account for the outline's depth.** The silhouette branch paints onto a neighboring background pixel and returns early. It tracks the outlined object's depth in `bestD`. Fog that ink with `bestD`, not the sky/background depth. If fog is a later pass, carry an effective depth for painted outline pixels into that pass.
2. **Keep every output path coherent.** Both the silhouette return and the ordinary surface output need fog coverage. Leave the sky governed by its own gradient, with fog color matched to the horizon. Handle any future transparent water and particles consistently; opaque G-buffer depth alone cannot describe all transparent layers.
3. **Blend before display encoding.** The current post shader applies `toSRGB` before writing its stylized image; its cleanup then copies encoded values. A separate fog pass must decode that image first or the pipeline must retain linear values until the final output. A direct fog insertion into the post shader is simpler for a first comparison.
4. **Avoid fighting cleanup.** Cleanup currently matches nearly identical neighboring colors. Fog added before that pass changes those comparisons and may reduce cleanup's effectiveness. Test with cleanup disabled first; a later, properly encoded fog pass can preserve its original behavior.
5. **Use explicit uniforms.** Setting `scene.fog` alone will not add fog to this custom post shader. [ShaderMaterial documentation](https://threejs.org/docs/pages/ShaderMaterial.html) describes the required custom fog support. Applying fog in the lighting post pass also avoids corrupting the G-buffer's albedo or depth data.
6. **Keep haze smooth initially.** Requantizing fog to a tiny final palette can create bands; heavy dithering can reintroduce speckles. We can retain palette-based materials while allowing atmospheric blends. If strict Resurrect 64 output remains a requirement for integration into the sprite game, author dedicated atmospheric ramps and evaluate that additional constraint separately.

## Pixel stability and asset design

Start comparison captures at 320×180, 480×270, and 640×360, holding geometry and camera composition fixed. These are suggested test resolutions. Integer enlargement is the cleanest display case; if a window cannot fit it, choose a documented crop/letterbox or accept uneven physical pixel widths. Account for device pixel ratio when promising physical-pixel-perfect scaling. Screen resizing should not silently change the intended detail budget without a deliberate policy.

The experiment already snaps its orthographic camera to a view-aligned grid with world-units-per-pixel equal to `viewHeight / internalHeight`. This helps translation, but cannot eliminate resampling during rotation, zoom, or independent object motion. [David Holland's implementation write-up](https://www.davidhol.land/articles/3d-pixel-art-rendering/) documents camera snapping and an optional presentation offset for smoother motion; this is a separate implementation reference, not evidence that A Short Hike uses either technique.

Design models at their actual projected size. Group foliage into broad masses, ensure animals and products have recognizable silhouettes, avoid thin high-contrast detail, and keep material colors distinct enough for small objects. If using surface textures, choose minification/mipmaps deliberately to reduce distant shimmer; nearest filtering of the final image does not require nearest/no-mipmap sampling for every source texture.

## Practical implementation sequence

1. Add a separate atmosphere comparison mode to the experiment with near, middle, and distant scenery. Preserve its existing before/after benchmark. Include fog toggle, start/end controls, fog color, and restrained outline intensity.
2. Add fog to both surface and silhouette outputs, using the object's effective depth. First compare with dither and cleanup off, then re-enable them individually. Reduce crease contrast and material light-band complexity only when the captures justify it.
3. Compare fogged ink against a fog-then-edge treatment, checking that far shapes stay readable without competing with near gameplay objects. Capture several zoom levels, angles, and panning motions; a still screenshot cannot establish temporal stability.
4. Verify pixel scaling on desktop and high-DPI/mobile displays; check shader errors, clear sky, fog disable parity, near/far ordering, focus tracking, transparent effects when added, and preservation of small foreground items. Measure GPU cost on target hardware before choosing a production pipeline.
5. Once the style is approved visually, decide between baking improved 3D assets into sprites for the current game or replacing its world rendering with live 3D. Baking helps consistent sprite art but cannot reproduce dynamic camera-depth atmosphere by itself. Keep game simulation separate from the presentation change.

The most useful next experiment is controlled distance fog with depth-aware soft silhouettes. The existing renderer already supplies much of the infrastructure; the visual gains will also depend on scenery depth and simpler, intentional color shapes.
