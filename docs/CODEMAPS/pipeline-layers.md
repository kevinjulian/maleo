<!-- Generated: 2026-09-16 -->

# Pipeline Layers

How the pipeline relates to Project Materials, visual style, and the timeline
template. Each layer owns a different question, and they meet only at stage
boundaries.

## Ownership

| Layer              | Owns                                                      | Does not own                            |
| ------------------ | --------------------------------------------------------- | --------------------------------------- |
| Pipeline           | stage order, approval gates, what each stage reads        | brand, appearance, pacing values        |
| Project Materials  | story, visual, voice, rules                               | execution order                         |
| Creative Direction | the wire shape carrying materials into stages             | a second operator-facing configuration  |
| Visual style       | consistent appearance, references, style bible            | pipeline selection                      |
| Timeline template  | timing, pacing, transitions, titles, music, render policy | story or brand guidance                 |
| Project preset     | which materials to seed, and one selected template, by id | the pipeline; the template's own fields |

## Materials do not select a pipeline

The read-only definition projection lives in
`apps/api/src/modules/agents/core/template-catalog.ts`. It reads the Mastra
workflow graph of story asset generation from `runtime/workflows/index.ts`, the
workflow definitions of `plan_story`, `plan_story_core` and `create_story_video`
(projected by `engine/catalog.ts`: nodes, branch expressions, operations as opaque
code with their schemas, prompts, tools and capabilities), the prompt templates
(`apps/api/src/lib/prompts/catalog.ts`), stage contracts and the tool registry.
Shared validation and revision types live in
`packages/shared/src/agent-template-catalog.ts`. Workflow entry points, stage
profiles, internal operations, and agent-available helpers are distinct; catalog
inspection neither creates a run nor changes its routing.

The workflow engine (`apps/api/src/modules/agents/core/engine/`) runs workflow
definitions — plain data validated by `packages/shared/src/workflow-definition.ts` —
inside an agent tool call (`runtime/tools/workflow-tools.ts`). Its flow record,
with definition snapshot, revision, cursor, state and per-node trace, is saved on
`job.run.flows[<toolCallId>]` after every node. Declared prompts, tools and
capabilities are enforced through `apps/api/src/lib/capability-scope.ts` at the
text runner, the research provider and `meter`.

A Visual material reading "cinematic" changes how output looks. It does not change
which stages run. Style changes appearance; the pipeline changes how output is
produced.

Pipeline selection is the agent's choice of workflow, offered by the project's
content type (`agentWorkflowsFor` and `definitionToolsFor` in
`apps/api/src/modules/agents/core/runtime/agent.ts`): a video gets
`workflow-plan_story`, `create_story_video` and `generate_story_assets`; image and
text projects are retired and get none. Planning runs as definitions on the
engine; generation runs its stages as Mastra workflow steps (`runtime/workflows/`). No material body is read at a selection point. The three
declared pipelines are in `apps/api/src/modules/agents/core/pipeline-definitions.ts`:

```text
storyPlan      plan → scaffold          (parks at the gate)
storyGenerate  scaffold                 (resumes after approval)
edit           apply → finalize
```

A project preset is the pair "named materials + one `videoTemplateId`"
(`packages/shared/src/content-preset.ts:83-90`). It selects the template by
identity and does not copy its fields, so a preset cannot become a second,
invisible editor of render policy.

A **pipeline** is that named stage order, declared once. A **profile**
(`FormatProfile`) is one run's instance of it — the order plus target duration,
unit granularity and whether narration leads — and it is what the run persists.

## Materials reach stages through one conversion

Materials are the authoring model; creative direction is the wire model.
`directionFromMaterials` (`packages/shared/src/project-materials.ts:349`) is the
single conversion, and stages compose their prompts from the routed channels.

The materials record itself is still read in one place:
`resolveSceneRefImages` passes it to reference resolution
(`apps/api/src/modules/agents/core/visual-gen.ts:442`) to decide which reference entities
a scene may use. That is a lookup of what exists, not guidance to compose, which is
why it does not go through the channels.

