# apps/web/src — agent instructions

## Purpose

The web client owns the app shell, the feature screens, the fetch client, and
token-driven styling. It talks to `@maleo/api` over HTTP.

## Ownership

The tree is role-first. The first path segment is what a module IS; the second
is what it is about:

- `app/` — `app.tsx` (view state and routing; it picks a shell per route via
  `shellFor` in `models/core/shell.ts`), `main.tsx`, `serve.ts`, `index.html`,
  the command palette and toast it owns, and the global stylesheets under
  `styles/` behind the single `styles.css` entry. The shell's pieces — sidebar,
  top bar, user menu, bare account frame — live in `components/shell/`.
- `pages/` — one module per route. A page reads route params, chooses a
  layout, and composes components. It may NOT import `api/`, and it
  stays under 200 lines. The set of files here is the set of screens, and that
  is meant literally: `create.tsx` served both `/create` and `/content/:id`
  from one component, and the cost was not the file size but that the form
  could not be rendered without constructing the editor. `create-form.tsx` and
  `content-editor.tsx` are two pages because they are two screens.
- `components/` — anything that renders.
- `hooks/` — React behaviour without markup. Every module here exports a hook.
- `stores/` — the `useSyncExternalStore` spine: the timeline document store,
  the two chrome stores, and the write surface over the document store
  (`document-writers.ts`, `as-one-step.ts`). Hooks read stores; a store that
  imports a hook fails the check.
