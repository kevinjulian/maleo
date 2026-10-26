# Maleo shader correction

Retained source: `vello_shaders` 0.11.0 from crates.io.
Upstream: https://github.com/linebender/vello
Source directory at upstream revision: `research/vello_shaders`.
Revision: `f3000c8d9e7a9c7e6abb09b9587238bf8b4860ff`.
Registry archive SHA-256: `2e653222cee49f2571729c3e4b0fa99bc4f826c6bb9487dbb88b825d552b3a27`.
License: Apache-2.0 OR MIT. Both upstream license texts remain beside this file.

## Modification

Maleo modifies `shader/fine.wgsl`, `shader/shared/config.wgsl`,
`src/cpu/coarse.rs` and relocates the two license links in
`README.md`. Each modified source file carries a modification notice.
The medium-quality image branch computes bilinear fractions in image-local
coordinates. Integer texel coordinates then receive the atlas offset. This
prevents floating-point precision from changing with atlas placement. Neighbor
loads keep the original per-image edge clamping.

The analytic-area branch also traverses segments in canonical geometry order.
GPU path tiling assigns segment slots atomically; its order otherwise changes
floating-point sums. Geometry ordering retains the area formula and GPU
preprocessing. Selection requires O(n²) comparisons for n segments in one fill
tile. Runtime measurements must include this cost. No CPU debug mode or relaxed
byte-comparison tolerance is enabled.

The adapter also uses the previously unused two-bit image-quality value 3 for
CSS source images. It uses four-bit bilinear weights and truncates premultiplied
byte samples, matching the production CPU image sampler. Standard Vello quality
values and GPU treatment images retain their existing behavior. The Rust adapter
uses `Scene::encoding_mut`, checks the pinned image-command layout and writes
only the raw quality bits; it never constructs an invalid Rust enum.

Skia sampling source:
https://skia.googlesource.com/skia/+/fbffa6c379baefcb3669cbbd9315d09402acbc8f/src/core/SkBitmapProcState_matrixProcs.cpp
and the associated `src/opts/SkBitmapProcState_opts.h`.
Production input probes and remaining phase-edge findings are recorded under
`openspec/changes/archive/2026-10-26-p2-motion-compositing/evidence/`.

PixelPresentation and EffectsLayer solid plates opt into raw mix value 16. It rounds opacity to a byte,
scales premultiplied bytes with SkAlphaMulQ and composes with SkPMSrcOver.
Ordinary blend/filter groups keep Vello's standard arithmetic. The checked Rust
adapter writes the raw command word without constructing an invalid Rust enum.
Production pixel samples distinguish this path from floating-point opacity.
Arithmetic source: https://api.skia.org/SkColorPriv_8h_source.html

The shader and CPU coarse path keep sixteen blend levels inline, instead of
four. Supported full-frame combinations exhausted the fixed 4096-tile spill
buffer and cleared the entire frame. A renderer guard rejects deeper scenes
before submission. This trades a bounded increase in per-thread register use
for avoiding dynamic spill allocation; final hardware timings must include it.
The combined overlap/mask regression fails with the original four-level split.

Upstream `shader/fine.wgsl` SHA-256:
`efd4a38f4a6a32518b33b497789723b8f163ada361f683c2dfa3700fe8b2d68d`.
Modified SHA-256:
`1a99e921ba916f59a97447a4a8526299d1a6a22dfbd6108ca7112f5be52a1a57`.

Upstream `shader/shared/config.wgsl` SHA-256:
`357c578c1ebae530f0867e592bb7bfacc2c4425cacd8738c1c94ad66654a596f`.
Modified SHA-256:
`68a7e1ccf225b9030adc392a56889b199d90f0c63c0d828f69fbc3853220c280`.

Upstream `src/cpu/coarse.rs` SHA-256:
`ae8b2515693d23d42f4ad0ccb439702255d757e080adf267eea93eb2d3a08d36`.
Modified SHA-256:
`a1735a86ed1cf2bff53a8786d64a2bf832872b3fa102f490028476c6ef6b3cf6`.

The remaining source files, normalized Cargo manifest, build script and licenses
are retained. Registry metadata, the original workspace manifest and the
upstream lockfile are omitted. Root Cargo.toml applies the override for every
target. Root Cargo.lock owns dependency resolution. Both Rust Docker stages
copy this directory. No installed registry source is modified during builds.

## Verification and removal

Native regressions live in `crates/renderer/src/gpu.rs` and `frame.rs`:
`registered_scaled_textures_are_stable_across_reallocation` and
`blurred_text_pixels_are_stable_after_seeking`. They fail without this correction
and require exact byte equality. Keep the existing production-reference golden
thresholds, WASM build and browser/lavapipe acceptance.

Replace this override when a reviewed upstream release contains the correction
and passes those same checks. Remove the vendor directory, root Cargo patch and
Docker copies together. Record the replacement in third-party notices. Do not
edit an installed Cargo registry copy or rely on a temporary path override.
