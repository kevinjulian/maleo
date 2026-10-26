# @maleo/shared — agent instructions

Pure types + pure logic shared across packages. Single source of truth for
channel, workspace, and content-behavior schemas. No I/O, no external service
deps. Private package (`workspace:*` consumers only).

## Running

Library only — no dev/build script. Validate with:

```bash
bun run typecheck
```

Import as `import { ... } from "@maleo/shared"`.

## Architecture

```
src/
  index.ts                 export barrel
  channel.ts               ChannelId, MediaType, ChannelSupports,
                           ChannelManifest, pickAspect()
  persona.ts               AutomationFlagsSchema, ActivationRowZ,
                           ChannelActivationsZ (Zod)
  channel-activations.ts   ChannelActivations + activeMediaTypes()
  content-behavior.ts      ContentBehavior, Rule, Mix, ContextSnapshot,
                           parseContentBehavior()
  image-policy.ts          image/aspect validation
  video-policy.ts          video duration/aspect validation
  video-style.ts           style presets + camera/transition/music mapping
  video-blueprint.ts       section-first short-form plan contract, legacy-flat
                           normalization, and semantic scene information
  video-editorial.ts       deterministic audiovisual grammar, relative anchors,
                           TTS-aware timeline compiler, and section music spans
  video-presentation.ts    one-primary-presentation grammar + category/template mapping
  video-attention.ts       deterministic viewer-load scoring + overload lint
  timeline-template.ts     global timeline framework schema + prompt variables
  project-materials.ts     Project Materials (Story/Visual/Voice/Rules): the
                           project's generation context, its stage routing, and
                           the adapters that read pre-materials fields into it
  material-record.ts       reusable material records + the ids a preset names
  content-preset.ts        Project Preset = Project Materials + Video Template
                           (legacy bundle fields retained for compatibility)
  prompt-builder.ts        prompt construction
  storyboard-generation.ts stable story draft/approval schemas, revision-checked
                           commands, and legacy read boundary
  distribution.ts          distribution types/helpers
  credits.ts               pure credit pricing, quote, and limit decisions
  pipeline-artifact.ts     stage handoff envelope, artifact refs + resolver,
                           kind registry, readiness, StageResult
  pipeline-artifact-kinds.ts  one definition per artifact kind (payload schema
                           + readiness) and the default registry
  animation-properties.ts  the one registry of animatable clip/overlay properties
                           (unit, range, neutral value, allowed element kinds)
  visual-primitives.ts     retained IDs, explicit retired IDs and normalized shape geometry
  composition-schema.ts    versioned primitive layers and normalized composition animation
  clip-animation.ts        the animation value, per-kind schemas derived from the
                           registry, trim/retime, export blockers
  keyframe-evaluation.ts   value and colour track sampling, easing incl. hold
  legacy-text-animation.ts read-time upgrade of normalized text `anim`
  render-fps.ts            RENDER_FPS, shared by render, preview and conversion
  editor/                  `@maleo/shared/editor`: the editable scope types and
                           the editor command vocabulary (`EditorCommand`,
                           `execute`), with golden fixtures under fixtures/
```

## Conventions

- **Editor commands are data.** Every edit to the editing scope is an
  `EditorCommand` (`{ type, ...args }`, JSON only, no functions) run by
  the host-provided Rust engine via `src/editor/engine-registry.ts`. Rust generates
  command/scope structure; TS refines opaque payloads with existing domain types.
  Adding a kind means adding it to the Rust schema/executor, regenerating
  `engine-types.generated.ts`, updating `EDITOR_COMMAND_TYPES`, and at least one
  fixture under `src/editor/fixtures/<type>/`; the fixture test fails otherwise.
  A fixture changes only with a deliberate behavior change to its command,
  because every binding is held to the same files. Tests provide the engine lazily
  through the common test guard (`scripts/test-db-guard.ts`, the root Vitest
  setup file); production hosts provide it at startup/load.
- **Animatable properties live in one registry.** Adding a property means one
  entry in `animation-properties.ts`; schemas, inspector labels and limits,
  canvas auto-key and key-command validation derive from it. Do not add a
  second keyframe shape for a clip or overlay. Scene camera motion and Motion
  Studio composition layers are the two normalized exceptions.
- `MediaType`: `"text" | "image" | "video"`.
- `ChannelId`: `threads | instagram | tiktok | reels | shorts | yt-long`.
- Runtime validation via Zod (3.23); export both schema and inferred type.
- `ContentBehavior` is the rules engine deciding media type from context
  (time, topic, tone, recent history).
- Project Materials are the AUTHORING model an operator edits; `CreativeDirection`
  is the WIRE model the generation stages read. `directionFromMaterials` is the one
  conversion between them — do not add a second path, or a stage ends up with two
  places to look and one of them gets forgotten.