- `api/` — HTTP wiring and the modules that compose it, split by domain.
- `controllers/` — interaction mechanics that drive the browser without React:
  the timeline surface (pointer capture, the kernel-effect interpreter, the
  scroll writer, the sparse interactive DOM over the canvas, the geometry
  query), the overlay stack, focus trap and Back dismissal (one history entry
  for every open Back-dismissable overlay, answered by the stack's key owner),
  keyboard routing and the keymap,
  announcements and reduced motion. Components and hooks drive them.
- `services/` — one long-lived browser capability per cluster, without React:
  `paint` (canvas painting, palette, scene), `frame-clock`, and `media` (the
  waveform/filmstrip summary pipeline, its workers, cache and cancellation).
  A service imports nothing but `models`. This is not the dissolved
  `services/`, which held hooks, stores, HTTP and nine unclassified modules;
  the import rule is what keeps it from becoming that again.
- `models/` — pure TypeScript. No React import, no fetch. Types, rules, math.

There were five roles until `services/` was dissolved. It was the one name that
did not say what a module IS — it meant "not the others" and held four kinds at
once: 55 hooks, 3 stores, 16 HTTP modules, and 9 modules nobody had classified.
Two mechanisms in `check-layers.ts` existed only to prop it up, a
longest-matching-prefix rank so `services/api` could sit below the rest of
`services`, and a `ROLE_ROOT_ALLOWED` exemption for the unclassified two. Both
were deleted rather than suppressed, because naming the kinds removed what they
were working around.

`components`, `hooks` and `models` group their modules into a second level
named by domain noun — `timeline`, `references`, `clip-templates`,
`storyboard`, `editor`, and so on. Those role directories hold no loose
modules; that is checked, because `shared/` accumulated three that sat outside
every import rule precisely by having no layer directory.

`api/` and `stores/` are flat, and deliberately so. `api/` is 21 modules
already named by domain noun (`chat.ts`, `projects.ts`, `media.ts`), so a
directory per module would restate the filename; `stores/` is 5. This is the
same rule that keeps `models/clip-templates/` flat at 41 files — uniform
contents do not need directories — and forcing five store modules into
two- and three-file subdirectories would reproduce the `shared/` shape the
check exists to prevent.

A cluster stays flat too. `timeline/state/` once had eight subdirectories, of
which `core/` held 14 of ~30 modules while six held two files or fewer —
`shared/` one level down. A `core/` appearing inside a cluster is the signal to
split the cluster, not to nest it.

Two things are known and deliberately deferred, recorded here so they are not
rediscovered as if new:

- **Two test modules sit at the `src` root, in no role at all** —
  `http-boundary.test.ts` and `render-option-parity.test.ts`. Both are
  structural rules expressed as tests because they need to resolve imports, and
  both are invisible to the loose-module check, which only inspects roles. It
  was one when `services/` was dissolved and is now two; a third is the point at
  which the check should learn about the `src` root rather than the count being
  rediscovered.
- **State with no reader is the defect this tree keeps producing.** Three
  instances so far, all found by reading rather than by any check:
  `hoveredClipId` wrote on every clip hover and was `void`-ed; four chrome
  fields in the same file were held as `useChromeField` pairs and voided, so a
  component re-rendered whenever any surface opened an edit popover; and
  `assetTab` was subscribed in the editor while the panel host owned it. The
  giveaway is a `void x;` statement, which silences the one signal that
  separates state about to be used from state that has stopped being used. Use
  `useChromeSetter` when a component writes a chrome field it does not render.
- **`hooks/timeline` holds 29 modules and `hooks/editor` 17.** That is large by
  count, not by coupling: the 30 modules in the former `services/timeline` had
  7 imports between them, so any split line would be nominal. Splitting on
  cohesion grounds is not supported by the evidence; if it is done, it needs a
  reason other than the number.
- **`editor-chrome-store.ts` and `shell-chrome-store.ts` are misnamed.**
  `editor-chrome-store.ts` holds the TIMELINE's chrome and
  `shell-chrome-store.ts` holds the editor shell's. A flat `stores/` puts them
  adjacent, which is what makes the misnomer obvious. Renaming is a mechanical
  change across their consumers and belongs in its own commit.

## Local Contracts

- Imports point one way: `pages -> components -> design-system -> hooks ->
  stores -> api -> controllers -> services -> models`. Every rank is one directory name, so a store cannot import a hook
  and HTTP wiring cannot import either. Controllers and services rank below
  `api` and `stores`, so a browser mechanism cannot read app state or issue a
  request, and neither imports React. A component importing a page fails —
  that is what keeps a component reusable across pages. `bun run check:layers`
  enforces all of it.
- Imports that cross a top-level directory use the `@app`, `@pages`,
  `@components`, `@design-system`, `@hooks`, `@stores`, `@api`, `@controllers`,
  `@services` and `@models` aliases, never a
  relative chain, so a module can move without rewriting its importers. An
  alias whose target does not exist is deleted rather than left: `@domain/*`
  resolved to a directory that never existed. The aliases live in
  `tsconfig.json` and nowhere else — Bun resolves paths from it natively, and
  there is no `bunfig.toml` at all now that the Tailwind plugin is gone, so
  there is no second table to drift.
- There is no feature barrel and no `shared/`. A module is in a role directory,
  and in a cluster if that role is clustered, or the check fails. What the old
  feature boundary provided is not replaced — it is measured: `check:layers`
  prints the count of imports crossing a cluster within one role, and does not
  fail on it. If it climbs, the coupling is visible before it is load-bearing.
- **The cross-cluster baseline is 183.** The three added by `use-media-while-uploading` are the session's pending-media resolver reached from `hooks/timeline` (preview) and `models/timeline` (admission, the local probe's type). It was 180 before that and 151 until the VUI kernel's
  host half moved into `models/timeline-view/` and the engine's web side into
  `models/editor-engine/` (`migrate-editor-to-shared-rust-core` task 4.10):
  the 29 added are imports that used to name `@maleo/vui` and now name a
  cluster inside the web, chiefly `models/timeline` reading `timeline-view`
  types. Before that it was measured at 134 just before
  `@maleo/vui`'s DOM, media and React layers moved into `controllers/`,
  `services/` and `components/editor-workspace/`
  (`migrate-editor-to-shared-rust-core` task 3.1); the move added 17, all
  imports between the new clusters (the surface using the overlay stack, the
  workspace components using several controllers). The 246 recorded below had
  already drifted to 134 by then without being updated.
- **The earlier baseline was 246, and it is not comparable to the 659
  recorded at transpose or the 796 reported before it.** Both earlier numbers
  were produced by a defect in the counter, not by the tree: `clusterOf()`
  returns a qualified `role/cluster` name and the comparison was
  `here.cluster !== there.cluster`, so a legal downward crossing like
  `components/timeline -> models/core` counted the same as
  `models/timeline -> models/core`. 532 of the 796 crossed a role. Fixing the
  scope alone, with no file moved, gave 264; the role split took it to 236, and
  refiling the shared components took it to 246. Compare against 246, and do not
  read the drop from 796 as improvement.

  That last move went UP by ten while making the tree more correct, which is
  worth understanding before reading the number as a score. Splitting one
  `atoms.tsx` import into separate `Frame` and `Shimmer` imports turns one
  counted edge into two, and a component promoted from a feature cluster to
  `components/ui/` was still same-role and still counted (that directory is
  now `design-system/components/`, a lower role, so those imports are layering
  and the count fell to 124). What fell is the thing
  the count existed to expose: `components/timeline -> components/editor` went
  from 27 to 8.

