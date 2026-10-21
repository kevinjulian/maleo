# Content-First Video Studio

## Intent

Shift video creation entry point from `persona -> create content` to
`content project -> optional persona profile -> draft/render artifacts`.

Current repo already has:

- `drafts` as record-of-record for generated artifacts
- `render_jobs` and storyboard prep in `packages/video`
- dashboard `Content` page as cross-persona draft feed

This codemap adds middle layer for planning and references before draft/render.

## Runtime Objects

### `content_projects`

Project root object.

- owns brief
- owns target audience / duration / aspect / platform
- may point to `owner_persona`, but persona is optional
- may link to `campaign_id`

### `content_storyboards`

Versioned text-first storyboard drafts.

- one project can have many storyboard versions
- stores prompt/reference note and raw storyboard payload
- lets operator iterate before asset/render stage

### `content_references`

Reference kit attached to project or storyboard.

- `kind`: `text | image | audio | video`
- `scope`: `global | scene | voice`
- `voice_key` supports multi-voice narration planning
- `notes` hold consistency instructions

### `content_renders`

Bridge to actual render execution.

- can point to `storyboard_id`
- can point to downstream `draft_id`
- can carry upstream `video_job_id`

## Story Planning Pipeline

How a story plan is produced. Five ordered production stages, sequenced by
`planStoryFlow` in `apps/api/src/modules/agents/core/services/planning.ts` — the layer
that may do IO. Three call a model, and none generates media assets.

| Stage     | Where                                                                       | Kind                              | Produces                                                                                                                                                                          |
| --------- | --------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame     | `planStoryFrame` in `apps/api/src/lib/content-generator.ts`                 | model, short timeout              | `planKind`, `arc`, narration language, the `engagement` spine, planned references, and the **grounding decision** (`needed` + the research questions). No narration.              |
| Research  | `runResearch` in `apps/api/src/modules/agents/core/services/research.ts`    | network, only when the frame asks | the cited `ResearchBundle` the draft grounds claims in. Free — `costsAssets: false`, gates nothing. Which service retrieves is `lib/research/registry.ts`'s decision.             |
| Skeleton  | `storySkeleton` in `content-generator.ts`                                   | pure                              | one identified section/semantic-beat slot: opaque ids, chapter function, obligation, default emotion, word budget                                                                 |
| Draft     | `draftStorySections`, same file                                             | model, per plan then per slot     | narration, shots, motion graphic and source evidence filled into the slots                                                                                                        |
| Direction | `directStorySequence`, same file                                            | model, full ordered draft         | purpose, presentation, visual concept, novelty, native overlay text, structured infographic decision, sparse SFX/silence, and ordered visual/reference direction per planned shot |
| Report    | `storyArcCoverageViolations` in `packages/shared/src/story-arc-coverage.ts` | pure                              | five counted invariants, reported for review — never a gate                                                                                                                       |

`planStorySections` composes frame → skeleton → draft → direction for callers
that do not ground; `planStoryFromFrame` is the skeleton-through-direction half
the planning service calls after research. Direction receives the complete draft,
retries invalid structure once, and stores `needsDirection` when it still fails;
that state blocks approval and asset generation while leaving the draft editable.
The direction call receives project-roster identity, provisional planned-reference
definitions, Visual/Rules material, and timeline constraints. Its validated output
is authoritative for the final planned-reference set. A fingerprint over those
inputs makes stale direction re-run before approval.

`needsDirection` is recomputed, never latched. `needsStoryDirectionRepair`
(`packages/shared/src/storyboard-generation.ts`) is the one gate both approval
paths consult: repair runs when the plan needs direction or its inputs drifted,
and never for a blocker only the operator can clear. The repair itself is
`redirectStorySections` (`apps/api/src/modules/agents/core/services/direction-repair.ts`),
called by the chat path through `refreshStoryDirectionForApproval` and by the
editor path through `approveStoryboard`, which persist to a run and to the project
document respectively. A refused approval returns its reason and writes nothing.

