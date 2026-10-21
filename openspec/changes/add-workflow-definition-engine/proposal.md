# Proposal

## Why

The AI Explorer must show exactly what the code runs, but today video planning is
six runtime layers deep (Mastra workflow, executable closure tree, stage step,
one-stage pipeline, registry tool, a second closure tree) and the catalog
reconstructs it by static analysis of TypeScript (`planning-source.generated.ts`,
6k lines). Resume state lives in four places. Making workflows and prompts plain
data, run by one small engine and rendered by one compiler, makes the explorer
true by construction and is the base live editing (step 5) needs.

This is step 2 of the AI workflow plan: the engine, the definition and prompt
formats, and `plan_story` ported first. Step 3 ports `generate_story_assets`.

## What Changes

- A workflow engine that runs JSON definitions built from a closed node
  vocabulary: `step`, `sequence`, `branch`, `suspend`, `call`, `end`, with
  `onError: "continue"` on steps. `forEach` is reserved in the schema and
  rejected by the validator until step 3 implements it.
- Conditions as data expressions (`eq`, `in`, `exists`, `empty`, `and`, `or`,
  `not`) over flow state, workflow input and declared facts, with registered
  named rules as the escape hatch. Expressions never read the raw run record.
- Operations are registered code with input/output schemas and declared
  capabilities, prompts and tools. A call to an undeclared prompt, tool or
  capability throws at the provider chokepoint.
- Definitions load through one registry interface (code defaults now). Every
  run records the definition snapshot and revision it started on.
- Per-node durability: each completed node checkpoints flow state and cursor
  together with the run record. Suspend and resume is a saved cursor; completed
  nodes never re-run. Generation keys are scoped per node, so a retry is
  charged once.
- Per-node run traces keyed by node id.
- Prompts as data: every prompt `plan_story` reaches becomes a template
  (fixed text, slots with filters, conditional parts, repeats, includes,
  code-owned constants, registered formatters) rendered by one compiler.
  Rendered requests stay byte-identical. Each model-request template references
  the parser and schema that validate its response.
- `plan_story` and `plan_story_core` ported to definitions. `plan_story` keeps
  its agent tool name `workflow-plan_story`.
- **BREAKING:** `create_story_video` runs the full `plan_story` (approved-plan
  replacement guard, direction routing, pre- and post-research questions unless
  the request bypasses them), then implicit approval and generation. Today it
  skips all four.
- **BREAKING:** runs suspended under the Mastra `plan_story` workflow or with the
  old planning checkpoint are not supported after deploy; no compatibility code.
  The pre-Mastra legacy-run answer path (`LEGACY_RUN_MESSAGE`) is deleted too.
- Removed for planning: the Mastra `plan_story` workflow, `planning-*.ts`
  closure trees, `planningFlow`, `PlanCheckpoint`, `pendingTool.phase`, planning
  `stepOutcomes`, the runtime-only `plan_story` registry tool, the one-stage
  `storyPlan` pipeline wrapping, the planning entries of
  `planning-source.generated.ts`, and the source-extracted prompt fragments of
  converted prompts.
- The catalog projects `plan_story` directly from its definition and its prompts
  from their templates. Explorer UI changes wait for step 4.
- Supersedes the unimplemented change `expose-model-response-contracts`; its
  response-contract facts become a field of prompt templates and its drawer work
  moves to step 4.

## Capabilities

### New Capabilities

- `workflow-definitions`: Workflows as validated data run by one engine: node vocabulary, expressions, registered operations with declared capabilities, registry and revision pinning, per-node durability, suspension, idempotent generation and traces.
- `prompt-templates`: Prompts as data templates rendered by one compiler, byte-identical to the builders they replace, with code-owned constants and response-contract references.

### Modified Capabilities

- `internal-agent-runtime`: Video planning runs as a workflow definition on the engine inside an agent tool call; story asset generation stays a Mastra workflow until step 3. Nested suspension resumes at the saved node.
- `executable-template-definitions`: The closure-tree pilot is replaced. Structure and prompts are the definitions; the suspension/replay compatibility rule is removed.
- `agent-template-catalog`: Planning workflow structure and planning prompts are projected from definitions and templates instead of derived from source.
- `generation-prompt-composition`: One-shot story generation plans through the full interactive `plan_story` before implicit approval.

## Impact

- API: `modules/agents/core` runtime, workflows, planning services, stage-step,
  pipeline definitions, template catalog, prompt builders in `lib/content-generator.ts`,
  `lib/story/creative-director.ts`, clarification and evidence planners, material
  layers, writer style; `lib/text-runner.ts` and the research provider as
  enforcement chokepoints; `scripts/generate-planning-source.ts`.
- Shared: pure definition schema, expression evaluator, validator and template
  compiler in `@maleo/shared` (the web explorer consumes them in step 4).
- Tests: planning baseline fixtures re-captured; prompt parity samples extended;
  new engine, compiler and differential suites.
- No database migration (flow state lives in the existing run record), no new
  dependency, no web UI change, no provider or billing behavior change.
- Docs: `apps/api/docs/agent-pipeline.md`, `apps/api/src/AGENTS.md`, CODEMAPS,
  `CHANGELOG.md` Unreleased.