- A render option the operator can choose is declared once and checked against
  the pipeline. `VIDEO_ASPECTS` in `models/timeline/timeline-editor-model.ts` is
  the aspect list; both pickers read it, and `render-option-parity.test.ts`
  asserts every entry has a `FORMAT_DIMS` row, an `ASPECT_RATIOS` entry and a
  size the renderer's `aspectMap` can produce, plus that every transition in
  `TIMELINE_SCENE_TRANSITIONS` resolves to something other than the fade
  fallback. Add the implementation before the picker entry — the check fails
  until every layer carries the format. It compares imported VALUES, never
  source text: a check that greps for `case "flip":` goes green the moment an
  implementation is refactored, which is when parity is most likely broken.
- One user action is one undo step, and the bracket is scoped to where the
  writes land. `asOneStep` closes as soon as the op returns, which is right only
  when every write the action causes is synchronous. If an EFFECT writes in
  response — row compaction closing the gaps a move opened — the gesture has to
  be opened on the action and closed by an effect declared after that one, the
  way `use-timeline-rows.ts` brackets a drag. A synchronous bracket around such
  an op leaves the effect's write in a second undo entry, and undo pops that
  instead of the action.
- An effect that writes to the document in response to the document changing
  cannot tell an undo from a user edit, and will write the undone state straight
  back — which also clears the redo stack, so the undo looks inert rather than
  wrong. Such an effect asks `writers.isCommandResult()` first. It is an
  identity check on the document undo committed, not a timing flag: "is a
  command being applied right now" is a race against effect scheduling and loses
  it.
- Edits are `EditorCommand` data from `@maleo/shared/editor`, never closures.
  Commit one through `writers.apply(cmd)`; when it must be computed against the
  state at commit time, pass a builder `scope => cmd` (`models/timeline/command-edit.ts`)
  rather than wrapping a command in an object with `apply`/`invert`. Read a
  command's label with `commandLabel`, and test behavior with `applyCommand` and
  `invertCommand`. A new kind of edit goes in the shared vocabulary with a
  fixture, not in web.
- A module belongs in `models/core/` only if two or more clusters import it.
  One consumer means it belongs inside that consumer. The same test governs
  `components/`: two or more clusters means `design-system/components/`, one means that
  cluster. A feature directory is not a home for a module the feature does not
  import — `components/editor/` held four such modules, one of which had no
  importer inside `components/editor/` at all.
- Filenames are kebab-case; `timeline-editor.tsx` still exports
  `TimelineEditor`. The check reads git rather than disk, because macOS sets
  `core.ignorecase` and a case-only rename leaves the index holding the old
  spelling while the working tree shows the new one.
- Tests sit beside their subject as `<module>.test.ts(x)` and move with it,
  one subject per file. If a `models` test needs a renderer or a network stub,
  the module is misplaced.
- Every source file stays at or under 800 lines, stylesheets included; a page
  stays under 200. There is no exception list. `check:layers` also prints the
  three files nearest the ceiling and their headroom on success, because a limit
  that only speaks at 801 lines fires while someone is doing unrelated work:
  both files that approached it were found by hand, one with four lines to
  spare. The report never fails — a large file is not a violation — it just
  means the next split is chosen rather than forced.
- Split a component by OWNERSHIP, not by props. The test is whether state can
  travel with the region: `timeline-tracks.tsx` is separable because the hover
  cursor, drop ghost, marquee and scrub handlers are read nowhere else, so they
  moved with it. What crosses the boundary is two bags — `ops` (actions) and
  `view` (derived values) — while the document, the chrome and the reference
  library are read from their stores directly. A component that would take
  sixty props has not been decomposed; it has been renamed.
