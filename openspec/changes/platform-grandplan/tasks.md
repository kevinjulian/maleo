# Tasks

This checklist tracks the milestones in `proposal.md` and `design.md`. Each
phase change owns its detailed specs, implementation tasks and acceptance evidence.
Create or update that phase change before implementing an open milestone here.
Do not apply the whole roadmap as one implementation change.

Status reviewed on 2026-10-25 against repository source and archived phase records. Motion/compositing milestones 4.1 and 4.3–4.5 were refreshed on 2026-10-26 against live phase acceptance.
Checked items cite existing evidence. Their runtime checks were not repeated for
this checklist. An archive alone does not establish completion.

P2 and P3 can proceed independently after their P1 prerequisites. P4 needs P2
and P3. P5 needs P3 and the renderer/media adapters it uses. P6 depends on the
P2 parity window, not on delivery of desktop or mobile apps.

Open design questions remain with their named phases: templates with motion,
prefetch and cache policy with P3, and proxies with P5. Resolve each in its phase
proposal before implementation. Payment-provider selection stays outside this roadmap.

## 1. P0 — Architecture decisions and feasibility

- [x] 1.1 Record accepted decisions for client SQLite, server-sequenced sync, Rust rendering and the platform ABI. Verify ADRs 0007–0010 contain decisions and rejected alternatives.
  - Evidence: [P0 tasks, sections 2 and 6](../archive/2026-10-22-platform-p0-foundations/tasks.md); accepted records in `docs/decisions/`.
- [x] 1.2 Prove a wgpu frame can play inside gpui with responsive editor panes. Verify the spike records frame times, dropped frames and interaction latency.
  - Evidence: [P0 tasks, section 3](../archive/2026-10-22-platform-p0-foundations/tasks.md); `spikes/gpui-wgpu/README.md`. macOS proof does not establish Windows or Linux support.
- [x] 1.3 Prove the raw core ABI from shared Kotlin on Android and iOS. Verify fixture parity, latency and repeated-call measurements.
  - Evidence: [P0 tasks, section 4](../archive/2026-10-22-platform-p0-foundations/tasks.md); `spikes/kmp-core/README.md`. Android emulator and iOS simulator proof, not physical-device acceptance.
- [x] 1.4 Prove Rust caption shaping against Remotion references and choose the text stack. Verify recorded SSIM, line breaks, word highlight and safe-area checks.
  - Evidence: [P0 tasks, section 5](../archive/2026-10-22-platform-p0-foundations/tasks.md). The production renderer corpus now owns the caption fixtures.

## 2. P1 — Shared editor and online sync foundations

- [x] 2.1 Move undo, redo, selection and the pending-command queue into host-free `app-core`. Verify Rust rule tests and web wrappers exercise the shared behavior.
  - Evidence: [app-core tasks](../archive/2026-10-23-p1-app-core/tasks.md); `crates/app-core/src/ledger.rs`, `selection.rs` and `pending.rs`; commit `d05ba43`.
- [x] 2.2 Give imports client-minted UUIDv7 identities that survive upload without reference replacement. Verify import, pending-media authorization and reload proofs.
  - Evidence: [asset-identity tasks, sections 1–3 and 5](../archive/2026-10-23-p1-asset-identity/tasks.md); commit `afcd040`.
- [x] 2.3 Derive an authorized asset manifest and use it for pending-media and export checks. Verify manifest states, duplicate references and measured route latency.
  - Evidence: [asset-identity tasks, section 4](../archive/2026-10-23-p1-asset-identity/tasks.md). The delivered manifest uses SHA-256. Hash deduplication remains P3 work.
- [x] 2.4 Add the server command log, idempotent submissions, catch-up and snapshot responses. Verify route tests and the web command-sync tests.
  - Evidence: [command-log tasks, sections 1–3](../archive/2026-10-23-p1-command-log/tasks.md); commit `1a6bf0f`. This item covers implementation and automated tests, not the open browser proof in 2.6.
- [x] 2.5 Put the project media library under server-owned commands and log delivery. Verify two browser contexts observe admitted media before placement.
  - Evidence: [media-library tasks](../archive/2026-10-23-p1-media-library/tasks.md), including browser proof 3.3; commit `54e3f11`.
- [ ] 2.6 Complete the command-log browser acceptance: edit while an agent writes the storyboard, then reload. Verify both changes survive and the persisted document matches the editor.
  - Carryover: [command-log task 3.4](../archive/2026-10-23-p1-command-log/tasks.md) remains unchecked despite archive.
- [ ] 2.7 Define the portable project envelope over the existing document and asset manifest. Verify cross-client round trips preserve authored fields and incompatible input is refused before overwrite.
  - Existing versioned documents and the `cross-platform-editor` spec are inputs. Include compatibility fixtures and document the exchange format in the owning phase change.
