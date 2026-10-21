## 0. Preconditions

- [ ] 0.1 Amend `apps/api/src/AGENTS.md:116` to draw the boundary explicitly: model-authored composition code is permitted in a path that renders it to a file and returns it as a generated asset, and remains forbidden in storyboard content. Proof: the amended paragraph, readable without reference to this change.
- [ ] 0.2 Confirm whether generation spend is actually recorded before relying on a spend ceiling. Measured 2026-09-15 on `apps/media-worker/data/gen-worker.sqlite`: every job row carrying a `cost` records `0` (528 image, 1 tts), while latency is recorded normally (image n=1209 p50 7.5s p95 25.9s; tts n=99 p50 5.9s p95 11.7s). Proof: either a metered path shown recording non-zero spend, or a recorded finding that local providers are free and the ceiling must be enforced on token counts rather than currency.

## 1. Vendor The Craft Ruleset

- [ ] 1.1 Vendor the MIT motion ruleset (SKILL, motion patterns, design rules, theme template) into `apps/api`, beside the code that will assemble it into a prompt, pinned by upstream commit with licence text and source recorded. Proof: the vendored directory, its licence file, and the pinned commit hash.
- [ ] 1.2 Add a provenance rule to the third-party audit surface that discovers vendored directories rather than listing them, requiring each to carry a licence, a pinned full commit sha, and a line in the inventory. Proof: `bun scripts/check-release-hygiene.ts` ok, plus a negative test proving removal of any one of the three fails the gate.
- [ ] 1.3 Write the override layer that supersedes the ruleset's audio, caption, Ken Burns and thirty-second-reel sections for single-clip use, and the prompt assembler that appends it after the vendored text. Proof: the override document, and tests asserting every override is present, that overrides are positioned after the vendored sections they contradict, and that the vendored copy is unedited.

## 2. Shared Contracts

- [ ] 2.1 Define the clip grammar set in `@maleo/shared` and what each grammar selects. Proof: the grammar module, and a test asserting an unknown grammar is rejected at parse, before any model call.
- [ ] 2.2 Add the clip brief, review and quality-score schemas to `@maleo/shared` with Zod validation, plus the admission helpers both the orchestrator and the job store read. Proof: schema tests covering a valid brief, a brief missing `purpose`, a brief missing `siblings`, a review with three sampled frames (must fail), a review claiming `pass` while recording black frames (must not admit), and a rendered length that does not match the imposed slot.
- [ ] 2.3 Extend the generation kind to include `clip`, defined once so the job store, the runtime seam, the producer request shape and the worker's enqueue all derive from it. Proof: `bun run typecheck` green across workspaces; removing the kind from any one consumer fails to compile.

## 3. Render Endpoint In `@maleo/video`

- [ ] 3.1 Add a render-only clip endpoint beside the existing render server: composition source and brief in, rendered file and measurements out. No model call, no orchestration. Proof: `bun run video`, POST a source plus brief, observe the response shape.
- [ ] 3.2 Confirm `packages/video` still declares no workspace dependency after the endpoint lands, so `apps/web` can keep importing its composition. Proof: `packages/video/package.json` diff showing no added dependency.
- [ ] 3.3 Build the per-render workspace: pre-baked dependencies, provisioned assets, provisioned brand font, generated `theme.ts` from the project palette, no network and no secret or repository reach. Proof: a test asserting the workspace contains the theme and font and no credential or repository path.
- [ ] 3.4 Bundle and render at exactly `durationSec * fps` frames, under a wall-time cap with termination on overrun and on caller abort. Proof: a rendered clip whose probe reports the imposed frame count; a composition requesting its own duration is overridden; an overrunning render is terminated and recorded as failed.

## 4. Gates

- [ ] 4.1 Implement the static gate over the composition source: import allowlist, easing present on every interpolation, required layer stack per grammar, streaming video component, no colour literal outside the supplied theme. Proof: fixture sources for each rule, each failing with the rule named.
- [ ] 4.2 Implement the deterministic frame gate: container probe (validity, duration, resolution, fps, audio presence) plus pixel analysis of at least four sampled frames for black frames, blank or near-uniform frames, safe-area violations and text contrast, with frame paths recorded. Proof: a clip with audio fails; a clip with three frames fails; a black frame is detected with no model call.
- [ ] 4.3 Confirm the frame gate makes no text-seam call. Proof: a test asserting the seam is untouched during frame measurement.
- [ ] 4.4 Implement the quality scorer: named dimensions scored by reading the composition source against the brief and sibling summaries through the text seam, producing `pass | revise | fail`. Proof: scored fixtures at each verdict boundary, a test that the seam receives source and brief rather than images, and the calibration sample recorded beside the thresholds.
- [ ] 4.5 Make a populated review a condition of admission — a rendered file without one is never stored, and a claimed `pass` never overrides a measured failure. Proof: a test that a rendered path with no review fails; a test that a `pass` status with recorded black frames is refused.