- Type a prop bag from `ReturnType<typeof theHook>`, not by restating the
  signature. A hand-copied signature is a second source of truth that drifts
  without failing anything.
- Chrome state lives in a `useSyncExternalStore` with per-field subscription,
  and there are two, split where the surfaces split.
  `stores/editor-chrome-store.ts` holds the TIMELINE's chrome — rails,
  density, inspector, popovers. `stores/shell-chrome-store.ts` holds the
  shell's — panel flags, editor mode, save and render status — because a text or
  image project has no timeline and should not subscribe to a store full of
  timeline fields to learn its save state. Per-gesture state that dies with the
  pointer stays local to the component that owns the gesture. Not context: one
  context re-renders every consumer on any change.
- Persisted, render-affecting state is DOCUMENT state, whatever it looks like.
  `trackFlags` read as chrome — a row of toggles in the timeline header — and was
  component state for as long as `EditorDoc` had no slot for it. It is written
  into the storyboard, read back from `doc.trackFlags`, and decides what a render
  contains. The test is not where a value is drawn; it is whether restoring a
  version has to reproduce it. Anything added to `EditorDoc` must also be listed
  in `scopeEqual` in `@maleo/shared` `editor/scope-diff.ts`: a doc field it does not compare
  makes an edit touching only that field diff to `noop`, and the commit is
  dropped rather than coarsened.
- Stylesheets are wrapped in cascade layers — `workspace`, `app-base`, `chrome`,
  `feature` — whose order is declared in `src/app/index.html` BEFORE any sheet loads.
  `workspace` is the editor workspace's structure
  (`components/editor-workspace/editor-workspace.css`, formerly @maleo/vui's
  `vui` layer), lowest of the app's layers so every other sheet can adjust it.
  Its `--vui-*` tokens are component tokens scoped to `[data-vui-root]` and
  resolved to the app's palette in that sheet, not global tokens. A
  layer's rank is fixed where its name first appears, and cluster sheets are
  imported by their own modules, so the declaration cannot live in
  `styles.css`. Anything unlayered outranks everything layered: a sheet that
  forgets its `@layer` wrapper silently wins over the whole cascade.
  `tokens.css` is unlayered on purpose — it declares custom properties on
  `:root` and `.dark` rather than rules that need a layer — so tokens belong
  there, never in a layered sheet, and `check:layers` fails on one nothing
  reads. `styles/reset.css` holds the element defaults in the `reset` layer,
  declared first; it is Tailwind's Preflight, vendored when that dependency was
  removed, because the app renders through it.
- The shared chrome sheets (`typography`, `shell`, `controls`, `panels`,
  `palette`) are imported by `src/app/styles.css` in the order they were
  written, because several selectors are defined twice and the second one wins.
  A pair split across two sheets swaps. Cluster sheets are imported by the
  module that owns them; the layer declaration is what makes that safe.
- Preserve the existing visual language; do not introduce unrelated UI systems
  or styling stacks ad hoc.
- Page state composes from the `app.tsx` view model and cluster-local state,
  not ad hoc global state.
- API usage flows through `@api/client.ts`.

## Work Guidance

- Keep large screens decomposed by ownership boundary rather than giant page files.
- Reuse existing components and tokens before creating new variants.
- When server contracts change, update page fetch/render paths in same pass.
- Storyboard editing should preserve current timeline studio split: left rail/drawer is global library and entity editing only, center stage is preview-plus-timeline, and scene editing opens from right overlay drawer; do not collapse back into single-image-per-scene flow or make left drawer select scene-specific refs directly. The Assets rail is the single source panel for project-local All Media, global Reference Library, and Stock; keep those as tabs under Assets rather than separate competing rail destinations.
- References are workspace-scoped entities, held in ONE pool (`references/domain/pool.ts`)
  whose entries carry `inRoster` for the project's attachment. Which references a
  scene generates with is decided by `resolveSceneRoster` (`@maleo/shared`) —
  never re-derive "project selection + scene cast" in a component; that rule has
  drifted and shipped bugs twice. Counts and lists must show the resolved, capped
  set, so a card never promises references the render drops.
- The timeline document has one write interface (`state/document-writers.ts`): the
  per-type setters, the projection rebuild and the raw `doc -> doc` seam. Do not
  add a second path into the store.
