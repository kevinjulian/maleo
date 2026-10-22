# Tasks

## 1. Setup

- [x] 1.1 Install the Android SDK (command-line tools, one emulator image for `arm64-v8a`) and confirm `adb devices` lists a running emulator and `xcrun simctl list devices booted` lists a booted iOS simulator.
  - Proof: SDK was already installed at `~/Library/Android/sdk` (emulator 34.2, NDK 27.3, `android-35` `google_apis_playstore` arm64-v8a image, AVD `Pixel_Fold_API_35`). `adb devices` lists `emulator-5554 device`; `xcrun simctl list devices booted` lists `iPhone 16 Pro (Booted)` on iOS 18.3.
- [x] 1.2 Create `spikes/` with one `README.md` that states the directory holds throwaway P0 proof code outside the Cargo workspace and CI, and confirm `cargo metadata --no-deps` at the root lists only `crates/editor-core` and `crates/editor-wasm`.
  - Proof: `cargo metadata --no-deps` lists `maleo-editor-core` and `maleo-editor-wasm` only.
- [x] 1.3 Add a `spikes/` row to the `AGENTS.md` workspace map and confirm `bun run check:references` passes.
  - Proof: `bun run check:references`: ok.

## 2. Server-independent ADRs

- [x] 2.1 Write `docs/decisions/0007-clients-keep-a-local-sqlite-store.md` (Context, Decision, Consequences) that scopes ADR 0005 to servers and cites the client reasons (iOS, browser, embedded Postgres weight), and confirm it names the road not taken.
  - Proof: Rejected road: embedded Postgres in every client (iOS, browser, weight).
- [x] 2.2 Change ADR 0005's status line to "Accepted; client stores scoped by 0007" without other edits, and confirm `git diff docs/decisions/0005-*` shows only that line.
  - Proof: `git diff docs/decisions/0005-*`: one line, the status line.
- [x] 2.3 Write `docs/decisions/0008-projects-sync-through-a-server-sequenced-command-log.md` that rejects CRDTs and database replication with reasons, and confirm it references `maleo-editor-core` command determinism and inverses as the basis.
  - Proof: Cites `Executed::inverse` in `execute.rs` and the golden fixtures; rejects CRDTs and replication with reasons.
- [x] 2.4 Add 0007 and 0008 to the index in `docs/decisions/README.md`, and confirm `bunx vp fmt --check docs/decisions` and `bun run check:references` pass.
  - Proof: `bunx vp fmt --check docs/decisions`: correct format; `bun run check:references`: ok.

## 3. Spike A: wgpu frame inside gpui

- [x] 3.1 Create `spikes/gpui-wgpu/` (Cargo project with its own empty `[workspace]`, pinned gpui and wgpu) with a window of browser, preview, inspector panes and a timeline strip, and confirm `cargo run --release` opens it.
  - Proof: `spikes/gpui-wgpu/` (empty `[workspace]`, gpui `=0.2.2`, wgpu `=30.0.1`, `Cargo.lock`); `cargo run --release` opens the window with toolbar, browser, preview, inspector panes and timeline strip.
- [x] 3.2 Add the frame harness: per-frame 1920x1080 RGBA upload, one composite pass with an animated overlay, a frame timer that logs p50, p95, max and dropped frames, and confirm a 10-second run prints the four numbers.
  - Proof: A 10 s run prints frame time p50 2.70 / p95 4.34 / max 5.03 ms and 0 dropped frames (`stats::dropped` unit test passes).
- [x] 3.3 Try integration path 1 (offscreen render and readback into a gpui image) against the D2 criteria and record the numbers in the spike README.
  - Proof: Path 1 passes all D2 criteria: 30 fps for 60 s with 0 dropped; at 60 fps p95 frame time 4.83 ms (UI frame p95 7.53 ms). Numbers in `spikes/gpui-wgpu/README.md` and `results/`.
- [x] 3.4 If path 1 fails, try path 2 (IOSurface shared texture), then path 3 (`CAMetalLayer` child layer), stopping at the first that passes, and record each attempt's numbers.
  - Proof: Not run: path 1 passed, so paths 2 and 3 were not needed (D2 stops at the first passing path).