The style bible is not a channel of its own. It is a derived Visual material, folded
into the visual channel by that conversion
(`packages/shared/src/project-materials.ts:355`) and documented as such in
`apps/api/src/modules/agents/core/material-layers.ts`. No stage can receive it separately.

Layer order inside a prompt is fixed once, in
`apps/api/src/modules/agents/core/material-layers.ts`, because a given input set has to
produce a stable prompt. `rules` layers **last** in every stage
(`material-layers.ts:13`): a constraint appearing before the guidance it constrains
reads as something to balance against, and after it as something that overrides.

## What each stage declares it reads

Every registered stage declares its context
(`apps/api/src/modules/agents/core/pipeline-stages.ts`), drawn from a closed key set
(`pipeline-context.ts`). Declared context is written into the run transcript as each
stage runs.

The declaration documents access; it does not restrict it. A stage still receives
the whole `AgentJob` and could read anything on it, so a declaration that drifts
from the implementation is caught by review or test, not by the runtime.

| Stage              | Reads                                                                          |
| ------------------ | ------------------------------------------------------------------------------ |
| `plan` (video)     | brief, story, voice, rules, style lock                                         |
| `scaffold` (video) | approved plan, visual, voice, references, rules, style lock, timeline template |
| `apply` (edit)     | generated assets                                                               |
| `finalize`         | nothing                                                                        |

## What each stage requires and produces

Besides context, every stage declares the artifact kinds it requires and produces
(`apps/api/src/modules/agents/core/stage-contracts.ts`). The declaration is mandatory —
the registry refuses a stage without one — and each pipeline is checked when
`pipeline-definitions.ts` loads: every required kind must come from an earlier stage
or the pipeline's initial inputs, at the schema version the kind is at now.

| Stage              | Requires                         | Produces (optional in parentheses)                                                              |
| ------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `plan` (video)     | —                                | story plan, storyboard table, (research bundle)                                                 |
| `scaffold` (video) | story plan @1, (research bundle) | approved plan, generation batch, story plan, (storyboard table, timeline document, style bible) |
| `apply` (edit)     | (story plan, research bundle)    | (story plan, storyboard table)                                                                  |
| `finalize`         | —                                | —                                                                                               |

`storyGenerate` starts from the plan an earlier run saved, so it declares `story_plan`
as an initial input.

While a stage commits, the run is scoped to its contract: the runner resolves the
artifacts it requires and hands them to it, and reading or writing any other kind
throws (`artifact-store.ts`). Legacy image and text projects keep their slides and
posts as the storyboard document's own `slides` and `posts` fields; no run writes
them.

One consequence a reader would not guess: **the visual style is locked during
planning, not generation.** When no reference image is chosen, the plan stage
generates and saves the style bible
(`apps/api/src/modules/agents/core/services/planning.ts:281-291`).

## Visual style precedence

Resolved in `apps/api/src/modules/agents/core/style-engine.ts:14-17`, in order:

1. a selected global reference image
2. a bible already locked on this job
3. a bible an operator edited and persisted for the project
4. a bible persisted by an earlier job
5. otherwise generate one, traced, plus a style board

An operator-edited bible wins over generating a new one, because regenerating over
it would discard writing someone did deliberately.

## Capture boundaries

Every external input a run depends on is captured at a defined boundary and held
stable for the work that reads it. The boundaries differ on purpose.

| Input                                       | Captured                                             | Where                                                |
| ------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| Materials → direction                       | when the run starts                                  | `project-materials.ts:349`                           |
| Visual style, direction, locked constraints | when asset generation begins                         | `services/story-assets.ts:75-84`                     |
| Timeline template                           | at the generation boundary, then frozen for the pass | `services/story-assets.ts:153-160`                   |
| Approved plan revision                      | at approval; generation refuses to run without one   | `services/story-assets.ts:551-552`                   |
| Chat context envelope                       | when a chat command starts                           | `apps/web/src/models/chat/build-chat-envelope.ts`    |
| Entity fingerprints                         | with the envelope, from the live editing surface     | `apps/web/src/models/timeline/agent-result-scope.ts` |