- Timeline preview is WYSIWYG by default: the center stage uses Remotion `Player` with the same `buildRenderStoryboard`/`StoryboardReel` path as export, while edit handles/controls overlay the Player and the timeline playhead syncs to Player frame updates. Use Remotion packages for player-adjacent behavior where available (`@remotion/preload` for near-playhead media preloading and `@remotion/media-utils` for waveform data), and keep caption menu state flowing into render storyboard props. Do not reintroduce a separate Preview toggle or a second manual playback renderer for audio/video.
- Infographic clips are structured timeline overlays, not generated JSX. Keep `InfographicOverlay` JSON flowing through schemaVersion 2 clips, `buildRenderStoryboard`, Remotion preview/export, and chat-agent output together. Supported payloads are stat reveals, bar/line/area/pie/donut charts, progress bars/rings, table builds, price tags, social proof, and urgency callouts; extend the typed payload contract before adding new Remotion components. New videos keep explicit section `motionGraphic` trace; legacy short-form blueprint cards remain read-only compatibility.
- Placeable animated text belongs in the Motion rail. Motion tiles preview through
  the same Remotion `StoryboardReel` path as timeline/export, then add normal
  timeline clips rather than hidden scene metadata. Keep Motion separate from
  global timeline-framework Templates.
- The Templates rail owns only workspace-global timeline-framework selection plus
  Create/Edit actions. Create and Edit open a modal whose live preview uses the
  same `StoryboardReel` composition as timeline/export; do not use a CSS mock.
  Frameworks control intro motion, entry SFX, data use, background fill, image
  guidance, and reference mentions. Selection persists only the global template
  id plus applied editor values; definitions never become project-owned. Copy
  mentioned global visual refs into project-local All Media during selection.
  Template modal also edits per-section lead-in silence/title duration, entry-SFX volume/offset,
  section gap/title policy, section motion, internal-scene SFX, sentence and planned-sub-section voiceover breathing gaps, independent max visual-beat and max voiceover-segment durations, optional static movement,
  and optional scene-transition override. Keep static and transition override unchecked by
  default; show the transition dropdown only while override is checked. Group the editor into identity,
  opening (section 1), section entries (every section), scene behavior, and visual framework.
  Every template group is independently collapsible. Asset/style choices use the shared
  popover selection vocabulary rather than compact selects: motion/text and transitions
  show renderer-backed previews; SFX uses playable stock results, searchable cues, and a
  persistent player for the selected sound inside the editor. Persist the selected stock
  asset URL so the picker, WYSIWYG preview, and generated timeline all use the same file;
  cue-only legacy templates may resolve once and freeze that URL on save.
  Lead-in silence belongs to section entries and applies before every section.
  Max visual beat and max voiceover segment remain separate controls: voiceover may span multiple visuals,
  both values come from the global template, and static movement never adds a second static-only limit.
  VO breathing controls remain semantic: technical/clause splits have no added
  gap, sentence boundaries use the short gap, planned sub-sections use the longer
  gap, and section boundaries use `sectionGapSec`.
  In Template Studio, timing controls that can overlap visually stay on separate
  lanes: max visual beat, max voiceover segment, and sub-section breath each get
  their own timeline lane.
  Preserve a generated scene's narrated `contentDur` through load/save/chat so structural lead-in or section-gap
  holds do not become false max-visual-beat violations on a later agent run.
  Opening motion applies only to section 1; following-section motion applies from
  section 2 onward. Preview both and resolve/play the selected stock SFX at each
  preview boundary. Background uses the shared `react-colorful` control. Audio
  clip selection opens Levels first; audio/text clips expose numeric timeline timing,
  and locally edited audio levels must survive agent reconciliation and save/reload.
- Legacy create-content video scenes may carry section-first and explainer metadata from
  the `video_blueprint` (`sceneKind`, stable logical/section/storyboard ids,
  intro image source, editorial pattern, semantic information, `question`,
  `claim`, `evidence`, `sourceEvidence`, `analogy`, `visualType`,
  `onScreenText`, `motionGraphic`, `sectionTransition`). Keep these fields flowing through chat job state and
  timeline persistence as provenance only. Visible `onScreenText`,
  `claim`/`evidence` explainer card text, and `sectionTransition.text` must be
  materialized as timeline text clips before preview/export;
  `buildRenderStoryboard` and Remotion must not render extra text directly from
  scene metadata. Section intro scenes carry entry-card/SFX provenance and reuse
  their first storyboard scene's image, but no hidden renderable card.
