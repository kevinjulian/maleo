# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The root `package.json` version, the newest released heading in this file, and
the matching `vX.Y.Z` git tag must always agree. `scripts/check-version.ts`
enforces that on every pull request.

Changes that are docs-only, CI-only, test-only, or internal refactors with no
user-facing or contributor-facing effect are release-note-exempt and need no
entry here. See `CONTRIBUTING.md`.

## [Unreleased]

### Added

- Rust compare mode draws keyed image/plain-text animation, camera presets and paths, local correction and masks with feather, blends, reveals, placement-specific transitions, timeline effects, scene labels, vignette, grain, chapter pills and progress. Unsupported media and templates remain visible in coverage. Option-level production goldens and exact seek checks cover the port. Remotion remains the normal preview and export renderer.

- Editing on the preview canvas runs in the shared Rust core (`crates/app-core` `canvas/`), so every client gets the same boxes, snapping and commands. The web canvas sends pointer, touch and key input to the engine through new `canvas_*` editor-engine calls and draws what comes back. An element is picked where it is drawn at the playhead, including an animated one. Shift-click on the canvas adds or removes an element from the selection, and a multi-selection moves, resizes and rotates as one group box in one undo step. A two-finger pinch scales the selection and a twist rotates it. Inspector layout edits use the same engine rules. The engine's size budget is now 240 KB gzip and 620 KB raw.
- A Rust renderer, `crates/renderer`, draws video frames from the render storyboard with parley and vello on wgpu. It draws backgrounds (colors, linear and radial gradients), image scene visuals and image overlays with their layout, crop, fit and opacity, plain text overlays, and captions with every style and motion. For each frame it reports what it does not draw yet. A golden corpus of Remotion frames, rendered in the production image, holds it at parity: `cargo test -p maleo-renderer` compares every case by SSIM, and CI runs it on a software Vulkan driver. Remotion stays the only preview and export renderer.
- A hidden compare mode in the editor: open a project with `?renderer=compare` to see the Rust frame beside the Remotion preview, with its frame time and coverage. It needs WebGPU. Without the parameter nothing changes and the renderer module is never loaded.
- A project's media library is now server-owned. Each asset is a row of the project, unique by URL, and changes only through `media.admit` and `media.update` commands in the project command log. An entry that changes only the library writes no storyboard version. A finished upload enters the library on the server, so a second device shows it before anyone places it, and two devices that admit the same file get one asset. The project read returns the library; the editor-state save no longer writes it. A project's stored list is imported once, the first time the server reads it.
- A project command log. The web editor now saves edits as editor commands through `POST /api/operations/projects/:id/commands`, not as whole documents. The server runs each command against the current version in the shared Rust engine, checks the result with the save route's rules, and accepts or rejects each command on its own. A retried command returns its first result. `GET /api/operations/projects/:id/commands?after=<seq>` returns what other writers saved, or one snapshot when the log no longer holds it. Agent runs and every other storyboard writer appear in the log as one `scope.replace`. The editor tells you when the server refused an edit or an edit no longer applies, and it keeps an agent run's result as one undo step. Pacing devices and presentation save through `PATCH /api/operations/projects/:id/storyboard-presentation`. App-core gains `pending_resolve`, which applies a server reply in one call.
- Imported media gets its final identity at import. The client mints a UUIDv7 media ID, the document holds `/api/media/<id>` from the start, and the server publishes the finished import under that ID. While the import runs, the media route answers `409 media_pending`. A media ID that is already in use gets `409 media_id_conflict`.
- `GET /api/operations/projects/:id/asset-manifest` lists the media a project references, with identity, origin, kind, size, SHA-256 and state (`ready`, `pending`, `failed`, `external`). Export preflight uses it.
- An agent run treats a clip on a minted media ID whose import has not finished as still uploading, as it treats a `pending:` reference: the agent cannot edit it.
- `crates/app-core` is the shared Rust home for editor state rules: the undo ledger, the selection rules and a queue of pending local commands that rebases over commands the server accepted. The web editor's undo history and selection transitions now run in it through new editor-engine WASM calls. A pending command that no longer applies after a rebase is dropped and reported. An undo step whose inverse no longer applies is dropped, not kept on the stack. The engine's gzip size budget is now 188 KB.
- `spikes/` holds the P0 platform spikes (gpui with wgpu, Kotlin Multiplatform over the C ABI, Rust captions against Remotion). They sit outside the Cargo workspace, CI and lint. ADRs 0007 to 0010 record the client store, sync, renderer and binding decisions drawn from them.

### Changed

- Text and Shapes no longer offer new variant creation. New timeline shapes keep their intended proportions across project aspect ratios, so Circle starts round.
- **Breaking:** writable projects and saved element definitions retire stock visual presets. Run the explicit read-only/apply visual cleanup before starting an existing installation. Cleanup deletes retired clips without ripple, preserves surviving composition timing, deletes empty saved definitions, and leaves media objects intact. Stale editors must reload; historical restore creates a cleaned head. See the self-hosting cleanup procedure.
- Saved plain-text composition layers now apply authored weight, alignment and casing consistently with standalone text. Frames can change where the old packed renderer ignored those values.

- Rust compare mode draws animated image layouts, rotation/flips, plain-text box/style animation with content blur, existing camera presets/custom paths with focal points and glitch offsets, local color/masks/feather/blends, and direct/phased reveals with their existing directions and textures. Legacy text retains normalized timing. A pinned shader correction preserves exact repeatability across texture allocations and GPU segment order. Normal preview and export remain Remotion.
- Compare mode (`?renderer=compare`) now plays the Rust preview in a worker on its own clock, through the engine's new preview session (`crates/preview`: playback clock, frame scheduler, preview states and recovery from a lost GPU device). When the Remotion Player plays or pauses, the Rust preview plays or pauses from the same position; the panel shows dropped frames and the drift between the two playheads in frames. A slow Rust frame no longer blocks the editor. The storyboard goes to the worker only when it changes. Without the parameter neither the worker nor the renderer module is requested.
- Exports draw emoji in color. The production image installs `fonts-noto-color-emoji`; before, every emoji in an export was an empty box.
- **Breaking:** a media import request key (`x-upload-id`) must be a client-minted UUIDv7 media ID; any other key gets `400`. Documents no longer use `pending:<requestKey>` references, and nothing resolves them.

- Caption generation accepts rounded TTS clip durations while decoding only available source audio. Clips whose selected interval exceeds the source by more than 50 ms still fail validation.

- Silent Motion Studio previews no longer wait for audio-device initialization before playback.

- Rebranded application and repository references to Maleo, including supplied logo, README, browser icons and PWA installation assets.
- **Breaking:** packages now use `@maleo/*`; first-party environment variables use `MALEO_*` with no aliases. Rust/WASM, services, database defaults and resource names use Maleo. Existing installations require explicit offline settings/envelope conversion and preserved data/secret values before boot; see self-hosting cutover. Replace MCP API keys and client configuration. Editor pane proportions reset once.

- Video export source downloads now time out after two minutes and abort stalled body transfers, so a connection stall cannot leave the render worker occupied indefinitely.

- Render workers now finish bundle warmup before processing jobs, preventing prepared media from being written outside the served directory during startup.

- Export video playback now uses Video.js controls for seeking, sound, playback speed and fullscreen. Player licenses ship with the web app; timeline preview remains on Remotion.

- Video export rows now match the Projects list: every attempt shows a preview or status placeholder, its status and facts, running progress or a failure cause, and one action at the row end. Screen-reader names identify each attempt by project, status and creation time. Details hold playback, diagnostics, retry, download and Open project. Collection filters keep their own width beside the search field, and Projects and Video share one pager.

- Video now lists workspace project exports with project-title search, status/project filters, paging, managed previews, playback and download. Project export progress recovers after refresh and return navigation. Connection failures retain last progress and offer reconnection. Fast browser drafts remain available only in their current session.

- Video export preserves authored scene boundaries, gaps, and narration. Later clips no longer stretch earlier scenes during preparation, so scenes end at the same time as preview.

- Storyboard exports preserve original image dimensions and transparency. Image preparation no longer adds an automatic crop before the authored clip layout, keeping exported framing consistent with preview.

- Export preflight validates text, audio, and infographic overlays by their clip type. Valid text font-size and color keyframes no longer trigger a false invalid-keyframes blocker.

- Production video export now includes an internal render worker, matching API authentication, a preinstalled render browser, and persistent render jobs in both self-host and Coolify stacks. Existing installations must set `MALEO_VIDEO_TOKEN` before deploying.

- Autosave keeps the stored caption fingerprint before load-time lane migration. Duplicating a voiceover with linked captions no longer raises a false `caption_conflict` after the editor rearranges legacy lanes. Concurrent caption edits remain protected.

- Caption recognition runs separately for audio spans divided by timeline gaps. Cues stay inside each span, leaving the gap empty while preserving overlapping-source mixing and timeline offsets.

- Captions reuse their existing lane after deletion, across recognition, SRT import and fresh narration. Timeline cleanup removes redundant empty caption lanes from earlier generation attempts while preserving occupied lanes and mute, hide or lock settings.

- Captions: an empty timeline with deleted captions now exposes the keep-or-replace choice. Completed jobs report when protected captions or deletions prevent every generated cue from being added, instead of claiming captions are ready.

- Preview Play passes its click event to Remotion during capture so the player can unlock shared audio on iOS.

- Generated videos start faster in the browser and show a server-made thumbnail.

- Preview playback retries a stalled frame clock twice, then pauses and shows a notice if playback cannot continue.

- Preview playback loads video clips 2 seconds before their start to reduce pauses at clip boundaries.

- Video thumbnails on phones: timeline video clips without a stored thumbnail and the media browser's video tiles now show their first frame in iOS Safari. Before, they stayed blank.

- Local captions: the image now ships a prebuilt whisper.cpp 1.5.5 at `/opt/whisper.cpp/main` (`MALEO_WHISPER_CPP_BIN`), so the Settings install downloads only the model and no longer needs git, a compiler or GitHub access in the container. The runtime image drops Git, Make, C++ and CMake. `MALEO_WHISPER_CPP_VERSION` is set by the image; change the version in the `Dockerfile` `whisper` stage. A truncated model download is removed so a retry downloads it again.

- Local captions install: a failed install shows the media worker's reason (for example a failed `make`) instead of `install_failed`. A retry after a failed build now rebuilds whisper.cpp; before, the leftover clone made every retry skip the build.

- Captions panel leads with results. Projects without captions open on one generate card; projects with captions open on the caption list, with Regenerate, Import SRT and Export SRT in the panel's overflow menu. Sources show media names and `m:ss` times instead of internal ids, Generate is always visible with its unavailable reason beside it, and regeneration asks once whether to keep or replace edited captions. Cue rows show time and text until selected. Enter splits a cue, Backspace at the start merges it, Shift+Enter adds a line break, and Cmd/Ctrl+Z in an unchanged caption field undoes the edit. Caption lanes have their own colour and icon and show one line of cue text.

- Editable captions: generate from admitted audio or video through the media worker, import/export SRT, correct timestamped cues, split/merge/delete, and style all captions or selected cues. Caption lanes share timeline gestures and undo. Whole phrases remain fixed while word emphasis changes. Scoped generation protects corrections/deletions, resumes known jobs, and refuses stale results. New narration creates canonical script-assisted or estimated cues; historical voiceover words are not backfilled.

- **BREAKING: AI is video-only; image and text projects are retired.** New projects can only be video: the create flow offers video alone, and the API refuses to create a project as, or change one to, `image` or `text`. The one-shot `POST /generate` endpoint is removed; nothing called it. Existing image and text projects still open and save as manual editors, but have no chat, quick commands or image generation. The project chat, MCP `run_agent`, research, reads and edits refuse them. The carousel and thread workflows, their slide and post tools, and the image and text agent instructions are gone, and the AI Explorer no longer lists them. **Back up your database before upgrading:** migration 0008 deletes the stored chat transcripts and agent runs (with their steps, tool calls and pending actions) of every image and text project. Their projects, slides, posts, generated media and billing records are kept.

- Contributors: lint and formatting tooling now comes from Vite+ 1.1.0 (`vp lint`, `vp fmt`), configured in root `vite.config.ts`, which loads the existing `oxlint.config.ts` policy. Standalone `oxlint`, `@oxlint/plugins` and `oxlint-tsgolint` are removed; tooling requires Node 22.18+ or 24.11+. Workspace typecheck and build run through `vp run` (uncached) instead of Turbo, which is removed. Portable tests run on Vitest (`vp test`, imports from `vite-plus/test`, one project per workspace in `vite.config.ts`); 250 suites whose exercised production code needs the Bun runtime are renamed `*.bun.test.ts` and stay on `bun test` (`test:bun`). A workspace `test` script runs its Vitest project and accepts a file path; `test:focus` is removed. `bun run test` measures branch coverage of editor commands and credit policy and fails below the recorded floors (`docs/development.md`). CI sets up Vite+ with `voidzero-dev/setup-vp`. `bun run check` gates the whole repository with `vp check`, and `bun install` installs a pre-commit hook that checks staged files (`docs/development.md`, "Commit hooks").

- Contributors: seven one-off root migration scripts that imported database modules removed in the Postgres move, and so could no longer run, are deleted: `migrate-reference-entities`, `migrate-reference-evictions`, `migrate-asset-mirror`, `dedupe-reference-entities`, `migrate-style-knobs`, `migrate-timeline-template-fields` and `backfill-scene-section-provenance`.

- AI Explorer replaces Pipelines & Tools with Workflows, Tools and Instructions. Desktop browsing uses compact workflow, stage and contextual-inspector columns; phones navigate sequentially with Back. Execution stages use compact list rows with unique tool/instruction reference totals and no arrows. Selection shares Providers and Security & Storage’s full-row targets, foreground marker and no-fill styling. Technical tables retain the previous drawer’s framed, locally scrolling presentation through shared TableScroll. Stage purpose and actual operations, tools, instructions and conditions appear immediately; complete contracts, sources and fidelity evidence stay under Technical details. Capability/purpose browsing comes from production-owned catalog metadata. The page matches Providers and Security & Storage: Instance heading with a plain lead, settings tab row, muted column titles and a large detail title; steps show their purpose; details read as plain label/value facts with chip links and omit empty facts. Chips open a right drawer with the same detail, leaving the selected step in place; workflow details now separate the chat assistant's instructions and tools from the workflow's own steps. URL selections, query, disclosure and inspector history survive reload and Back/Forward; execution behavior is unchanged.

- **BREAKING: `create_story_video` now plans like `plan_story`.** The one-shot build asks before replacing an approved plan (and on Reject keeps it and generates nothing), routes free-text direction, and asks the pre- and post-research story questions unless the request says to skip them or build in one shot; then it approves implicitly and generates as before. **Runs paused before this deploy cannot continue:** a run waiting on a planning question or approval under the previous planner, or paused by the agent loop before the Mastra runtime, ends in an error or times out when answered; start the request again.
- Video planning now runs as a workflow definition — plain data run by one engine inside the agent's `workflow-plan_story` call — and its prompts are data templates rendered by one compiler, byte-identical to before. A run saves its progress after every planning step, so a restart or retry never repeats a finished step, and a retried model call is charged once. The AI Explorer reads planning's steps, conditions and prompts directly from those definitions and templates. Contributors: definitions, the engine and templates are described in `apps/api/docs/agent-pipeline.md`; the planning source generator and `templates:generate`/`templates:check` are gone.

- Selectable sandbox video generation produces four-second silent MP4s through the media worker without AI credentials or a sandbox flag; editor and agent animation share provider selection, show video-frame thumbnails, preserve source duration, and cap clips at source length while allowing shorter trims.

- Story images now require authored beat visuals before generation, including
  silent beats. Direct scene frames send structured scene, style and project
  constraints to the selected image provider. Contributors: sequence and beat
  authoring have separate modules under `apps/api/src/lib/story/`.

- Template editor and Motion Studio use the timeline editor's shared pane, inspector and timeline styling, including compact-height rows and distinct filled clip colors; previews fit their panes, desktop studio modals use media-black body housing with theme-colored header/footer, the timeline toolbar and ruler stay visible while all lanes scroll into view, and inspector help captions are removed.

- Contributors: Rust now owns editor command execution across web, API and shared helpers. Command/scope structure derives from generated Rust types; the TS executor and shadow helpers are retired. Golden fixtures and 1,111 frozen TS results retain compatibility checks.
- Reloading while an agent approval waits preserves intervening manual scene edits; stale run snapshots are no longer previewed. Recovering extracted source audio also clears a newer derivative when the prior revision had none.

