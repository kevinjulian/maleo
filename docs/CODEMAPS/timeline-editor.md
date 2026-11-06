# Timeline editor contract (create-content)

Code: `apps/web/src/pages/content-editor.tsx` and the editor component
clusters under `apps/web/src/components/`. The editor is a
custom DOM timeline over a Remotion `Player` preview; export renders the same
storyboard via `buildRenderStoryboard` (WYSIWYG: preview == render).

## Data model

- **Scenes** (`data.tsx: Scene`) are the base track (row -1/0). Sequential by
  default; a scene with `startSec` set becomes a free clip (gaps allowed).
  A scene may carry multiple `visualClips` (multi-image beat).
- **Free clips** ride generic rows above the base track: `videoOverlays`
  (b-roll), `overlays` (text), `audioOverlays` (voiceover/music/sfx/ambient/
  accent_hit), `effects`. Each has `start`/`dur`
  seconds and a `track` row index. `timeline-clips.ts: buildFreeClips`
  projects them into `TimelineClip { id: "<source>:<refId>", ... }`.
- **Persistence** is storyboard schemaVersion 2 (`timeline-doc.ts:
  toTimelineDoc`): `clips[]` + `markers[]`, written as editor commands through
  the project command log (see "Editing commands and undo"). Chat/media/settings
  live in `editor_state_json`, not the storyboard. Markers are annotations, never
  clip containers.
- **Animation** is one model for every clip and overlay: `layout.animation`
  (audio: `animation`), per-property tracks of `{t, v, easing}` in clip-local
  seconds plus colour tracks. The properties, their ranges and which element
  kinds may use them come from one registry (`@maleo/shared`
  `animation-properties.ts`). Text overlays animate the same box properties as
  visual clips, plus size, style and colour. Legacy normalized text `anim` is
  converted on read (`legacy-text-animation.ts`). Scene camera motion
  (`CustomMotion`) and Motion Studio's composition layers (`CompositionLayer`)
  stay normalized and separate.
- **Saved compositions** use shared `composition-schema.ts`: version 1, flat
  retained primitive layers, relative seconds and preserved `spanSec`. Compatible
  unversioned data gains the version without changing authored fields. Inner
  animation stays normalized; outer animation stays in clip-local seconds.
  Save/place rejects invalid layers rather than defaulting them to `title`.
  Shared `visual-primitives.ts` owns the five shape definitions and normalized
  geometry. `reel-text.tsx` owns retained Remotion interpretation: normal
  preview/export, Motion Studio and library tiles all render `StoryboardReel`.
  Packed previews retain every layer and use the saved span; still frames clamp
  to that span. Rust adoption remains subject to parity verification.
- **Keyframe editing** follows opencut-classic. Each inspector row of
  animatable values has one keyframe toggle before its label
  (`keyed-property-row.tsx` `KeyedFieldRow`, `useClipKeying().rowKeying`); it
  keys every value in the row (Position = X and Y), and editing any value of a
  keyed row keys the whole row at the playhead in one undo step. The selected clip shows one ◆ per moment on
  its bar (`clip-keyframe-lanes.tsx`): Shift-click or a box over the expanded
  lanes multi-selects, dragging/arrows/Delete act on the selection, and the
  toolbar Easing menu sets interpolation. Expand / Collapse keyframes and
  Copy / Paste keyframes live in the clip context menu. Every key edit is a
  `clip.setKeys` command; an edit within 0.1 s of a key updates it. The
  keying rules live in the shared core: the key target and refusal message in
  `maleo_editor_core::keys` (the executor uses the same check), the snap and
  upsert in `crates/app-core/src/keys.rs`, and the key edits, moments, easing,
  paste, edge presets and a row's keying at the playhead in
  `crates/app-core/src/animation_edit.rs`. `clip-keys.ts`,
  `clip-animation-edit.ts` (`rowKeyingAt`) and `@maleo/shared`
  `edge-animation.ts` are typed calls through `inspector_apply`.
