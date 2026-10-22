# Design

## Context

See proposal.md - Why, and `platform-grandplan/design.md` for the target
architecture. The facts that shape P0:

- `crates/editor-wasm` exposes `maleo-editor-core` through a raw ABI, not
  generated glue. The host passes UTF-8 JSON through `(ptr, len)` pairs and
  reads results from an output buffer. A document lives behind a handle. The
  same calling convention can be exported as a C ABI for native hosts.
- The Rust targets `aarch64-apple-ios`, `aarch64-apple-ios-sim` and
  `aarch64-linux-android` are installed on the development machine. Xcode is
  installed. A JDK is present. Gradle, Kotlin and the Android SDK are not.
- Captions render in `packages/video/src/components/Captions.tsx` with fonts
  from `packages/video/src/fonts.ts`. Remotion can render a still frame of a
  composition, which gives the reference image for each fixture.
- gpui draws with its own renderer (Metal on macOS, DirectWrite plus a GPU
  backend on Windows, Vulkan on Linux). It does not expose a wgpu surface.
- ADR 0005 says: revisit the engine "if the product becomes a single-user
  desktop app". The client store ADR scopes 0005. It does not reverse it.
- `docs/decisions/README.md` admits an ADR only when someone argued for the
  other road. Each road below was argued in the grand-plan discussion: Tauri
  and Remotion, egui, CRDTs, SQLite versus embedded Postgres, UniFFI versus a
  hand-written ABI.

## Goals / Non-Goals

**Goals:**

- Each spike answers one yes-or-no question with numbers, against criteria
  fixed before the spike starts.
- Each ADR cites the evidence it rests on.
- A failed spike produces a named fallback, not an open question.

**Non-Goals:**

- Spike code quality, tests beyond the measurement harness, or cross-platform
  packaging.
- Windows and Linux runs of the gpui spike. The spike runs on macOS. The
  result records the other platforms as not run.
- Performance tuning beyond what the pass criteria need.

## Decisions

### D1. Spikes live in `spikes/`, outside the workspace and CI

```text
spikes/
  gpui-wgpu/       Cargo project, own empty [workspace]
  kmp-core/        Gradle Kotlin Multiplatform project + Rust build step
  rust-captions/   Cargo project, own empty [workspace]
```

- Each Cargo spike declares an empty `[workspace]` table. Without it, Cargo
  finds the root workspace and refuses to build a package that is not a
  member.
- CI does not build `spikes/`. `cargo test` at the root does not reach it.
- Each spike has a `README.md` with the question, the pass criteria, how to
  run it, and a `Result` section with the measurements and the verdict.
- Spike code stays in the repository until the phase change that builds the
  real component replaces it. That change deletes the spike.
- Rejected: spikes in `crates/`. A gpui build compiles for minutes and needs
  system packages on Linux, and every root `cargo test` would pay for it.
- Rejected: spikes in a separate repository. The ADRs must link to the code
  that produced their evidence.

### D2. Spike A: wgpu frame inside a gpui window

Question: can a gpui window show a wgpu-rendered frame at playback rate, with
the editor panes around it, on macOS?

Setup:

- A gpui window with three panes (browser, preview, inspector) and a timeline
  strip, sized like the web editor.
- Each frame, the spike uploads a 1920x1080 RGBA buffer to a wgpu texture (a
  stand-in for a decoded video frame), then runs one composite pass that
  draws the texture plus one animated overlay. Decoding is out of scope: it
  sits behind the media trait of grand-plan D13.
- Try integration paths in this order and stop at the first that passes:
  1. Offscreen wgpu render, read back to CPU, hand to gpui as an image.
  2. Shared GPU texture through a platform handle (IOSurface on macOS).
  3. A native child layer (`CAMetalLayer`) with a wgpu surface, placed over
     the gpui preview pane.

Pass criteria (all must hold, on an Apple Silicon Mac, release build):

- 30 fps sustained for 60 seconds with zero dropped frames.
- p95 frame time at most 16.7 ms when driven at 60 fps.
- A pane resize during playback drops at most one frame.
- The UI stays responsive: a click on a pane control responds within one
  frame while playback runs.

Measure frame times with the spike's own timer and record p50, p95 and max.

Fallback if all three paths fail: re-open the desktop UI choice. egui with a
wgpu backend (`egui-wgpu`) shares the device by design and becomes the
candidate. The grand plan's D3 changes.

### D3. Spike B: Rust core from Kotlin Multiplatform

Question: can one shared Kotlin module call `maleo-editor-core` on Android
and on iOS?

Approach, cheapest first:

1. **Raw C ABI.** Build the existing `editor-wasm` calling convention as a C
   ABI (`staticlib` for iOS, `cdylib` for Android). iOS reaches it through
   Kotlin/Native `cinterop` with a C header. Android reaches it through a thin
   JNI shim. A Kotlin `expect`/`actual` pair hides the two.
