# Design

## Context

See `proposal.md` for the selected product scope.

- The current `element-groups.ts` classifies Basic, Shapes, Text and Motion. `shape-elements.ts` exposes Rectangle and Circle.
- `clip-templates/registry.ts` supplies stock text, intro and logo presets. `custom-clip-templates.tsx` reconstructs saved variants by looking up those stock bases.
- `packages/shared/src/clip-template.ts` already stores user compositions as `overlays` plus `spanSec`. Layers carry relative start, duration, preset, style, layout and normalized animation.
- `composition-overlays.ts` serializes and restores those bundles. Legacy empty preset IDs resolve to `title`, not plain text.
- `packages/video/src/compositions/reel-text.tsx` holds stock preset code and composition interpretation. Rust already draws plain text and motion/compositing primitives, but not these templates.
- `timeline-template.ts`, generation presentation defaults and template previews can still emit retired title/card IDs.
- Project changes persist through a versioned command log. Saved clip templates use existing library storage and routes. These boundaries must observe cleanup, not just the picker.

## Goals / Non-Goals

**Goals:**

- Retain one primitive vocabulary for authoring, validation and rendering.
- Reuse current composition authoring and storage rather than build a general template engine.
- Delete exactly the retired content authorized by the user, with no ripple or fallback conversion.
- Make cleanup observable, repeatable and safe against stale write paths.

**Non-goals:**

- No stock motion catalogue, per-word special preset engine, arbitrary JavaScript expressions or CSS interpreter.
- No new primitive image/video layers inside saved motion in this phase. Existing media clips remain available on the normal timeline.
- No custom polygon editor, adjustable star point count or cross arm editor.
- No change to captions, camera-motion preset storage, transitions, effects, audio or video-template selection ownership.
- No normal Rust preview switch, inline text typing, renderer overlay pass or export migration.

## Decisions

### D1. Keep stable primitive IDs and retire the remaining visual presets

Retain `plain`, `shape-rect` and `shape-circle`. Add `shape-triangle`, `shape-star` and `shape-cross`. Keep the existing placed-composition discriminator `motion-comp` as a container, not a stock preset entry.

Declare one explicit retirement set from the current styled text, animated card and `rve-*` preset IDs. Use the same set in cleanup, validation and producer tests. Do not classify retirement by a substring search across arbitrary JSON. Unknown malformed IDs are reported for repair rather than deleted as though they were a known retired preset.

Resolve old missing/empty IDs with the old reader before classification. Thus a legacy empty ID that means `title` is removed. New primitive readers never default to `title`.

Custom variants based on retained primitives may remain in Text or Shapes. Motion contains only user-authored compositions. Camera-motion presets remain editing tools and are not Motion element tiles.

Rejected: hiding stock tiles while keeping generators and saved variants able to recreate them. That leaves the removed model alive.

### D2. Reuse layer bundles as the declarative format

Extend the existing composition config with `schemaVersion: 1`. Preserve `overlays`, `spanSec`, relative starts, durations, track order, content, primitive parameters, style, layout and normalized animation. Define actual schemas for the retained fields that are currently passed through as `unknown`.

Primitive definitions contain their stable ID, label, group, defaults and supported fields. Place these pure definitions and normalized shape geometry under `packages/shared`, exported through its existing entry points. Web UI, API validation and Remotion consume them. Rust consumes the same validated render payload and uses fixture-tested equivalents of geometry and timing.

New saved compositions contain flat primitive layers. A placed `motion-comp` wraps that data as today. The compatibility reader accepts unversioned old bundles only through explicit normalization and retirement cleanup. It preserves retained animation and values. Reject unknown newer versions and invalid surviving data before writes. Do not turn compatibility errors into blank frames.

The format has no function bindings, condition language or built-in motion definitions. Users animate primitive layers with existing properties. It needs no interpreter for the deleted cinematic/logo presets.

Rejected: design a scene-graph language capable of reproducing every removed preset. Removing those presets removes that requirement.

### D3. Define five deterministic shapes