- **Inspector groups** are one ordered list per clip kind shared by the
  desktop rail and the phone bar: the clip's own content first (Text / Source
  / Data / Audio), then Transform, Blending, Audio, Timing, and treatments
  (Masks, Adjust, Reveal/Motion, Background). The group keys, the conditional
  groups, the fallback group and the subject precedence come from
  `crates/app-core/src/inspector.rs`; `clip-property-groups.tsx` adds only
  labels, icons and titles.
- **Inspector fields** have no sliders. Values are scrubbable number fields
  (`AmountField`) grouped by context in `FieldRow`s
  (`design-system/patterns/inspector.tsx`): Position [X][Y], Size
  [W][lock][H], Rotation with the flips, Fit, collapsed Crop; Blending
  [Opacity][Blend mode]; Adjust [B][C][S]. Number cells wrap at
  `--ui-field-min`. The size lock is the stored `layout.aspectLocked`; while
  locked, width drives and height follows. The mask size lock works the same
  way and is editor state only. The layout a field reads when absent or out
  of range (`normalizeLayout`, `defaultClipLayout`), text preset styles, the
  gain fader's dB mapping and the focal-point nudge are shared-core rules
  (`crates/app-core/src/layout.rs`, `controls.rs`).
- **Caption words** on voiceover overlays are ABSOLUTE timeline seconds
  (`caption-timing.ts`). Real aligned words win; otherwise timing is
  estimated from text + measured duration. SRT interop: `srt.ts`.

## Retained elements

Editor and Library share Text, Shapes and user-only Motion groups. Filters are
All/Text/Shapes/Motion. `element-catalogue.ts` supplies plain text;
`visual-primitives.ts` supplies five shapes. `clip-templates/registry.ts` exposes
only those six bases. Retained custom variants stay with Text or Shapes, but neither
group offers new variant creation. Motion contains compositions and retains creation.
New shapes use the project aspect ratio to preserve square or four-to-one visible
bounds. Saved composition edits retain original span and leading
layer gaps; placement copies values into a new clip, independent of library CRUD.
Loading scene metadata never derives replacement text clips. Generated titles
are explicit plain-text clips; Video Template title choices are plain or none,
and retired stored selections resolve to none without changing other policy.

## Interaction contract

- **Layout** (`timeline-tracks.tsx`): `.tl2-tlmain` is two columns. The track
  gutter is its own column outside the horizontal scroll. `.tl2-tlscroll`
  (`data-vui-slot="timeline-scroller"`, `trackRef`) scrolls the lanes on both
  axes. `use-gutter-scroll-sync.ts` keeps the two vertically in step, both
  ways, and evens their scroll ranges with a tail spacer. The lanes fill at
  least the panel height (`.tl2-lanes-fill` is empty lane space), so the
  playhead, snap line and hover cursor span the panel.
- **Zoom** (`use-timeline-zoom.ts`): continuous px/sec 4–240, Ctrl/⌘-wheel
  cursor-anchored, `fitToWidth`. A plain vertical wheel scrolls the lanes.
- **Ruler** (`ruler-ticks.ts: rulerMarks`): label and tick intervals step down
  to single frames (`CONTENT_FPS` 30), with labels as `M:SS` on whole seconds
  and `Nf` between. Only the window from `use-ruler-window.ts` is marked: the
  viewport plus a buffer, snapped to half-viewport steps.
- **Lane heights** follow lane group (`tracks.css`). From tallest to shortest:
  scene, visual, audio and caption, then text/data/effect. Caption is the sixth
  group: its clips use `--clip-caption`, the `captions` gutter glyph and a
  one-line ellipsis label (`.tl2-clip-caption`). The cross axis measures every
  row (`rowHeightsPx`), falling back to `LANE_HEIGHT_FALLBACK_PX`.