- [x] 3.5 Run the pane-resize and click-response checks during playback on the passing path and record the results.
  - Proof: 10 window resizes and 10 inspector pane resizes during 30 fps playback: 0 dropped. 10 clicks: latency p50 14.68 ms, max 30.84 ms, inside one 33.3 ms frame.
- [x] 3.6 Write the `Result` section of `spikes/gpui-wgpu/README.md` with the gpui and wgpu versions, the path used, all numbers, platforms not run, and a go, adjust or stop verdict.
  - Proof: Result section records gpui 0.2.2, wgpu 30.0.1, path 1, all numbers, platforms not run, and verdict **go**.

## 4. Spike B: Rust core from Kotlin Multiplatform

- [x] 4.1 Build the `editor-wasm` calling convention as a C ABI (`staticlib` for `aarch64-apple-ios-sim`, `cdylib` for `aarch64-linux-android`) from a crate under `spikes/kmp-core/`, and confirm both artifacts exist and export the engine symbols (`nm`).
  - Proof: `spikes/kmp-core/rust` builds `libmaleo_kmp_core.a` (aarch64-apple-ios-sim) and `libmaleo_kmp_core.so` (aarch64-linux-android). `nm -gU --no-llvm-bc` lists `_engine_alloc`, `_engine_open`, `_engine_execute`, `_engine_read`, `_engine_close`, `_engine_open_count`, `_engine_output_ptr`, `_engine_output_len`; `llvm-nm -D` lists the same plus the six `Java_dev_maleo_spike_core_NativeEngine_*` shim symbols.
- [x] 4.2 Create the Gradle Kotlin Multiplatform project in `spikes/kmp-core/` with one `expect`/`actual` engine wrapper: `cinterop` on iOS, a JNI shim on Android, and confirm `./gradlew build` succeeds.
  - Proof: `expect object Engine` with a `cinterop` actual (iOS) and a JNI actual (Android); `./gradlew build`: BUILD SUCCESSFUL (Kotlin 2.4.21, Gradle 9.8.1, AGP 9.4.1).
- [x] 4.3 Run the `crates/editor-core/tests/fixtures.rs` fixtures through the Kotlin wrapper on the Android emulator and the iOS simulator, and confirm the JSON results are byte-identical to a host run.
  - Proof: All 59 golden fixtures plus one non-BMP Unicode case: results byte-identical to the host run on the iOS simulator and the Android emulator (digest `3a170358ef391934` on all three, 175,655 B).
- [x] 4.4 Measure p50 and p95 round-trip latency for one typical edit command and run 10,000 sequential calls while recording memory, on both targets, and record the numbers and library sizes.
  - Proof: Round trip p50/p95: iOS 0.207/0.250 ms, Android 0.037/0.077 ms. 10,000 calls: no crash, Rust heap growth 0 B on both. Library size: iOS 775 KB linked, Android 831.6 KB `.so`.
- [x] 4.5 If the raw ABI fails a D3 criterion, repeat 4.2 to 4.4 with the UniFFI Kotlin Multiplatform generator and record both results.
  - Proof: Not run: the raw ABI passed every D3 criterion, so UniFFI was not needed.
- [x] 4.6 Write the `Result` section of `spikes/kmp-core/README.md` with the binding used, all numbers, and a go, adjust or stop verdict.
  - Proof: Result section records the raw C ABI binding, all numbers, and verdict **adjust** (D4 stands; its "generated bindings" becomes the hand-written C ABI).

## 5. Spike C: captions in Rust

- [x] 5.1 Define the caption fixture set from D4 as data in `spikes/rust-captions/fixtures/` and render each fixture's Remotion still at 1080x1920 with the fonts from `packages/video/src/fonts.ts`, and confirm one PNG per fixture and frame exists.
  - Proof: 14 fixtures in `spikes/rust-captions/fixtures/fixtures.json` (each property alone, two combined, Indonesian and English, a three-line wrap, emoji) at frames 21, 28, 30. `remotion/render.ts` renders `Captions.tsx` with `fonts.ts`: 42 PNGs in `reference/` (macOS) and 42 in `reference-linux/` (production image).
