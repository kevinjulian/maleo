# Design

## Context

See proposal.md for the motivation and specs/ for the required behaviour.

The parts this change builds on already exist:

- A `motion-comp` text overlay stores a composition in `params`
  (`compositionParams`, `packages/shared/src/composition-schema.ts`). Layers are
  plain text or a shape primitive (`visual-primitives.ts`).
- A layer animates in one of two forms. `anim` is normalized: `t` is 0..1 of
  the layer's duration; `x` and `y` are a translation in percent of the layer's
  own box; `width` and `height` are frame percent; `scale`, `rotate` and
  `opacity` are as named. `layout.animation` uses clip-local seconds. The Rust
  renderer (`crates/renderer/src/scene/text_motion.rs`) and Remotion
  (`CompositionOverlay`) sample both. **Saved motion definitions use `anim`**,
  and Motion Studio edits those saved definitions only, not placed clips
  (`apps/web/src/components/timeline/motion/motion-studio-edits.ts`).
- Easing is `linear | in | out | in-out | bezier | hold`
  (`keyframe-evaluation.ts`, ported bit-identically to `editor-core`).
- Story generation places directed on-screen text in `templateTitleOverlays`
  (`services/story-assets.ts`) as plain clips with no reserved id, so a save does
  not rebuild them. `buildSceneTextOverlays` (`overlays.ts`) is a different path,
  for blueprint and manual storyboards, rebuilt on every persist.
- Model calls follow one pattern: a catalogued prompt (`renderPrompt`),
  `runPrompt`, `parseJson`, a zod schema, and a test override
  (`authorStoryBible` in `apps/api/src/lib/content-generator.ts`).

## Goals / Non-Goals

**Goals:**

- Motion feel comes from code that a test can pin, not from model taste.
- Generated motion is indistinguishable from motion a user built in Motion
  Studio: same clip, same form, same editing.

**Non-Goals:**

- No new primitive, property, easing or document field.
- No rendered-frame review. Lint reads keys, not pixels; frame review is a
  separate change.
- No beat-synced music cues. Motion states use beat-relative times inside the
  span; snapping to a music grid is a separate change.
- No saved library entries are created.

## Decisions

### D1. Output one timeline clip per layer, keys in seconds

Generation and the chat tool place each layer as its own text or shape clip on
its own lane, with `layout.animation` keys in clip-local seconds on absolute
properties (`xPct`, `yPct`, `widthPct`, `heightPct`, `scale`, `rotationDeg`,
`opacity`, colour `fill`). The compiler computes absolute geometry already, so
it writes those keys directly.

- Why: a placed `motion-comp` clip is sealed. Its layer keys show on no
  timeline and nothing edits them, and Motion Studio edits saved definitions
  only. Separate clips put every key in the timeline's key lanes, inspector and
  `set_keyframes`.
- Why absolute keys: box-relative translation (the composition form) made a thin
  layer's vertical move read as `y = 1500 %`. Frame-percent keys read as what
  they are.
- The composition form stays as the compiler's second output: the explode action
  (D9) and the parity case use it.
- Alternative rejected: keep one `motion-comp` clip. Users could not edit what
  generation made.

### D2. Model writes intent, code writes keys

The model returns a `MotionIntent` (layers, roles, classes, states, values at
each state). `compileMotion(intent, spanSec, frame)` writes every key.

- Why: the published workflows show one-prompt motion converges on the same
  defaults. Roles and classes are choices a model makes well; stagger, springs
  and holds are numbers it makes inconsistently.
- Alternative rejected: let the model write keys directly with
  `set_keyframes`. One property per call, a 48-key limit per call, and no rules
  to keep motion consistent.

### D3. Springs are sampled into linear keys

A spring is the closed-form step response of a damped oscillator with damping
ratio `zeta` and settle time `ts`, evaluated directly at each time, never
simulated step by step. The compiler builds every layer's absolute edges, scale,
rotation and opacity from timed moves, samples the whole layer window at 60 Hz,
converts the samples to the normalized units, and removes keys whose removal
keeps the linear interpolation within 0.5 % of each track's range. Typical
result: 10 to 25 keys per track.

- Why: no new easing, so no change to the TS evaluator, `editor-core`, the
  renderer, Remotion or the golden set.
- Alternative rejected: a `spring` easing with parameters. Better editing, but a
  schema change across four runtimes. Revisit if users edit generated springs
  often.

Opacity and colour never use a spring; they use `out` on entrance and `in` on
exit, which cannot overshoot.

### D4. Motion tokens live in one shared table

`packages/shared/src/motion-tokens.ts` holds every number the
spec names, so the compiler, the lint and the tests read one source:

| Class       | zeta | settle | Notes                                 |
| ----------- | ---- | ------ | ------------------------------------- |
| `headline`  | 1.0  | 0.45 s | critically damped, no bounce          |
| `body`      | 1.0  | 0.40 s |                                       |
| `label`     | 0.85 | 0.35 s |                                       |
| `container` | 0.9  | 0.60 s | moves first when paired with text     |
| `accent`    | 0.6  | 0.50 s | the only visible bounce               |
| `indicator` | 0.75 | 0.40 s | trailing edge delayed 60 ms, zeta 0.9 |