- **Drag** (`use-content-timeline.ts`): move snaps to clip edges / scene
  boundaries / playhead / beat grid while the toolbar's Snapping mode is on.
  Alt bypasses snap and quantization; Shift locks to vertical (track change
  only). Multi-select moves as a rigid group (one snapped delta for all
  members). A pointer near the viewport edge autoscrolls. With Ripple editing
  on, a trim uses the kernel's ripple policy, so later clips on the lane
  follow it in one undo step.
- **Modes** (`timeline-toggles.ts`): Snapping (default on) and Ripple editing
  (default off), remembered per browser and held in chrome.
- **Time origin** is the `.tl2-lanes` element, which is also the scroller's
  content. Pointer→time math measures from the lanes rect.
- **Selection**: click selects (and seeks preview), double-click on a video
  clip opens the scene drawer (`opensSceneEditorOnDoubleClick`), marquee
  multi-selects (`use-marquee.ts`).
- **Keyboard** (`use-keyboard-shortcuts.ts`): Space/K play-pause, J/L slower/
  faster (no reverse — Remotion can't), S or ⌘B split, Delete follows the
  ripple mode and Shift inverts it (`deleteModeFor`), arrows nudge (0.1s /
  Shift 1s), +/- zoom, 0 fit, Home/End seek, ⌘Z/⇧⌘Z undo/redo, Alt+1..0 rail
  panels. The playhead is a focusable slider: ←/→ step one frame.
- **Selection marking**: a lane holding a selected clip, and its gutter row,
  carry `.holds`.
- **Tracks**: per-row lock/mute/hide flags (`trackFlags`, key -1 = base).
  Locked rows refuse drag/delete. Clips remain selectable for read-only inspection;
  `aria-disabled` follows selection permission, not the edit lock.

## Editing commands and undo

- Every edit is an `EditorCommand` from `@maleo/shared/editor`: plain JSON
  data (`{ type: "clip.move", id, patch }`, …), run by the pure
  `execute(scope, cmd) → { scope, inverse }` (`applyCommand` and
  `invertCommand` separately). The scope is `EditScope`: the document plus
  slides, posts and media assets.
- Callers commit through `writers.apply(cmd)` (or a builder
  `scope => cmd`, resolved against the live store before recording,
  `models/timeline/command-edit.ts`). Whole-document writers go through
  `diffScopeToCommand`, which picks the narrowest command and falls back to
  `scope.replace` when its result would not reproduce the document.
- The undo history, the selection rules, the queue of pending local commands
  and the inspector rules live in the shared Rust core `crates/app-core`,
  reached through the editor engine's WASM calls (`ledger_*`,
  `selection_apply`, `pending_*`, `inspector_apply`). Rules that read the
  document name the shared follower handle (`document-handle.ts`), which the
  canvas rules use too. `inspector-rules.ts` types the stateless calls. Each
  moved rule is held to a reference recorded from the TypeScript before it
  moved (`packages/shared/src/editor/inspector-reference/`).
  Entries are `{ id, command, inverse }`; a gesture collapses into one
  `scope.replace` step back to where it began.
- `use-command-stack.ts` keeps the React side: effects, the slides/posts
  watcher and key bindings. `models/chat/command-ledger.ts` opens an engine
  ledger over the executor `engineExecutor` returns; `run` returns the step
  id, `isLatest(id)` answers whether an agent result can still be undone.
  `models/timeline/selection-model.ts` sends each selection transition to the
  core and keeps the per-render reads in TypeScript.
- Edits persist through the project command log (`p1-command-log`), not as
  whole documents. `models/editor/sync-bridge.ts` decides what reaches it:
  a command the stack ran is enqueued as itself; an undo, a redo, or a write
  that went around the stack (script-view chapters, media reconciliation, the
  slide and post panels) as a `scope.replace` from the last submitted scope;
  an agent run's preview and settled merge (`bridge.localOnly`) not at all.
  `models/editor/command-sync.ts` submits the queue on a 1.2 s debounce, one
  request at a time, and resolves each reply with `pendingResolve` (undo
  pending, apply delivered, re-apply pending except rejected).
