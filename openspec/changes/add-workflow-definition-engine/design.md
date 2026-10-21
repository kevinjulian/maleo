# Design

## Context

See proposal.md for motivation. The current planning call chain:

```
Mastra Agent on Inngest (tool loop; agent snapshot in the mastra schema)
 +- tool "workflow-plan_story" = Mastra workflow: guard, direction, clarify, plan
     each step -> executable closure tree (executable-definition.ts)
     plan -> runStage (stepOutcomes, generation scope "<runId>:plan")
          -> runPipeline (one-stage storyPlan profile) -> storyPlanStage.commit
          -> emitToolCall(registry plan_story) -> planStoryFlow -> planningFlow tree
```

Resume state lives in the Mastra workflow snapshot, `run.stepOutcomes`,
`run.pendingTool.{phase,checkpointId}` and `run.planCheckpoint`. Operations share a
mutable `PrepareContext` of about 25 fields. `create_story_video` calls
`planStoryFlow` directly and skips the guard, direction routing and both question
checkpoints; its non-interactivity rests on the hidden test
`pendingTool.tool === "plan_story"` (`services/planning.ts:212`).

Prompts are built by TypeScript functions over fragments that a script extracts
from source (`*-prompt-definitions.ts`); `planning-prompt-parity.json` holds 11
byte-exact samples. Billed text calls go through `lib/text-runner.ts`, which meters
with a key from `generation-scope.ts`.

## Goals / Non-Goals

**Goals:** one engine and one compiler, both small; planning behavior unchanged
apart from `create_story_video` (see the `generation-prompt-composition` delta);
each verification failure points at one layer.

**Non-Goals:** porting `generate_story_assets` (step 3), `forEach` and loop bounds
(step 3), explorer UI and run-trace overlay (step 4), database-stored or editable
definitions, publish and rollback, guardrails a live edit cannot remove (step 5),
moving the agent loop off Mastra, vendor JSON or structured-output modes,
converting image, beat, character, reference or agent-instruction prompts.

## Decisions

### 1. The engine runs inside an agent tool call; Mastra and Inngest stay

`workflow-plan_story` becomes a plain Mastra tool (`createTool`, same name, so the
agent instructions prompt is unchanged) whose `execute` runs the engine. Suspension
uses `context.agent.suspend({question, actionId})` and resume reads
`context.agent.resumeData`, the same path the existing approval preconditions use
in `registry-tools.ts`. The Mastra agent snapshot then only records that the tool
call is suspended; the engine's own cursor says where.

Rejected: hosting the engine on Inngest directly (`step.run` per node,
`waitForEvent` for suspension). It would also require moving the agent loop off
Mastra, which is out of scope, and would put durable state in a third store.

### 2. Durable state is one flow record on the run

`job.run.flows[<toolCallId>]` holds `{ workflow, revision, definition, cursor,
state, status, trace[] }`. The engine mutates nothing in place: each node yields a
new state object. After every node the engine calls the existing run save, so
the node's effects on the run record and the cursor land in one write. This
replaces `stepOutcomes` (planning), `pendingTool.phase/checkpointId` and
`PlanCheckpoint`. Called workflows nest under the caller's record by node id.

The key is the agent's `toolCallId`, which is stable across Inngest retries and
already keys generations for registry tools.

Effects outside the run record are not atomic with the checkpoint: the
storyboard version written by `persistPlan`, required-action rows, trace events
and ledger entries. Each is already idempotent or keyed (required action per
pending id, ledger per generation key, storyboard version per plan revision), so
re-running an interrupted node is safe. The persist-plan operation keeps its
explicit storyboard write.

Rejected: a new table. The flow record is read and written with the run in every
case, and step 5 stores definitions, not flow state, in the database.

### 3. Pinning by snapshot

The run stores the definition JSON it started with plus its revision
(`agentTemplateRevision` of the content). Resume executes the stored snapshot, so
pinning needs no history in the registry. The registry interface is
`get(id) -> { definition, revision }`; step 5 adds a database-backed
implementation behind it. Operations remain code: an operation whose schema no
longer accepts a pinned definition's binding fails validation at that node.

Rejected: storing only the revision id. With code defaults there is nowhere to
load an older revision from.

### 4. Definition format