- Reverse, playback rate and audio extraction work again on a clip placed while its file was uploading, once the upload finishes, and on a clip whose media was relinked and then undone: the editor finds a clip's media by its asset id, not its URL.
- Agent edits to an existing timeline are executed and saved by the same Rust engine the editor uses. A run that only edited the timeline no longer overwrites a version saved while it worked: its edits are re-applied onto the newest version, and when you had changed the same clip nothing is overwritten and the run reports the conflict. Reloading the editor while such a run works no longer applies its edits twice.
- **Imported media files are limited to 50 MB** (was 500 MB), below the 100 MB request cap of the Cloudflare edge the deployment sits behind, where larger uploads failed. A larger file is refused before it uploads, and the message names the limit.
- On a phone, the clip Trim controls show In and Out on their own lines again; the Out label had covered the In step-forward button.
- **Use media while it uploads.** A file you drop on the timeline is placed at once, and a file you import into All Media is ready to place at once, before its upload and processing finish. It previews from your browser's copy and switches to the processed media when the import is ready, without an extra Undo step and without moving or re-timing its clips. A file whose length the browser cannot read waits for processing and says why. Its card and every clip that uses it show the upload's progress, then Processing, Failed or Interrupted, on desktop and phone; Server render waits for it and says which file, while Fast render can use your browser's copy and says so. Reverse, playback rate and Extract audio wait for the upload to finish. Reloading the page resumes an unfinished upload from a copy the browser keeps; if the browser no longer has the file, the asset says it was interrupted and asks you to choose the file again, which is checked against every place it is used. Removing a failed upload removes its clips as one Undo step, and a clip that turns out longer than its processed source blocks export until you trim it. Contributors: the session resolver is `apps/web/src/models/core/pending-media-sources.ts`; saves write ready imports as managed URLs.
- Contributors: groundwork for using media while it uploads (OpenSpec `use-media-while-uploading`). Documents may reference a file still importing as `pending:<requestKey>` (`@maleo/shared` `pendingMediaUrl`/`pendingMediaRequestKey`), and `GET /projects/:id/media/import/request/:requestKey` resolves one key from stored state. Production export refuses a timeline that uses a pending file, naming it, and agent edits leave its clips unchanged. Saves now refuse `blob:` media URLs and `data:` URLs other than small images, naming the field, without writing a version.
- When the chat agent edits an existing timeline (a scene's text or duration, removing a scene, a clip's position, keyframes, or placing a title, infographic, sound or overlay), the editor applies exactly the edits it made, as one Undo step, instead of reconciling a copy of the whole timeline. Clips the agent did not touch stay as they are, and a scene the agent shortens or removes leaves the scenes after it where they were, as it does when you edit by hand. If you changed one of the same clips while it worked, or a clip it edits is gone, nothing is applied and the chat says why. Contributors: agent editing tools emit `@maleo/shared/editor` commands through `edit-document.ts` (see `apps/api/AGENTS.md`); `diffScopeToCommand` moved to `@maleo/shared/editor`, alongside the new `sceneEditCommand`.
- Contributors: `packages/vui` is gone. The timeline's view-model (model, store, engagement, geometry, time types) lives in `apps/web/src/models/timeline-view/`, the renderer contract and its conformance suite in `apps/web/src/controllers/playback/`, and the editor's document contract is the executor conformance suite in `@maleo/shared/editor`. Edit policies, timecode and snapping run in the Rust engine; the kernel's answers are kept as frozen references the engine is tested against. `bun run dev` builds the engine's WASM before the web starts (rustup required), and the `check:vui-references` script and the VUI build gate are retired.
- The web editor now edits through the Rust editor engine: every edit, undo and redo runs in it, and timeline drags and trims use its edit policies. The editor waits for the engine to load before it opens, and says so with a Retry if it cannot. Contributors: the engine arrives as `/editor-engine.wasm`, built by `bun scripts/editor-engine.mts build` locally and in its own Docker stage. Motion Studio and the template editor no longer open kernel transactions they never read.
- Contributors: the Rust editor engine now carries exact project time — rationals, timebases, project/source ticks, SMPTE timecode with drop-frame — and clip retiming and transform sampling, held to 1,745 TS reference values in `packages/shared/src/editor/reference/` (regenerate with `UPDATE_EDITOR_REFERENCE=1 bunx vp test run --project scripts editor-time`).
- Contributors: the Rust editor engine now also carries the timeline edit policies (trim, ripple, roll, slip, slide, placement and overlap, linking, snapping, the cross axis) behind a gesture handle, with the same projections and operations as the VUI kernel on every generated gesture.
- Contributors: the Rust editor engine (`crates/editor-core`) now executes all 30 editor command types, including resize, trims of scene, visual and keyframed clips, and key edits, with the same scope and inverse as the TypeScript executor on every corpus and fixture edit.
- Production renders the editor the way development does: the reference library rail keeps its 16px padding and the audit panel its grid layout, where the production bundle's stylesheet order had let other rules win. Contributors: every stylesheet now keeps its rules in a cascade layer (`src/styles/cascade-layers.test.ts` checks all of them, not only sheets that already declare one), and the browser-test server runs without hot reload (`MALEO_WEB_HMR=0`), so it bundles CSS the way production does.
- Pressing Play while the preview is still loading now starts playback once it loads, instead of showing Pause over a timeline stuck at 0:00.
- On a landscape phone the Elements panel's list scrolls into view again, so Motion Studio and the other elements can be opened in landscape.
- Contributors: the editor workspace's structural stylesheet moved from `@maleo/vui/styles.css` into `apps/web/src/components/editor-workspace/editor-workspace.css` (cascade layer `workspace`, formerly `vui`), and its colours resolve to the app's tokens there.
- With a dialog open above a sheet, the device Back button no longer closes the hidden sheet underneath; Back closes only the overlay that is on top, when that overlay is one Back dismisses.
- Contributors: DOM, media, React and Remotion presentation moved into `apps/web` under `controllers/`, `services/`, `components/editor-workspace` and `hooks/editor-workspace`. The surface performance budget lives in `docs/editor-surface-budget.md`.
- Contributors: a root Cargo workspace adds `crates/editor-core`, the Rust editor command engine being migrated to (OpenSpec `migrate-editor-to-shared-rust-core`). `bun run ci` now includes `bun run check:rust` (fmt, clippy, tests, WASM build) and needs rustup, which installs the toolchain and `wasm32-unknown-unknown` target pinned in `rust-toolchain.toml` (`brew install rustup` on macOS).
- Undoing a scene marker removal puts the marker back in its original position instead of moving it to the end.
- Undoing a carousel slide or thread post edit now removes fields the edit added, such as a new slide name or post seed, instead of leaving them behind.

- Space controls editor play/pause even when buttons or options have focus; text entry and independent modal scopes retain their keys. Enter activates controls.
- Option pickers use shared custom dropdowns on desktop and bottom sheets on phones, with keyboard selection, unavailable/disabled states, form values and nested Back/focus recovery.
- Rectangle and Circle have their own Shapes category and inspector controls for fill, stroke, width and rectangle radius. Shape numeric parameters, including zero opacity, render consistently in preview and export.
- Workspace and God Mode navigation share SidebarNavigation; app, account and editor headers share Topbar styles and slots.

- Add static Text, Rectangle and Circle basics and compact square Elements preview tiles, with default content independent of selection, category tab bar below search, scoped New actions and autoplay previews, retaining click/drag placement and saved elements. Text clips use ordinary property keyframes; the duplicate Animate editor is removed.
- Edit clip Entrance and Exit in separate, initially collapsed inspector sections showing selected effects in their headers, with independent presets/duration and replay in the main preview; clip edge triggers/indicators are removed. Shared-boundary Transition editing stays inline. Selected-key Curve easing lives beside properties, with no animation dialogs or toolbar easing. Moving clips apart removes their transition on drop; cancellation preserves it and undo restores both.

- **BREAKING (stored format):** Text overlay animation joins the clip keyframe model. Keys are stored in `layout.animation` in clip-local seconds, and old normalized `anim` is converted when a project opens. Text animates the same position, scale, rotation and opacity as visual clips, so old text motion that moved the text inside a fixed box now moves the whole box, background included. Resizing a text overlay now trims its animation instead of stretching it. Keyframes gain a Hold interpolation that steps at the key. Scene camera motion and Motion Studio are unchanged.

- Keyframes work like OpenCut's. Each animatable inspector property has a keyframe toggle before its label, and editing a keyed property keys the playhead (an edit within 0.1 s of an existing key updates it). The selected clip shows its keyframes on its own timeline bar: click, Shift-click or box-select them, drag or nudge to retime, Delete to remove, and set Linear / Ease / Hold from Curve in the property inspector. Expand keyframes, Copy keyframes and Paste keyframes are in the clip's right-click menu. The agent can animate clips with a new `set_keyframes` tool.

- The clip inspector is regrouped: each clip kind lists its own content first (Text, Source, Data or Audio), then Transform, Blending, Audio, Timing, Masks, Adjust and Reveal/Motion, each with its own icon. Opacity and blend mode moved to Blending, masks and colour adjustment have their own groups, and playback rate moved to Timing.

- Timeline chrome:
  - The playhead spans the whole timeline panel.
  - The track headers sit outside the horizontal scroll, and the mouse wheel scrolls lanes vertically.
  - The ruler counts down to single frames when zoomed in.
  - Lanes take their height from what they hold (scene, visual, audio, then text/data/effect).
  - The lane holding the selection is tinted.
  - The playhead can be focused and stepped one frame with the arrow keys.
  - The toolbar adds Duplicate, Delete, a Snapping toggle and a Ripple editing toggle. With ripple on, trims and deletes close the gap, and Shift+Delete inverts it.

- Style panel edits in place: Creative direction, Style reference, Brand (accent, chapter pills, pill style, progress bar, watermark, background) and Data callout are collapsed sections with inline controls and per-property default actions, instead of rows that open a separate detail drawer. Caption font moved out of Style; the Captions tool owns it.

- MCP clients can call the agent's edit and generate tools directly (`add_slide`, `update_scene`, `generate_slide_image`, ...). Each call runs as a one-tool run in the project chat, waits for approval before changing existing work, is metered like the agent's call, and is traced to the key's owner.

- Remember desktop editor panel sizes across reloads; default rows to 50%/50% and tools/preview/inspector to 35%/30%/35%. Chat shares tool-panel sizing and hides scrollbar chrome while remaining scrollable.

- Add ordinary clip transform and gain keyframes with timeline lanes, inspector controls, keyframe copy/paste, easing, undo and phone access; preserve animation through source cuts, rate changes and production rendering.

### Removed

- **Breaking:** infographics are removed. The `infographic` clip type, the `data` lane group, the Data element family in the Elements rail and Library > Elements, the infographic inspector, the data-callout style controls, the `add_infographic` agent tool, the `infographic` presentation and the `motionGraphic` decision on scenes, sections and beats are gone, and the Remotion renderer no longer draws infographic overlays. Use a text overlay or a generated image to show a number. The editor engine refuses a clip of type `infographic`.
- Stored projects still open, edit, save and export. The storyboard read drops infographic clips, `infographicStyle`, `infographicOverlays`, `infographic_overlays`, a scene's `motionGraphic` and a lane flag of group `data`, and names each in the read diagnostic's new `dropped` list; the next save writes a version without them. Stored versions are not rewritten. A stored plan beat with the `infographic` presentation reads as `narrative`. Content presets drop `infographicStyle` on read and on write, and timeline templates drop `useData`. Migration `0012_remove_custom_data_elements.sql` deletes custom elements of kind `data` and moves any element in the `data` category to `text`.

### Added

- **Clip compositing.** Rectangle/ellipse masks with local move/size/rotation, feather and inversion; direct canvas handles and phone inspector controls; normal/multiply/screen blending and resettable brightness/contrast/saturation share preview/export rendering, undo and saved state. Invalid fields block save/export; simplified drafts disclose omitted compositing.

- **Extract and recover source audio.** Detach aligned video sound as one media/document edit, suppress embedded playback, undo or reload, and explicitly keep/discard independently edited audio during recovery. Silent sources disable extraction. Narration growth holds the selected scene frame without extending or repeating its source soundtrack; agent edits retain authored playback controls.
- **Source playback controls.** Video/audio constant rate (0.25x–4x), explicit pitch preservation and processed reverse audio retain source bounds, gain, fixed neighbor starts, cancellation and one-step undo. Preview and production export share processed soundtrack mapping; draft omissions are disclosed.
- **Timeline bookmarks.** Add, name, move, navigate and remove independent points from timeline tools or ruler, including phones. Undo and reload preserve them; shortened projects retain out-of-range points with recovery instead of extending exports.
- Reverse selected video ranges with source audio, cancellation, one-step undo, reload retention, and shared preview/export sampling; block unresolved processing and disclose simplified-draft omissions.

- **Source-aware cuts.** Split and trim preserve video/audio in-points and respect measured source bounds, including scene videos. Trim before/after playhead is available through timeline menu, Q/W, and phone Clip actions; neighbors stay fixed, locks refuse edits, and each cut undoes once.
- **Source crop and flips.** Image/video Transform controls select source pixels and flip horizontally or vertically in preview and export. Cropped media preserves intrinsic fit before rotation; edits support undo, reset, and reload on desktop and phones without replacing original files.

- **Media import processing contracts.** Project-owned quarantine sources, measured metadata, separate preview/render compatibility and durable worker probe/thumbnail/normalization jobs. Processing readiness names missing FFmpeg/ffprobe; cancellation, limits and stale source revisions prevent ready publication on failure.
- **Manage project media.** Switch grid/list, sort source facts, select files independently, rename project labels, and navigate source usages. Bulk placement/removal uses one undo step; referenced files and shared stored media stay protected.
- **Replace or relink media.** Media details accepts a replacement file on desktop and mobile. Validated source ranges update all project uses in one undo step, preserve identity/provenance and retain earlier sources. Wrong type, short sources, locks and stale completions keep original references; waveforms invalidate when source changes.
- **Import personal media.** All Media accepts image, video and audio files through a native picker or batch drop, with individual status, retry and cancellation. Picker, panel drop and clipboard files stage without creating clips; timeline file drops place after processing with one undo/redo for media and clip. Media details show source facts with native playback and retry; pending imports resume after reload, and Retry save keeps metadata after a failed write. Known incompatible or missing managed sources block production export. Desktop and mobile retain existing generation, references and stock actions.

- **Projects terminology.** Project inventory, desktop/mobile navigation, search, and creation now use Projects and New project. Existing project links and editor content controls retain their behavior.
- **Project inventory.** Thumbnail-led list/grid views, authored video duration when known, and global name/modified sorting in both directions. Missing previews stay openable; unknown duration stays explicit.
- **Editor panes.** Bordered desktop tools, preview, and inspector above a full-width, resizable timeline. Preview retains project aspect as panes resize; mobile sheets and Editor/Chat workspace keep their existing housing.
- **Media placement and canvas basics.** Ready image, video and audio assets have explicit keyboard/touch placement. Native drags show source thumbnails and snapped destination/duration feedback, refuse locked or stale sources, and undo once. Canvas aspect and background are available in the contextual inspector; advanced settings remain available.
- **Preview transforms.** Direct rotation, proportional resize, alignment guides, keyboard controls and touch handles. Completed gestures undo once; cancellation and track locks leave authored values intact. Infographic rotation and opacity now follow their inspector values.