- [ ] 2.8 Complete shared inspector rules and editor view-model ownership under D2. Verify web controls delegate rules to `app-core`, with tests and an updated editor codemap.
  - Already delivered: selection, undo, pending commands and canvas layout edits. Audit remaining inspector and view-model rules without moving React presentation into Rust.

## 3. P2 — Renderer foundation, preview runtime and canvas rules

- [x] 3.1 Add Rust rendering for backgrounds, still-image layers, plain text and captions, with bundled fonts and explicit coverage reports. Verify the renderer tests and supported-layer corpus.
  - Evidence: [render-foundation tasks, sections 2–3](../archive/2026-10-24-p2-render-foundation/tasks.md); `crates/renderer`; commit `3b195bb`.
- [x] 3.2 Establish the golden-frame parity gate against production-image Remotion references. Verify normal runs pass and deliberate visual drift fails with diagnostic artifacts.
  - Evidence: [render-foundation tasks, section 4 and task 7.3](../archive/2026-10-24-p2-render-foundation/tasks.md), including lavapipe CI and a recorded failing drift check.
- [x] 3.3 Build the browser renderer and hidden compare mode. Verify supported frames display beside Remotion and normal editor loads do not fetch the renderer module.
  - Evidence: [render-foundation tasks, sections 5–6](../archive/2026-10-24-p2-render-foundation/tasks.md); ADR 0011 records the `wasm-bindgen` exception.
- [x] 3.4 Add the shared preview clock, scheduler, states and worker surface, including GPU recovery. Verify fake-clock tests and recorded browser playback and device-loss checks.
  - Evidence: [preview-runtime tasks](../archive/2026-10-24-p2-preview-runtime/tasks.md); `crates/preview`; commit `34fbb0f`. Decoder/audio traits exist, but their implementations remain open.
- [x] 3.5 Move canvas geometry, hit testing, gestures, groups, masks and transient edit commands into Rust. Verify shared fixtures, gesture tests and running-editor acceptance.
  - Evidence: [preview-editing tasks, sections 2–4 and task 5.1](../archive/2026-10-25-p2-preview-editing/tasks.md); `crates/app-core/src/canvas`; commit `9b2897b`.
- [x] 3.6 Route inspector layout reads and edits through the Rust canvas API. Verify layout/edit boundary tests and the migrated inspector callers.
  - Evidence: [preview-editing tasks 2.8, 3.1a and 4.5a](../archive/2026-10-25-p2-preview-editing/tasks.md). These controls still display their result through Remotion.

## 4. P2 — Motion, compositing and templates

Completed phase: [p2-motion-compositing](../archive/2026-10-26-p2-motion-compositing/proposal.md)
owns the non-template rendering work in 4.1 and 4.3–4.5. Declarative templates
and template interpretation (4.2 and 4.6) are implemented in
[p2-visual-templates](../archive/2026-10-27-p2-visual-templates/proposal.md). The user-approved
scope retains plain text, five shapes and user-created motion, and deletes
retired stock-preset clips and empty saved templates instead of porting them.

- [x] 4.1 Measure use of unsupported presets, transitions, effects and motions. Verify the phase proposal names each feature to port or retire and provides migrations for affected projects.
  - Evidence: [motion/compositing inventory](../archive/2026-10-26-p2-motion-compositing/evidence/feature-matrix.md). Local 2026-10-25 snapshot: 12 projects, 10 saved storyboards and 2 saved templates; production unmeasured. All offered non-template options are retained. Visual presets, saved compositions and legacy `Product*` compositions remain explicitly deferred to `p2-visual-templates`; no feature retirement or persisted migration.
- [x] 4.2 Define the retained primitive and user-composition format and authoring contract. Verify schema/cleanup fixtures and a Remotion interpreter preserve supported values and timing before adding Rust interpretation.
  - Evidence: [visual-template tasks 1–3, 5–6 and 7.2](../archive/2026-10-27-p2-visual-templates/tasks.md): strict versioned/shared format; five shape primitives; user-only Motion; transactional no-ripple cleanup and stale-write barriers; production Remotion and desktop/320px authoring proof. Local development cleanup was applied after a backup; deployment apply remains an operator step.
- [x] 4.3 Render animated transforms, camera motion and reveals in Rust. Verify keyframe sampling and representative frames against the golden corpus, including clip boundaries.
  - Evidence: [motion/compositing tasks 2, 3 and 5](../archive/2026-10-26-p2-motion-compositing/tasks.md), source-derived samples and production references. [Acceptance](../archive/2026-10-26-p2-motion-compositing/evidence/acceptance.md): all 156 cases / 1,098 frames pass Metal and local software Vulkan; direct/out-of-order checks pass.