Shapes use the existing clip layout box. Paths are normalized to that box and use a shared fill/stroke convention. Preserve Circle/Rectangle behavior, including Rectangle radius, and test nonsquare boxes under the existing resize behavior.

- Triangle: upright, vertices at top center and the two bottom corners.
- Star: five outer points, upright first point, inner radius half the outer radius.
- Cross: centered plus sign, horizontal and vertical bars each one third of the box dimension.

These ratios are implementation defaults, not new inspector fields. Stroke joins, inset/clipping and antialiasing must agree between Remotion and Rust and receive geometry/pixel fixtures. Keep the shape outline inside its authored preview bounds under the selected stroke convention.

Reuse fill, stroke color/width, position, size, rotation, opacity, timing and ordinary keyframe controls. Radius appears only for Rectangle. Shapes have no text/font/casing controls. Do not add new animation properties for shape styling in this phase.

### D4. Share primitive/composition interpretation before deleting old renderers

Refactor the retained Remotion branches to read shared primitive definitions and composition schemas first. Capture Circle/Rectangle and compatible user-composition references before replacing their branches. New Triangle/Star/Cross get reviewed synthetic references from the same production image.

Rust adds shape paths and composition traversal to the existing storyboard renderer. Reuse P2 motion sampling, text layout and compositing. Inner normalized animation and outer clip-local seconds remain distinct, with the current composition span and frame rounding.

Keep the current placement flow. If it expands a saved selection, it creates normal supported clips. If a path creates a packed composition, that clip carries the validated bundle. Neither path resolves its appearance through a removed preset.

Library tiles, Motion Studio, timeline preview and export use the retained interpreter. The Rust support report inspects layer paths and reports unsupported fonts/options independently of drawing. Retiring presets is not permission to remove unrelated historical golden evidence merely to make the gate green.

The operator approved consistent authored text styles during implementation.
Packed layers apply weight, alignment and casing as standalone plain text does.
Compatible unversioned bundles preserve their stored values when normalized,
but frames can change where the old packed renderer ignored these values.
No legacy rendering branch or compatibility flag preserves that omission.

### D5. Cleanup is a pure transform with authoritative persistence

Put the pure cleanup transform in `packages/shared`. It visits known project text payloads, placed composition payloads and saved template definitions. It returns the cleaned value plus counts of retired clips/layers/records. It never visits unrelated media metadata looking for matching strings.

For project heads:

1. Read the current head under the existing project version lock.
2. Remove retired clips and clean composition layers. Remove empty placed composition clips.
3. Preserve every surviving clip field, timeline gap and composition span. Do not rebase surviving layer starts to zero.
4. If changed, persist a new authoritative version with the existing command-log/snapshot mechanism. If unchanged, do nothing.

For saved definitions, remove retired layers without renormalizing `relStart` or `spanSec`. Delete empty compositions and retired-base custom variants. Preserve retained record identities and ownership. Normalize category metadata to text, shape or motion according to the retained base/container. Run template row changes transactionally.

Migrate authoritative writable heads and library rows. Keep historical versions as historical records; apply the same cleanup before restore becomes a new head. Do not bulk rewrite immutable history or delete media objects. Current-head reloads must not consult old defaults and recreate removed clips.

Expose a dry-run count and an explicit apply operation using existing maintenance conventions. Tests use throwaway databases. Planning does not run cleanup against local or production data. During implementation, record aggregate counts without project text or media URLs.

Rejected: filtering clips only in React. That leaves persisted data, exports and other clients inconsistent.

### D6. Release sequencing closes stale-write paths

Install retained-ID validation at project/template save, commands, agent output, import and restore boundaries. Reject new writes containing retired content with an actionable reload/repair error. Historical restore uses the explicit cleanup path rather than ordinary acceptance of retired IDs.

Run migration before normal editing is admitted for the new release. Ensure generation jobs and fixture bootstrap cannot publish old presets after that barrier. Use existing project locks and transaction semantics; do not bypass the command feed with raw document writes.