- [x] 5.2 Create `spikes/rust-captions/` (Cargo project with its own empty `[workspace]`) that renders the same fixtures offscreen through wgpu with a chosen Rust text stack, and confirm one PNG per fixture and frame exists.
  - Proof: `spikes/rust-captions` (empty `[workspace]`, parley 0.11.1 + vello 0.11.0 on wgpu 30) writes 42 PNGs to `out/rust/`.
- [x] 5.3 Add an SSIM comparison that prints one score per fixture and frame, and confirm it reports 1.0 when a reference image is compared with itself.
  - Proof: `cargo run --release -- ssim reference/base-21.png reference/base-21.png` prints `1.000000`; unit test `an_image_against_itself_scores_one_and_against_noise_less` passes. The run prints one score per fixture and frame (`results/*/report.tsv`).
- [x] 5.4 Check line breaks, highlight frame index and safe-area position against the Remotion output for each fixture, and record any mismatch.
  - Proof: Against both references: equal line counts, line ink extents within 2 px, box position within 2 px, highlight bounds within 2 px, and the highlight moves to word 2 on frame 30 in both. Only mismatch: the production reference draws emoji as tofu (no emoji font in the image).
- [x] 5.5 If a criterion fails, apply the D4 fallback (a browser-closer rasterizer) and re-run 5.2 to 5.4, recording both results.
  - Proof: Not run: every criterion passed with parley + vello, so the browser-closer rasterizer fallback was not needed.
- [x] 5.6 Write the `Result` section of `spikes/rust-captions/README.md` with the text stack chosen, SSIM per fixture, side-by-side images, and a go, adjust or stop verdict.
  - Proof: Result section records parley 0.11.1 + vello 0.11.0, SSIM per fixture against both references, side-by-side images in `results/*/side-by-side/`, and verdict **go**.

## 6. Evidence-dependent ADRs and grand-plan update

- [x] 6.1 Write `docs/decisions/0009` (renderer ownership) from the verdicts of spikes A and C, titled as the claim the evidence supports, linking both spike READMEs, and confirm it records the fallback road if a verdict was stop.
  - Proof: `docs/decisions/0009-the-rust-engine-owns-rendering.md`, from spike A (go) and spike C (go), links both READMEs. No verdict was stop; it records the egui + `egui-wgpu` fallback as the revisit road if P4 fails on Windows or Linux.
- [x] 6.2 Write `docs/decisions/0010` (platform boundary and binding) from the verdict of spike B, linking its README, and confirm it names the binding chosen and the one rejected.
  - Proof: `docs/decisions/0010-the-core-reaches-every-platform-through-one-c-abi.md`, from spike B, links its README. Chosen: the hand-written C ABI (`cinterop` + JNI shim). Rejected: UniFFI and its Kotlin Multiplatform generator (and `wasm-bindgen`).
- [x] 6.3 Add 0009 and 0010 to the ADR index and confirm `bunx vp fmt --check docs/decisions` and `bun run check:references` pass.
  - Proof: Index rows added; `bunx vp fmt --check docs/decisions`: correct format; `bun run check:references`: ok.
- [x] 6.4 For each adjust or stop verdict, update the matching decision in `openspec/changes/platform-grandplan/design.md`, and confirm `openspec validate platform-grandplan --strict` passes. If every verdict is go, record "no change" in this task's proof.
  - Proof: Spike B was **adjust**: D4, D5, the diagram label and the UniFFI risk in `platform-grandplan/design.md` (and the two matching proposal lines) now name the hand-written C ABI. Spikes A and C were **go**: D1 and D3 unchanged. `openspec validate platform-grandplan --strict`: valid.

## 7. Integration checks

- [x] 7.1 Confirm `cargo test` at the root and `bun run check` pass unchanged, which proves no spike entered the workspace or a CI gate.
  - Proof: Root `cargo test`: 9 suites ok, 0 failed, only `maleo-editor-core` and `maleo-editor-wasm`. `bun run check`: exit 0. It first failed with 11 lint findings in `spikes/rust-captions/remotion/*.ts(x)`, because `vp check` lints the whole tree; `spikes/**` was added to `oxlint.config.ts` `ignorePatterns` beside the archived-evidence entry, as D1 requires. No other gate changed.
- [x] 7.2 Confirm `openspec validate platform-p0-foundations --strict` passes.
  - Proof: `openspec validate platform-p0-foundations --strict`: Change 'platform-p0-foundations' is valid.
