## Why

Every moving element this product can produce is chosen from a fixed list. Camera
motion is one of seven labels picked by `(sectionIndex + shotIndex) % 6`
(`apps/api/src/lib/story.ts:469`), flattened to two keyframes with linear easing
(`packages/video/src/lib/motion-keyframes.ts:207`). Infographics are twelve payload
types whose entire build animates off a single scalar `progress` through one
hardcoded easing curve, with per-element stagger encoded as fixed algebra
(`packages/video/src/components/InfographicRenderer.tsx:34`). Two projects with the
same shot counts get identical choreography, because nothing about the content
reaches the motion decision.

Adding presets does not fix this — the ceiling is that motion is _selected_ rather
than _authored_. A clip whose composition is written for its own content can express
holds, staggered builds, layered depth and settle, none of which any preset count
reaches. Authoring that composition, rendering it, and handing the result to the
timeline as a generated asset raises the ceiling without moving model-authored code
into the render path or the editor.

Authoring a composition is a text generation: one prompt in, one blob of code out.
The `TextProvider` seam already models exactly that, and says so — _"the tool loop,
retry policy, tracing and JSON parsing all live app-side"_
(`apps/api/src/lib/ai-provider/types.ts`). So this change adds no runner, no
agent protocol, and no provider for an operator to choose. It composes two things
that already exist: the text provider a workspace has already selected, and the
render service `apps/api/src/lib/video-client.ts` already talks to.

## What Changes

- Clip generation becomes a pipeline, not a provider. `apps/api` orchestrates it
  using the text provider already selected for the workspace; there is no second
  provider choice, because "which model writes the composition" is the same question
  as "which model writes anything else here".
- `clip` joins `image` and `tts` as a generation **job kind**, so clip work inherits
  the durable transport: a job row, an idempotency key, retry, and a pollable status.
  It does **not** become a provider capability.
- A clip request carries a typed brief — grammar, imposed duration, aspect, fps,
  theme derived from the project brand, narrative purpose, and sibling summaries —
  and returns a rendered clip plus a structured review.
- `packages/video` gains a render-only endpoint: composition source and brief in,
  rendered file and measurements out. No model call, no orchestration. It stays a
  leaf package with no workspace dependencies, which is what lets `apps/web` keep
  importing its composition.
- Generated output passes three gates: a static gate over the source (import
  allowlist, easing and layer rules), a deterministic frame gate over the rendered
  file (ffprobe plus pixel analysis — black frames, blank frames, safe-area, contrast),
  and a quality score in which the text provider reads the composition source against
  the brief. No vision model is required, and none is added.
- Two artifacts persist per clip: the composition source as the permanent artifact of
  record, and an mp4 bake as an evictable cache keyed by
  `(code, durationSec, aspect, fps)`. The review and quality score persist on the job
  row, not as a third file.
- A clip that fails after its revision budget falls back to the existing preset path.
  The timeline is never left without a clip.
- Storyboards reference a generated clip exactly as they reference a generated image:
  by url. `packages/video`'s render path gains no knowledge that the source was
  generated.
- Generated clips render mute and caption-free, and set `move: "Static"`, because the
  timeline already owns audio, captions and camera motion.

## Capabilities

### New Capabilities

- `generated-clip`: what a clip brief carries, what clip generation returns, the gates
  a model-authored composition passes before admission, the revision and budget caps,
  the preset fallback, and the two-artifact storage contract with its differing
  lifecycles.
- `clip-codegen-sandbox`: the isolation contract for executing model-authored code —
  import allowlist, no network or filesystem reach from the generated module, resource
  and wall-time caps, and the rule that generated code never executes in a browser the
  user is signed into.

### Modified Capabilities

- `generation-transport`: the job kind enum gains `clip`, with its own concurrency cap;
  the job row carries the structured generation review.
- `generation-metering`: clip authoring is priced through the text provider's existing
  token metering; the revise loop is bounded by one spend ceiling rather than per
  attempt, and a re-bake is priced as a render rather than a generation.
- `generated-asset-staleness`: a generated clip goes stale against its brief and theme,
  and its mp4 bake is invalidated separately by the slot's duration, aspect and fps.
- `ai-text-provider`: clip authoring is a declared consumer of the text seam, and the
  seam's text-in/text-out contract is what keeps a vision model out of the design.
- `third-party-release-compliance`: a vendored third-party motion ruleset needs its
  licence, attribution and pinned provenance recorded.

## Impact

- `apps/api`: clip orchestration — prompt assembly over the vendored ruleset,
  the text-provider call, the static gate, the quality score, the revise loop, and the
  clip request in the planning agent's vocabulary. `src/AGENTS.md:116` needs amending
  to draw the boundary explicitly: model-authored composition code is permitted in a
  path that renders it to a file, and remains forbidden in storyboard content.
- `packages/video`: a render-only clip endpoint beside the existing render server,
  plus deterministic frame measurement. No workspace dependency is added.
- `packages/media`: `clip` as a job kind — `JobKind`, `enqueue`, a `/clip` route, its
  own concurrency cap, and the review on the job record. No new provider capability.
- `packages/inngest`: `generationRequested.kind` enum.
- `packages/shared`: the clip brief, review and quality-score schemas, read by all
  three packages above.
- `packages/db`: job row gains the generation review; clip artifact records and their
  eviction policy.
- `apps/web`: a generated clip appears in the media library and on the timeline as a
  video clip; regeneration is an explicit, credit-spending action.
- New third-party dependency: a vendored MIT-licensed motion ruleset, pinned by commit.
