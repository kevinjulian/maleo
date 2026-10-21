# Agent Pipeline

How the create-content agent builds and edits: one predictable, gated pipeline
for every content type, where the first approval can auto-chain the rest of a
build, and edits/deletes always re-confirm. Where it runs is at the end.

## Principles

1. **One flow for every video format.** Long-form and short-form share the
   same stages. Their differences are _parameters_, not code
   paths. No `runLoop` vs `runLoopGeneric`, no `>= 180s` branch, no
   longform-specific routes.
2. **Every stage is `produce -> gate -> commit`.** `produce` computes a
   reviewable draft cheaply (no paid side effects). `commit` applies it and runs
   the expensive generation. The gate sits between.
3. **Approval is structural, not keyword-matched.** Whether a stage gates is a
   function of run mode and operation type — never a regex over the prompt.
4. **Approve once, then auto-chain.** The first approval can flip the run to
   `auto`, so downstream additive stages commit without asking.
5. **Edit/delete of existing work always re-gates**, regardless of mode.
6. **Tools stay atomic; the pipeline orchestrates them.** The pipeline is a
   separate, testable state machine layered above the tool registry.

## Format profile (unifies long and short video)

The only thing that differs across formats is configuration. Image and text
projects are retired and have no pipeline; the type still names them because
their saved projects load:

```ts
interface FormatProfile {
	contentType: "video" | "image" | "text";
	targetSec?: number; // video length; scales beat/section count
	granularity: "beat" | "section" | "slide" | "post";
	narrationFirst: boolean; // long-form video = true
	researchFirst: boolean; // factual long-form = true
	stages: StageId[]; // which stages apply
}
```

A 15s reel and a 10-minute narration run the **same** pipeline with different
profiles. The profile decides stage set + sizing, not control flow.

## The pipeline stages

```
prompt
  |-> [1] plan      -> Blueprint (beats/sections, emotion, intent, motion decisions)
      [2] scaffold  -> materialize blueprint into Units (structure, no assets)
      [3] visuals   -> frames / images per unit
      [4] motion    -> animate + infographics
      [5] audio     -> voiceover + music / sfx
      [6] finalize  -> captions, transitions, render-ready
```

- Video (short/long): all six.

Same `StageId`s; the profile's `stages[]` selects the subset.

## Stage contract

```ts
type Operation = "create" | "update" | "delete";

interface Draft {
	operation: Operation;
	targetsExisting: boolean; // touches user-visible, already-committed work
	summary: string; // shown in the approval card
	payload: unknown; // stage-specific proposed change
}

interface Stage {
	id: StageId;
	costsAssets: boolean; // commit spends money/time (visuals, motion, audio)
	produce(ctx: PipelineCtx): Promise<Draft>; // cheap, reviewable, no paid side effects
	commit(ctx: PipelineCtx, draft: Draft): Promise<void>; // apply + expensive generation
}
```

`produce` never spends; `commit` is the only place cost happens. This makes the
gate meaningful: the user reviews `Draft.summary` before any spend.

## Run state machine

```ts
interface PipelineRun {
	profile: FormatProfile;
	cursor: StageId;
	mode: "manual" | "auto"; // auto = chain without asking
	status: "running" | "awaiting_approval" | "done" | "error";
}
```

```
for stage in pipeline.from(run.cursor):
    draft = await stage.produce(ctx)
    if needsGate(stage, draft, run):
        suspend -> emit approval card (Approve | Approve all | Reject)
        return                       // run parks in awaiting_approval
    await stage.commit(ctx, draft)
    run.cursor = next(stage)
run.status = "done"
```

On resume with the user's choice:

```
Approve      -> commit(currentDraft); continue loop
Approve all  -> run.mode = "auto"; commit(currentDraft); continue loop
Reject       -> stay parked; user revises via the edit loop
```

Parking/resume reuses the existing suspend/resume machinery (Design B): the run
persists its `cursor` + draft and continues from there when answered.

## Gate policy (the whole point)

```ts
function needsGate(stage: Stage, draft: Draft, run: PipelineRun): boolean {
	// Destructive or edit-of-existing always re-confirms, whatever the mode.
	if (draft.operation !== "create" && draft.targetsExisting) return true;
	// After the first approval, chain additive stages silently.
	if (run.mode === "auto") return false;
	// First time / manual: gate stages that actually spend.
	return stage.costsAssets;
}
```

This single function encodes both requirements:

- **"1x approve then auto":** the first gate offers `Approve all`, which sets
  `mode = "auto"`; every later additive `commit` skips the gate.