- A Project Preset NAMES materials by id; a project stores their resolved VALUE.
  A preset is a recipe and should follow its material as it is edited; a project
  created weeks ago must not silently change what it generated from.
- The `rules` direction channel routes to EVERY stage. A constraint that reaches
  only some stages is not a constraint.
- `VideoBlueprint -> VideoSection[] -> SectionIntroScene + StoryboardScene[]` is
  the canonical short-form contract. Planner output supplies narrative semantics,
  structured `information`, and section `vibe`; it does not choose motion, SFX,
  or concrete music assets. Keep v1 flat
  `beats`/`audioPlan` parsing only at `normalizeVideoBlueprint` for persisted-data
  migration.
- `video-editorial.ts` owns deterministic media decisions. Every semantic
  function maps to one named pattern containing category, clip family, motion
  template, and optional paired SFX. Section entry uses one stable
  motion/SFX grammar. Timeline cues stay relative until measured TTS is known;
  absolute scene, cue, and per-section music timing is compiled afterward.
- Viewer presentation categories map narrative/headline/explainer/transition
  intent to compatible clip templates. Materializers must choose one
  primary family per beat; captions and base visuals remain supporting layers.
- Viewer-attention analysis is pure and deterministic. Sustained overload,
  competing primary overlays, unreadable text, and long VO duplication can gate
  delivery through dashboard outcome evaluation.
- Schema changes must stay backward-compatible — `db` and `api` read the same
  rows.
- Story generation identity is section id for chapters and semantic beat id for
  authored units. Shared commands are pure and revision checked; legacy reads do
  not persist invented ids. Generated media provenance uses input hashes, never
  array counts or URL presence.
- Global timeline templates own section-entry SFX identity/exact asset URL/volume/offset,
  internal-scene entry SFX, sentence and planned-sub-section voiceover pauses, independent max visual-beat and measured voiceover-segment durations, optional static scene movement, optional scene-transition override,
  per-section lead-in silence/title duration, additional section gap/title policy/motion, data use, background,
  and image guidance. Exact SFX URLs are optional for legacy cue-only templates. Scene controls default off. Title duration must be
  positive while lead-ins, gaps, pauses, and offsets may be zero and have no upper cap. Visual limits accept 2-15s and voiceover limits 3-20s; static movement never creates a separate duration limit. New fields require defaults
  so existing DB templates load.
- Voiceover silence follows semantic hierarchy: max-duration technical or clause
  splits add no silence, sentence boundaries use `sentenceVoiceoverPauseSec`,
  planned narration-beat boundaries use `sceneVoiceoverPauseSec`, and section
  boundaries use `sectionGapSec`.
- No filesystem, DB, fetch, env, or subprocess access here.

## Visual primitive contract

`visual-primitives.ts` defines plain text and five shape IDs. `motion-comp`
is a composition container. The explicit retirement set classifies historical
presets. Unknown IDs require repair. Only historical classification resolves
missing, null or empty IDs to the old `title` preset.

Shape coordinates use a unit box. Triangle has vertices at top centre and both
bottom corners. Star has five outer points, starts upright and uses half-radius
inner points. Cross has two centred bars, each one third of its axis dimension.
Circle becomes an ellipse in nonsquare boxes. Rectangle alone supports radius.
`shapeGeometry` scales each axis independently. It clamps stroke width to the
smaller dimension and insets its centreline by half that width. Polygon strokes
use round joins to stay inside the box. Invalid numbers fail; zero dimensions
draw nothing. Existing renderer branches remain unchanged until they adopt this
geometry and pass their parity gates.

`compositionConfigSchema` accepts version 1 or compatible unversioned bundles,
which normalize to version 1. It rejects unknown fields and unsupported versions.
Layers are flat retained primitives. Starts and durations use seconds relative
to the saved selection. `spanSec` retains the original span, including gaps.
Layer order and track offsets remain authored. Inner `anim` keys use normalized
0–1 time over the layer's rendered frame span. Outer clip `layout.animation`
keys use clip-local seconds. Cleanup must not rebase surviving layer starts or
recompute the span. Numeric shape strings remain compatible without conversion.

## Verification

Because this package has no standalone app surface, verify through consumers:

```bash
bun run typecheck
bun run test                               # Vitest project `shared`
bun run test src/editor/clip-keys.test.ts  # one file
```

If you change exported types or schema names, re-check `packages/db`, `apps/api`, and `apps/web`.

## Deps / env

- `zod@3.23`. No env vars.

## Directory map

- `src/` — shared schema/types/helpers barrel.
- `docs/` — package references/codemaps.