A client whose command base predates cleanup must receive a cleaned snapshot or an explicit reload refusal before its pending writes can apply. Resetting client undo after that reload must prevent a historical inverse from resurrecting retired clips. Test this as a migration boundary, not just a happy-path schema change.

Cleaned snapshots and migration markers must account for retained old log entries. Catch-up across the boundary uses the existing snapshot response where possible. Do not replay old replacement entries containing deleted presets into an accepted writable state.

Coordinate API and web deployment; outdated clients fail clearly. A rollback of application code alone does not restore deleted content. Follow the existing backup/restore operating procedure for recovery.

### D7. Update producers and title policy at their source

Remove retired choices from generator schemas/prompts, presentation-role defaults, timeline title resolution, previews, fixture bootstrap and tests. New on-screen titles use `plain` plus explicit existing style/layout fields. Do not replace stock rendering with a hidden stock preset registry.

Existing Video Template selections that name retired visual presets become no-title selections. Preserve the Video Template row and unrelated pacing, audio, transitions and project selection. Supported plain/no-title settings survive. Do not regenerate titles while loading or migrating existing projects.

Keep captions and scene-label decorations separate from element presets. Their existing Rust implementation and behavior remain intact.

### D8. Reuse governed UI surfaces

Selected UI contract: existing Elements/Library catalogue, compact `MediaGrid`/`MediaCard` tiles, canonical category controls and approved request states. Use Text, Shapes and Motion headers; `All` remains a filter, not a fourth group. Remove Basic and the stock intro/logo categories from element browsing.

Existing inspector property rows and shape-specific controls own primitive editing. Existing Motion Studio and library CRUD own user motion. Preserve editor pane sizes, persistence, phone sheets, keyboard behavior and overlay-controller ownership. No new shared pattern or feature-specific styling system is needed.

Motion's empty state identifies that users create motion from their own text/shape layers. It must differ from loading and request failure. Built-in primitives remain immediately available while saved definitions load. Verify at desktop and 320px with pointer and keyboard.

### D9. Evidence follows each change

Tests cover cleanup idempotency, surviving-field equality, no ripple, old empty-ID semantics, mixed/empty templates, packed compositions, old snapshots and stale command/inverse writes. Producer tests prove generation and bootstrap reference no retired presets.

Renderer fixtures cover normalized geometry, transparency/stroke, zero values, normalized inner animation, outer keys, preserved composition spans and direct seeking. Render production-image references through retained Remotion interpretation, then compare Rust using existing full-frame and region thresholds.

Browser proof drives all three groups, adds each shape, edits inspector values, animates a selection, saves/places/edits/deletes user motion, undoes placement and reloads. Check that normal preview/export remain Remotion and compare mode draws the same supported composition.

## Risks / Trade-offs

- [Cleanup permanently removes content] -> Dry-run counts, tested scope, transactional writes and existing backups. No silent conversion or media deletion.
- [Stale jobs, snapshots or undo restore deleted presets] -> Migration barrier, authoritative validation and cleaned snapshot/reload tests.
- [Removing a leading layer shifts a composition] -> Preserve original span and relative times rather than rerun the save-selection normalizer.
- [Blank text or zero opacity becomes a default] -> Explicit absence handling and zero/empty-value fixtures.
- [Shape strokes differ across backends] -> Shared normalized paths, stated stroke convention and region-level parity.
- [Old raw composition fields fail strict parsing] -> Compatibility cleanup before narrowing schemas; refuse malformed surviving data with its path.

## Migration Plan

1. Define retained IDs, geometry, versioned schemas and pure cleanup with fixtures.
2. Add validated primitive/composition interpretation to Remotion and Rust.
3. Replace producers/defaults and three-group catalogue/authoring paths.
4. Install write barriers and the migration operation, then verify dry-run/apply on throwaway data.
5. Deploy with migration before editing, capture counts and exercise browser/render acceptance.
6. Delete unreachable stock preset code and stale docs only after producer and persistence checks pass.

This change owns grandplan 4.2 and 4.6 under the reduced, user-approved scope. It does not reopen completed motion/compositing work or close media, export or preview cutover milestones.