**Open blockers.** Unresolved delivery-check findings and direction errors are
derived from current state, not from the chat transcript — `openBlockers`
(`packages/shared/src/open-blockers.ts`) keys each one by a hash of its condition,
so an acknowledgement expires when the condition changes. `GET
/projects/:id/blockers` returns the set plus the clarification batch that renders
it; `POST .../blockers/resolve` applies each answer independently and returns what
remains, the instructions only a run can carry out, and any remedy that failed.
Acknowledgements persist as a `blocker_acknowledgements` artifact on the
storyboard document.

The arc library is `packages/shared/src/story-arc.ts`: five named arcs
(`three_act`, `story_circle`, `seven_point`, `fichtean`, `pov_lifecycle`), each an
ordered list of functions carrying an obligation, a position window as a fraction
of runtime, and a default emotion.

Load-bearing details:

- **Grounding is a frame decision, not a keyword match.** `looksFactual` (a regex
  over the brief) and `defaultResearchQuestions` (a four-query template phrased for
  historical topics) are both gone. The frame already reads the brief to pick arc
  and language, so it also says whether the narration will make checkable claims
  and what to search for. `FormatProfile.researchFirst` reaches the planner as
  `StoryPlanOpts.requireGrounding` and only ever raises: configuration can demand
  grounding the frame did not ask for, and cannot switch the frame's answer off. It
  is deliberately NOT derived from `narrated` — a narrated video is not a factual
  one, and deriving it that way overrode the frame on every narrated build.
- **A degraded frame takes grounding from the plan kind** (`defaultGroundingFor`:
  true for `explainer`, `documentary`, `comparison`), never from the brief's words.
- **Ungrounded is reported, never fatal.** Research that cannot run leaves the plan
  marked ungrounded with the reason, and the approval gate says so — the counts
  `planVerification` already computed now appear in the question the operator
  answers with money (`groundingSummary` in `agent/approval.ts`).
