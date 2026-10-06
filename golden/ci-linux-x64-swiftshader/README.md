These ten CI references were generated from known-good main `f2b0945` on Linux x64 with the pinned Chromium build `1710741` (Chrome 157.0.8086.0), using ANGLE SwiftShader. Only `tools/golden.ts` was changed in the detached baseline checkout, to select these views and prefix their output directory with `ci-`; its renderer, scenes, assets and shaders were unchanged.

The set covers the frozen Pass 0 and Pass 1 comparisons, current comparison, Cookie Co. noon/night, village canal and fountain, fluids by day, and rigid objects at night. It uses the normal 1440×900 viewport and frozen clock/camera queries. The complete 42-view GPU sets are separate.

Run a dev server, then `GL_BACKEND=swiftshader npm run golden -- --ci`. Any pixel difference fails; there is no tolerance. Browser changes or deliberate visual changes require regeneration from a known-good commit on a work branch and review through a PR.