- **"unless update/delete existing":** `operation != "create" && targetsExisting`
  forces a gate even in `auto` mode.

Free stages (`costsAssets === false`, e.g. scaffold/finalize for text) never gate
in the first place unless they edit existing work.

## Unit lifecycle (one status machine for all)

Scene, section, slide, and post are the same abstraction — a **Unit** with one
lifecycle:

```
draft -> proposed -> approved -> generating -> ready
                        ^ gate                  ^ commit complete
```

- `scaffold.commit` creates units in `proposed`/`approved`.
- `visuals.commit` moves a unit `approved -> generating -> ready`.
- An `update`/`delete` on a `ready` unit drops it back to `proposed`, which
  re-enters the gate for free — this is why edits re-confirm without bespoke
  logic. Same machine, one place.

## Two layers: pipeline vs tools vs edit loop

```
PIPELINE   (deterministic state machine)   builds/extends: plan..finalize, gates + auto
    | calls
TOOLS      (registry, atomic ops)          produce_blueprint, scaffold, generate_frame, add_infographic, ...
    ^
EDIT LOOP  (ReAct tool loop)               targeted edits: "regenerate scene 3", "delete section 2"
```

- **Building/extending** = the pipeline drives. Predictable order, structural
  gates. No model free-for-all deciding whether to plan or build.