Pure types, the validator and the expression evaluator live in `@maleo/shared`
(the web explorer consumes them in step 4); the engine, registry and operation
registry live in `apps/api` (IO). Definitions are JSON objects exported from TS
modules (`as const satisfies WorkflowDefinition`) so they are type-checked and
still plain data.

```
step     { id, op, in?: {name: path}, out?: path, prompts?: [id], tools?: [id], onError?: "continue" }
sequence { id, steps: [node] }
branch   { id, if: expr, then: node, else?: node }
suspend  { id, kind: "approval" | "questions", ask: op, onAnswer: op, out?: path, skipIf?: expr }
call     { id, workflow, in: {name: path | literal} }
end      { id, outcome: {ok, note: literal | "$path"} | outcomeOp: op }
expr     { eq: [a, b] } | { in: [a, [values]] } | { exists: path } | { empty: path }
         | { and: [expr] } | { or: [expr] } | { not: expr } | { rule: id } | { fact: id }
paths    input.*, state.*, fact:<id>
```

`step.prompts` and `step.tools` must equal the operation's declared lists; the
validator checks this, so the definition shows what the operation may use.
`forEach` is in the type union and rejected by the validator.

### 5. Facts and rules instead of raw run reads

Conditions that today read `AgentJob` become registered read-only projections:
facts (`run.approveAll`, `job.styleImageUrl`, `clarification.bypass`) and rules
(`plan.approvedExists`, `direction.needsRouting`, `clarification.eligible`,
`plan.hasGeneratedWork`). Five current conditions (answered, stage-answer,
stage-suspended, resume-completion, park) disappear because they are resume
plumbing the cursor replaces. The rest are expressions over state.

Rejected: expressions over the raw run record. A live edit in step 5 could then
read any field, and every record shape change would silently change conditions.

### 6. Declared-capability enforcement through async-local scope

The engine runs each operation inside an `AsyncLocalStorage` scope holding its
declared prompts, tools and capabilities, mirroring `generation-scope.ts`. The
chokepoints check the scope: `text-runner` (prompt id and `llm:text`), the research
provider (`research_topic`), and the media transport (`media:generate`). An
undeclared use throws before the request or charge. Calls made outside any engine
scope (step 3 code paths) are unaffected.

Prompts carry their template id when rendered, so `text-runner` knows which
prompt it is sending. This avoids threading a `ctx.prompt` argument through
`content-generator.ts`.

Limitation: only executed paths are checked. The planning baseline and parity
suites drive the repair and fallback paths so those are exercised.

Capabilities split `llm:text` from `media:generate` now, so step 5's credit
approval guardrail can target media generation without blocking planning, which
spends text credits.

### 7. Generation keys per node

The engine opens `withGenerationScope("<executionId>:<toolCallId>:<nodePath>")`
around each operation. A retried node reuses its keys, so the meter and image
ledger find the earlier attempt. No legacy runs are supported, so the key prefix
change needs no migration.

### 8. Stage contracts wrap a call node

`withStageScope` (artifact write scope, producer provenance, context
fingerprint) and `settleJobArtifacts` are real behavior. A `call` node may declare
`contract: "plan"`; the engine wraps the called workflow in that stage scope,
settles its writes on completion and checks the contract's required outputs,
except when the workflow ended through an `end` node that declares it produced
nothing (preserve-generated). `runPipeline`, `runStage` and the one-stage
`storyPlan` wrapping go for planning. `pipeline.ts` itself stays for
`storyGenerate` and edits until step 3.

### 9. The planning definitions

`plan_story`: `guard.duration` -> branch `rule plan.approvedExists` -> suspend
approval (skip if `fact run.approveAll`) -> branch reject -> `end` kept ->
branch `rule direction.needsRouting` -> `direction.route` -> `clarify.bypass` ->
branch bypassed (record) else branch `rule clarification.eligible` (generate ->
branch has questions: suspend questions, else record unavailable) ->
`plan.bind` -> call `plan_story_core` (contract `plan`).

`plan_story_core`: `setup` -> branch `rule plan.hasGeneratedWork` -> `end`
(note) -> `brief` -> `frame` -> branch (grounding needed and no matching research)
-> `research` -> branch (research held and `fact clarification.bypass` not in
skip_request/one_shot) -> `evidence.decide` -> branch fallback note / branch batch
-> suspend questions -> `draft` -> `materialize` -> branch `empty fact
job.styleImageUrl` -> `style.load`, `style.generate` (onError continue),
`style.save` -> `bible` (onError continue) -> `persist` -> `end`.