- **Rejecting a story plan keeps the run.** The gate parks on `awaiting_input`
  holding its frame, skeleton and research; the next typed message is the revision,
  and `redraftStoryPlanFlow` redraws every section against that same structure
  before re-gating. The revision resolves its bundle through `researchForPlan`
  (the plan's `researchKey`) rather than `matchingResearch` (a brief fingerprint),
  because a revision changes the brief by definition. Bound: `MAX_PLAN_REVISIONS`
  (12) reports itself and keeps the plan; the durable `MAX_SEGMENTS` (96) only
  catches a run stuck for another reason.
- **Retrieval resolves through a registry**, `apps/api/src/lib/research/registry.ts`:
  explicit selection (`MALEO_RESEARCH_PROVIDER`), then env configuration, then the
  first registered provider that is ready. `searxng` leads and `browseros` follows,
  so grounding no longer requires a daemon on the machine doing the planning.
  Registration order is behavior, not presentation.
  - **No fallthrough.** A failing selected provider means research is unavailable
    and the plan is marked ungrounded — never a silent second attempt, because a
    plan grounded from an unexpected provider is indistinguishable from a
    well-grounded one at every layer that reads it afterwards.
  - **Two request details are load-bearing and asserted by the conformance suite**
    (`lib/research/conformance.ts`), not left as comments, because a provider that
    stops sending either still works and quietly does less: search must ask for
    `categories=general,science` (the scholarly engines live there — 35 results from
    2 engines becomes 93 from 7), and a read must request a `PruningContentFilter`
    and consume `markdown.fit_markdown` (raw markdown opens with navigation, and
    the caller takes the first 600 chars).
  - **A redirect is reported.** `redirected_url` becomes `finalUrl`, so the citation
    names the page whose text was actually read; `researchTopic` re-validates that
    url against SSRF before citing it.
  - `RESEARCH_CAPS.maxCandidates` (10) bounds how many pages one pass reads. It is
    its own number rather than `maxSources × a multiplier`, because reads are
    sequential and a derived cap would drift with the citeable-source limit.
- **"Research again" merges, never replaces.** `researchAgain` unions new sources
  into the run's bundle by url, so a second search that ranked differently cannot
  drop the source the current plan already cites.
- **The skeleton is why the split exists.** Once slots are data, the draft fills
  pre-shaped holes instead of inventing structure and prose at once, and a failed
  slot has something to retry against — one slot, not the whole plan schema.
- **Identity exists before prose.** Draft retry reuses skeleton section and
  semantic-beat ids. Held-skeleton redraft retains surviving ids and locked beat
  contents; chapter grouping continues to use section id while measured voice and
  visual segments carry semantic beat id.
- **Failure degrades to a skeleton, never to substitute narration.** A failed frame
  retries once and then falls back to the plan kind's default arc and the job's
  configured language, marking the plan `frameDegraded`. With no configured
  language there is nothing usable to degrade to, so planning fails visibly.
  Narration language is never inferred from topic words.
- **An undrafted slot is kept and marked**, with empty narration and
  `needsDrafting`, rather than dropped or filled with substitute text.
- **Direction is approval data, not a second planner.** `plan_story` remains the
  only public planning tool. Direction lives on each semantic beat; exact logical
  bindings, aliases, final planned-reference definitions, and its input
  fingerprint are frozen into the approved snapshot. Visual authoring and frame
  hashes consume them; native text becomes editor text overlays, infographics
  require explicit data, and `sfxCue: null` suppresses generic accents unless a
  template pins an asset.
- `pov_lifecycle` is the promoted form of the old POV lifecycle stages;
  `POV_CHAPTER_FUNCTIONS` and `POV_LIFECYCLE_STAGES` are `satisfies`-checked
  against that arc, so a drift is a compile error. POV is now a selectable arc, not
  a regex over the brief.
- **Arc coverage warns; visual beat coverage still blocks.** A midpoint at 0.62 of
  runtime is a pacing opinion; a duplicate or uncast image wastes a provider call.
  Only the second hard-fails before submission.
- `chapterFunction` is the narrative job a section holds. It is **not** the timeline
  chapter that contains it — `timeline-chapters.ts` is untouched.
- Arc, chapter function and obligation are **optional on the plan**. A plan
  persisted before arcs existed loads, renders, and reports no arc coverage.
- The **script view joins the two for display only**, in
  `apps/web/src/models/script/arc-chapters.ts`. The join key is that `seedChapters`
  gives a run the agent already grouped its plan section's own id, so a chapter id
  and a section id are the same string. A chapter grouped by beat or by nothing
  gets a positional `ch-N` id, matches no section, and renders as before. Nothing
  there derives a chapter or writes to the document, and the operator-written
  chapter brief is never overwritten by the arc's obligation.

## Story Beat Visual Pipeline

How a narrated story's image prompts are produced. Two model calls, one pure
compiler, one gate.

| Stage       | Where                                                                                   | Kind                                                  | Produces                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Story Bible | `authorStoryBible` in `apps/api/src/lib/content-generator.ts`, after sequence direction | model, once per story, then pure reference derivation | visual constants plus one identity-linked subject/location entry per validated direction binding                               |
| Beat intent | `authorStoryBeatVisuals`, same file                                                     | model, once per section                               | one `BeatVisualIntent` per measured narration beat: approved bindings, moment, action, end state, camera, per-beat constraints |
| Compile     | `buildStoryBeatIntent` in `packages/shared/src/story-beat-compile.ts`                   | pure                                                  | `ImagePromptIntent` — bible fills style/lighting/negatives, beat fills scene/composition, materials fill constraints           |
| Gate        | `storyBeatCoverageViolations` in `packages/shared/src/story-beat-coverage.ts`           | pure                                                  | counted timing, coverage, binding-subset, and attached-roster invariants, run before any provider call                         |
| Render      | `compileImagePrompt` in `packages/media/src/generation/image-prompt.ts`                 | pure, in the worker                                   | the provider-facing prompt text, after provider selection                                                                      |

Load-bearing details:

- The **beat intent schema carries no style fields**. A model authoring a beat
  cannot restate the story's medium, lighting, palette or negatives because it has
  nowhere to put them; a result that carries them fails parsing. This is what keeps
  one story's look from being spelled four different ways across four shots.
- **Beat count is an input, never a prediction.** Beats are cut from measured audio
  at the timeline template's `maxVisualBeatSec`, so authoring is told how many
  visuals to write. It may split or merge planned-shot intent across that measured
  count, but may select only bindings frozen by approval.
- **Logical bindings survive materialization.** A planned key remains
  `planned:<key>` in direction and hashes. Generation resolves it through the
  approved revision's materialization record to a durable project entity; it does
  not rewrite the approved decision or fall back to another shot's references.
- **Continuity crosses the section boundary**: each authoring call receives the
  previous beat's `endState`, including the last beat of the preceding section.
- `StoryVisualSegment.visualPrompt` is a **rendered mirror** for the script view and
  the run record. Compilation reads `intent`. A segment with no `intent` — every
  storyboard written before this pipeline — is read through `beatIntentFromProse`
  and behaves exactly as it did before; there is no migration.
- The worker parses intent with `safeParse` and **falls back to the raw prompt
  string on failure**, silently. `packages/media/src/generation/story-intent-roundtrip.bun.test.ts`
  pins that the compiler's output survives that parse.

## Storyboard Generation Authority

`story_plan.generationState` is canonical generation authority: one mutable draft
revision plus latest immutable approved snapshot. Shared typed commands mutate
draft by stable id and expected revision through
`agent/services/storyboard-command-service.ts`; index-based chat input is only a
legacy adapter. Read-only legacy plans gain no persisted identity until mutation
or approval.

Normal generation requires approved snapshot. Standard approval defaults to
`review_additions`; explicit `approve all` selects `auto_approve_additions`.
`create_story_video` records `implicit_one_shot` with auto extension. Review-mode
duration recovery writes unapproved draft additions and stops before provider or
clip work; auto mode creates `implicit_extension` approval before generation.

Generation captures approved snapshot once. Speech, captions, measured voice
segments, visual intents, and frames record source beat, approved revision, and
input hashes. Reuse requires matching hashes; counts and URLs prove nothing.
Approved planned references materialize only in generation preflight, from frozen
definitions, with key-to-entity results stored beside the approved snapshot.
Draft edits keep old media and timeline clips intact until explicit reapproval and
generation. Scene markers group clips by semantic beat while chapters keep opaque
section ids; marker ranges remain derived from canonical clips.

## Web Surface

`apps/web/src/pages/content.tsx` owns project browsing. Video authoring opens the
fullscreen editor with four sibling views:

- **Storyboard** edits typed story-plan sections and semantic beats through
  revision-checked commands and reviews each planned shot's visual intent,
  reference labels/roles, planned-versus-existing state, and rationale.
  `/content/:id/storyboard` opens it directly. Shot direction is read-only;
  rejection and reference changes use the existing chat revision loop and return
  to the same approval gate.
- **Script** edits generated scenes. `/content/:id/script` opens it directly.
- **Timeline** edits clips and render timing.
- **Studio** edits detailed scene treatment and retains its separate PNG
  storyboard export.

Storyboard draft edits do not copy into Script or Timeline. Approval and later
generation make that boundary explicit. Authoring reads generated `plan.sections`
grouped by semantic beat id beside draft state, so stale image and voice outputs
remain visible until regenerated from latest approved revision.

## API Shape

Owned by `apps/api/src/routes/operations/`.

- `GET /api/operations/projects`
- `POST /api/operations/projects`
- `GET /api/operations/projects/:id`
- `POST /api/operations/projects/:id/storyboards`
- `GET /api/operations/projects/:id/storyboard-authoring`
- `POST /api/operations/projects/:id/storyboard-authoring/commands`
- `POST /api/operations/projects/:id/storyboard-authoring/approve`
- `GET /api/operations/content` stays as downstream artifact feed