| Rule                 | Value                                             |
| -------------------- | ------------------------------------------------- |
| cascade gap          | 150 ms after the previous mover (spec 100–200 ms) |
| secondary offset     | 60 % of the hero offset (spec 50–70 %)            |
| ambient amplitude    | 3 % of frame, sine, period 4 s                    |
| exit duration        | 0.7 × entrance                                    |
| text after container | at 50 % of the container's move                   |
| reading time         | max(1.0 s, words / 3 per s)                       |

### D5. Edge offset uses `x` and `width` together

On the horizontal axis an indicator's leading edge follows the fast spring and
its trailing edge the slow one. Vertical edges move together: a thin underline
stretched vertically reads as a block (found on the first golden contact sheet). The compiler converts the two edge curves into a centre translation
(`x`, percent of the box) and a `width` track (frame percent). This needs no
new property.

### D6. Hook directed on-screen text, author after final assembly

Story generation does not place its on-screen text through
`buildSceneTextOverlays`: that builder reads `scene.onScreenText`, `claim` and
similar fields, which story scenes never set, and serves blueprint and manual
storyboards. Story generation places directed text in `templateTitleOverlays`
(`services/story-assets.ts`), from `section.editorial.onScreenText` and the
section's presentation. That is the hook.

`services/section-motion.ts` owns it:

1. `directedTextSlots(sections, timing)` lists each section's directed text and
   span, the same placement `templateTitleOverlays` used before.
2. `directedTextOverlays(job, slots)` emits a `motion-comp` clip (full-frame
   layout, `compositionParams(config)`, as the editor places one) when a
   composition resolves for a `headline`, `explainer` or `transition` slot, and
   today's plain clip otherwise. Resolution order: the run cache
   `job.sceneMotion[motionInputHash]`, then a `motion-comp` clip already on the
   timeline with the same text and span.
3. After the final `assembleTimeline`, `authorSectionMotion(job, slots)` authors
   every eligible slot nothing resolves yet (concurrency 3), caches successes and
   failures, and the flow assembles once more if any slot gained a composition.

Directed text clips carry no reserved id, so a save never rebuilds them: a
generated composition survives every later edit run. Regenerating story assets
replaces the text layer as it always has, and the placed-clip lookup keeps the
composition for unchanged beats without a model call.

- Alternative rejected: author in `syncSceneTextOverlays` on persist. Persist is
  synchronous and runs on every save; it cannot call a model, and its reserved-id
  band is rebuilt on every save.
- Alternative rejected: a new artifact kind under stage contracts for the cache.
  It is derived and regenerable; the placed clip already carries the result.

### D7. One model call per moment, retried once

`authorMotionIntent` (`apps/api/src/lib/motion-author.ts`) follows the
story-bible pattern: prompt `prompt:content:authorMotionIntent`, 45 s timeout,
one retry on parse or validation failure with the refusal attached; a provider
failure is not retried. Tests answer through the text runner's own seam
(`setTextRunnerForTests`), not a per-caller override, and `runPrompt` meters the
call. Inputs: the text,
presentation, editorial purpose, visual concept, span, aspect, captured visual
style and the ban list (no gradients, glow, particles, fade-in on every layer,
centred-everything layouts). Colours must be hex. An empty shape fill uses the
brand accent, as shapes do today.

### D8. Chat tool reuses the same path

`add_motion_design` calls `authorMotionIntent`, `compileMotion` and
`lintMotion`, then `placeOverlay(job, "textOverlays", …)` with a fresh non-auto
id. Lint findings are returned in the tool note, so the model can say what it
accepted.

## Risks / Trade-offs

- [Dense spring keys are tedious to edit by hand] → Key reduction keeps 6–12 per
  move; the chat tool can regenerate a layer. D3 names the upgrade path.
- [Model ignores roles or returns unreadable layouts] → Schema validation,
  one retry, then plain-text fallback. Lint findings are recorded for tuning.
- [Text spend grows with eligible beats] → Cache by input hash; only headline,
  explainer and transition beats qualify; concurrency 3.
- [Rebuilds overwrite manual edits to generated compositions] → Same as plain
  generated text today. The spec states it; changing it belongs to the
  `fence-video-agent-results` work.
- [A thin layer's vertical move shows as a large `y` value in the stored keys, because translation is a percentage of the layer's own box] → Correct in both renderers; changing it needs a format change this design excludes.
- [Left-aligned plain text in a composition renders centred in the pinned Remotion reference] → Existing behaviour, seen in `composition-local` too; reference intents use centred text.
- [Composition renders differently in Remotion and Rust] → Only existing
  primitives and `anim` properties are used, which `visual-templates` already
  holds to parity. One compiled fixture is added to the parity evidence.

## Migration Plan

No data migration. Existing projects keep their plain-text overlays until a
generation run rebuilds them. Rollback: remove the authoring step; the cache
misses and `directedTextOverlays` emits plain text again.

### D9. Explode a placed motion clip into clips

The editor gains "Expand into clips" on a selected `motion-comp` clip. It builds
one clip per composition layer with `animationFromLegacyText` (the existing
normalized-to-seconds conversion) and replaces the motion clip with one batch
command: one undo step. Saved motion definitions are untouched.

### D10. Reserved ids recognise a beat's motion clips

Each generated layer clip gets id `MOTION_ID_BASE + slot * 32 + layer`, where
`slot` is a 16-bit hash of the beat's text and start. A regeneration that finds
clips in a beat's id range keeps them as they are, user edits included, and
skips authoring for that beat. Text overlay ids are already numbers kept through
persistence, so this needs no schema change. A text or start change gives a new
range and new motion.
