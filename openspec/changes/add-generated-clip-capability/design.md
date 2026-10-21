## Context

Motion in this product is selected, not authored. `storyMotion()`
(`apps/api/src/lib/story.ts:469`) picks one of seven camera labels by
`(sectionIndex + shotIndex) % 6`; `fromLegacy()`
(`packages/video/src/lib/motion-keyframes.ts:207`) flattens whichever label to two
keyframes with linear easing. `InfographicRenderer` drives twelve payload types off one
scalar `progress` through a single `easeOut` curve, with per-element stagger encoded as
fixed algebra (`progress * rows.length - index`). The keyframe engine underneath is
richer than either caller uses — `motionKeyframeSchema` accepts up to 24 keyframes and
five easings, and `OverlayAnim` carries per-property tracks — but nothing in the agent's
vocabulary reaches it.

The pieces this change needs already exist, and the design is mostly a question of which
ones to compose.

- `apps/api/src/lib/ai-provider/` holds a `TextProvider` seam: `prompt` in,
  `{ text, usage, model, durationMs }` out, with selection, per-provider config, health,
  normalized thinking levels, and a declared `maxConcurrent`. Its header states the
  intent plainly: _"the tool loop, retry policy, tracing and JSON parsing all live
  app-side. So the seam needs no agent protocol, no session, no tool negotiation — and
  deliberately has none."_
- `apps/api/src/lib/video-client.ts` already reaches the render service over
  `MALEO_VIDEO_URL`.
- `packages/media` already hosts a durable job transport with idempotency, retry,
  per-kind concurrency and a pollable status.
- `StoryboardReel.tsx:322` already renders `kind === "video"` clips through
  `OffthreadVideo`.
- `@maleo/video` declares **no** workspace dependencies. It is a leaf, imported by
  `apps/web` for the composition the Player mounts.

Two external projects informed the shape. A third-party Remotion motion-graphics skill
(MIT) supplies the craft: ten rules, seventeen composition patterns, and a theme
contract. A large agentic video-production project (AGPL) supplies the control loop:
typed artifacts between stages, a deterministic quality scorer that gates progress, a
structured review artifact that exists to prove the output was inspected, and bounded
revision with budget caps. The craft ruleset is vendorable. The AGPL project is not — it
informs the design and nothing is copied from it.

## Goals / Non-Goals

**Goals:**

- Raise the motion ceiling from "pick a preset" to "author a composition for this
  content".
- Keep model-authored code out of the render path, out of the editor, and out of any
  browser carrying a user session.
- Make verification a schema obligation rather than an instruction, so an unverified clip
  cannot be admitted.
- Compose seams that already exist rather than adding a parallel one.
- Leave the timeline renderable when generation fails.

**Non-Goals:**

- Replacing preset motion. Presets remain the default and the fallback.
- Fixing the existing smoothness defects in `CameraMotion` and `InfographicRenderer`
  (linear easing, clip-length-stretched builds, `width` animation, count-up text reflow).
  Those are real and separately actionable; this change neither depends on nor delivers
  them.
- A declarative multi-stage pipeline engine. The artifact-and-gate pattern is borrowed at
  clip scale only.
- Editing a generated composition inside the timeline. A generated clip is regenerated or
  replaced, never hand-tuned — the same contract a generated image has.
- Extending the text seam with image input.

## Decisions

### A generated clip is an asset, not a renderer feature

The alternative was mounting generated components directly in the composition, which is
what "limitless" initially suggests. Rejected on four counts: it would execute
model-authored code in the editor's origin with access to session and storage; it would
break reproducibility, since a runtime upgrade could change a months-old project; it
would move the generated composition's per-frame cost into every scrub and every export;
and it would not deliver editability anyway, because generated code is no more
keyframe-editable when live than when baked.

Treating the clip as an asset keeps the render path unchanged and reuses the mental model
already established for generated images and generated speech.

### Authoring is a text generation, so there is no clip provider

Writing a composition is one prompt in, one blob of code out. That is precisely the
`TextProvider` contract, and the seam was built for consumers that own their own loop.

An earlier version of this design added `clip` as a third provider capability beside
`image` and `tts`, with a `ClipProvider` interface and a conformance suite. That was
wrong, and the way it was wrong is instructive: it would have asked an operator to choose
a provider for clip authoring when they have already chosen a provider for text, and the
answer would always have to be the same model. A settings row whose only correct value is
another row's value is not a choice, it is a chance to be inconsistent.

