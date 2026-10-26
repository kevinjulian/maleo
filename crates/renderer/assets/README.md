# Constant grain tile

`grain.rgba` is the 200×200 straight-alpha RGBA raster of StoryboardScene's
constant SVG background. It preserves the source fractal-noise filter without
adding an SVG interpreter. Opacity and overlay blending remain draw-time rules.

Generated with Chromium 149.0.7790.0 and Remotion 4.0.462 in production image
`sha256:146ade4131420726457fe0540d63093764ed12122f82aca179be8e68c333a691`.
SHA-256: `cf02b27f327405141fa315a4a5408dfad2778e706d150cec8aab9a4a5bb70568`.

Run `packages/video/scripts/render-renderer-grain.ts` in that image with the
renderer asset directory mounted writable and both grain scripts plus current
StoryboardScene source mounted at their repository paths. The entry reads
`GRAIN_STYLE` directly. Regenerate and review grain goldens when that style or
production browser changes. The raster is synthetic source data, not user media.