- **Connect an MCP client from your account.** Account → MCP creates a personal key (shown once, with an expiry) and gives the setup for Codex CLI, Claude Code, Cursor and VS Code with the key already in it, so connecting is one copy and paste. Keys are listed and can be deleted there. The endpoint is `<your site>/api/mcp`, the same origin as the app.
- **Use a local or extra model with the API provider.** `MALEO_AI_API_MODELS` (or Extra models in the provider's settings) adds comma-separated model names the endpoint serves, such as `llama3.2` or `qwen2.5:7b` on a local Ollama.

- **Design-system decision skill for agents.** `web-design-system` resolves UI patterns, canonical components, tokens, ownership, and extension requirements before implementation, then guides contract validation against Storybook and production UI.

- **Drive projects from an MCP client.** `POST /mcp` serves MCP clients such as Codex CLI and Claude Code. A client authenticates with a user-owned API key sent as `Authorization: Bearer <key>` (created through `POST /api/auth/api-key/create` while signed in; there is no settings screen yet). The key reaches only projects in workspaces its owner belongs to, and stops working if the owner is suspended. Keys are limited to 300 requests a minute. The tools:
  - `list_projects` and `get_project`;
  - the read tools for a video project: `view_timeline`, `read_skill`;
  - research: `search_web`, `read_web_page`, `research_topic`;
  - `run_agent`, `get_run`, `answer_action` and `cancel_run`.

  A client changes a project only through `run_agent`, under the same approvals as the project chat. Nothing that edits or generates is served directly.

- **Give a workspace's agent tools from MCP servers.** An instance owner configures servers for a workspace with `PUT /api/mcp-servers/<name>?workspace=<ws>`, taking `url`, `allow` (the server's tool names the agent may call) and optional `headers`. `GET` lists them, and `DELETE` removes one. Headers are stored encrypted and listed by name only. Only the allowlisted tools reach the agent, and each call shows in the run like the agent's own. A server that cannot be reached is reported once in the run, which carries on without its tools. Removing a workspace removes its servers.

- **A pattern catalogue for contributors and agents.** `docs/design-system/patterns.md` lists the 21 UI patterns as Approved (built, with import and story) or Candidate (specified only), with the steps to follow before writing UI. A test keeps the list in step with the code.

- **Popups work inside dialogs.** Popovers, menus and the colour picker opened from a dialog or sheet are reachable by keyboard, and Escape closes the popup before the dialog. The colour picker closes on outside click and Escape, and typing a hex value no longer resets the colour.

- **Tooltip component.** `<Tooltip label>` shows a hint on hover and on keyboard focus, which a native `title` never did. The image viewer, media frame, audio preview and colour control now draw from the shared tokens and components.

- **Button `loading` state.** `<Button loading>` announces `aria-busy`, shows a spinner, ignores presses and keeps keyboard focus; dialogs now take their title and spacing from the type and spacing roles.

- **Storybook for the web UI.** `bun run --cwd apps/web storybook` renders components with the app's stylesheet, tokens, fonts, and light/dark theme, organized as Foundations, Components, and Patterns. Every `components/ui` primitive has stories for its variants and states, and the primitives are now canonical — built only from foundation tokens, with defined hover/focus/pressed/disabled states and no legacy classes for other stylesheets to paint (`Components/Overview` lists them). Button variants are now named by purpose (`primary`, `secondary`, `ghost`, `accent`, `danger`); Input, Textarea and Select share one field recipe in three sizes; IconButton sizes follow the control scale and `on` announces `aria-pressed`; new canonical ToggleGroup, Toggle, Popover (moved from the timeline), ContextMenu, Spinner, Progress and Separator; `Foundations` documents the visual grammar as live pages (Overview, Colors, Typography, Spacing, Sizing & Density, Radius, Borders, Shadows & Elevation, Icons, Motion, Theme Check) with in-page WCAG contrast checks, and `Patterns/Inspector` adds the first executable patterns, `InspectorSection` and `PropertyRow` (`apps/web/src/design-system/patterns/inspector.tsx`), with realistic Transform and Audio compositions at the inspector's real widths. `Input` and `Select` gain `size="xs"`, a filled 24px editor field; `Switch` gains `size="sm"`; a canonical `Slider`, a scrubbable `NumberField` ported from OpenCut classic (MIT), and a `--r-0` radius step support the dense editor tier; the colour palette is now OpenCut classic's neutral greys and blue accent, adjusted for WCAG AA; radius is four roles (none, 4px controls, 8px floating surfaces, pill), icon sizes are a named scale (`ICON.xs`–`display`) enforced by `check-layers`, new semantic tokens cover raised and overlay surfaces, disabled text and subtle borders; the interface no longer uses a monospace or the uppercase micro label — labels are 11px sentence-case Space Grotesk, digits align by tabular figures, and JetBrains Mono is no longer loaded; icons are now Lucide, drawn through the existing `Ic` registry, which also replaces the hand-drawn glyphs that lived in timeline, image-lab and frame components, the unchecked `Switch` track is now visible on panel surfaces, a disabled `TabsTab` now renders dimmed, and `Shimmer` and `AlphaColorControl` carry their own styles instead of borrowing the editor and timeline sheets. See `apps/web/stories/README.md`.

- **Account menu, account pages, and a standard shell.** A user menu in a new top bar shows who is signed in and leads to Profile (display name), Security (change password, which signs out other sessions; list and sign out other sessions), Preferences (light, dark, or system theme), and Sign out, which the web app previously did not offer. The top bar carries the sidebar toggle (now remembered per browser), breadcrumb, search, credits, and theme at every shell route including God Mode. The workspace switcher now leads to workspace settings and members, the sidebar footer holds God Mode and the running version, and account pages open without the sidebar. The API disables better-auth's one-day session freshness gate so the session list works for long-lived sessions.

- **God Mode manages the deployment.** Instance owners now have a separate sidebar for users, workspaces, project metadata, registration, providers, security, usage, and audit. Account and workspace actions enforce last-owner and final-workspace safeguards (serialized, so concurrent deletions cannot remove the last workspace), new workspaces require a named owner, and privilege or access changes ask for confirmation; instance ownership alone does not open workspace content. Global settings routes require instance ownership, while old `/settings/*` links lead to their God Mode equivalents.

- **Web controls now use Base UI and shadcn Base Nova recipes more broadly.** Buttons, form fields, checkable controls, audit tabs, badges, and alerts use Maleo tokens with keyboard and phone coverage. `apps/web/DESIGN.md` documents the authoring path.

- **Local setup and checks now run from one documented path.** Setup verifies
  Inngest and applies database migrations; dev waits for API, web, and Inngest
  readiness. `bun run check` provides fast feedback, while `bun run ci` includes
  browser visuals. Turbo schedules workspace tasks and caches the verified VUI
  build. Package tests use isolated runtime data.

- **`scripts/reset-password.ts` resets a forgotten password.** The deployment
  sends no email, so an operator locked out of their account had no way back
  in short of hand-written SQL. Run it from the api container (or
  `bun run auth:reset-password <email>` locally); it reads the new password
  from stdin, stores an argon2id verifier, and clears the sign-in lockout.
  Documented in `docs/self-hosting.md`.

- **Guides moved to `docs/`, one per task.** `docs/self-hosting.md` covers
  running a deployment — environment, media store, backups, account recovery —
  `docs/coolify.md` the Coolify steps, and `docs/development.md` running,
  restarting and verifying locally. `infra/inngest/README.md` now holds only
  what is local to its compose files, and the README keeps the quickstart.

- **RustFS replaces MinIO as the self-hosted media store.** Every MinIO
  community image was withdrawn from its registry — `quay.io/minio/minio` and
  `minio/mc` answer 401 on every tag — so the previous stack could not be
  deployed at all. the core stack runs an S3-compatible server whose images are
  published, creates the private bucket idempotently, and now applies the
  browser origin allowlist as bucket CORS rather than a server-wide variable,
  which the MinIO community build could not do. Every `MALEO_MEDIA_S3_*`
  variable keeps its name, and R2 or S3 remains a configuration change away.
  RustFS 1.0 has a single key pair, so the application credentials also
  administer the store — recorded in `docs/self-hosting.md`.

- **A deployable core stack.** Web, API, and media worker each have an image
  that describes only what they run, and one Docker Compose resource deploys them
  with the self-hosted Inngest server so they resolve each other by name.
  `ffmpeg` is installed where the runtime shells it rather than assumed. A root
  `.dockerignore` takes the build context from 52 GB to 19 MB, and
  `bun run check:deploy` fails when it grows again, when a shelled binary is
  missing from an image, or when two function hosts claim one Inngest app id.
  The Inngest server is pinned, healthchecked against its database rather than
  its socket, kept off the public proxy, registered on every deploy, and pruned
  of finished-run history after 30 days. Deployment configuration is recorded in
  `infra/inngest/AGENTS.md`.

- **Private object storage for new media.** Images, speech, uploads, voice
  references, and video renders use stable workspace-authorized URLs backed by
  S3-compatible storage. Self-hosted MinIO, a migration dry run, and conservative
  cleanup tools are available. Historical storyboard media resolves through the
  migrated object registry when a project is reopened. Production requires
  storage credentials; local development can explicitly select disk storage.
  Old worker jobs with a trusted owner were moved to storage; unowned or missing
  legacy job results now report an explicit failure. Worker cache is scratch and
  is no longer served over `/files`. Signed-URL lifetimes are configuration, not
  fixed values: `MALEO_MEDIA_URL_LIFETIME_SECONDS` bounds a browser download and
  the new `MALEO_MEDIA_EXTERNAL_URL_LIFETIME_SECONDS` bounds a URL handed to an
  external generation provider. Media that a browser cannot render safely —
  SVG among it — downloads instead of rendering inline.

  Objects are keyed `workspaces/<workspace>/<kind>/<project>/<uuid>-<filename>`,
  so a bucket listing groups by owner and names each file. Every write gets its
  own key: identical bytes stored twice are two objects, which costs duplicate
  bytes and means deleting one project's media can never remove bytes another
  still needs. A workspace name that is not usable as one path segment fails the
  write rather than being rewritten into one.

  **Objects written before this key layout are not readable and must be re-keyed.**
  An earlier iteration addressed objects by the SHA-256 of their bytes; those keys
  no longer validate, so a store holding them serves nothing until each object is
  copied to a key of the new shape and its `media_objects.storage_key` updated.
  Media IDs are unaffected, so persisted `/api/media/<id>` URLs keep working once
  the objects move. No bytes are lost — legacy sources are retained — but a
  deployment that already ran the importer needs this pass before its media reads
  again.

- **A Manage section, with workspace administration in it.** The sidebar gains
  Manage, holding Workspace and the existing Settings page. The workspace
  surface has General (display name and a new description), Members, and a
  separated Danger Zone.

  **Invitations** are single-use links an owner creates and copies — no mail
  transport is required, and none is used. A link expires after 48 hours, works
  once, and can be revoked. Redeeming one creates an account and its membership
  together, which is the second way onto a deployment with registration closed;
  someone already signed in gains the membership on the account they have.

  **Deleting a workspace is permanent and cascades.** It removes the workspace's
  projects, storyboards, renders, outputs, events, generation history,
  references, voice clones, materials, assets, durable run history, its credit
  account and balance, its memberships and invitations, its directory on disk,
  and the files it uploaded. In-flight runs are cancelled first. Deletion
  requires typing the workspace name, is restricted to workspace owners, and is
  refused when it would leave an owner with no workspace at all. **There is no
  undo.**

- **The API now authenticates its callers, and requires an account.** Sign-in is
  email and password over a server-side, revocable session cookie. The first
  account created claims the deployment and becomes its owner; after that,
  registration is closed unless `MALEO_ALLOW_SIGNUP=1` is set. Workspace
  membership decides who may act in which tenant, and the workspace switcher
  lists only the workspaces the signed-in account belongs to.

  **This is a breaking change for any running deployment.** Every path the API
  serves now requires a session, including `/uploads/*` — generated images,
  renders and voice clips are no longer readable by URL alone. Three boundaries
  are deliberately exempt and unchanged: `/api/inngest` (Inngest signing key),
  `/internal/*` (`MALEO_SERVICE_TOKEN`) and `/health`.

  On upgrade: start the app, create the owner account on the screen it presents,
  and the workspaces you already have become yours. A production deployment must
  now set `MALEO_SERVICE_TOKEN` — the API refuses to start without it — and
  should set `MALEO_API_PUBLIC_URL` to the address browsers reach it at, plus
  `MALEO_API_CORS_ORIGINS` if the web client is served from another origin.
  Both are now credential boundaries rather than conveniences.

- **Every open blocker is answered in one place, together.** Unresolved delivery
  checks and story-direction failures are now read from the project rather than
  the chat log, and presented as one pinned card above the composer: one question
  per blocker, one submit. Answering one no longer strips the controls off the
  others, a run that failed still offers its blockers' remedies, and each blocker
  carries "Leave as is" — the card never parks the run or blocks the composer.

### Changed

- **Compact, grouped inspectors.** Inspector values are scrubbable number fields (drag the short label, or type) instead of slider-and-number rows, and values edited together share a row: Position, Size with the aspect lock between width and height, Rotation with the flips, Opacity with the blend mode, the three colour adjustments, start and duration, trim in and out, rate and reverse, and the captions, data callout, reveal, effect and transition settings. One keyframe toggle per row keys every value in it. The size lock keeps the aspect ratio from width: while locked, height follows and is not edited directly.

- **Editor commands are data.** Every editor edit is now a serializable `EditorCommand` in `@maleo/shared/editor`, run by one pure `execute(scope, cmd) → { scope, inverse }` and pinned by golden fixtures that any later implementation must pass. The closure-based `timeline-commands.ts` is gone; undo steps are identified by id. Editing behavior is unchanged.

- Refine editor tools with quieter Style sections, switch-only disabled Captions, top-level Templates header, compact Assets filters and icon views, SVG inspector chevrons, default timeline cursors and full-gap desktop resize targets.

- Project Settings edits Output and Audio inline in inspector sections, preserving provider status, voice audition and default actions without Changed badges or detail drawers.
- Resize desktop tools, preview, inspector and full-width timeline at their boundaries; hidden panel scrollbars and aligned rails free editor space while phone sheets retain their existing housing.
- Compact desktop editor tool titles, shorten Assets tabs to Media / References / Stock, and bring search/import ahead of creation controls. Phone sheets retain clear titles and touch-sized close actions.

- **Workspace layout.** The API moved from `packages/api` to `apps/api`, and the Remotion render server from `packages/video/src/server` to `apps/render-worker` (`bun run render-worker`; `bun run video-server` is gone). Auth and media storage are now the libraries `@maleo/auth` and `@maleo/storage`. Routes, ports, env vars and the deployed image are unchanged.

- Editor property labels stack above values, with adjacent keyframe navigation and consistent filled text, search and multiline fields. Style, Captions and Project settings retain existing actions and mobile access.

- **BREAKING: the project chat runs on the new agent runtime.** Every chat run is now the internal agent on Inngest, choosing its tools and the build, planning and generation workflows itself, with the same approvals, stop and reload. A run left waiting for an answer by the previous version cannot continue: answering it ends it with an explanation, and Resume starts the instruction again on the current agent. Runs need an API text provider (see Removed).

- **Inngest SDK 4 and server 1.45.1.** The api, media and inngest workspaces move from `inngest` 3 to 4.21, a prerequisite for the Mastra durable-agent adapter. Event contracts are now typed triggers (`agentRunRequestedEvent.create(...)`); `contentType` on `agent/run.requested` and `workspaceId` on `generation/requested` are required rather than defaulted, since every producer already sent them. The deployed `inngest/inngest` image moves from v1.36.0 to v1.45.1, the version development already ran. A self-hosted deployment must update the server with the release.

- **Screen readers hear a chat run's stage change.** The newest run announces its stage as it moves on; the progress count does not interrupt.

- **Chat runs, messages and tool activity share one build.** No visible change: the same status line, progress bar, tool lines and error block, now reusable outside chat.

- **One prompt box for chat, images and speech.** The three composers share one build: the same send button, the same Enter behaviour, focus shown once on the box, and a draft that stays put when a send fails.

- **Media cards share one build.** The image gallery, reference library, editor media browser and stock results use the same card and grid: one selected look, one "unavailable" state, two columns on a phone.

- **One play control for every timeline.** The editor and both studios use the same transport; a screen reader hears "Play" or "Pause".

- **Toolbars share one build.** The timeline bar and the search-and-filter strips above Content, Library, Images and Speech use the same toolbar, group and action components; filter chips look the same on all four. In the docked editor the timeline bar's controls no longer overlap.

- **Generate and Improve look like any other main action.** The blue button reserved for AI actions is gone; they use the primary button.

- **The editor uses the app's typeface.** Timeline, inspector and studio chrome rendered in the system font; they are Space Grotesk now, like every other screen. Text of 14–17px moves onto the Body and Panel title sizes.

- **Small text and spacing sit on the scale.** Sizes between steps (11.5, 12.5px and the like) snap to 10, 11, 12 or 13px and nothing is set below 10px; weights are the four the font is loaded at. Stylesheets reference spacing, type, weight and layer tokens instead of repeating the numbers; the scale gains 2, 6 and 10px steps and named page-level layers.