`create_story_video`: call `plan_story` -> `approveImplicit` -> `generate`
(wraps the existing `generateStoryAssetsFlow` until step 3).

Flow state keeps only what must survive a wait: shape, brief, frame,
research key, evidence decision, plan, sections, style, bible, note. Operations
re-read live inputs (locked constraints, direction roster, writer style) and
re-resolve research by key at draft time, exactly as `bindPlanningCompletion`
does today, so a wait does not freeze them.

The `interactive` mode is not needed: `create_story_video` runs the full
`plan_story`, and the bypass rules decide whether to ask.

### 10. Prompt templates

Template nodes: `text`, `slot { path, filters }`, `when { if, then, else }`,
`each { path, as, template, sep, empty }`, `include { prompt, in }`,
`const { name }`, `format { name, in }`. Filters: `trim`, `collapseWs`, `round`,
`min(n)`, `join(sep)`, `default(v)`, `truncate(n)` (the builders cap excerpts by
length). The vocabulary has no join node: "the present parts joined by a
separator" is authored with `joinPresent`, a TS helper that emits plain `when`
nodes guarding each separator, so the stored template stays inside the
vocabulary. Slot values are inserted literally; template
syntax inside input text is never interpreted. Constants that validation also
reads (`VIDEO_PLAN_KINDS`, `EMOTIONS`, `MAX_STORY_SHOTS_PER_SECTION`,
clarification limits) are referenced by name. A model-request template carries
`response: { parser, schema, policy }` naming registered code; composition
fragments carry none. The compiler and validator are pure (`@maleo/shared`).

In scope: `directionRouterPrompt`, `storyClarificationPrompt` (+ `resolvedBlock`),
`storyFramePrompt`, `evidenceDecisionPrompt`, `storyDraftPrompt`,
`storySequenceDirectionPrompt` (+ repair), `generateStyleBible`,
`authorStoryBible`, `lockedConstraintBlock`, story and voice material layers,
writer-style fragments, chat context. Shared prompts used by generation keep
identical bytes, so generation is unaffected.

From the superseded `expose-model-response-contracts`: response parsing,
acceptance, retries and fallbacks stay in their current owners and are only
referenced; transport stays plain text and the unused `jsonMode` trait is not
treated as enforcement.

Rejected: keeping TypeScript recipe functions with ids. Step 5 needs prompts
editable without a deploy.

### 11. Catalog projection

`template-catalog.ts` projects `plan_story`, `plan_story_core` and
`create_story_video`'s planning call from the definitions (a direct tree walk),
and converted prompts from templates. Source-derived entries for planning are
deleted from `planning-source.generated.ts` and its generator scope. Catalog
schema stays 2; definition kinds and ids stay stable where the concept survives.
Any web change waits for step 4.

## Risks / Trade-offs

- [Hidden ordering coupling in the context bag, e.g. the guard writes
  `job.targetDurationSec` and `setup` reads it] -> explicit state paths, plus a
  differential test comparing the old and new paths on the same fixtures before
  the old path is deleted.
- [Prompt conversion changes bytes] -> parity captured from the unchanged builders
  first, compiler done before the engine, byte-exact comparison.
- [Runtime enforcement only covers executed paths] -> baseline suites drive
  repair, fallback, outage and bypass paths; the validator checks declared lists
  match the definition.
- [Non-atomic external effects] -> each is keyed or idempotent (decision 2);
  tested by killing a run between effect and checkpoint.
- [Mastra-suspended runs at deploy fail] -> accepted (no legacy support).
- [`create_story_video` now asks questions] -> intended; covered by new scenarios.
- [Possible latent defect: preserve-generated through the stage runner may fail
  with `missing_output`] -> first task proves or disproves it; decision 8 makes the
  intended behavior explicit.

## Migration Plan

1. Freeze baselines: extended prompt parity, parser acceptance, planning baseline
   behavior, current event sequences.
2. Land the compiler and convert prompts while the old runtime still runs.
3. Land the engine and port the definitions; run the differential test; switch
   `workflow-plan_story` and `create_story_video`; delete the old planning path.
4. Deploy API alone (no web change). Runs suspended inside the old workflow end
   or time out. Rollback is reverting the change as a unit; no data repair.