- Caption editing reads and writes canonical caption cues only, through the shared command ledger; voiceover words never become captions. The panel leads with results (`apps/web/DESIGN.md`, Captions): generate card without cues, caption list with cues, rare actions in the header menu. Show timing provenance (recognized vs estimated) and Needs refresh state, keep the unavailable reason beside Generate with a link to Settings, which owns worker setup. Caption UX controls stay reader-facing and Remotion-backed: presets, max words/chars, motion, active word colour, width and shadow flow into render props.
- Create-content flow (`components/editor/`) is unified: Setup → create the project FIRST (`createProject`, status `brief`) → open the workspace. Setup never starts generation and never writes a first chat prompt. Video opens an empty timeline editor first; storyboard generation is an explicit chat action (`Generate storyboard`) and must not auto-run on project creation or live in the global topbar. All agent commands run through `useContentAgent` (`hooks/editor/use-content-agent.ts`); `CreateContent` owns the run + apply callbacks. Chat command shortcuts are slash-only (`/` autocomplete); command rows show `command | intent`, selecting a command stages the slash token plus natural-language intent in the prompt, and the user must press Send before tools run. Keep `@` autocomplete reserved for project/reference mentions. A reload mid-run re-attaches via `agent.resume()`. Image/text reuse the video `ChatPanel` in a left split pane.
- Create setup is only a project shell form: required project title, optional description, and output format where relevant. Do not expose setup brief or setup duration. Description is project metadata (`reference_notes`) and must not feed generation, chat prompts, or agent context. Creative direction belongs inside the editor so it stays visible and editable after creation: style direction, global style reference, brand kit, project background, data-callout style, and retention overlays live in the Style rail; Project/Settings owns format, generation providers, voice defaults, and render backend; references/media and captions stay in their owning editor panels.
- Content list is operator inventory, not a campaign/status board: show title, type, date created, and last edit only. Keep search plus type filter (`all`, `video`, `image`, `text`) as the primary controls. The title is the editor CTA; do not add separate Open editor buttons or status/campaign/platform columns.
- Longform plan cards expose evidence coverage honestly: show aggregate matched/partial/unverified state, mark unsupported factual sections, and let users expand exact supporting quotes + source links. Never label exact-quote matching as independent fact verification.
- Longform plan cards expose visual-style retry when no `visualStyle` is locked; the action must route through chat to the deterministic style retry path and must not approve/generate assets.
- Longform section redo UI uses **Improve** language. Improve means use the existing generated clip as reference/fallback and keep timing/audio stable; do not label this flow as Regenerate unless a hard replacement path is explicitly exposed.
- Timeline voiceover regeneration uses measured TTS duration and ripples later clips forward/backward by the duration delta; do not trim fresh voiceover to the prior clip length.
- Timeline audio clips preserve semantic kind in the editor: Voiceover, SFX/
  Accent, and Music/Ambient use distinct labels, icons, colors, and named lanes.
  Color alone never communicates audio kind.
- `Organize range` is non-destructive. It groups selected clips, or the scene at
  the playhead, into semantic lanes and separates time-overlapping clips; it may
  change only track placement, never clip count, content, timing, or media.
- Motion template selection exposes presentation categories backed by the shared
  category-to-compatible-template mapping so template choices can expand without
  generator-specific UI branches.
- Pacing insights model both boredom and cognitive overload. Sustained high load
  is a first-class lint state and the heatmap must distinguish balanced, busy,
  overloaded, and quiet ranges.
- Create-content generated outputs must expose a local why + edit handle in the chat/workspace surface: blueprint beats show purpose and edit command, style bible shows rules/source and retry, images show prompt/style/ref source and regenerate command, voiceovers show script/voice/measured duration and edit/revoice command, infographics show data/reason/source and edit/remove, captions show estimated/aligned status and re-align, and render QA surfaces concrete problems with a fix command.
- Create-content chat must render the server's delivery evaluation as an outcome
  card, never translate `needs_attention` into “Done.” Each blocker/warning keeps
  its scoped repair action. Audit shows requested objective, outcome score,
  current/versioned assets, quality metrics, and accept/regenerate feedback.