- [x] 4.4 Render supported scene transitions, effects, labels and progress decorations in Rust. Verify each retained feature has golden coverage and no unexplained coverage omission.
  - Evidence: [motion/compositing tasks 6 and 7](../archive/2026-10-26-p2-motion-compositing/tasks.md), eight transition types by placement, six effects, labels and pacing. [Acceptance](../archive/2026-10-26-p2-motion-compositing/evidence/acceptance.md) records empty supported-case coverage and measured playback limits. Normal preview/export remain Remotion.
- [x] 4.5 Render rotation, flips, masks, color adjustments and blend modes in Rust. Verify compositing fixtures match preview/export semantics and update the renderer support documentation.
  - Evidence: [motion/compositing tasks 2 and 4](../archive/2026-10-26-p2-motion-compositing/tasks.md), transparent-edge and combined production cases; [backend proof](../archive/2026-10-26-p2-motion-compositing/evidence/backend-acceptance.md), renderer codemap and ownership instructions. Templates and media remain unsupported; this does not close export or preview cutover.
- [x] 4.6 Render retained text, shapes and user compositions through the declarative interpreter. Verify fixtures, font handling and golden frames match the accepted primitive/composition output, with no built-in motion catalogue.
  - Evidence: [visual-template tasks 4 and 7.3](../archive/2026-10-27-p2-visual-templates/tasks.md): all five shape paths, validated composition traversal and layer-derived font/option coverage; 48 composition golden frames and seven shape cases at unchanged thresholds; actual browser compare worker and decoded production H.264 proof. Remotion remains the normal preview/export owner.

## 5. P2 — Video decoding and audio playback

- [ ] 5.1 Implement the web video decoder adapter through WebCodecs and the shared media boundary. Verify seek, trim, rate and supported reverse behavior with real media fixtures.
- [ ] 5.2 Add bounded decoder pools and decoded-frame caching to the shared preview runtime. Verify rapid seeks select the latest frame and resource use stays within the phase's measured budget.
- [ ] 5.3 Implement audio mixing and the web audio-output adapter. Verify voiceover, music, clip audio and sound effects preserve timing, volume, fades, trims and mute rules.
- [ ] 5.4 Make audio position the playback clock when audio is active. Verify measured audiovisual synchronization during play, pause, seek and rate changes.
- [ ] 5.5 Integrate media loading, buffering, stalls and recovery with the session. Verify delayed or missing media does not corrupt edits and document the adapter and state contracts.

## 6. P2 — Production export before preview cutover

- [ ] 6.1 Export Rust session frames and mixed audio through browser encoders. Verify a decoded output file preserves timing and appearance across representative projects.
  - Reuse the installed MediaBunny integration where suitable. Existing draft export does not establish production parity.
- [ ] 6.2 Run the Rust renderer and native media encoder in the server render worker. Verify actual output, cancellation, progress and failure handling through the existing job surface.
- [ ] 6.3 Run export preflight against the asset manifest. Verify missing assets download or offer server export, while unavailable assets produce an explicit refusal.
- [ ] 6.4 Compare production jobs through Rust and Remotion, then switch authoritative export with rollback available. Verify recorded output comparisons and document worker deployment and recovery.
  - The export phase must define project coverage, comparison criteria and the observation window before the switch.

## 7. P2 — Preview and inspector integration, then project cutover

- [ ] 7.1 Expose element bounds and caption line boxes from the renderer's layout pass. Verify hit testing selects what the displayed frame draws, including rotated and animated elements.
- [ ] 7.2 Draw selection boxes, handles, guides and safe areas in the Rust overlay pass. Verify gesture visuals match engine geometry and exports contain none of these overlays.
- [ ] 7.3 Connect existing canvas input to the Rust preview session. Verify temporary changes render during gestures, Escape cancels them, and release records one undoable command.
- [ ] 7.4 Connect inspector edits to the same selection, document and playhead as Rust preview. Verify edits from either surface update the other, including keyframes, undo, redo, save and reload.
  - Keep text editing in the inspector initially. Direct text entry on the canvas is deferred by D15.
- [ ] 7.5 Connect transport, seeking, rate and preview quality controls to the Rust session. Verify interactive controls in the running editor and document their shared ownership.
- [ ] 7.6 Add loading, buffering, failure and WebGPU-required UI states. Verify unsupported browsers receive the D16 refusal and no fallback renderer starts.
- [ ] 7.7 Switch eligible projects to Rust preview only after export migration. Verify coverage is empty across every project frame, with measured playback and rollback evidence.
  - Define the eligibility check in the preview-UX change. A supported still frame does not establish whole-project coverage or media correctness.
- [ ] 7.8 Migrate template and custom-element preview surfaces to Rust. Verify their controls remain reachable and editing produces the same preview and exported result.