- The media library is server-owned (`p1-media-library`): the project read
  returns it, and the editor-state autosave does not carry it. The bridge
  compares it too: assets added around the stack (`ensureMediaAsset`) are
  sent as one `media.admit` each, any other library change as `media.update`.
  After a resolve the editor's library is the server's (from delivered and
  accepted entries) with its pending `media.*` commands applied and its
  unfinished uploads kept; a pending `scope.replace` never restores the
  client's own list. `hooks/editor/use-command-log.ts` opens it from
  the loaded version's `commandSeq` and reads the log on window focus and
  when an agent run settles; a rejected or dropped edit is reported, a
  divergence reloads the saved project.
- Pacing devices and presentation are outside the editable
  scope; `use-content-persistence.ts` writes them alone through
  `PATCH /projects/:id/storyboard-presentation`.
- Command behavior is pinned by the golden fixtures in
  `packages/shared/src/editor/fixtures/<type>/`; any other implementation of
  `execute` must pass the same files.

## Rendering pipeline

- Preview: `Player` + `StoryboardReel` from `@maleo/video/composition`,
  `playbackRate` state, playhead synced via `use-remotion-playhead.ts`.
- Preview media readiness (`hooks/timeline/use-preview-media.ts`): the shared
  projection `previewMediaDependencies` lists every source a clip needs, and
  only clips with sources or blockers. A session (`services/preview-media/
  session.ts`) loads each source completely into session-owned local storage,
  validates it, and reports progress to the Rust readiness engine
  (`crates/media` through the editor WASM). Play is refused until every source
  is ready: `use-remotion-playhead.ts` pauses when readiness drops, and the
  transport disables Play with the toolbar status
  (`components/timeline/media/preview-clip-state.tsx`) as its description.
  Clip bars show a badge only while a source loads or fails; clip menus and the phone actions sheet
  offer Retry for failed sources. Sessions follow the workspace and project
  scope and close on sign-out.
- Editing on the preview canvas is the shared Rust core's: `crates/app-core`
  `canvas/` owns the screen mapping, element boxes at the playhead, hit
  testing, gestures and snapping, the group and mask boxes, and the command a
  change makes (keys at the playhead for keyed properties, a static replace for
  the rest). The web reaches it through the editor engine's `canvas_*` calls
  (`@maleo/shared/editor` `canvas-engine.ts`). `hooks/timeline/use-canvas-engine.ts`
  forwards pointer, touch (`controllers/canvas/two-pointer.ts`) and key input
  from the canvas surface, previews a gesture's command on a copy as the
  Player's draft, applies the release's command as one undo step, and applies
  click and shift-click selection actions. `components/timeline/clip-box.tsx`
  draws the box, handles and guides the engine returns. Inspector layout edits
  go through the same rules (`models/editor-engine/canvas-document.ts`).
- Export: `CreateContent.onExport` → `submitVideoRender` (`api.ts`) →
  dashboard `/api/video/render` → video service. `backend` selects the
  worker path: `local` (in-process `renderMedia`) or `lambda`
  (`renderMediaOnLambda`; needs `REMOTION_LAMBDA_FUNCTION` +
  `REMOTION_LAMBDA_SERVE_URL`, falls back to local with a note when unset).
  Default backend: request body > `MALEO_VIDEO_BACKEND` env > local.

## Invariants (don't regress)

1. Measured audio is the source of truth for timing; word counts and
   estimates are hints.
2. Scenes on the base lane move horizontally only; free clips also change
   track by vertical drag.
3. Group drag preserves relative spacing (single snapped delta).
4. Every edit is a data command with an exact inverse; direct panel edits to
   slides/posts coalesce into one `scope.replace` after 400ms of quiet.
5. Agent-generated (auto) text overlays use reserved ids; user-authored
   clips must survive rebuild/regenerate.