So `clip` is a **job kind**, not a provider capability. The kind earns the durable
transport — idempotency, retry, pollable status, its own concurrency cap. It does not
earn a selection surface.

Rejected alternative: spawning an agent CLI, mirroring `packages/media/src/providers/codex`.
That would have made the third-party ruleset's tenth rule — render, extract frames, look
at them, fix, re-render — self-executing, which is genuinely attractive. It was rejected
because it adds a runtime dependency on a CLI being present in the deploy target, makes
attempt cost and duration unpredictable, and buys a loop this design has to implement
anyway to enforce its gates. The gates are not optional, and an agent that runs its own
loop still has to pass them.

### Orchestration lives with the text seam; rendering stays where the runtime is

`@maleo/video` has no workspace dependencies, and that is load-bearing: `apps/web`
imports its composition. Making it depend on `apps/api` to reach the text seam would
invert the graph and pull the HTTP server into the web app's dependency tree.

So the split follows the existing one:

- `apps/api` orchestrates — assembles the prompt, calls the text seam, runs the
  static gate, scores quality, drives the revise loop. It already has the text seam,
  metering, and the video client.
- `packages/video` renders — composition source and brief in, rendered file and
  measurements out. No model call, no orchestration, no new dependency.
- `packages/media` carries the job.

This also puts the vendored ruleset and the override layer in `apps/api`, beside the
code that assembles them into a prompt, rather than in the package that renders.

### Three gates, and only one of them is a judgement

Injecting a ruleset produces compliance most of the time. It does not produce certainty,
because a prompt is a suggestion.

1. **Static gate** over the source, before bundling. Decidable without executing: import
   allowlist, easing present on every interpolation, required layer stack for the
   grammar, streaming video component, no colour literals outside the supplied theme.
   Failures re-enter generation as revision requests naming the rule. This gate doubles
   as the sandbox import check, so the AST pass is written once.
2. **Frame gate** over the rendered file. A container probe plus pixel analysis of
   sampled frames — black frames, blank or near-uniform frames, safe-area violations,
   text contrast. This is where audio presence is caught, which is how the mute rule
   becomes mechanical rather than advisory.
3. **Quality score** against named dimensions: motion without narrative purpose,
   decoration over communication, typography over-reliance, resemblance to siblings.

### No vision model, and the seam is what makes that a decision rather than a limitation

`TextProvider.generate` takes `prompt: string`. It has no image input, and this design
does not add one.

That constraint turned out to be clarifying. The two kinds of check want different tools
and were only ever conflated because a vision model can do both badly:

- _Is this frame black? Is this text touching the frame edge? Is this contrast
  readable?_ — measurements. Computed exactly from pixels with `sharp`, which
  `packages/video` already depends on. Cheaper, faster, and strictly more reliable than
  asking a model to look at a picture of a black rectangle.
- _Is this motion motivated by the clip's purpose? Does this resemble its neighbour?_ —
  judgements about the composition, best made by reading the composition source against
  the brief. That is text-in, text-out.

Rejected alternative: extending the seam with image input for the frame gate. It would
widen a contract sixteen call sites depend on, in order to do worse at something
deterministic code does exactly.

### The composition source is the artifact of record; the rendered file is a cache

A pure bake loses duration and aspect independence, which matters in a timeline where the
user drags clip edges — a baked file whose slot grows can only stretch, loop or freeze,
all wrong. A pure live-mount has the problems above.

So: store both, with different lifecycles. The composition source is permanent and is what
a re-bake derives from. The rendered file is keyed by `(code, durationSec, aspect, fps)`
and is evictable. A duration change is a cache miss, not a regeneration — which is also
why metering prices a re-bake as a render with no token cost.

This makes the storage shape one source plus N bakes, not a pair, so eviction policy is
part of the contract rather than an afterthought.

The review is the third thing generation produces, and it is metadata about a generation
rather than media. It lives on the job record beside `provider_id`, `model`, `cost` and
`latency_ms`, so the files directory stays media-only.

### The brief carries purpose and siblings

`purpose` exists because the strongest quality dimension is motion with no narrative
justification — which is precisely the current defect, since `(sectionIndex + shotIndex) % 6`
is by construction unmotivated. A composition can only motivate motion if the brief says
what the shot is for, and a scorer can only judge it against something.

`siblings` exists because variation is a property of a sequence, not of a clip. The
existing code already rotates camera moves so neighbours differ; this is the same rule one
level up.

### Grammar is the middle term