A project's template selection can change while a run waits for approval. The asset
pass uses the one captured when it began, not the one selected now.

## The chat context envelope

One typed envelope per chat command, built from live editor state and frozen on
the run. It carries the whole project in outline plus full detail only for what
the command is about, so prompt size tracks the task rather than the project.

| Concern          | Rule                                                                                                                    | Where                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Freshness        | built from the live editing surface, never the persisted copy — both autosaves debounce 1200ms                          | `build-chat-envelope.ts`                  |
| Focus precedence | mention > selection > playhead > named entity > whole project                                                           | `packages/shared/src/chat-focus.ts`       |
| Ambiguity        | a phrase matching two entities is reported, never guessed                                                               | `chat-focus.ts`                           |
| Prompt inputs    | brief, aspect, references, direction, materials and project settings travel inside the envelope, validated as one shape | `chat-context-envelope.ts`                |
| Document payload | scenes, clips, slides, posts stay in the request — the run edits them, it is not governed by them                       | `apps/web/src/api/chat.ts`                |
| Trust            | the server owns project identity and resolves references from ids; no client-supplied URL becomes a fetch target        | `modules/agents/core/context-compiler.ts` |

### Conversation memory

Decisions are recorded when the user answers, not inferred afterwards: the chat
message type carries no decision semantics, so recovering one from prose would be
inference dressed as a pure function. They persist beside the transcript in
`editor_state_json` — no memory table — and a decision write flushes immediately
rather than waiting out the debounce a reload would cancel.

| Concern       | Rule                                                     | Where                                             |
| ------------- | -------------------------------------------------------- | ------------------------------------------------- |
| Recording     | at the moment of answering                               | `apps/web/src/models/chat/decision-record.ts`     |
| Durability    | immediate flush, not the 1200ms autosave                 | `use-content-persistence.ts` (`flushEditorState`) |
| Normalization | decisions pass through; turns bounded; activity excluded | `packages/shared/src/conversation-memory.ts`      |
| Validation    | entry-by-entry, so one bad record cannot strip the focus | `modules/agents/core/context-compiler.ts`         |
| Precedence    | current project state always outranks memory             | `withoutConflictingDecisions`                     |

### Result fencing

A run takes minutes and the user keeps working, so a settled result is fenced
against what the run actually read before any of it is written.

| Step          | Rule                                                                           | Where                           |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------- |
| Touched scope | observed — result differs from what was captured — never declared by the model | `agent-result-scope.ts`         |
| Fencing       | compare only touched entities; an unrelated edit is not a conflict             | `fenceTouchedResult`            |
| Application   | start from current state, take only touched ids from the result                | `applyTouchedResult`            |
| Undo          | one settled run is one command-ledger step over the touched scope              | `use-agent-apply.ts` (`settle`) |

Identity is stable, never positional. Slides and posts carry a persisted `key`;
clips carry `source:refId`. Settled **video** results are the exception — they
apply through `mergeAgentScenes`, which still pairs scenes by array position, so
they are neither fenced nor undoable. That is corrected by the
`fence-video-agent-results` change, not here.

The compatibility point: the loose prompt-input fields were removed from the chat
request once the envelope carried them. The document payload was deliberately left
in place.

## Provenance is per asset

Generated segments carry two fields: the plan revision they were produced from, and
a content hash of their own inputs
(`apps/api/src/modules/agents/core/services/story-assets.ts:609`).

The hashes are computed per asset — narration text, visual prompt, planned shots,
reference ids, style, visual direction, rules, editorial direction
(`packages/shared/src/asset-staleness.ts:76-98`) — and the visual hash chains off
the speech hash, so a change to narration invalidates the visual that followed it.
Reuse is decided per beat (`services/story-assets.ts:655`).

The granularity matters: one section's visual can be stale while a sibling's stays
reusable. A single record covering a whole stage's output could not express that.