## 8. P3 — Local storage and project synchronization

- [ ] 8.1 Add the client store and persistent pending queue, including web OPFS. Verify edits survive offline reload and storage failure cannot silently discard pending commands.
  - Resolve storage persistence, encryption and key handling for each client in this phase's design under D6.
- [ ] 8.2 Complete reconnect synchronization and remote delivery over the existing command log. Verify acknowledgement retries, rebase, agent writes and dropped-command notices across two clients.
- [ ] 8.3 Add snapshot bootstrap and log compaction for durable clients. Verify a device older than retention recovers without losing its pending edits and document the recovery procedure.
- [ ] 8.4 Queue offline AI requests with estimated cost and reconnect consent. Verify reconnect sends nothing until consent and preserves pending-result placeholders.

## 9. P3 — Media transfer, device identity and server capabilities

- [ ] 9.1 Resolve the D8 hash contract against delivered SHA-256 identities, then add authorized hash deduplication. Verify duplicate imports avoid byte transfer without exposing another workspace's assets.
  - `p1-asset-identity` deliberately deferred deduplication and BLAKE3. Reconcile the chosen hash with D8 before implementing transfer verification.
- [ ] 9.2 Add resumable background upload through presigned multipart parts and the local-only option. Verify interrupted uploads resume and local-only assets are never evicted.
- [ ] 9.3 Add verified downloads, range caching and per-device asset states. Verify partial, remote and unavailable media show correct placeholders while timeline editing continues.
- [ ] 9.4 Define and measure prefetch, cache limits, eviction and offline pinning. Verify offline playback and original recovery, respect stock-provider cache licenses, and document the measured policy.
  - Resolve the P3 cache and small-asset questions with measurements. Derived thumbnails, waveforms and indexes stay local.
- [ ] 9.5 Extend reachability and quota checks for synced manifests and pending client state. Verify live assets survive collection and over-quota uploads fail before bytes move.
- [ ] 9.6 Implement browser-approved device sign-in, device-scoped credentials and revocation. Verify approved, refused and revoked devices against hosted and self-hosted configurations.
- [ ] 9.7 Add the capability and minimum-version handshake. Verify clients hide unavailable features and refuse unsafe compatibility combinations; document HTTPS and deployment settings.
  - Keep one backend build. Cover billing mode, signup policy, quotas and enabled services through configuration.

## 10. P4 — Desktop client

- [ ] 10.1 Create the gpui client shell linked directly to shared Rust state. Verify project opening, timeline and inspector interactions use shared commands without copied editing rules.
- [ ] 10.2 Add desktop surface, media and audio adapters with the client store and sync. Verify offline preview/export and reconnect using representative projects.
- [ ] 10.3 Package and exercise supported desktop targets. Verify platform input, recovery and frame budgets, and publish installation and operating instructions.
  - The macOS P0 spike does not establish Windows or Linux product acceptance. Keep FFmpeg dynamically linked with the pinned LGPL build from D13.

## 11. P5 — Mobile client and proxies

- [ ] 11.1 Create the shared Compose Multiplatform UI and production C ABI bindings. Verify Android and iOS execute the same shared command fixtures and handle lifetimes safely.
- [ ] 11.2 Add native surface, hardware media and audio adapters. Verify touch gestures, preview, inspector edits and export on physical Android and iOS devices.
- [ ] 11.3 Integrate local storage, device sign-in and sync. Verify offline edits, interrupted transfers and recovery after app restart; document mobile operating limits.
- [ ] 11.4 Choose proxy resolution and codec from real footage measurements, then generate proxies on importing devices. Verify identity mapping and original-quality export without a server transcode farm.
- [ ] 11.5 Complete mobile distribution checks and user instructions. Verify first-release builds contain no purchase UI and record a current app-store policy review before launch.

## 12. P6 — Remove Remotion and Chromium

- [ ] 12.1 Close the measured parity window. Verify production comparisons have no unexplained divergence and every retained project has a covered or migrated rendering path.
  - Set measurable acceptance criteria in the P6 change before approving removal. Account for every remaining unsupported project, not only the switched majority.
- [ ] 12.2 Remove Remotion Players, React compositions and package dependencies. Verify all editor surfaces and production export work through Rust and dependency checks find no runtime Remotion use.
  - Preserve shared schemas and preparation logic still needed by Rust consumers when retiring `packages/video`.
- [ ] 12.3 Remove headless Chromium, obsolete Lambda integration and Remotion build/deploy tooling. Verify a clean deployment produces a playable export and update development and deployment docs.
- [ ] 12.4 Run final integration and release gates. Verify `bun run ci`, cross-surface browser acceptance and deployed export evidence, then record the P6 closeout.
  - Archive phase changes only after explicit user confirmation under `AGENTS.md`.
