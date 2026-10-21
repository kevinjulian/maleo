# Timeline Shared UI

## Purpose

The boundary between this app's three editor surfaces — Main Editor, Motion
Studio, Template Studio — and the Rust editor engine, which owns edit semantics
and time arithmetic. The engine is reached only through `models/editor-engine/`
(`policy-gesture.ts` for gestures, the command executor for writes).

## Ownership

**The engine owns the edit; the app owns the gesture's surface, the cross axis
and what an edit means.** That split moved three times: the VUI package used to
ship the timeline's drawing, its DOM and React layers became the app's in
`migrate-editor-to-shared-rust-core` task 3.1, and its kernel retired in task
4.10 — the edit policies and time arithmetic to the Rust engine, the
timeline's view-model to `models/timeline-view/`.

- The engine owns placement, trim, linking, snapping, the transaction an edit
  is, and frame/timecode arithmetic. `models/timeline-view/` owns the
  timeline's model, store, engagement rule and geometry, and the time types.
  `controllers/surface` owns the surface — pointer capture, the terminal paths,
  effect interpretation and the geometry query — and `services/paint` the
  painting. `components/editor-workspace` owns the workspace shell, overlays
  and sheets, the inspector rail and the accordion; `hooks/editor-workspace`
  the store bindings.
- **This app draws its own timelines.** Rows, ruler, gutter, playhead and item
  bodies are the editor's markup and the editor's CSS, in all three surfaces:
  the vertical rhythm of a lane stack, a layer stack and a settings preview are
  three different facts, and none of them is the library's. The former
  `VuiTimelineView` had no production consumer and was deleted.
- One surface per region, created ONCE. Its callbacks read current props
  through a ref: an effect keyed on a per-render object rebuilds the surface
  mid-drag, and disposing a surface ends its gesture as `unmount`.
- Adapters are the seam. `content-document-adapter.ts`,
  `motion-document-adapter.ts` and `template-document-adapter.ts` read this
  app's documents into the timeline's model; `content-cross-axis.ts` answers the
  vertical questions with MEASURED heights, one per row (rows differ by lane
  group), and uses the token fallbacks only before layout. What stays
  Maleo-owned is named by `CONTENT_TIMELINE_DOMAIN_OWNERS` in
  `models/timeline/content-vui-adapter.ts`.
- Specs target the timeline through `data-vui-slot`, roles, or the geometry
  query rather than a styling class.

## Local Contracts

- Keep `models/timeline-view/` and the engine domain-neutral. If a change
  would put a scene, a layer or a template setting inside them, the answer is
  an adapter or a typed prop.
- Keep preview transport, playhead color, and duration readouts visually
  consistent across Main Editor, Motion Studio, and Template Studio.
- Studio modals keep fixed headers/footers and fixed outer shells. Overflow
  belongs inside preview, inspector, and timeline panels; CTA actions stay in
  the footer.
- Motion Studio and Template Studio share the same modal chrome, header/body
  spacing, footer action vocabulary, and bounded panel scroll behavior.
- All three surfaces (Main Editor, Motion Studio, Template Studio) share the
  inspector chrome via `VuiInspectorRail`: a left icon-rail of categories + a
  scrolling body of collapsible `AccordionSection`s. The rail selects the active
  category; one category's section is open at a time.
- Timeline clip/range selection sets the active rail category and focuses the
  relevant inspector section/input.
- Studio modals own keyboard focus while open. Modal key events must not bubble
  to Main Editor global shortcuts such as undo, split, delete, or playback.
- Timeline ranges express current editor state and must not introduce hidden
  persistence behavior.
- Preserve `tl2`/`cv` visual language and Remotion-backed preview composition.
- Motion Studio numeric animation tracks cover placement, transform, filter, and
  basic typography/layout attributes: `x`, `y`, `width`, `height`, `scale`,
  `rotate`, `opacity`, `blur`, `bgOpacity`, `fontSize`, `letterSpacing`, and
  `lineHeight`. Color animation uses separate color keyframe tracks for `fill`,
  `bodyFill`, `accent`, and `background`. Preview and export must sample the
  same renderer evaluator.

## Work Guidance

- Prefer adding small adapter props over adding template- or motion-specific
  branching inside anything shared.
- **No element owns a pointer.** An item is hit-tested by identity, and the
  gesture lives in the timeline store — which is what lets an item re-render, change
  lane, or unmount mid-drag. A component that calls `setPointerCapture` for a
  timeline item is reintroducing the defect this boundary exists to remove.
- A committed edit writes ONCE, on the terminal phase. While the gesture is
  open the editor draws the engine's projection; nothing reaches the document
  until it commits.
- Declare an engagement rule in exactly one place per surface and hand it to
  the timeline store as its recognizer. Two thresholds in two files is how a press
  starts meaning different things in different lanes.

## Verification

- `cd apps/web && bun run typecheck`
- Run focused tests for touched timeline helpers and adapters.
- `bun run check:layers` for the file-size and direction rules, and
  `bun run --cwd apps/web test src/models/editor-engine` plus `bunx vp test run --project scripts editor-policy`
  for the engine boundary.
- A gesture change is not verified by a unit test alone: drive the surface in
  the browser. `visual/editing.spec.ts` and `visual/mobile-editor.spec.ts` are
  where the terminal paths, the engagement rule and the touch minimums live.