- **Editor panel headers.** Every rail panel, sheet, the inspector and the editor popovers share one header: the title is a real heading, close is always last and named, and a panel's header lines up with the top bar.

- **Editor mode switch is keyboard-navigable.** Storyboard / Script / Timeline / Studio is one tab stop: arrow keys, Home and End move between modes and Enter selects.

- **Library search, filters and actions.** Every library, the Images and Speech galleries and the Content list search through one field with a clear button; filter chips highlight like every other selection; Save shows progress and Delete is marked as destructive.

- **Workspace switcher.** The active workspace is highlighted like every other selection, the create form shows progress while it saves, and the panel follows its button when the page scrolls instead of closing.

- **Captions panel.** Caption settings are aligned rows; amounts take an exact number as well as a slider, and Italic and All caps are switches.

- **Text and voice properties.** A text overlay's size, font, colours, background opacity and alignment, and a voiceover's voice, are aligned rows in the inspector instead of a wrapping strip of chips.

- **Clip inspector.** Properties are aligned rows: every amount has a slider and an exact number field, choices are labelled selects, and on/off properties are switches. On a phone the fields, sliders and rows are finger-sized.

- **Data callout style panel.** Colours and amounts are aligned property rows: each colour shows its value, and opacity, radius and blur take an exact number as well as a slider.

- **The web design system has its own boundary.** Shared components, patterns, icons and tokens moved to `apps/web/src/design-system/` (`@design-system/*`); `check:layers` now rejects feature imports of `@base-ui/react`, design-system imports of features or stores, and upward imports inside it. `@components/ui/*` and `@components/icons/*` no longer exist.

- **Agent artifacts carry an envelope.** Every plan, research bundle, style bible, storyboard table, outline, media clip and blocker acknowledgement is now a versioned artifact with its producer (a pipeline stage or tool in a run, or an editor edit), a revision and a content hash, written through one path that validates it. Artifacts saved in the old shape (storyboard documents, run snapshots and chat logs from earlier builds) no longer load, and their read-time shims are removed. The chat's client-side pacing critique card, which nothing created any more, is removed.

- **The deployed stack runs one API service again.** The `api-2` replica is gone from both compose files, and the web proxy reaches `api` through `MALEO_API_URL`. The proxy still accepts a list in `MALEO_API_URLS` for anyone who adds replicas back.

- **Shared web controls now use Base UI behavior with shadcn styling mapped to Maleo tokens.** Shell navigation, Content creation, Library, Settings, chat and editor controls have responsive keyboard and touch coverage. The remaining timeline popover uses Base UI; Radix was removed. The candidate inventory and approved UI kit remain separate.

- **The core deployment stack moved from `infra/inngest/` to `deploy/`.** The
  compose file deploys the whole product, not just Inngest, and builds maleo
  images, which `infra/` does not hold. `.env.inngest.example` is now
  `deploy/.env.example`. A Coolify resource pointing at `/infra/inngest` must set
  its base directory to `/deploy` and replace `infra/inngest/**` with `deploy/**`
  in its watch paths before the next deploy.
- **Self-hosting and Coolify now have their own compose files.**
  `deploy/docker-compose.yml` runs with plain `docker compose` and publishes
  web, API and media on `MALEO_BIND_ADDRESS` (loopback by default) for a reverse
  proxy; `deploy/docker-compose.coolify.yml` is what Coolify deploys. A Coolify
  resource must set its compose location to `/docker-compose.coolify.yml`.
  `bun run check:deploy` fails when the two drift. The local override's S3 port
  moves from 19000 to 9000.

### Fixed

- Agent provider failures preserve the API error instead of reporting a successful pause and delivery warnings. Empty scenes no longer trigger a brief-coverage warning, and responses with no completed model step report an error.

- **Edits save through the command log without losing history.** A save reply that only accepted commands cleared redo, and a reply that handed back an equal scope recorded an empty undo step, so Redo turned off after any saved undo. Only a rejected or server-delivered command clears redo now. A layout the editor migrates while it loads (for example, retired lanes) is also saved now; before, it stayed only in the browser.
- The API no longer exits when two media uploads stream at the same time. Bun 1.3.1 `pipeTo` left an unhandled rejection on that path; the upload now reads its body with a plain reader loop.
- Project routes under `/api/operations/projects/:id` refuse a project that belongs to another workspace with `404 project_not_found`. Before, a member of any workspace could read or edit it by id.
- **Keyed scene visuals stay visible.** A scene image or video with transform keyframes rendered through the keyed path, whose box had no height, so the preview and export showed an empty frame. Scene visuals now fill the frame height there, as the static path always did.
- Locked tracks now block the Blending, Masks and Adjust inspector groups, not only Transform.
- Prevent accidental text selection in timeline labels and controls while preserving text selection in editable fields.

- Media uploads forward client cancellation through the web proxy, reject incomplete declared file bodies before processing, and admit the configured upload limit at both servers.
- **Provider errors stay readable behind Cloudflare.** Cloudflare replaces an origin `502`/`504` with its own page, which hid every TTS, image, video and render provider failure reason. The API now sends those as `503` with the same JSON body and the original status in `x-upstream-status`; the web proxy reports an unreachable API as `503` too.
- **Imports complete on S3 storage.** Reading a stored object from S3 reported its size as `NaN`, so every size check failed: the worker's source read answered 500 ("Import source authorization failed: 500") and no import could finish on S3-backed deployments. Stored reads now report the real size.
- **Requests no longer fail after a rejected upload.** When the API answered a write before reading its whole body (an expired session, an invalid or oversized upload), the web proxy's pooled connection kept the unsent bytes, and the next request on it failed with a bare 400 (a 502 through Cloudflare). Proxied writes no longer reuse upstream connections.
- **Upload cards and progress.** All Media shows each importing file as a card with its real upload percentage, then finishing and processing states. A failed card shows the error with Retry, Choose file again when the browser no longer holds the file, and Delete, which keeps it from returning on reload. A gateway or proxy error page now reads as a short message instead of raw HTML.

- **Media import recovery.** An import no longer gets stuck returning server errors when the worker loses a job or rejects a result; it fails with a retryable message or times out. A dropped or pasted file while import is unavailable now says so, and a passing network error no longer fails a live import into a duplicate re-upload.
- **Import and source-processing access.** Read-only members can see import state but no longer trigger worker submission or publication; error responses no longer carry storage keys or worker addresses; cancelling by upload identity wins even before the worker answers.
- **Editor shortcuts.** Focused selects, sliders, tabs and menus keep their own keys instead of splitting, trimming or deleting clips; copying highlighted page text is no longer replaced by the clip clipboard; Motion and Template Studio Delete/undo/redo/save work after clicking a button; a refused trim or other no-op edit no longer adds an undo step or clears redo.
- **Render alignment.** Split audio and video share one in-point rounding, so a cut never offsets sound by a frame; a flipped, cropped, masked or color-corrected visual without a stored height renders instead of collapsing; splitting an image scene re-bases its own animation keys.
- **Tolerant project reads.** A malformed mask, color, blend or animation field is dropped on read instead of breaking the editor; a blank or overlong bookmark label is repaired instead of discarding the bookmark; a stored rate outside 0.25x–4x is read as the editor shows it so the clip can still be split.

- Export snapshots retain Project Materials, locked style guidance, chapters and bookmarks when saving before render.

- Missing managed media files return 404 from authenticated public and worker reads, allowing source replacement without an internal-server error.

- **Production editor startup.** VUI distribution uses production-compatible JSX, preventing blank editor/studio screens when production React disables `jsxDEV`.

- **Imported source ranges.** Video/audio edits use verified normalized playback duration, so container padding cannot make an otherwise valid trim, reverse or audio extraction exceed its source.

- **Settled video-agent undo.** Scene and overlay updates now commit together, so one Undo reverses the settled update while keeping unrelated authored clip settings.

- **A carousel or thread no longer loses its content on autosave.** The editor's save wrote only timeline fields, so every autosave of an image or text project stored a version without its slides or posts, and a reload showed an empty project. Saves now keep them.

- **Stock results show their source.** The provider and author links on a stock image or video were clipped out of view; they sit on the result now.

- **Four layout faults in the editor.** The studio's Regenerate button was cut off at its column edge; template rows ran name and description together; the top bar overlapped its own tabs on a phone; several labels were set in capitals against the rest of the interface.

- **Actions over a media frame are reachable without a mouse.** Regenerate, remove and the stock "Add without placing" button appeared only on hover, so the keyboard and touch screens never saw them; they now show on focus and on touch, and "Remove image" has a name. Badges and actions over media share one look that follows the theme.

- **Typing Japanese, Chinese or Korean no longer sends half a message.** In the image and speech composers, Enter that confirms an input-method candidate submitted the prompt; in chat it could pick a command or mention. Enter now sends only when it is a plain Enter.

- **Usage and Script fit a phone.** The usage tables scroll inside their own region instead of widening the page, the usage sections are real navigation that wraps, and the script toolbar wraps.

- **Image composer and create form are usable with a screen reader and keyboard.** The image prompt, its send button and its reference controls have names, Escape closes the reference and aspect popovers without losing the draft, and the create form's Description field is named by its label.

- **Libraries no longer say "none yet" when loading failed.** References and Voices used to hide a failed load behind an empty message; Presets and Video Templates showed "none yet" beside an error or while still loading. Every library and gallery now shows a loading status, an error with Try again, and keeps its list on screen during a refresh.

- **Customize motion no longer crashes the editor.** Pressing it in the scene drawer threw a React hook-order error; the keyframe editor now opens, and its fields are aligned rows. Its buttons are also announced by their own names instead of the whole section's text.

- **Visual suite no longer depends on what else is running.** Fixture runs answer the editor's autosave instead of aborting it (the source of a stray "Auto-save failed" banner in screenshots), never proxy to a developer API on `:8090`, and refuse to reuse a leftover server on the suite's port.

- **A narrated build interrupted mid-generation finishes after a restart.** When the API restarted while story assets were generating, the resumed run stopped with "generate_story_assets has an uncertain prior attempt" and needed a manual retry. Asset generation reuses every finished section by input hash, so it now runs again on resume; only the sections in flight at the restart are requested again. Other generate tools still refuse an uncertain attempt.

- **Speech generation works again.** Every narration clip failed with "speech job storage owner mismatch": media keys moved to the plain workspace name, but the API still expected it base64url-encoded, so it refused the worker's own clips. A narrated build ended with every section failed and the voice backend reported unavailable.

- **Polling a run no longer fails while one of its stages commits.** The chat poll read the run's artifacts under the committing stage's contract and returned 500 until the stage finished. A stage's scope now covers only its own commit.

- **Regenerating a story no longer repaints unchanged sections.** After an approved edit, generating assets re-authored the visual beats of every section, a paid model call each, because the pacing reflow discarded each beat's authored visual and provenance, and frames were reused only when the approved revision was unchanged. Beats whose text survives the reflow now keep their authored visual, reuse is decided by input hash and source beat rather than revision, and every section is rechecked so an edited section that was already ready is regenerated while its siblings make no provider call. Reused output keeps the revision it was produced under.

- **A hex `MALEO_MASTER_KEY` is accepted.** A 64-character hex key (as from `openssl rand -hex 32`) was read as base64 and rejected with "key must be 32 bytes base64-encoded, got 48", so saving any provider credential failed. Both base64 and hex 32-byte keys now work. `bun run key:generate` runs again; it failed with "Cannot find module '@maleo/db/secret-crypto'".

- **Uploads no longer depend on API working directory.** New uploads use the
  shared media store, so replacing an API container does not erase them when
  object storage is configured.

- **Typing while a decision is waiting no longer throws the decision away.** A
  plan approval the operator was still reading used to vanish the moment they
  sent anything else, because the instruction launched a second run immediately.
  It is now held as the queued instruction and runs once the decision is answered
  or its run is stopped.
- **A storyboard edit that was undone no longer locks approval.** Any staling
  edit marked the plan as needing direction, re-direction was skipped whenever
  the inputs matched what direction last saw, and a refused approval overwrote the
  recorded cause — so undoing an edit left a plan that could only be re-planned.
  Direction state is recomputed now, and refusals report their reason instead of
  rewriting the plan. Approving from the Storyboard editor repairs stale direction
  first, as chat already did, instead of refusing with no way forward.

- **Story-plan review now shows which visual references each planned shot will
  use.** Storyboard displays shot intent, reference label and role,
  planned-versus-existing state, and rationale before approval. Rejecting with a
  reference change re-runs direction and returns the revised plan to the same
  gate. Approval freezes those decisions; generation materializes planned
  references afterwards and keeps each measured visual beat within the approved
  binding set.

- **Narrate in a voice you supply, in Indonesian.** A new self-hosted TTS
  provider, Pocket TTS Indonesian, speaks the voice in a recording rather than a
  speaker from a catalogue. Upload a few seconds of clear speech in the voice
  library, name it, and it joins the voice list as an ordinary voice — selectable
  anywhere a voice is selected, auditioned from the recording it was made from,
  and removable. Clones belong to the workspace that created them and to the
  provider that can speak them; a voice another provider cannot speak is
  reported rather than quietly swapped for a different one. Kokoro remains the
  default for every other language, and a workspace with no clones sees exactly
  the voice list it saw before.

  The service is deployed from `infra/pocket-tts-id` and configured by entering
  its URL in Settings. The model is band-limited to 16 kHz, cannot read digits —
  narration must spell numbers out, and a request containing them is refused
  rather than mispronounced — and does not support exclamation marks.

- **On a phone, chat is its own view of the workspace.** An `Editor | Chat`
  switch replaces the chat sheet that rose over the stage and timeline. Both
  views stay live, so switching keeps the selection, playhead, timeline
  position, composer draft, queued instruction, pending decision and running
  command. While Editor is showing, a compact indicator reports when chat is
  working, needs your input, or failed, and opens Chat at the pinned decision;
  `Show changes` switches to Editor with the changed item selected. The
  composer and a pinned decision stay above the on-screen keyboard. Rail panels
  are still sheets.

- **Project chat now knows what you are looking at.** Every command carries a
  typed context envelope built from the live editor — current selection,
  playhead, the project in outline, and the decisions already settled in this
  conversation — so "make this punchier" resolves to the thing on screen without
  restating the project. Scope resolves in a fixed order: an explicit mention
  beats the selection, the selection beats the playhead, and a phrase matching
  two entities is asked about rather than guessed.

- **The project chat is a workspace, not a log.** Each command reads as a
  status line naming the pipeline's stage and a real count ("Generating section
  3 of 8"), with its tool activity folded behind one Activity control. Only the
  newest run offers actions — Stop, Resume, one targeted Retry, `Show changes`,
  or `Undo` while it is still the latest edit — and everything earlier is a
  read-only record, so an old message can no longer change the current project.
  Story plans show as a compact summary with their review details folded away;
  the newest one opens straight in the Storyboard view, where plans are edited.
  A line above the composer says what the next command is about, and `@`
  completes sections, clips, materials and references. The composer stays
  usable while a run works: sending queues one visible `Send after current`
  instruction. The decision a run waits on is pinned above the composer, and
  typed text only answers it in an explicit `Replying to` mode. A result held
  because you edited the same thing says so and offers review or re-plan instead
  of claiming success. Colour now marks state only, and credits appear only when
  they limit what you can do. On desktop the chat pane is resizable between 380
  and 520 pixels and remembers its width; the clip inspector folds away before
  chat is squeezed below that.

- **Answers you give are remembered.** Resolving an approval or clarification
  records it, so a later command inherits what was agreed instead of asking
  again. The record is written at the moment you answer and persisted
  immediately, so it survives a reload straight afterwards.

### Changed