## 5. Orchestration In `apps/api`

- [ ] 5.1 Implement clip authoring through the existing text provider seam, using the workspace's selected provider. Proof: a clip authored end to end; switching the workspace text provider changes which model authors, with no clip-specific setting.
- [ ] 5.2 Implement the generate-gate-revise loop: static-gate failures re-enter as revision requests naming the rule, `revise` verdicts re-enter with the failing dimensions named. Proof: a test that a first-attempt violation produces a second attempt rather than a failed job.
- [ ] 5.3 Bound the loop by attempt cap, wall-time cap and one spend ceiling covering every model call across attempts. Proof: tests for each limit ending the loop.
- [ ] 5.4 Respect the text provider's declared concurrency bound across the loop rather than holding a slot between attempts. Proof: a test that clip authoring queues behind the bound like any other consumer.
- [ ] 5.5 Send the passing composition to the render service over the existing `video-client` boundary. Proof: a generated clip rendered through the service with no rendering runtime in `apps/api`.

## 6. Transport

- [ ] 6.1 Add `clip` to `enqueue` and a `/clip` route in `packages/media/src/worker.ts`, carrying the brief as the request payload. Proof: POST `/clip`, poll `/jobs/:id`, receive the url and review.
- [ ] 6.2 Give clip its own concurrency cap so it cannot starve image and speech work. Proof: saturate clip concurrency and observe image jobs still running.
- [ ] 6.3 Persist the review and verdict on the job record; keep the files directory media-only. Proof: a completed clip job returning its review; the files directory containing only composition sources and rendered clips.
- [ ] 6.4 Record the final verdict and failing dimensions on a job that ends in fallback. Proof: a forced failure whose job row explains why.

## 7. Storage And Staleness

- [ ] 7.1 Persist the composition source as the artifact of record and the rendered file as a cache keyed by `(code, durationSec, aspect, fps)`. Proof: a duration change producing a new bake key with the source unchanged.
- [ ] 7.2 Implement eviction keeping the newest bake per clip, with composition sources exempt. Proof: a test that cleanup removes superseded bakes and never a source.
- [ ] 7.3 Hash the brief and theme on admission so a generated clip goes stale when either changes. Proof: editing `purpose` marks the clip stale; editing the brand palette marks it stale.
- [ ] 7.4 Separate bake invalidation from composition staleness: duration/aspect/fps changes re-bake with no model call, brief/theme changes require regeneration. Proof: a re-bake clearing the bake miss but not the staleness, and recording no token cost.
- [ ] 7.5 Keep regeneration an explicit per-clip action and make renders report stale clips without blocking. Proof: a stale clip not self-regenerating; a render completing and reporting it.

## 8. Metering

- [ ] 8.1 Price clip authoring and scoring through the text provider's existing token metering, on the model that actually ran. Proof: token usage recorded for both calls after one generation; no second pricing path introduced.
- [ ] 8.2 Price a render distinctly from authoring, and a re-bake as a render with no token cost. Proof: a duration-change re-bake recording a render charge and zero tokens.
- [ ] 8.3 Apply the existing quota gate to clip requests. Proof: an exhausted workspace refused by the same gate that refuses other generation.

## 9. Agent And Timeline Integration

- [ ] 9.1 Give the planning agent a way to request a generated clip for a slot, carrying purpose and sibling summaries. Proof: a plan producing a clip request with both fields populated.
- [ ] 9.2 Set `Static` movement for generated clips in the storyboard so preset camera motion is not composed over internal choreography. Proof: a storyboard containing a generated clip showing `Static`.
- [ ] 9.3 Implement the preset fallback when generation ends without a passing verdict, marked as preset-derived. Proof: a forced failure filling the slot; the surface showing it as preset-derived, not generated.
- [ ] 9.4 Surface generated clips in the media library and on the timeline as video clips, with regeneration as an explicit credit-spending action. Proof: open the editor, place a generated clip, drive regeneration from the UI.

## 10. Verification

- [ ] 10.1 Confirm the render path in `packages/video/src/compositions` and `src/components` is unchanged by this work — a generated clip plays as an ordinary video asset. Proof: diff showing no change for clip support.
- [ ] 10.2 Confirm preview and export play the same file. Proof: scrub a generated clip in the editor, export, compare frames at matching timestamps.
- [ ] 10.3 Confirm generated code never reaches the browser. Proof: network capture during editor use showing no composition source requested.
- [ ] 10.4 Confirm no clip provider appears in the capability settings surface. Proof: the capabilities listing, showing clip authoring following the text provider.
- [ ] 10.5 Run the repository gate. Proof: `bun run ci` green.
- [ ] 10.6 Add the `CHANGELOG.md` entry under `Unreleased`. Proof: the entry.
- [ ] 10.7 Validate the change. Proof: `openspec validate "add-generated-clip-capability" --strict` passing.