- Create-content chat must show a single active approval/question surface and a
  visible Stop control for running or waiting agent jobs. Answer controls must
  pass the server-provided action id so stale cards cannot resume a newer gate.
- Live agent scene patches preserve editor-owned `start` and `track` placement,
  plus the last known `contentDur` when a patch omits it. Agent content updates
  must not repack the preview independently from timeline lanes.
- Failed or cancelled agent runs never apply their settled snapshot over newer
  editor state. Partial live patches already applied while running may remain,
  but terminal error payloads cannot replace a later saved storyboard.
- Sidebar/drawer and create-content chat composer show daily and rolling 5-hour
  credit remaining plus refresh time. When credit enforcement is enabled and
  either window is exhausted, replace the chat free-text input with a
  generation-paused card.
- Settings is three tabs over a routed master-detail: Usage, Capabilities and
  Security & Privacy. Usage is the operator page for balance, activity,
  transactions and policy visibility, wired to `/api/credits/balance`, `/usage`
  and `/transactions`; do not introduce payment/subscription UI there until
  explicitly requested.
- **Every settings level is a route** — `/settings/capabilities/tts/kokoro`
  addresses one provider's setup. Nothing lives in component tab state: a level
  that is not a route cannot be linked, cannot be reached by the back button, and
  cannot be photographed by visual regression without a synthetic click, which is
  how a settings tab once went uncovered while 297 green snapshots passed.
- **A provider's form is GENERATED from what the provider declares it needs.** Do
  not hand-write a form per provider; that is the Services-cards surface this
  replaced, one abstraction higher. A field's declared kind decides its input, its
  masking and its store — a secret is written to encrypted storage and never
  returned by any endpoint.
- **Nothing is selected until the route names it, unless the columns are side by
  side.** Where one column fits at a time, a selected item IS the screen and would
  replace the list the operator opened. `useSettingsColumns` owns that line and
  `settings-breakpoint.test.ts` fails if it and the stylesheet disagree.
- Content detail's navbar Settings panel exposes BrowserOS and Sandbox through
  the same `cv-select` field vocabulary used by Render, Video, and Voice
  providers, with auto-save and active-provider state. Selection remains
  workspace-wide and drives subsequent generation jobs. Unready providers are
  visible but disabled and selection errors stay explicit; do not put this routine
  switch in global Settings or Env.

## Visual regression

`bun run visual` screenshots every screen the shell routes to, at 320/768/1024
/1440, and compares against the baselines in `visual/baselines/`. It replays
recorded api responses from `visual/fixtures/api.har`, so it needs no api,
video or image service, and it freezes the clock so relative timestamps are
part of the baseline rather than a reason it rots.

This exists because the type checker and the test suite cannot see rendering:
a malformed `@media` rule once discarded a thousand lines of stylesheet, a
stylesheet split resolved a token to its mobile value on desktop, and a state
class inherited a button's colours — all three passed `typecheck` and the full
suite.

- A diff you did not intend is a regression. Read the images in
  `visual/.output/` before touching the baseline.
- A diff you did intend: `bun run visual:update`, then review the image change
  as part of the diff like any other file.
- New screen: add it to `visual/screens.ts`. An uncovered screen is one no
  baseline protects.
- Api contract changed: `bun run visual:record` against a live api, which
  rewrites the fixture.

`visual/editor.spec.ts` covers the editor's own surfaces: all nine rail panels
and the docked inspector. Rails open with Alt+1..9, not a click — the rail
button toggles, so clicking whichever rail is already open closes the panel.
The Studio view is deliberately uncaptured: `SceneStudio` returns null when a
project has no scenes and the fixture project has none, so the image would be a
topbar on an empty page — one that stays green if the studio breaks entirely.

`visual/layout.spec.ts` asserts the computed values a screenshot cannot name:
`--page-pad`, `--topbar-h`, the sidebar's display and width, the top bar's
display, height and offset, main's offset, and h1's inset from main. Expected values are
written out rather than read from the sheet; a probe that derives its
expectation from what it checks asserts nothing.

`visual/account-shell.spec.ts` drives the user menu, the account pages and
the workspace switcher's settings/members entries, and holds their baselines in
both themes. Base UI popups are tested there rather than under happy-dom.