- **The runtime database is Postgres.** SQLite allowed one writer, so the API
  could run as only one replica with no blue/green deploy. Production now
  requires `MALEO_DATABASE_URL`, and a host other than localhost must connect
  with `sslmode=require` or `verify-full`. Development leaves it unset and gets
  an embedded Postgres under `data/postgres` (`MALEO_PG_PORT`, default 54329),
  with nothing to install. Schema changes are numbered, checksummed migrations
  in `packages/db/migrations/`. The runner refuses a migration that was edited
  after being applied. Workspace configuration moves from
  `data/workspaces/<name>/config.yaml` into the database. It is validated when
  written, so an invalid field or a credential-shaped key is refused naming the
  field, where before it failed later, on read. `bun run media:cleanup` now
  reads references from Postgres.

  **This is a breaking change for any existing installation.** The new release
  does not read `data/maleo.db`. Carry it over once, before you start the new
  API:

  1. Stop the api and workers, and back up `data/maleo.db` and
     `data/workspaces/`.
  2. Point `MALEO_DATABASE_URL` at an empty database, or leave it unset for
     the embedded one.
  3. Run `bun run db:migrate-from-sqlite` (`--source <path>` for another file).
     It prints the source and target row count for every table. It stops,
     naming the table, row and column, on a value Postgres cannot hold as it
     is. It stops, naming the file, on a workspace `config.yaml` that is
     missing, unparseable, invalid, or holds a credential. Fix the cause and
     run it again: a run that was interrupted or failed resumes without
     duplicating rows.
  4. Start the api. The shipped library fixtures are reconciled on first start.

  Keep the SQLite file until the new deployment has been verified; rolling back
  means starting the previous release on it. `data/master.key` is unaffected.

- **Storyboard history is bounded per project.** Every agent step used to
  persist a full storyboard snapshot forever — one working database held
  230,533 versions, 7.3 GB, 96% of the file. Each write now keeps the newest 20
  versions (`MALEO_STORYBOARD_RETENTION_WINDOW`, `off` disables pruning), plus
  any version marked approved or rendered, any version an output or render
  record points at, and the newest carrier of each artifact a run is seeded
  from; the rest is pruned in the same transaction as the write. **Breaking for
  operators:** a pruned version number no longer resolves, and reads report it
  as pruned rather than missing. Numbers stay monotonic and are never reused.
  Existing history is reclaimed deliberately with `bun run storyboards:reclaim`
  (dry run; `--apply`, then `--apply --vacuum` to shrink the file).

- **Third-party service directories move from `apps/` to `infra/`.** `apps/`
  now lists only deployables built from maleo source (`web`, `media-worker`);
  `infra/` holds the five that only configure software we host — `inngest`,
  `kokoro-tts`, `pocket-tts-id`, `searxng`, `crawl4ai`. Names, contents, images,
  ports, and public addresses are unchanged. The Coolify applications
  `maleo-core`, `maleo-kokoro-tts`, `maleo-pocket-tts-id`, `maleo-searxng`,
  and `maleo-crawl4ai` had their base directory and watch paths repointed from
  `apps/<name>` to `infra/<name>` outside this repository; a fork deploying from
  the old paths must do the same.

- **Approving a story plan uses the plan as it is now.** Edits made in the
  Storyboard view while a chat run waited for approval used to be ignored — the
  run generated from its own earlier copy and could then save that copy back
  over the edits. Answering the approval now continues from the saved plan.

- **Agent edits no longer overwrite work done while they ran.** A settled result
  is compared against what the run actually read and applied only to the entities
  it changed; anything edited in the meantime keeps your version. When the agent
  and an edit touch the same thing the result is held for review rather than
  silently winning, and one settled run is one undo step. Applies to carousel and
  thread projects; video results are unchanged for now.

- **Carousel slides and thread posts keep a stable identity** across generation,
  reordering and reload, so an edit lands on the slide it named rather than on
  whichever slide now sits in that position.

### Fixed

- **The storyboard approve button no longer approves a plan whose sequence
  direction failed.** Chat already refused such a plan before generation, but the
  storyboard authoring route snapshotted it as approved anyway, so the plan showed
  as approved and then stopped at generation. The route now refuses it with the
  first direction error. The only exception is direction errors that generation
  repairs itself when the timeline template turns data overlays off.

- **Story-plan approval now reaches the active approval gate.** Draft plan cards
  no longer expose a duplicate control that starts a fresh command, and typing an
  approval option answers the same durable action as its question-card button.

- **Templates without data overlays no longer block story approval.** Sequence
  direction now excludes infographic treatments when the selected timeline
  template cannot render them, and safely treats ignored model output as an
  explainer before structural validation.

- **A clarification card no longer multiplies on every reload.** Re-opening a
  project with a parked question replayed the run's events into a chat log that
  already held them, appending a fresh copy each time — one project reached 13
  copies of a single question and 262 messages for a run that emitted 32 events.
  The replay now drops the run's own cards first, a question card is replaced
  rather than appended, and loading a project keeps one card per question, which
  also cleans logs that already accumulated copies.

- **A blocked build no longer claims it generated assets.** When a story plan was
  refused before generation, the run reported "Generated assets, but N blocking
  outcome finding(s) remain" and discarded the stage's own explanation. The final
  message now leads with what the stage reported, and appends the blocker count
  only as a qualifier.

- **A plan blocked by an undrafted section now says so.** The editorial pass
  reported "Every drafted section needs a stable semantic beat id" for two
  unrelated faults, so a plan stopped by an empty section sent operators looking
  for a missing id that was never missing. Each fault is now named separately,
  with the sections it applies to and what to do about it.

- **An undrafted section records why it failed.** Drafting degrades on purpose so
  one unfillable slot cannot cost a whole plan, but the cause used to be
  discarded. The section note now distinguishes a timeout, a slot the drafter
  never answered, an empty narration, an empty visual prompt, and a schema
  rejection.

- **An invented motion-graphic kind no longer discards a whole plan.** A model
  answering `kind` with a description rather than one of the supported renderers
  failed the sequence-direction pass, blocking an otherwise valid researched plan.
  An unrecognised kind now degrades to `none`, and the pass reports the previous
  failure back to the model when it retries instead of re-asking blindly.

### Removed

- **BREAKING: the Codex CLI and Claude CLI text providers.** A CLI runs its own tool loop and cannot take part in the agent's tool calls, so all text, the agent's included, now runs on the API text provider (`MALEO_AI_API_KEY`, `MALEO_AI_API_BASE_URL`; any OpenAI-compatible endpoint, a local Ollama included). Without a key the product still starts and reports text as unconfigured. A stored selection of `codex` or `claude` now fails visibly by name; select the API provider in Settings. To drive projects from Codex CLI or Claude Code, connect them to the MCP server (`POST /mcp`). Codex image generation in the media worker is unaffected.

- **Internal package ownership now matches runtime ownership.** **BREAKING:**
  database imports move from `@maleo/core/*` to `@maleo/db/*`; text providers
  now live inside API; `/api/sources` is removed in favor of `/api/stock`; and
  generated image/TTS calls require `MALEO_GEN_WORKER_URL` with no
  `MALEO_DURABLE_GEN` or API `MALEO_IMAGE_URL` fallback. Self-hosted Inngest
  deployment files now live under `infra/inngest`, while `@maleo/inngest`
  contains only shared client and event schemas.

- **Affiliate catalog integration moved out of public distribution.** The
  affiliate service, remote catalog API and UI, credentials, and video ingest
  path now live only in the private `maleo-black` mirror. Existing project data
  can still render saved product references, but Maleo no longer fetches or
  manages affiliate products. **BREAKING:** `/api/catalog`, the
  `@maleo/affiliate` workspace, and affiliate environment variables were
  removed.

### Added

- **Story plans now receive a whole-sequence editorial pass before approval.**
  Each semantic beat records its purpose, presentation, visual concept, novelty,
  native on-screen text, structured infographic choice, and deliberate SFX or
  silence. Invalid direction retries once and then blocks approval without
  hiding the draft. Approved direction drives image authoring and cache hashes,
  renders text natively, rejects fabricated chart/table values, and suppresses
  generic repeated accents unless a template explicitly pins its audio asset.

- **Research can now raise an editorial decision before the script is written.**
  When a grounded plan's sources expose a fork the evidence cannot settle — two
  credible case studies, sources that disagree, a requested claim nothing
  supports, or materially different evidence scopes — planning pauses after
  research and asks, using the same question card as the pre-research checkpoint,
  with each option naming the retrieved sources it rests on. Almost always there
  is no such fork and nothing is asked; when the review cannot run, planning
  continues on best judgment and says so. Answering resumes the same plan at the
  script stage without re-running the framing or the research already paid for,
  and the finished plan records what was decided after reading the sources
  separately from what was decided before. Retrieved page text is treated as
  untrusted evidence throughout: it is bounded, never obeyed, and an option may
  only cite a source the run actually retrieved. Letting the wait time out
  abandons the run exactly as any other unanswered question does — no answer is
  chosen for you, and no script is written.

- **A new story build now asks before it plans.** Before framing or research, one
  batch of up to three tailored questions collects the decisions that most shape
  the story — audience, the change wanted in the viewer, the example context to
  build on. Each question offers two or three options with a recommendation, a
  short note on what each choice changes, and a free-form answer of your own; one
  action delegates everything unanswered to best judgment. The batch never offers
  alternate story directions and never asks for something the request or the
  project already settles, such as duration, aspect, language, voice or style.
  Accepted answers reach planning beside the original request, which is stored
  unchanged, and the resulting story plan carries their provenance — reporting a
  decision it could not honor rather than claiming it was applied. Asking to skip
  the questions, or requesting one-shot generation, bypasses the batch and records
  that it was bypassed. A parked batch survives reload and restart, rejects a
  half-answered submission, and abandons on the existing awaiting-input timeout
  without inventing an answer or generating anything.

- **Video projects now have direct Storyboard authoring.** A fourth editor view
  creates and edits stable story sections and beats, attaches references, records
  approval policy, scopes chat help to one beat, previews current or stale
  generated outputs, and resolves revision conflicts without overwriting local
  retry text. Script scenes and Timeline clips remain independently editable.

- **Storyboard generation now has stable approval and provenance boundaries.**
  Story sections and semantic beats keep opaque identities through revision,
  generation, chapters, and markers; edits are revision checked; provider work
  reads an immutable approved snapshot; duration additions follow recorded review
  or auto-approval policy; and speech, visual, caption, and frame reuse now
  requires matching generation-input hashes while stale media stays available.

- **One name per component, and three checks that keep it that way.** A labelled
  field was written four ways, an advisory note three, a small inline tag three,
  and the input and icon button once each across 161 call sites — so changing
  "the field" meant four edits and any of them could be missed with nothing
  failing. Each is now one primitive under `components/ui/` emitting the classes
  it always did, so nothing renders differently: the visual suite passes with no
  snapshot updates, which is the whole proof. Writing a retired spelling into a
  `className` now fails and names the file; a class leaking out of the cluster
  that defines it is reported by name against a baseline; and a class written
  into markup that no stylesheet defines fails, which nothing checked before.
  The panel, section and control tiers were promoted as three primitives rather
  than merged, because reading the running DOM showed they are a hierarchy with
  two entry points rather than three names for one box.

- **Five classes that style nothing are now recorded rather than invisible.**
  Each is a live defect: `cv-field-lbl` renders every editor field's label at
  inherited 16px where its siblings get a 9.5px mono caption, a removable chip is
  styled identically to a fixed one, a drag in progress looks like one that is
  not, a motion clip's body is styled as a text clip's, and the clip bar's
  overflow control is styled as an ordinary button. Fixing any of them changes
  what the product looks like, so each is listed with its symptom for the change
  that is allowed to move pixels.

- **The UI candidate inventory can be generated and published to a design tool.**
  `bun run publish:ui-inventory` renders every competing implementation the
  repository still has — four spellings of a field, five of a chip, three of a
  button — side-by-side on one board per concept, each carrying its defining
  stylesheet, call-site count, consuming directories, related spellings and
  source commit. It exists to be run _before_ consolidation, because collapsing
  the duplicates is what destroys the evidence for deciding which one to keep.
  `publish:ui-kit` renders the approved kit and is deliberately empty until
  convergence approves something: appearing in the inventory is not approval.
  Generation is one-way and reads only tokens, the census and the repository's
  own disposition data; nothing reads the design tool back, and no gate depends
  on it being reachable.

- **Twenty stylesheet rules read design tokens that did not exist, and now read
  the real ones.** Every timeline warning and error rendered a red found nowhere
  else in the product (`--danger`, undeclared, falling back to `#e5484d`) and now
  uses the app's `--err`; several image placeholders and inset panels had no
  background at all because the token naming them was never declared. The
  structural check gained the matching arm, so a `var()` naming a property
  nothing declares now fails — a fallback is no exemption, since a fallback is
  what makes the defect render plausibly.

- **`bun run ci` now runs a class census over the web client.** It reports, per
  class, the stylesheet that defines it, its call-site count, and the source
  directories that consume it, plus per-file inline-style and literal-colour
  density. Cross-cluster consumption is the promotion signal that the existing
  stylesheet-ownership rule cannot see. Run it alone with
  `bun run --cwd apps/web check:census`, or `CENSUS_ALL=1` for every row.

- **Dialogs, sheets, and image previews now share keyboard-safe overlay behavior.**
  Focus stays inside the top overlay, `Escape` closes only that overlay, page
  scroll locks while it is open, and focus returns to its opener after closing.

- **Stock search setup now lives in Settings.** Capabilities lists Stock visuals
  with Pexels and Sound effects with Freesound, including saved credentials and
  connection tests. **BREAKING:** `MALEO_PEXELS_API_KEY` was removed; use
  `PEXELS_API_KEY` or save the key in Settings.

- **Providers are set up in the browser, not by editing `.env`.** Settings now
  lists what the app can do — text, image, speech, research, video, captions —
  and every provider that can serve each. A provider's form is generated from
  what it declares it needs, so adding one to a registry adds its settings
  screen. You can test a credential the moment you paste it rather than finding
  out when a generation fails hours later, and the provider serving each
  capability is marked as its default.
- **Credentials survive a restart, with nothing to configure first.** What you
  enter is encrypted and stored in the runtime database instead of written to a
  `.env` file that a container discards. The key that encrypts them is created
  for you at `data/master.key` the first time you save a credential — back that
  file up, because it is deliberately the one thing a database dump does not
  contain. Deployments whose data directory is not persistent set
  `MALEO_MASTER_KEY` instead, which takes precedence; generate one with
  `bun run key:generate`. The key can be rotated from Settings without
  reconfiguring a single provider, and both the old and the new key keep working
  until the app restarts with the new one, so a restart mid-rotation loses
  nothing.
- **What you configure reaches the process that generates.** Durable generation
  runs in a separate worker that does not hold the database; given
  `MALEO_API_URL` and `MALEO_SERVICE_TOKEN` it now reads provider
  configuration from the API, caches it briefly, and picks up a rotated
  credential without a redeploy. If it cannot reach that configuration it fails
  and says so, rather than falling through to the provider that fabricates
  output.
- **Settings reports what the environment is overriding.** An environment
  variable still wins over a stored value; Security & Privacy names every stored
  value one is currently shadowing, so an edit that silently has no effect is
  visible instead of mysterious.

- **Grounding a video no longer needs a daemon on your machine.** Research
  retrieval went through BrowserOS on `127.0.0.1`, so on any machine without that
  process running the planner asked for sources, got none, and honestly marked
  the plan ungrounded — correct, and useless. Retrieval now resolves through a
  registry, with the self-hosted SearXNG and Crawl4AI services leading and
  BrowserOS kept as the option that needs no configuration. Selecting a provider
  explicitly still wins, and there is deliberately no fallback between them: if
  the chosen one cannot answer, research is unavailable and the plan says so,
  because a plan grounded from an unexpected source looks identical to a
  well-grounded one everywhere downstream.

- **The script shows what a narration line is grounded in.** A cited source and
  the quote it was validated against now appear beside the narration they
  justify, at the density where prose is edited — the AV script previously held
  that evidence on every scene and showed none of it. Collapsed by default, so a
  citation lengthens a row only when you open it, and the story plan card and the
  script now render citations through one component instead of two. A scene with
  no evidence deliberately shows nothing rather than a verdict: a scene record
  does not know whether its line was supposed to be grounded, so a fiction beat
  and an unsupported factual claim would otherwise get the same mark.

- **Two self-hosted services for research retrieval.** `infra/searxng` and
  `infra/crawl4ai` deploy a SearXNG metasearch instance and a Crawl4AI extraction
  instance, replacing the dependency on BrowserOS running as a local daemon on
  whatever machine happened to be planning a video. Both are pinned upstream
  images with their configuration baked in, fenced behind Cloudflare Access, and
  documented with the deploy settings that live only in Coolify's database. No
  application code calls them yet — the research provider that will is a
  separate change, written against what these services actually return.