2. **Generated bindings.** Only if the raw ABI fails a criterion: try the
   community UniFFI Kotlin Multiplatform generator.

Pass criteria (Android emulator and iOS simulator):

- The editor command fixtures used by `crates/editor-core/tests/fixtures.rs`
  produce byte-identical JSON results to the same fixtures run on the host.
- p50 round-trip latency for one typical edit command is at most 1 ms. Record
  p95.
- 10,000 sequential calls finish with no crash and no memory growth beyond
  the document size (ownership of input and output buffers follows the ABI
  convention).
- Record the native library size per target.

Fallback if both approaches fail on iOS: iOS gets a native SwiftUI shell over
the C ABI, and Android keeps Kotlin. The grand plan's D4 changes.

### D4. Spike C: captions in Rust against Remotion

Question: can Rust draw maleo's caption styles close enough to Remotion that
the renderer migration is safe?

Setup:

- Fixtures: `Captions.tsx` has no named presets. It reads style properties:
  font, weight, italic, stroke, shadow, background, vertical position (top,
  center, bottom or a percentage) and the active-word highlight. The fixture
  set covers each property on its own plus two combined styles. Each fixture
  renders at a frame mid-word (highlight active) and a frame between words.
  Text includes Indonesian and English, one line that wraps, and one emoji.
- Reference: Remotion stills of the same fixtures at 1080x1920.
- Candidate: an offscreen wgpu render with a Rust text stack (shaping and
  layout plus glyph rasterization) using the same font files from
  `packages/video/src/fonts.ts`.
- Pick the text stack during the spike. Candidates: parley with swash,
  cosmic-text, or vello for vector glyphs. Record which one and why.

Pass criteria:

- SSIM at least 0.95 against the Remotion still for every fixture.
- Line breaks, word highlight timing (frame index) and safe-area position
  match exactly.
- Outline, shadow and highlight color are visually equal in a side-by-side
  review, recorded as images in the spike's `Result` section.

Fallback if the criteria fail: keep D1 of the grand plan, but draw text
through a rasterizer that matches the browser more closely (for example
Skia through `skia-safe`) and re-run the spike. If that also fails, the
renderer ADR records captions as the blocking gap, and P2 starts with it.

### D5. Verdicts

Each spike ends with one verdict in its `Result` section:

| Verdict | Meaning                                   | Action                                        |
| ------- | ----------------------------------------- | --------------------------------------------- |
| go      | All pass criteria hold                    | The grand-plan decision stands                |
| adjust  | Passes only with a change of approach     | Update `platform-grandplan/design.md`         |
| stop    | Fails, fallback named in D2 to D4 applies | Update the grand plan, write the ADR to match |

### D6. ADRs and their order

| ADR  | Claim                                                                          | Depends on     |
| ---- | ------------------------------------------------------------------------------ | -------------- |
| 0007 | Clients keep a local SQLite store. Postgres stays the server engine            | none           |
| 0008 | Projects sync through a server-sequenced command log, not CRDTs or replication | none           |
| 0009 | The Rust engine owns rendering. Remotion retires after a parity window         | Spikes A and C |
| 0010 | The core reaches each platform through one boundary                            | Spike B        |

- 0007 and 0008 do not depend on a spike. Write them first.
- 0009 and 0010 are written only after their spikes end, from the verdicts.
  If a verdict is stop, the ADR records the fallback road instead.
- ADR 0005 keeps its content. Its status line becomes "Accepted; client
  stores scoped by 0007", following the README's rule for partial
  supersession.
- Each ADR follows the repository format: Context, Decision, Consequences,
  titled as the claim.

### D7. Spec change

`database-engine-parity` keeps its requirements for servers and adds the
client store boundary (see the delta spec). The client store itself gets its
own capability in P1, when the first client store exists.

## Risks / Trade-offs

- [gpui pins move fast and break the spike build] → Pin the gpui version in
  the spike's `Cargo.lock`. Record the version in the result.
- [The macOS result does not hold on Windows or Linux] → The result records
  them as not run. P4 runs the same harness on both before the desktop ships.
- [A synthetic frame hides decode cost] → Decode belongs to the media trait,
  measured in P2. Spike A measures only the render and present path.
- [SSIM hides a visible defect] → Side-by-side images are part of the pass
  criteria, not only the number.
- [Android SDK and Gradle setup takes longer than the spike] → Install them
  as task 1, before the spike clock starts.
- [Spike code becomes product code by accident] → Spikes sit outside the
  workspace. The phase change that builds each component deletes its spike.

## Migration Plan

Nothing deploys. Rollback is a revert of the spike and ADR commits. The spec
delta merges into `openspec/specs/` at archive.
