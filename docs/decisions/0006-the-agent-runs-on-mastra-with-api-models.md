# ADR 0006: The chat agent runs on Mastra with API-backed models only; coding CLIs are MCP clients

- Status: Accepted
- Date: 2026-10-03
- Deciders: Kevin Julian
- Related: OpenSpec `adopt-mastra-internal-agent`; supersedes the agent loop of
  [0001](0001-inngest-durable-workflows.md) and the CLI providers of
  [0004](0004-ai-text-provider-seam.md)

## Context

The chat agent was our own loop: a model call per step that returned one JSON
decision, a parser, an intent classifier that chose build or edit before the
model saw the request, a pipeline cursor persisted on the run, and a granular
Inngest driver that replayed the loop step by step. The default model was the
Codex CLI, run as a subprocess.

A CLI cannot be an agent model here. Task 1.2 of the change tried both bridges
(`ai-sdk-provider-codex-cli`, `ai-sdk-provider-claude-code`): each runs the
CLI's own tool loop and ignores tools the caller defines, reaching ours only
through an MCP server the CLI itself calls. A step limit, a tool approval or a
durable suspension never sees those calls, and a suspending tool cannot hold a
CLI process across a restart.

Using a CLI in development and an API model in production was proposed during
the change, to keep development free. It was rejected: two runtimes would differ
in exactly the behaviour worth testing — tool choice, approvals, suspension —
so development would stop predicting production.

## Decision

- Run the chat agent as one Mastra agent (`apps/api/src/modules/agents/core/runtime/`)
  on the selected API text provider, in every environment. Development chooses a
  cheaper model or a local OpenAI-compatible server (Ollama, vLLM); tests use a
  scripted model through the same runtime.
- Let the model choose tools; do not classify intent or parse decisions. Builds,
  planning and generation are Mastra workflows the agent calls as tools; their
  pipeline stages run as workflow steps through the existing stage runner, and a
  gate is a step suspension.
- Execute runs on Inngest through `@mastra/inngest`, with Mastra's suspended
  state in the `mastra` schema of the runtime database. The `AgentJob` stays the
  product record: chat, required actions, progress and results are read from it,
  never from Mastra.
- Remove CLI text providers. Codex CLI and Claude Code reach the product as MCP
  clients of `POST /api/mcp`, driving the same agent through `run_agent`.

## Consequences

- One runtime to test and operate. Behaviour that matters — which tool, when to
  ask, what is approved — is the model's and the tools', and is the same in
  development, CI and production.
- Every deployment needs an API text provider, and pays per token. Without one,
  the product starts and reports text as unconfigured.
- Tool choice depends on the model. A small local model (`llama3.2` in the
  cutover check) may answer in prose instead of building; nothing reroutes it.
  The agent's instructions carry the routing guidance (`runtime/instructions.ts`).
- The replacement did not shrink orchestration code below the recorded baseline
  (2311 lines like for like against 2163; task 3.2 has the measurement). The gain
  is the loop, parser, classifier and cursor resumption no longer being ours.
- Revisit if a CLI exposes caller-defined tools to its model directly, or if
  Mastra's durable agent stops being maintained.