- **Rejecting a story plan no longer ends the run.** Pre-production is meant to be
  free and iterative, and only asset generation is meant to cost an approval — but
  rejecting a plan set the run to `done` and told you to send a revision, which
  started a fresh run and threw away the frame, the skeleton and every source that
  had been retrieved. A rejected plan now parks the run holding all of that: the
  next thing you type is the revision, every section is redrafted against the same
  arc and skeleton, and the approval gate comes back. Nothing in that loop
  generates an asset. A "Research again" action at the gate retrieves more sources
  and merges them into what the plan already cites rather than replacing it.
- **The approval gate says what the plan is grounded in.** The source count, how
  many sections cite nothing, and whether grounding was requested but unavailable
  now appear in the question you approve — the counts already existed, but they
  lived beside the decision instead of in it. They are reported, never blocking.

### Changed

- **The web client has one button, one note, and one text ramp.** `.cv-btn` and
  its five variant classes are gone: there is a single `Button` with six
  variants and two sizes, and the editor's compact treatment is now the `sm`
  size rather than a second class family. `.settings-note`, `.tl2-dsec-note` and
  `.settings-field-warn` collapse into one `Note` with a tone prop, and the
  status banner formerly spelled `cv-provider-warning` becomes `Callout`, named
  for its job rather than for one caller. Buttons in the editor grow slightly,
  small buttons across the app move to the editor's tighter metrics, and the
  timeline's advisory text moves from 11px to 12px.

- **The app has one type scale, one field, one form and one collection.** Page
  titles read the title role, so they grow on a wide screen and are unchanged at
  800px and below; the four field spellings collapse into one `.field`; six
  arrangements of "a column of fields" become one form pattern at a shared
  measure; and the library, presets and galleries share one collection card, row,
  toolbar and empty state instead of three copies each. Settings help and errors
  are now announced — help describes its control instead of becoming part of its
  name, a rejected value is marked invalid, and an environment override is a
  warning rather than an error. Spacing moves by a few pixels on most surfaces
  and editor micro-labels move from 9.5px to 10px.

- **Controls meet a 44px hit target on touch devices.** The app had no
  hit-target floor at all: a 26px icon button stayed 26px under a finger. Buttons,
  icon buttons, chips and the transport now take the floor on coarse pointers
  only, so a mouse keeps the editor's density, and a transition marker gets a
  44px hit area without growing over the clips it sits between. A clip's delete
  affordance deliberately does not — a bigger target for a destructive control on
  a narrow clip turns "select" into "delete".

- **Semantic colours are derived from their own tone.** Each of the four states
  now mixes its background from its foreground, so the two can no longer drift —
  three of the four status pills had been filling a different hue than the text
  sitting on them. `--accent` gains a dark-theme value it never had, which fixes
  active sidebar items and selected library cards rendering darker than the
  surface behind them in dark mode.

- **Every control has a focus indicator.** Nine controls suppressed the platform
  focus outline and replaced it with nothing — four of them borderless, so
  keyboard users had no indication at all. Buttons, text buttons, icon buttons
  and inputs now share one focus ring, and icon-only buttons require an
  accessible name.

- **Prepared repository for MIT open-source distribution.** Removed prohibited
  browser automation and restricted Supertonic packaging while retaining private
  backup copies, migrated speech defaults to self-hosted Kokoro, replaced Focal
  and creator-imitation names with neutral editor/preset/style terms, sanitized
  product and HAR fixtures, added source/creator/license links to stock results,
  and documented separate dependency, model, provider, privacy, and migration
  obligations. Existing legacy preset ids and stale Supertonic selections migrate
  to neutral/Kokoro behavior.

- Settings is reorganised around capabilities: Usage (was Credits), Capabilities
  (replacing the hardcoded Services cards) and Security & Privacy (was Env, with
  the raw key table kept as the advanced escape hatch). Every level is a route,
  so a provider's setup can be linked to directly.
- **BREAKING**: the per-capability provider-choice writes
  (`PUT /api/settings/{tts,image,text}-provider`) are replaced by one endpoint,
  `PUT /api/capabilities/:id/provider`. Their read projections remain, because
  the editor's pickers need catalogue detail the capability list does not carry.

### Fixed

- **A section is no longer failed for having more approved shots than its
  narration produced beats.** The pre-submission coverage gate compared two counts
  drawn from different stages — shots the planner approved before any audio
  existed, against beats cut from the measured voiceover — and rejected the
  section before a single provider call whenever the first number was larger.
  Four approved shots over three measured beats was enough. Because the run's
  circuit breaker reads any failed section as a provider outage, a story that had
  never reached the voice or image backend reported that the backend was
  unavailable.

  Measured beats are now the only authority on how many visuals a section has;
  approved shots remain what the section should show, merged across the beats the
  audio produced. The gate still checks that approved intent arrived, at subject
  granularity: a Story Bible subject named in an approved shot must appear in the
  section's beats. Sections already stuck on this generate on retry with no plan
  edit.

- **A beat-coverage violation now re-authors the section once before failing it.**
  The single retry was always part of the rule and had never been performed, so a
  one-off authoring miss failed the section outright.

- **The create flow's material rows render as cards again.** An unclosed rule in
  the editor stylesheet had swallowed the whole `.cv-materials-*` block through
  CSS nesting, so none of it applied: rows had no card, and each material's icon
  sat on its own line above its name.

- Choosing a text provider in Settings no longer discards the model and thinking
  level chosen in the editor. They are cleared only when the provider actually
  changes, which is when they stop being meaningful.

- **Whether a video is researched is decided by the planner, not by a keyword
  list.** A regex over the brief (`history|sejarah|kingdom|…`) decided whether to
  ground a script in real sources, and the questions it searched came from a fixed
  four-query template phrased for historical topics — so "how does a heat pump
  work" was searched for its _primary sources_, and a brief that made checkable
  claims in words the list did not contain was written from memory and presented
  without a warning. The framing stage, which already reads the brief to choose the
  arc and the narration language, now also decides whether the narration needs
  grounding and writes the questions for that subject. Research became its own
  stage between framing and drafting; it still costs no approval. When framing
  fails, grounding falls back to the plan kind's default rather than to a scan of
  the brief.

- **A story plan now has a skeleton, not just a spine.** The planner returned an
  `engagement` object — premise, hook, tension, escalation, turn, resolution —
  that nothing downstream ever read, and every section was structurally
  identical, so pacing was whatever the model felt like. A plan now selects one of
  five named story arcs (`three_act`, `story_circle`, `seven_point`, `fichtean`,
  `pov_lifecycle`), and each section carries its job in that arc: a chapter
  function, the obligation that function must meet, and a default emotion — so the
  background-music arc follows the story arc instead of being free-picked per
  section. The arc is chosen by the planner with `auto` plus explicit override,
  matching how structure and plan kind already resolve. Plans persisted before
  arcs existed load and render unchanged.
- **The script view names the story arc and each chapter's job.** The AV script
  showed a chapter's title and an empty "What is this chapter for?" brief; it now
  names the arc once beside the density chips, reads each chapter eyebrow as
  `Chapter 1 · inciting crisis`, and states that chapter's obligation under its
  title. The obligation is derived and read-only — the operator's own chapter
  brief is a separate field and is never written over. A project planned before
  arcs existed renders exactly as it did.
- **Narrative coverage is reported beside visual coverage.** Five counted checks
  over a drafted plan: required functions present, functions in canonical order,
  the midpoint inside its position window, the engagement turn landing on the
  turn-function section, and an emotional arc with at least three distinct
  emotions. These are surfaced for review and never block approval or image
  generation — a midpoint at 0.62 of runtime is a pacing opinion, not a defect
  that would waste a provider call. Plan-shot and beat-cast coverage still hard-fail
  before submission, exactly as before.

- **`bun run restart` stops the local stack and starts it again.** `--hot` reload
  does not survive every edit, and a half-reloaded server reports failures the
  code no longer contains — which previously meant hunting several processes
  across several terminals. The command stops a process only when its working
  directory is inside this repository, so another project on a shared port such
  as 3000 or 3030 is left alone, and `--dry-run` lists the targets without
  signalling any of them.

### Changed

- **Story planning runs as three stages instead of one call.** A cheap _frame_
  call returns the plan kind, arc, narration language and spine with no narration;
  a _skeleton_ stage derives the section slots by computation with no model call at
  all; a _draft_ call fills narration and shots into those slots. A failed frame is
  retried once and then falls back to defaults; a failed slot is retried on its own
  against the skeleton that still exists, rather than against a second prompt
  restating the whole plan schema.
- **Embodied POV is a selectable arc, not a topic-word match.** POV planning used
  to fire whenever a brief matched a fixed regex — `pov`, `queen`, `ratu`, `live
  as` and a dozen more — which forced POV onto briefs that merely mentioned the
  subject and could not be requested for one that did not. It is now
  `arc: "pov_lifecycle"`, requestable for any brief and declinable for any other.

### Removed

- **The hardcoded bee fallback.** When the planner timed out on a brief matching
  five words, the system emitted roughly a hundred lines of pre-written Indonesian
  or English worker-bee narration — whatever the video was actually about. A dead
  planner now degrades to a skeleton with empty, marked sections, which is
  topic-agnostic; a plan that cannot be framed at all fails visibly with the
  underlying error. Nothing emits narration about a subject other than the brief's.
- **Narration language guessed from topic words.** Language came from matching the
  brief against an Indonesian word list, four lines below a comment in the same
  file stating that language is never resolved that way. It now comes from the
  frame stage or from the job's configured language, and from nowhere else.

- **A workspace can choose how its narration is written.** Person, tense, sentence
  rhythm and figuration used to be whatever the planner reached for, so every
  project narrated in the same house voice, and the only lever was prose in the
  Story material — a channel that carries the video's SUBJECT and is fingerprinted
  as the research topic. A workspace now selects one of seven writer style
  profiles (`writer_style` in `config.yaml`), each one data rather than prose:
  person, tense, rhythm, concreteness, figuration, viewer address, opening move,
  a banlist, and a sentence density. The profile is rendered into the narration
  drafting prompt identically on every run, and never reaches image generation or
  speech synthesis. Profiles describe craft, not authors, so nothing imitates an
  identifiable writer. A workspace that selects none plans exactly as before.
- **The planning word budget now accounts for the silence a prose style earns.**
  Synthesis inserts a breath at every sentence boundary, so the same word count
  at a higher sentence density runs longer. The budget folds each profile's
  sentence density in, the way it already folds words-per-second. Final timing
  still comes from measured audio; this only corrects the target the planner
  writes toward.

### Fixed

- **A story's look is now stated once, not re-invented per shot.** The style lock
  was prose, so every beat had to restate it to use it — and did, differently:
  one section of a real project opened four consecutive beats with four spellings
  of the same lock, and composition then appended the whole lock a second time in
  the plan's own language. A story plan now carries a structured Story Bible
  (subjects with their narration aliases, locations, medium, lighting, palette,
  camera language, negatives), authored once, and every beat's prompt renders it
  identically. Per-beat authoring returns structured fields instead of prose and
  has no field to restate the style in.
- **The planner's camera grammar reaches the image provider.** Planned POV shots
  already carried camera role, location, body action and prop focus; that
  structure was flattened into a prose parenthetical and then discarded, and
  every story frame was submitted as a hardcoded `Medium Shot`. It now compiles
  into the image intent's composition fields.
- **A story's own negatives are compiled as constraints rather than buried in the
  scene description**, where an image model reads them as things to draw. Prose
  prohibitions are no longer double-negated into `Avoid: no human hands`, and a
  constraint phrased as a prohibition is treated as one wherever it was authored
  — a real project had `no modern objects` stored as a location descriptor, which
  asked the provider to include it.
- **Four counted invariants gate a section before any image is generated**: cast
  drawn from the story bible, adjacent beats that differ on a field that changes
  the picture, approved shots that fit the measured beats, and a subject the
  narration names appearing in that beat's cast. The last is the story-to-image
  link, checked without a model call. A violation retries once and then fails the
  section, kept and retryable.

- **Story videos no longer show the same picture twice in a row.** Roughly half
  of every adjacent pair of visual beats was repeating an image: the planner
  budgeted shots per section at plan time from a word count, the pipeline cut
  visual beats from the measured audio afterwards, and the two never agreed — so
  a smaller set of planned prompts was spread across a larger set of beats by
  reusing them. The video now authors one image prompt per measured narration
  beat, after the audio exists, with the operator's approved planned shots
  supplied as visual intent rather than used as the prompts themselves. Plan
  review is unchanged.
- **The duplicate-prompt check can now fire.** It ran on the fully composed
  provider string, after a per-beat index label and a rotating composition
  phrase had been appended, so adjacent prompts always differed no matter what
  they showed — it never blocked a single section. It now runs on the authored
  visual text, before any style, guidance or index layer is added.
- **A section whose visuals cannot be authored now fails visibly**, kept and
  retryable, instead of quietly falling back to another beat's prompt.
- **A planned shot cue the narrator never speaks is no longer used for timing.**
  Cues are verified against their own section's narration when a plan is
  materialized; one that does not occur is recorded as unverified and narration
  grouping falls back to its balanced split.

### Changed

- **Project quality reports record two story visual-beat signals** — beats per
  planned shot, and the share of adjacent beats reusing a visual — both counted,
  with no tunable similarity threshold, and both reported as absent rather than
  passing when a project has no generated story sections. They replace
  `visualRelevancePct`, which scored a brief-language objective against an
  English image prompt by token overlap and was recorded on zero runs.
- **Per-project art direction is no longer carried in code.** The hardcoded
  subject lexicon that rewrote prompts after the fact — a subject-keyword table,
  a style substitution table, and a canned composition rotation — is gone.
  Project Visual and Rules materials and the locked constraints are supplied to
  visual authoring instead, so a constraint is satisfied while the visual is
  written rather than overwritten afterwards, and a new subject needs no code
  change. Projects relying on those defaults should carry the constraint in
  their own Rules or Visual material.

- **The Script view's table reads as a script rather than a form.** Its audio,
  visual and image columns are now equal width, so a reader can run down a
  column across a chapter break; the frame keeps its portrait ratio at a capped
  width inside its column. The Time column is now Duration and shows the scene's
  length alone — the timeline start offset, which nothing on that row acted on,
  is gone with it. The audio column lists every audio element the scene carries,
  labelled by kind and ordered `Music`, `SFX`, then `VO (<speaker>)`, instead of
  showing narration plus a single line that labelled music as an effect.
  Narration stays editable in place; the cues are read-only, because they belong
  to the timeline. Chapter footers stack each label above its value.
- **The Script view names the timeline audio crossing a scene** — the music bed,
  the effects, the generated speech and its length — where it previously reported
  only a count. A bed running the length of the project is stated once, on the
  row it starts, marked as continuing, rather than repeated down every row it
  covers. The audio column header no longer names the project's default voice,
  since every voiceover line already names its own speaker. Audio is no longer
  also counted beside the visual prompt, where it repeated what the audio column
  now says properly.
- **Script view frames are sized by their own shape.** A portrait frame takes
  half the image column and a landscape or square one takes all of it, with
  height following the image's real aspect ratio instead of every frame being
  forced to 9:16. A long generated visual prompt now stops growing at a maximum
  height and scrolls, so one paragraph-length prompt no longer sets the height of
  its row.

### Fixed

- **A video generated from a plan of several sections came out as one chapter.**
  The scenes never recorded which section they came from: the plan was flattened
  into a flat list and the section's identity was dropped at that step, so every
  surface that groups by section had nothing to group on. Scenes now carry their
  section, and the first shot of each is marked as its opening, so chapters are
  derived one per section and named after it. Projects whose scenes carry story
  beats were unaffected — the beat fallback had been masking this — and projects
  generated without beats collapsed into a single chapter.
- A project already generated without that provenance can be repaired with a new
  **Regroup** action in the Script view, which re-derives its chapters and says
  which authored titles and briefs it will replace before it does. It is offered
  only when re-deriving would actually change the grouping. Nothing regroups on
  its own: chapters an operator has deleted or renamed are still never rewritten
  by a read.
- A backfill script recovers the missing provenance
  for projects generated before it was recorded, matching scene names against the
  section titles their plan still records. It reports by default and writes only
  with `--apply`, refuses any project it cannot account for exactly, writes a new
  storyboard version rather than editing one in place, and never touches
  chapters.
- A chapter title or brief changed in the document rather than typed into its
  field kept showing the old text until the page was reloaded.
- Audio cued at exactly the boundary between two scenes was reported on both of
  them in the Script view, so a single cue read as two. Scene starts are running
  sums of float durations, so the comparison now carries a tolerance.
