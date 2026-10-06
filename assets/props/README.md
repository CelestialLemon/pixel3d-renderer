# Renderer prop sources

Each folder contains a deterministic `build.py`, an inspected Workbench `preview.png`, and `metadata.json` with metre dimensions and evaluated triangle counts. Public runtime assets are `public/props/<id>.glb`.

```sh
/opt/homebrew/bin/blender -b --python assets/props/street_lamp/build.py
node assets/props/build-all.mjs --verify
node assets/props/validate.mjs
node assets/props/gallery-check.mjs
```

`common.py` owns shared mesh helpers, ground/centering/triangle checks, GLB export and preview framing. `lamp_model.py` builds the matching warm/cool lamp variants. GLBs have material base colours, normals, emission and lamp extras, with no textures, UVs, cameras or lights. Preview cameras are created **after** export. Workbench previews show shapes and material colours; they do not show the renderer's emission or lamp pools.

Cart wheel assemblies export several material primitives below a `move_spin_wheel_*` node. The twenty `thin_spoke_*` children share their wheel's axle origin. Blender wheel axes are local X (also X after Y-up export); future spin motion should rotate about that axis. The fence set is nearly 8 m wide, so its gallery slot needs more width than the other initial props.

Assets deliberately called `thin_*` have sub-pixel features for flicker checks. Read `docs/ASSET_BRIEF.md` for the agreed scene-import naming contract.

`build-all.mjs` launches one fresh Blender process per prop; `--verify` checks exported GLBs against their SHA-256 before rebuilding. Set `BLENDER_PATH` to override the executable. `validate.mjs` checks exported triangles through Three's GLTFLoader, including ground/centering, material/UV contract, lamp extras, wheel children, windmill shaft orientation, open bridge arch and hollow well.

Spheres use explicit latitude topology because Blender's UV-sphere pole welding can reorder faces and float normal accumulation. After export, the helper also canonicalizes each primitive's triangle index order, preserving winding and vertex data. This keeps GLBs reproducible and their palette input order stable.

The gallery is `http://127.0.0.1:5180/pass3.html?scene=props`. `gallery-check.mjs` uses the existing headless capture helpers and requires that dev server. It records a fixed clock, every prop at game scale, selected close-ups and night lamps/shop into the ignored `review/` folder; browser, shader and asset-load errors fail the check. Pass one or more prop IDs to capture a subset. The studio preview hides `glass_*` after export to match the runtime's see-through rule.

## Batch 1 catalogue

| ID | Triangles | Diagnostic purpose |
| --- | ---: | --- |
| street_lamp | 608 | Thin solid post, warm emission and lamp pool |
| street_lamp_cool | 608 | Matching geometry with cool emission and blue lamp metadata |
| fence_set | 1,802 | .08 m pickets versus .03 m iron bars and rope; overlapping silhouettes |
| cart | 3,684 | Curved rims, .03 m spokes, cargo overlap, authored wheel pivots |
| market_stall | 4,620 | Overhang shadow, coral/cranberry stripes, saturated fruit |
| stone_arch_bridge | 1,282 | Solid curved deck over an open tunnel and a water surface |
| well | 2,460 | Hollow interior, ring creases, thin rope, roof occlusion |
| metal_props | 4,156 | Copper, dark iron, brass and pale steel; smooth curved shading |
| villagers | 4,112 | Four skin tones, clothing contrast and small human silhouettes |
| shop_front | 2,020 | Visible stocked interior, emissive back wall, lamp and sign pivot |
| telegraph_pole | 2,728 | Three .02 m sagging wires and overlapping depth |
| windmill | 1,184 | Large four-sail assembly, local-X shaft and thin lattice children |
| snow_hut | 2,542 | White-on-white contrast, cold shadow colours and a rounded snowman |

Total: **31,806 triangles**, excluding the gallery floor. Runtime assets occupy about 1.2 MB combined. `move_*` names and origins author motion for a future renderer mode; these models remain static in the current gallery. Metallic properties are likewise authored but currently ignored by the renderer.

Inspection found distinct awning stripes, visible produce, readable villager heads/hands and separate warm/cool luminous panes. Thin wires exposed broken segments at game scale, and the night captures showed warm-only lamp pools and light reaching the shop roof through solid geometry. All three were fixed in the renderer on 2026-10-01 (the thin-feature resolve, per-lamp colour, and occluded lamp light); see `docs/ROADMAP.md` section 1.