Neither fourteen presets nor an unconstrained prompt. A grammar names the kind of clip and
selects which composition patterns apply and what skeleton generation starts from. It
bounds generation enough to be reliable while leaving the composition free within the
frame, and it gives regeneration something stable to reproduce against.

### Theme is synthesised, not copied

The vendored ruleset ships a default palette. Copying it would put a foreign palette inside
brand-coloured videos. The theme module handed to generation is built from the project's
brand palette and infographic style — the same discipline the image path already applies
through its style lock. Fonts are provisioned into the render workspace rather than
fetched, which is both a brand requirement and a sandbox requirement.

### The timeline keeps what it already owns

Audio, captions and camera motion are timeline concerns today. A generated clip that
brought its own would collide: two music beds, two caption layers, camera motion composed
on top of internal choreography. So generated clips are mute and caption-free, and the
storyboard sets `Static` for them. The vendored ruleset's sections on sound design,
captions and Ken Burns are therefore explicitly overridden, as is its thirty-second scene
architecture, which assumes a whole video rather than one shot.

Overrides are layered after the vendored text rather than edited into it, so the vendored
copy stays byte-identical to its pinned commit and precedence is positional.

## Risks / Trade-offs

- **Model-authored code is executed at all** → It executes only in the render service,
  never in a browser with a session. Imports are allowlisted and checked before bundling,
  the workspace has no network or secret reach, and every render runs under a wall-time
  cap with termination on overrun.
- **Clip authoring competes with other text generation for provider concurrency** → It
  respects the provider's declared `maxConcurrent` like any other consumer rather than
  bypassing it, and the clip job kind has its own transport-level cap so a burst of clip
  work cannot saturate image and speech generation.
- **A revise loop multiplies token cost** → One spend ceiling covers every model call in
  the loop, not each attempt; hard caps on attempts and wall time end it regardless.
- **Generation can fail entirely** → Preset fallback fills the slot, marked as
  preset-derived rather than presented as generated, so the project stays renderable and
  the surface does not lie about provenance.
- **Bakes accumulate as the user drags clip edges** → Eviction keeps the newest bake per
  clip; cleanup is forbidden from removing a composition source.
- **Gates may reject correct compositions** → Static rules re-enter as named revision
  requests rather than errors, so a false positive costs an attempt, not a generation.
  Rule severity should be calibrated against observed violations before any rule is made
  blocking, as the repository's lint policy already requires.
- **Deterministic frame checks catch less than a human would** → True, and accepted. They
  catch the failures that actually recur — black frames, blank frames, content off the
  safe area, unreadable contrast — exactly, while the judgement-shaped failures are
  caught by scoring the source. A vision pass can be added later without changing any
  contract here.
- **Vendored ruleset drifts from upstream** → Pinned by commit with licence text recorded;
  updates are deliberate, and the override layer is re-read against new upstream text.
- **`apps/api/src/AGENTS.md:116` currently forbids model-authored animation code** →
  Amended explicitly rather than reinterpreted: permitted in a path that renders it to a
  file, still forbidden in storyboard content. The rule was written for a reason and the
  boundary needs to be legible to the next reader.

## Migration Plan

Additive throughout. No existing storyboard, project or render path changes shape, because
a generated clip enters the storyboard as an ordinary video asset.

Sequence: shared contracts first, then the render endpoint, then the gates, then
orchestration and the revise loop, then transport and metering, then the agent-facing
request, then the web surface. Clip generation stays unavailable until a text provider is
configured and the render service is reachable, so partial deployment degrades to today's
behaviour rather than failing.

Rollback is not offering clip requests: briefs stop being accepted, existing generated
clips continue to play as video assets, and slots that would have been generated fall back
to presets.

## Open Questions

- Which grammars ship first. `explainer-data` and `product-reveal` cover the current
  infographic-heavy use; the rest can follow once the loop is proven.
- What the quality thresholds should be. They should be calibrated against a sample of
  real generations rather than chosen in advance.
- Whether authoring wants a specific thinking level, and whether scoring should run at a
  lower one than authoring.
- Whether a low-resolution proxy bake is needed for scrub responsiveness after a duration
  change, or whether background re-bake with a stale file shown meanwhile is sufficient.
- Recorded `cost` is `0` on every media job row that carries one (528 image, 1 tts),
  measured 2026-09-15. Either the local providers in use are genuinely free or metering is
  not wired for them. The clip spend ceiling assumes a working metered path, so this wants
  checking before the metering tasks are implemented.