- **Editing** = the tool loop. A mutate flips a unit to `proposed` (operation
  `update`/`delete`, `targetsExisting = true`) which re-gates per policy; the
  downstream re-commit (e.g. re-generate that scene's image) runs in `auto`.
- Tools remain small and registry-based (`kind`, `input`, `handler`). The
  pipeline is orchestration above them, not another set of tools.

## Approval UX

The composer/approval lock gains a third action:

- `Approve` — commit this stage only (stay `manual`).
- `Approve all` — commit + flip run to `auto` (chain the rest).
- `Reject` — park; the user types a revision, which enters the edit loop.

## Example flows

Build (first time):

```
user prompt
 -> plan.produce -> Blueprint            [gate] "Approve to build?"  -> Approve all (mode=auto)
 -> scaffold.commit  (units created)     auto
 -> visuals.commit   (images)            auto
 -> motion.commit    (animate + charts)  auto
 -> audio.commit     (voiceover + music) auto
 -> finalize.commit                      done
```

Edit later:

```
"regenerate scene 3"
 -> edit loop: scene3 -> proposed        [gate] (update of existing -> always)  -> Approve
 -> visuals.commit(scene3)               auto (downstream)
```

Longform is identical — only the profile changes (`granularity: "section"`,
`narrationFirst: true`, larger `targetSec`); the stages, gates, and policy are
the same.

## Where it runs

The internal agent (`src/modules/agents/core/runtime/`, ADR
[0006](../../../docs/decisions/0006-the-agent-runs-on-mastra-with-api-models.md))
chooses tools; it never orders stages. Video planning is the `plan_story`
workflow definition run by the engine inside the agent's `workflow-plan_story`
tool call; `create_story_video` is a definition that calls `plan_story`, then
approves implicitly and generates. Story asset generation is still a Mastra
workflow (`runtime/workflows/story-assets.ts`), which runs its stage through the
same runner as a step (`stage-step.ts`); a gate is a step that suspends, and the
answer resumes it. Edits and deletes of existing work gate as tool preconditions
(`runtime/tools/preconditions.ts`) before the tool runs. "Approve all" sets
`run.approveAll`, which the gates, the planning definition's `run.approveAll`
fact and the scaffold's `autoApprove` read. Runs execute on Inngest; a run's
product record is its `AgentJob`.

## Prompt templates

Every prompt planning reaches is a plain-data template under
`src/lib/prompts/templates/`, rendered by the one compiler in `@maleo/shared`
(`prompt-template.ts`) through the registry in `src/lib/prompts/registry.ts`.
The registry validates every template at module load, so a bad reference fails
boot rather than the request that happens to reach it.

A template is a list of nodes rendered in order and concatenated:

| Node                                               | Renders                                                   |
| -------------------------------------------------- | --------------------------------------------------------- |
| `"text"` or `{ type: "text" }`                     | fixed text                                                |
| `{ type: "slot", path, filters }`                  | an input value, inserted literally                        |
| `{ type: "when", if, then, else }`                 | one branch, by a workflow expression over the input       |
| `{ type: "each", path, as, template, sep, empty }` | the template per list item (`$index`, `$number` in scope) |
| `{ type: "include", prompt, in }`                  | another template, with mapped input                       |
| `{ type: "const", name, filters }`                 | a code-owned constant (`lib/prompts/constants.ts`)        |
| `{ type: "format", name, in }`                     | a registered formatter (`lib/prompts/formatters.ts`)      |

Filters: `trim`, `collapseWs`, `round`, `{ min }`, `{ join }`, `{ default }`,
`{ truncate }`. A `const:NAME` path reads a constant where a path is expected
(`each` over a code-owned list). "The present parts joined by a separator" is
authored with `joinPresent`, which emits guarded `when` nodes, so the stored
template stays inside the vocabulary.

Slot values are never re-read as template syntax: a brief or source excerpt that
contains `{{…}}`, quotes or backticks arrives as text. Values validation also
reads (plan kinds, emotions, clarification limits) are constants, never copied
into a template, so the prompt and the parser cannot disagree.

A template sent as a model request carries `response: { parser, schema, policy }`
naming entries in `lib/prompts/responses.ts`; a composition fragment carries
none. Parsing, retries and fallbacks stay in their owners and are only named.
`renderPrompt(id, input)` returns `{ id, text, response }`; `runPrompt` takes it
whole and refuses a fragment sent on its own.

The catalog projects each template directly (`lib/prompts/catalog.ts`): its text
with every slot, constant, formatter, include and condition named in place, its
inputs and its response contract. Parity with the builders the templates replaced
is pinned byte for byte by `planning-prompt-parity.bun.test.ts`; parser behavior by
`parser-acceptance.bun.test.ts`.

## Workflow engine

A workflow can be plain data run by one engine instead of a Mastra workflow. The
definition format, its expression language and its validator are pure and live in
`@maleo/shared` (`workflow-definition.ts`, `workflow-expression.ts`); the engine,
its registries and the agent tool that hosts it live in
`src/modules/agents/core/engine/` and `runtime/tools/workflow-tools.ts`.

Nodes: `step` (an operation, with `in` bindings, an `out` state path, its
declared `prompts` and `tools`, and optional `onError: "continue"`), `sequence`,
`branch` (`if` expression, `then`, `else`), `suspend` (`ask` and `onAnswer`
operations, optional `skipIf`), `call` (another workflow, with `in`, `out` and an
optional stage `contract`) and `end` (a stated `outcome`, or one read `from` a
state path; `unchanged` when it produced nothing). `forEach` is reserved and
rejected. Paths are `input.*`, `state.*` and `fact:<id>`; conditions use `eq`,
`in`, `exists`, `empty`, `and`, `or`, `not`, or name a registered `rule` or
`fact`. A condition never reads the run record directly.

Operations are registered code (`defineOperation`) with input and output schemas
and the prompts, tools and capabilities (`llm:text`, `media:generate`) they may
use. A step must list exactly its operation's prompts and tools; the registry
(`createEngineRegistry`) rejects any unknown reference, duplicate id, call cycle
or `forEach` at load. `get(id)` returns the definition and its content revision.

The flow record (`engine/flow-record.ts`) lives at `job.run.flows[<toolCallId>]`:
the workflow id, the revision and definition snapshot it started on, its input,
status, cursor, flow state, completed node ids, branch decisions, nested call
records and a per-node trace (run, workflow, node, revision, times, outcome,
branch, prompts, tools, pending action, error). The engine saves it with the run
after every node; a resume executes the snapshot and skips completed nodes. Each
operation runs in `withGenerationScope("<executionId>:<toolCallId>:<nodePath>")`,
so a node re-entered after a crash reuses its generation keys and text usage is
recorded once per key.

Suspension is the agent tool's own: the `ask` operation records one pending
action, the engine saves its cursor, and the tool calls `context.agent.suspend`.
The resumed call re-enters with `resumeData.answer`, which the suspend node's
`onAnswer` receives. Cancellation is checked before every node.

Enforcement: every operation runs inside the async-local scope in
`lib/capability-scope.ts`. `runPrompt` refuses an undeclared template id (or
untemplated text), the research provider refuses an operation that did not
declare `research_topic`, and `meter` refuses media generation without
`media:generate` — each before any provider call or charge. Code outside an
engine operation is unaffected.

A `call` with `contract: "plan"` runs as the plan stage (`engine/contracts.ts`):
writes are scoped to the contract and stamped with its producer and context,
settled complete when the workflow completes, and the contract's required outputs
are checked unless the workflow ended through an `unchanged` end.