- The Script view no longer marks a scene's duration as pinned or auto. The
  overflow warning on a pinned scene whose speech runs long is unchanged, so the
  consequence of pinning is still reported where it matters.

### Added

- **A Script view in the content editor**, beside the timeline and the scene
  studio. The project reads as an AV script table — one row per scene, narration
  beside its visual prompt, its frame and its timing — grouped into chapters with
  a running time and word count per chapter. Three densities (outline, read,
  write) show the beat sheet, the read-through, or everything. `/content/<id>/script`
  opens the editor straight to it, and `?density=outline` opens it as an outline.
  Exports as Markdown.
- **Chapters are real.** A chapter is a persisted record with a title and an
  optional brief, and a scene names the one it belongs to. Projects that predate
  them derive chapters on read from section membership, then from runs of story
  beats, and finally a single chapter — deriving only, never rewriting what was
  loaded. The timeline ruler now marks chapters instead of showing one marker per
  scene, and the rendered chapter pill counts chapters rather than scenes: a pill
  reading "2 of 5" used to mean scene 2 of 5.
- **Scene durations can follow their narration.** A duration is either pinned or
  auto; an auto scene takes its length from its measured speech plus a gap read
  off the writing itself — continuous mid-clause, a short breath at a sentence, a
  longer one at a sub-section, longest at a chapter break. Dragging a scene's edge
  pins it. A pinned scene whose speech runs long reports the overflow instead of
  retiming itself.
- **Generated assets know what produced them.** Speech and frames record a hash
  of their inputs, so editing narration or a visual prompt marks that asset stale
  in the script and the timeline. Regeneration is always per scene and per asset —
  there is deliberately no bulk control — and a render reports what is stale
  without refusing to run. Assets generated before this existed read as fresh.
- **Kokoro-82M as a second self-hosted TTS provider**, deployed from
  `infra/kokoro-tts` and configured with `MALEO_KOKORO_URL`. It ships all 68 of
  its voices across nine languages, each auditionable from every voice picker,
  and is Apache-2.0 licensed where Supertonic is OpenRAIL-M. Supertonic remains
  the default; choose Kokoro in Global Settings, or with
  `MALEO_PROVIDER_TTS=kokoro`.
- **A TTS provider choice you can see and set.** `GET`/`PUT
  /api/settings/tts-provider` is the twin of the image provider route, backed by
  a stored app-wide setting, and reports the selected provider, the one that will
  actually run, and why when those differ.
- Voice pickers group by language and float the project's narration language,
  which is what makes a fifty-four voice catalogue navigable.
- **Library > Voices lists every registered provider**, grouped by provider and
  language, filterable by provider, and searchable across all of them at once.
  Every voice keeps its play control, whichever provider it belongs to.
- **Tools > Speech picks a provider per synthesis**, defaulting to the effective
  one. Trying a provider no longer means changing what every project renders
  with: the choice travels on the request and never writes the app-wide setting.
  A provider that cannot serve is shown as unavailable rather than offered.

### Removed

- **BREAKING — `GET /api/tools` and `GET /api/tools/:name` are removed.** They
  existed so a network-enabled Codex run could fetch data mid-generation by
  curling them, and that generation path is gone. The route was the only caller
  of the tool registry, which held exactly one tool.
- **BREAKING — the `tools:` key is no longer part of the workspace config
  format.** It granted access to the route above and gated nothing else, so it
  is removed rather than left as a setting with nothing to deny. A `config.yaml`
  that still carries the key keeps loading; the key is simply no longer read.

### Changed

- **BREAKING — Canvas TTS is removed**, along with `MALEO_TTS_PROVIDER`,
  `MALEO_TTS_CANVAS_TIMEOUT_MS`, `GEMINI_TTS_CANVAS_URL` and
  `CANVAS_TTS_TIMEOUT_MS` from the Settings surface. Projects that selected
  Canvas fall back to the effective provider rather than failing. Canvas was the
  reason TTS resolved through its own dispatcher instead of the provider
  registry; with it gone, every synthesis path — the route, the chat agent and
  the durable worker — resolves the same way.
- **BREAKING — `/api/tts/status` reshaped.** `supertonic_configured`,
  `canvas_configured`, `image_configured` and `voices_by_provider` are replaced
  by a registry-derived `providers` list plus `selected_provider`,
  `effective_provider` and `selection_error`. No payload field is named after a
  provider any more, so registering one needs no client change.
- Voice audition samples are now per language: voices of a language are compared
  on identical words, and a language-locked voice is auditioned in its own
  language rather than reading English. Re-run `bun run bake:voice-samples` —
  every existing clip is superseded.
- Supertonic's narration language now reaches the provider on every path, and is
  part of its cache key. The same voice speaking two languages previously risked
  serving one clip for the other.

### Fixed

- A voice sample is identified by its provider AND its voice id wherever that is
  held in memory. Ids are unique within a provider and not across them, so a
  surface listing several could mark the wrong row as playing or collide two rows
  on one key. The baked file was already provider-qualified; the in-memory keys
  had not caught up.
- A streamed WAV is measured from the audio that actually arrived rather than
  from its header. A streaming encoder cannot know the length when it writes the
  header and writes a placeholder; trusting it reported a five-second Kokoro clip
  as twenty-four hours, and the timeline placed it accordingly.
- A TTS request for `mp3` is refused at the client with the formats the server
  can actually encode, instead of failing at the service. The shared request
  schema offered `mp3` for every provider, which Supertonic cannot produce.

- **Tools > Speech**, at parity with Tools > Images. `/speech` lists every clip
  the workspace has synthesized — newest first, with the filters carried in the
  URL so a narrowed view is shareable, and a play control on each row beside its
  voice, provider and duration. `/speech/lab` is the synthesis session: text, a
  voice picker with sample playback, and a character allowance shown while you
  type. Synthesis stays a single request; there is no job to poll.
- Speech that projects already had is recovered. 6,627 projects carried 14,685
  synthesized clips in their storyboards that nothing had ever recorded, so a
  Speech gallery built only from new syntheses would have been empty for every
  existing project. Each recovered clip carries the words it speaks and the
  project it belongs to; its voice, provider and exact time were never recorded
  and are left absent rather than guessed. The recovery runs when the database is
  opened, and is safe to repeat.
- Speech is now recorded. `POST /api/tts/generate` previously wrote a file and
  returned a url, so nothing survived the response — the spend was metered while
  the artifact it paid for was not. Each synthesis now opens a ledger row before
  the provider is called and resolves it after, so a clip can be found again and
  a failed attempt stays visible as one.
- `Animated Systems Explainer` built-in Project Preset, with Project Materials
  and a matching Video Template seeded as the project's starting context.
- Two hosted image providers, selectable with `MALEO_PROVIDER_IMAGE`. Both work
  from an API key alone, so image generation no longer requires a browser
  session or a CLI on the machine.
  - `cloudflare-ai` — Cloudflare Workers AI, on a free allocation of 10,000
    neurons/day. Defaults to `flux-2-klein-4b`, which honours aspect and accepts
    up to four reference images; `flux-1-schnell` is selectable but square-only
    and refuses a non-square aspect rather than returning mis-framed output.
    Requires `MALEO_CF_ACCOUNT_ID` and `MALEO_CF_API_TOKEN`.
  - `huggingface` — the Inference Providers router, reaching 200+ models through
    one adapter at pass-through pricing. Requires `HF_TOKEN`, optionally
    `HF_BILL_TO` and `MALEO_HF_INFERENCE_PROVIDER`. Two limits to know about,
    neither of which raises an error: reference images are ignored, because the
    text-to-image task has no parameter for them; and the requested aspect is
    often ignored by whichever provider the router picks, so a 9:16 request can
    return a square. Use `cloudflare-ai` when the aspect or the references have to
    be honoured.
- Public repository baseline: `LICENSE`, `SECURITY.md`, this changelog, and a
  canonical root version.
- `CONTRIBUTING.md` covering participation, contribution intake, and the release
  workflow.
- GitHub issue, discussion, and pull request templates.
- `scripts/check-version.ts` and `scripts/check-references.ts`, both gating
  pull requests in CI.
- Tag-triggered GitHub Release workflow.
- `docs/decisions/README.md` describing the bar for an architecture decision
  record and the supersede protocol.

### Changed

- **Library > Voices lists the voices that can actually be synthesized, and can
  play them.** It served Supertonic's six voices whatever provider was
  configured, so an operator running Canvas saw six voices that would fail at
  synthesis and none of the eight that would work — while `/api/tts/status`
  reported the right thing next door. The catalogue now resolves for the
  effective provider everywhere, from one source. The page also renders the
  sample clip it was already being sent and had been discarding, so the surface
  whose job is auditioning voices can finally play them.
- A voice draws in one colour everywhere. Its hue had two derivations — a
  hand-picked table in the web app and a hash of the id in the catalogue client —
  so the same voice rendered differently in the library than in a storyboard
  export. Existing voices may change colour once; they now agree.
- **The image ledger records speech as well as images.** Every row carries the
  medium it recorded, and reads are scoped by it, so the Images gallery shows
  only images and Speech only speech. Rows written before this are images.
  `GET /api/image-gen/images` returns `asset_url` where it returned `image_url`,
  the column having outgrown the name.
- **The widening lint rule is twenty rules, one per construct.**
  `anti-slop/no-known-value-widening` is gone; in its place are
  `anti-slop/no-widening-<destination>-<position>` ids covering all twenty
  destination-kind-and-position pairs, sharing the same detection. A shared
  severity was an average over constructs a full sample scored between 0% and
  100% genuine, and one id could carry only one disposition. Two pairs are
  retired with their samples recorded, three are scoped by cause, and sixteen
  are at zero and now gated repository-wide by `bun run check:closed-rules`
  rather than only on changed files. If a suppression or config in your branch
  names the old id, it no longer matches anything — use the pair's id.
- **`require-safety-comment-for-type-assertion` is scoped by six more causes.**
  Each of the eleven existing `overrides` causes was tested against this rule
  one group at a time with a recorded sample, rather than extended because the
  files were already listed. Six transferred in whole or in part and are scoped;
  five did not and are unchanged. The rule's findings fall from 212 to 149, all
  of them scoped rather than fixed, and every finding that remains is now
  classified by construct in
  private historical record §5.3.
- `bun run lint:all` is unchanged and still not a gate. It reports 164 errors and
  exits 1, as it always has.

- **Media providers are directories, not packages.** `cloudflare-ai`, `codex`,
  `huggingface` and `sandbox` moved from `@maleo/media-provider-*` workspace
  packages into `packages/media/src/providers/<name>/`, where the adapter that
  wrapped each of them already lived. Four `package.json`, four `tsconfig.json`
  and four `AGENTS.md` are gone; the contracts those guidance files carried are
  now one provider section in `packages/media/AGENTS.md`.

  The split bought nothing — the registry imported all of them statically, so
  every dependency loaded regardless of which provider ran — while the rule that
  kept them leaf packages ("must not import any `@maleo/*` package") forced
  `paths.ts` to exist five times and `health.ts` four. Two of those `paths.ts`
  copies held the same `/uploads/` traversal guards byte-for-byte, with a comment
  in each asking a human to keep them in sync. That resolver is now one module,
  `src/providers/shared/paths.ts`, with its guards tested once and verified by
  mutation rather than asserted twice.

  `@maleo/media-provider-tts-supertonic` stays a package: it ships the
  Dockerfile that builds and runs the Supertonic TTS server, so it is a
  deployable service that also happens to hold a client. Separating those is
  filed separately.

  Nothing an operator configures changed — same provider ids, same env
  variables, same worker HTTP contract.

- **BREAKING — the default media providers moved.** Image now defaults to
  `cloudflare-ai` and TTS to `supertonic`. The previous default, `gemini-canvas`,
  has been removed (below), and registry order is what picks an unconfigured
  default, so both change together. An explicitly selected provider is unaffected.
- **BREAKING — the `sandbox` mock provider is opt-in.** It reports `ready` only
  when `MALEO_SANDBOX=1`, for every capability it implements. Selecting it with
  `MALEO_PROVIDER_IMAGE=sandbox` or `MALEO_PROVIDER_TTS=sandbox` now also needs
  that variable, and fails loudly without it.

  It used to report `ready` unconditionally, which in a registry where an
  unconfigured default takes the first ready provider meant any misconfiguration
  — absent credentials, an unreachable service — could quietly resolve to it. The
  caller then received fabricated media through a success response, with a
  completed job row and nothing to distinguish it from real output.

- A persisted project or workspace provider id that no longer names a registered
  provider now falls back to the default instead of failing every generation. It
  was a valid choice when it was made and a provider was retired underneath it.
  The same id supplied through an environment variable still fails loudly, and a
  provider that is registered but unhealthy still fails from every source.
- **The web client no longer uses Tailwind.** It never really did: across the
  whole app there were 19 utility classes, while the stylesheets read the
  hand-written `--bg` / `--r-1` / `--font-mono` custom properties over two
  thousand times. Tailwind's `@theme` declared the same palette a second time as
  `--color-*`, which nothing read, and 62 further lines mapped those onto
  shadcn's names for one component. That duplicate token layer is gone, along
  with `tailwindcss`, `tw-animate-css`, `bun-plugin-tailwind`, `tailwind-merge`,
  `clsx` and `class-variance-authority`. `radix-ui` stays — it supplies popover
  behaviour the editor uses, which is a different thing from styling output it
  did not.

  Nothing renders differently: the change is verified against 301 visual
  snapshots, and the element defaults Tailwind's Preflight was supplying are
  vendored into `apps/web/src/app/styles/reset.css` rather than dropped. For
  contributors, styling is now plain CSS in `src/app/styles/` and the cluster
  sheets — variants are typed props backed by lookup tables instead of `cva`,
  and `check:layers` now fails on a design token that nothing reads, so a
  second unread token layer cannot accumulate again.

- **Library > Custom Elements is now Library > Elements**, and lists every
  placeable timeline building block rather than only the ones an operator has
  saved. Built-in text, motion and data elements sit alongside Custom Elements
  and Motion presets as groups within one catalogue; the saved blocks are one
  group inside the page instead of the name of it. `/library/elements` is
  unchanged, so existing links still work.
- **Every Library page now shares one layout.** The page title, its description
  and its count come first and the library navigation follows, instead of the
  navigation sitting above the title. Search moved into one shared toolbar in the
  same position on every menu, with group filters beside it where a surface has
  meaningful groups.
  - Project Presets and Video Templates gained search, which they did not have.
  - Materials exposes Story, Visual, Voice and Rules as filters; picking one
    shows that group alone, and a group with nothing in it still says so and
    offers a way to add to it.
  - References switched its Images/Products/Notes tabs to those shared filters,
    so the search box no longer moves or disappears when you switch between them.
- **Video Templates and Elements are catalogues rather than embedded editor
  panels.** Both pages used to render a panel built for a rail inside a project,
  so they carried a close button that closed nothing, a selection control with
  nothing to select for, and a body pinned to a 420px column on a full-width
  page. They now render catalogue rows and tiles and open the shared editor
  behind Create and Edit, so editing behaviour is unchanged.

### Fixed

- Library pages are usable on a phone. The library navigation wrapped instead of
  scrolling out of reach — with six scopes at 320px, half of them were clipped
  with nothing to indicate they existed — and Library > Materials rendered 180px
  wider than the viewport, which the app clips rather than scrolls.
- Page padding is one value again. `--page-pad` said 28px while the page
  container hard-coded 16px below 640px, so the gutter and the breadcrumb bar
  disagreed on phones.

### Changed

- Shipped Project Presets, Materials and Video Templates are stored as **fixture
  rows** instead of virtual entries assembled in code. A built-in preset now
  contains real Material records, so it looks the same in the library as one an
  operator wrote, and inspecting it shows what it will actually seed. Each row
  carries an immutable **slug** alongside its local id: the slug is how a shipped
  row is found and updated across releases, and the id stays a plain local
  reference, so retuning a shipped default reaches every workspace exactly as it
  did before, without a backfill.

  Two behaviours change as a result:

  - **BREAKING** — the virtual `builtin:` preset identity is retired. Default
    pointers and active-preset references are migrated to the fixture rows on
    first open; provenance recorded inside existing projects keeps resolving
    through an alias, with no rewrite of stored project state.
  - **BREAKING** — shipped Video Templates are no longer editable in place. They
    were editable before, with only deletion refused. Editing any shipped row now
    copies it into one you own and applies the edit there; an in-place edit made
    to a shipped template before this release is preserved as a separate
    `(copy)` rather than being overwritten when fixtures are first bootstrapped.

  A shipped row that stops shipping is retired rather than deleted, so anything
  still pointing at it keeps working while it disappears from the library.