`visual/gestures.spec.ts` drives the pointer: hover cursor, ruler scrub,
marquee, clip drag, lane right-click, zoom, density. It exists because all 54
screenshots stayed green through a version of the `TimelineTracks` split where
none of that was wired up. A screenshot cannot see a drag.

`visual/phone-chat-workspace.spec.ts` (mobile project) drives the phone's
`Editor | Chat` switch: geometry, selection, playhead and draft surviving a
switch, the run indicator's three states, `Show changes` crossing to Editor,
focus restoration and the keyboard-up layout. Both views stay mounted, so a
screenshot cannot tell a preserved editor from a remounted one — the geometry
comparison can.

## Verification

```bash
cd apps/web
bun run typecheck
bun run test                      # Vitest project `web`, then the Bun suites
bun run test src/api/media.test.ts  # one file (Vitest)
bun run check:layers
bun run visual
```

Unit and component tests run on Vitest in Node. A suite that needs a DOM
declares `// @vitest-environment happy-dom` on its first line and gets a fresh
window per file; happy-dom does not lay out, paint or run real pointer input.
Layout, focus, popups, gestures and the WASM engine in a browser are proved by
the Playwright specs in `visual/` in Chromium. `src/app/api-proxy.bun.test.ts`
stays on Bun: it drives the proxy under `Bun.serve` and Bun's `fetch`, the
runtime that serves it in production.

`bun run visual` runs all four specs. A green screenshot run is not enough on
its own for editor work — the gesture spec is what catches wiring.

Then `bun run web` from the repo root.

Then load touched page/flow and verify behavior manually.

## Directory map

- `app/` — shell, routing, command palette, toast, and `styles.css` plus
  `styles/` (tokens and the visual language).
- `pages/` — one module per route; the file list is the screen list.
- `design-system/` — the shared visual system, below every feature. `tokens/`
  and `icons/` are leaves, `components/` (`button`, `select`, `modal`,
  `popover`, `tooltip` …) build on them, `patterns/` (`inspector`,
  `collection`) build on components. Nothing in it imports `components/`,
  `pages/` or `stores/`, and it is the only place `@base-ui/react` is imported;
  `check:layers` enforces each. A primitive two or more clusters read belongs
  in `design-system/components/`, one module per component.
  - Before writing UI, follow the agent protocol in
    `docs/design-system/patterns.md`: find the pattern in its catalogue, use an
    Approved one through its listed import, and treat a Candidate as a spec to
    read, not an API to invent. Values come from the roles in
    `docs/design-system/foundations.md`, never a literal.
- `components/` — feature UI, clustered by domain noun.
  - A component read by ONE cluster belongs in that cluster, whichever cluster
    it was first written beside. `clip-canvas`, `mention-textarea` and
    `insights-canvas` sat in `components/editor/` with no importer inside it.
  - nested contract: `components/timeline/studio/AGENTS.md` for the boundary
    with the Rust editor engine, which owns edit semantics and time arithmetic
    (`models/editor-engine/`). The timeline's view-model — model, store,
    engagement, geometry — is `models/timeline-view/`; the surface that holds
    pointer capture is `controllers/surface/`. This app draws its own rows,
    ruler, gutter and item bodies in all three editor surfaces, and answers the
    vertical axis through its own cross-axis adapter; what stays Maleo-owned is
    named by `CONTENT_TIMELINE_DOMAIN_OWNERS` in
    `models/timeline/content-vui-adapter.ts`.
- `hooks/` — one module per hook, clustered by domain noun (`timeline`,
  `editor`, `settings`, `image-lab`, `video`, `content`, `catalog`).
- `stores/` — flat: `timeline-document-store.ts`, `editor-chrome-store.ts`,
  `shell-chrome-store.ts`, and the write surface `document-writers.ts` /
  `as-one-step.ts`.
- `api/` — flat HTTP wiring split by domain, including `client.ts`, which is
  the one module allowed to call `fetch` (see `http-boundary.test.ts`).
- `models/` — pure types, rules and math per cluster; `core/` holds what two
  or more clusters share (asset URL resolution, formatting, class names,
  path <-> view routing).
- `scripts/check-layers.ts` (in `apps/web/`) — the layering check.