- Rebuilt `@maleo/vui` as a video editor library, around four decisions the
  previous implementation could not express. Time is **rational ticks** against a
  project timebase rather than float seconds, so ten thousand single-frame nudges
  at 23.976 land exactly ten thousand frames from where they started. An edit is
  a **transaction** — `begin`, `update`, `commit` — so a drag writes once when it
  ends instead of once per pointer sample, and every operation has an inverse. A
  gesture belongs to the **surface** rather than to the element under the finger,
  so a clip may re-render, change lane or unmount mid-drag and the drag
  continues, with every terminal path named (release, `pointercancel`, lost
  capture, `Escape`, unmount) and only release committing. And a clip's
  duration, its drawn width and its **touch target** are three separately
  computed boxes, so padding a short clip to stay tappable no longer makes the
  timeline quietly lie about time — it reports that it did.

  The package is now six entry points with no root barrel — `kernel`, `dom`,
  `react`, `remotion`, `media`, `conformance`, plus an opt-in `theme` — with the
  layering enforced against built entry graphs, so "the kernel loads without
  React" is checkable rather than a hope about tree-shaking. Host contracts ship
  with **executable conformance suites** a consumer runs against their own
  adapters, and five reference consumers are built and tested from the packed
  artifact on every check.

  All three Maleo editors — content, template, Motion Studio — moved onto it,
  including the base track's scenes and the ruler. Maleo draws its own rows,
  ruler and gutter and answers the vertical axis through its own adapter; the
  library resolves time and the gesture.

- The video-template and Motion Studio editors are full-screen workspaces on
  phones. They fill the visual viewport edge to edge with no desktop modal gap
  or corner radius, keep preview and timeline visible together, and move the
  inspector into a dismissible sheet.
- Fixed the phone action footer being pushed below the fold on devices with a
  display cutout: the full-screen dialog was sized to the whole viewport while
  its overlay had already subtracted the safe-area insets.
- Fixed a single Escape inside an editor sheet closing both the sheet and the
  editor beneath it, losing the edit. The overlay at the top of the stack now
  owns Escape and Tab.
- Fixed timeline drags being dropped when they were fast: a gesture engaged only
  after both a distance threshold and a hold, so a quick flick committed while
  still unengaged and did nothing.
- A content clip drag interrupted by Escape, a lost pointer capture, or a system
  `pointercancel` now restores the clip instead of leaving it wherever the drag
  had reached. The window listeners this replaced ended only on `pointerup` and
  could not see any of those.
- Fixed the timeline viewport republishing an identical viewport in a loop, which
  a resize observer re-armed on every publish. A zoom landing inside that loop
  could be overwritten by the next scroll, which made ctrl-wheel and pinch zoom
  drift off their focal point every few interactions.
- Fixed the template editor's phone header running its subtitle on from its title
  on the same line.
- Root `README.md` rewritten around the current workspaces and quickstart.
- Root `AGENTS.md` rewritten: OpenSpec is the only planning and task-tracking
  workflow.
- Database rows are declared at the query in the 31 places that still asserted
  them at the call site, so `bun:sqlite` carries the row type and checks the
  statement's parameters. `StoredProjectEventRow` is now exported from
  `packages/db/src/db/events.ts`, alongside the existing
  `StoredStoryboardRow` and `StoredContentProjectRow`.

### Security

- Tool execution is now gated by the workspace's `tools:` grant.
  `GET /api/tools/:name` refuses with **403 `tool_not_granted`** unless the
  workspace's `config.yaml` names the tool. **BREAKING for operators**: absent
  and `[]` both deny, because a grant is opt-in — of the seven workspaces in
  `data/workspaces`, `sigi` and `veronika` keep access to `shopee_search` and
  the other five lose it. Add the tool to a workspace's `tools:` list to restore
  it.

  The gate was documented but never existed: `tools/types.ts` stated capability
  was "checked before a tool ever runs" while `routes/tools.ts` stated the
  opposite in its own header, and operators had been writing grants that nothing
  read. `WorkspaceSchema` also stripped the `tools` key before any caller could
  see it, so the grant was inert twice over. This is authorisation, not
  authentication — the route still has no auth.

  Note that a skill's `allowed_tools` in `data/skills/*.yaml` remains unread by
  any code and enforces nothing.

### Changed

- Template Studio and Motion Studio now draw the same strip between the preview
  and the timeline as the main editor does, with the same padding, rule and
  ground, and with the playback controls in it. They used to sit under the
  preview instead, and the studios' strip had no chrome at all and positioned
  its contents with a flexible spacer — so the same readout sat at a different
  place in each studio depending on how many buttons happened to precede it. A
  fixed three-track layout puts playback in the same place on every surface.
  Both studio headers are now one line on a phone, a back control and a title,
  and every editor surface reads one answer for whether the viewport is small:
  between 700 and 860 pixels the main editor used to compose as a phone while
  the studios composed as desktops, in the same window.
- On a phone, Template Studio and Motion Studio now carry one control per
  inspector category on their bottom bar, opening the inspector directly at the
  category tapped. It was a single control that opened a panel whose own rail
  then had to be used to choose one, which took two taps to reach a field. The
  bar also names what is being edited, keeps its close and save controls fixed
  while the categories scroll, and no longer repeats the category rail inside
  the sheet it opens.
- Template Studio and Motion Studio now compose the same editor shell as the
  main editor rather than each keeping its own. Template Studio's inspector was
  a stack of six accordions and is now the same category rail the other two use,
  showing one section at a time. On a phone, both studios reach their inspector
  and their save/cancel actions from a persistent bottom bar instead of a text
  button wedged into the timeline toolbar and a desktop-shaped button row: the
  toolbar's width belongs to the timeline, and the bar is the one surface a
  bottom sheet does not cover, which makes it the way back out of one. The two
  studios also drew the same lane column under two different sets of class
  names; they now use one.

### Fixed

- On a phone, the studios' bottom bar was visible under an open inspector panel
  and could not be used. Its back control read correctly and sat clear of the
  dimmed area, but the panel disabled everything behind it and the bar was part
  of that — so the only way out was the panel's own close. The bar is now
  outside what a panel disables, and its controls work while one is open, which
  is the whole reason it is there.
- The editor inspector's sub-category headings were styled by nothing. The
  component behind them moved into `@maleo/vui` and the editor's rules for it
  stayed behind, matching a class no longer rendered, so the headings fell back
  to the library's defaults — larger padding inside a panel that already pads,
  and the wrong type — while the intended styling sat in the stylesheet looking
  authoritative. The styling is restored, and a check now fails when a rule
  styles something the app does not render, which also turned up 71 further
  dead rules that have been removed.
- The content editor's video preview was missing at desktop widths. The editor
  removed the editor-workspace's own layout boxes with `display: contents`,
  which deleted the flex column stacking the preview over the timeline; the two
  then fell into the surrounding row, the timeline took most of it, and the
  preview's aspect-ratio canvas collapsed to zero width. Below 860px the phone
  rules stack the same elements anyway, so the preview only vanished above
  1024px. The editor now composes against the workspace's documented slots
  instead of removing them.
- The editor's preview/timeline splitter did nothing. It measures the editor
  shell to turn a pointer position into a timeline height, and the reference it
  reads stopped being attached to anything when the shell became a component of
  `@maleo/vui`, so every drag computed a height from nothing.
- The docked clip inspector rendered inside the preview region, so with nothing
  selected its "Inspector ready" empty state sat in the area that exists to show
  the video. It now occupies the workspace's inspector region on desktop and a
  bottom sheet on the phone.
- The timeline's waveform stopped following its clip's width. A wrapper added
  around a clip's body had no stylesheet rule, so it shrink-wrapped and the
  canvas's `width: 100%` resolved against the label rather than the clip —
  zooming widened the clip and left the waveform drawn at the old resolution.
- A trim handle could take the press meant for the clip beneath it, because two
  stylesheets declared the same touch target with `translate` and `transform`
  and the two composed rather than one winning.
- The Image Lab now exposes image-provider choice in its bottom composer, and
  the Reference Library renders catalogue thumbnails again instead of solid
  color cards when the catalogue payload names the image as `src`.
- Opening a project whose saved chat held an older plan card no longer blanks the
  editor. The card assumed a shape that a short-lived earlier version had not
  written, threw while rendering, and took the whole page down with it — the
  project appeared as "Untitled" with nothing in it. Plan cards that cannot be
  read are now skipped when the log loads, and the card tolerates a plan it does
  not recognise instead of failing the page around it.
- A short video with no narration now actually renders. Its beats were planned
  and their images generated, but the timeline placed sections by measured
  voiceover length, so a beat with nothing to say was never placed and the
  finished video came out empty. Sections are now timed by their measured audio
  when they have narration and by their planned duration when they do not. A
  section that has narration but no audio yet still stays off the timeline,
  because that means it is mid-generation or failed, not silent.
- Narration text no longer leaks into longform image prompts. Each visual beat
  carried its narration appended as `Narration beat: <text>`, so the image
  provider was asked to draw the sentence along with the scene — spoken words
  bled into the picture as captions and lettering. The narration is now kept as
  timing metadata beside the prompt instead of inside it, and prompts persisted
  in the older shape are stripped on the way to the provider, so existing plans
  regenerate cleanly without re-planning.
- The Reference Library no longer lists the same reference many times. One
  workspace showed 69 cards for 23 references — seven rows for one picture,
  minted by a retired project-creation path that created a new entity per
  project instead of reusing the workspace's. Duplicates now collapse to one
  entry, and creating a reference that matches an existing one by workspace,
  role, label, and image reuses it rather than adding another row. The existing
  rows are kept and stay selectable, because each is attached to some project.
- References imported from the retired persona routes show their images again.
  Their urls pointed at an endpoint removed during the workspace migration, so
  they had rendered blank; the images are re-hosted as ordinary uploads.
- A reference selected by a Project Preset is now actually used. Applying a
  preset wrote the selection to the project document but never attached it to
  the project roster, and generation resolves references through the roster — so
  the chosen reference silently contributed nothing. The route that saves a
  project document now attaches the selection in the same request, for project
  creation and editor preset changes alike.
- The Reference Library shows the workspace's reference entities again. Catalogue
  reads were served from the `content_assets` mirror, so a workspace with a full
  entity library and a sparse mirror displayed only the handful of mirrored rows.
  Entities are the source of truth now; mirrors only decorate them. Reference ids
  are unchanged, and deleted references stay deleted.
- Image generation stops before calling a provider when a selected reference
  cannot be rendered, naming the reference and why. It used to generate the
  images first and mention the missing reference afterwards, in a job event.
  Projects whose selection drifted from their roster are reconciled
  automatically, so only genuinely broken selections block. References dropped
  by the subject cap or by the image-url safety check are still reported without
  stopping the run.
- Visual guidance stored in more than one compatibility field no longer reaches
  the image provider twice, and `@Reference` mentions in Visual materials are
  resolved to plain labels instead of being sent to the model with the `@`.
- Generated style bibles and planned scene descriptions are now given the
  project's locked constraints — selected references, Visual materials, and Rules
  — before they are written. A project restricted to sketch stickmen with no
  human presence no longer receives a generated style asking for photoreal humans
  that then has to be argued with downstream.
- The Reference Library flags a selected reference that will not render, with
  Attach or Remove beside it.
- Longform planning no longer selects the ChatGPT-account-incompatible
  `gpt-5.5-codex` Codex CLI model; retired saved selections are migrated to
  `gpt-5.5`.
- The dashboard's `config.yaml` reader parses with `WorkspaceSchema` instead of
  returning a raw value for each caller to assert. A malformed block now reads
  as absent rather than failing every other reader, and a config with no `name`
  key still reads its blocks.
- The Telegram capability no longer looks for a `approval.telegram_chat_id` that
  no workspace config contains and nothing writes; it reads `TELEGRAM_CHAT_ID`
  from secrets, which is where every working value already came from. Its
  "not configured" message names that key instead of `config.yaml`.
- Collection items are parsed rather than assumed, so an entry omitting `type`
  reads as `image` instead of `undefined`, and a malformed entry is dropped
  without hiding the rest of the collection.
- The unused `image_collections` override in `config.yaml` is gone. It was
  absent from every workspace config and written by nothing, so collection
  listings have always come from the built-in defaults.
- `WorkspaceSchema` no longer drops the keys a `config.yaml` carries. It was a
  closed `z.object` declaring twelve keys of a document real workspaces carry
  twenty-one to twenty-nine of, so parsing stripped 24 distinct keys — `niche`,
  `tone`, `audience`, `language`, `platforms`, `topics` and more — and
  `routes/tools.ts` hands the parsed result whole to `tool.run`. A tool reading
  `workspace.niche` saw `undefined` with no error.

  No file ever lost a key on disk: every write path edits the YAML document in
  place rather than serialising a parsed workspace. And nothing is broken today —
  the one registered tool reads `workspace.name`, which is declared. This closes
  the trap before the registry grows.

  The object cannot be closed correctly, because `collections_${collection}` is a
  key built from a caller's argument, so the key set is not statically knowable.
  Passthrough is the accurate description of the document, not a shortcut around
  declaring blocks; undeclared keys now arrive typed `unknown` rather than
  vanishing.

- Applying a content preset parses the bundle's `settings`, `pacingDevices` and
  `infographicStyle` blocks instead of asserting their shape at each of the
  places that read them. A preset written by a build that disagreed about a
  field's type applied that value verbatim before — a numeric `aspectRatio`
  reached the editor typed `string`, and a retired voice provider was accepted as
  a current one. Such a field is now dropped and the rest of the preset applies.

  The drop is per field, not per block. A block with one bad value keeps its
  other values, so a bundle holding `{bgColor: "#101010", blur: "lots"}` keeps
  its background colour rather than applying nothing — the difference between a
  preset that half-applies and one that applies what it can. Keys written by a
  later build still survive the round trip.

- The lint-finding classifier in
  private historical record sliced
  oxlint's source spans with string indices where the offsets are UTF-8 bytes,
  so any file with a multi-byte character before a finding was classified from
  the wrong text. It now reads bytes and fails the run if extraction drifts
  again. Anyone re-running that sample gets different — correct — numbers;
  `unclassified` falls from 20% to 2%.

### Removed

- **BREAKING — the `gemini-canvas` media provider.** The Chrome CDP driver that
  produced images and speech by automating a Gemini Canvas share URL is gone,
  along with `@maleo/media-provider-gemini-canvas`, the `playwright` and `tsx`
  dependencies it alone required, the `gemini-canvas-chrome` script, and the
  `GEMINI_CANVAS_URL` / `GEMINI_CANVAS_URLS` settings keys.

  ADR 0002 had already called it the fragile, redundant path and prescribed
  retiring it in favour of hosted providers; it stayed only because it was the
  registry default and its intended replacement was never built. Stored settings
  naming it are cleared on schema apply, and selection falls back to the default
  rather than failing. If it was your image or TTS provider, set
  `MALEO_CF_ACCOUNT_ID` + `MALEO_CF_API_TOKEN` (or `HF_TOKEN`) for images and
  `MALEO_SUPERTONIC_URL` for speech.

- Six unreferenced modules, 483 lines: the API's `telegram-client`,
  `collection-autofill`, `character-autofill` and `character-files`, the
  affiliate package's `niche-match`, and core's `open-loops`. No file imported
  any of them. Five were orphaned in June by the commits that removed the persona
  runtime and the autonomous persona engine — those took out the call sites and
  left the modules — and `niche-match` never had an importer at all.

- The API's `voice-rewrite` module, dead since
  `remove-persona-to-workspace`. Its only export had no callers, and it was the
  sole reader of the persona-era workspace config keys (`niche`, `tone`,
  `audience`, `max_length`). Those keys — along with `platforms`, `topics`,
  `posting`, `engagement`, `example_posts`, `quirks`, `relationships`,
  `learning`, `temporal`, `skills`, `plugins`, `automation`, `affiliate` — are
  now read by nothing. They stay as inert text in existing workspace configs;
  nothing breaks, because the schema passes unknown keys through.

- Beads (`bd`) task tracking and the DOX hierarchy framework from agent
  guidance, including the `bd prime` session hooks.

## [0.1.0] - 2026-08-20

Initial public version.
