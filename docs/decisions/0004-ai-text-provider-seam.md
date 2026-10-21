# ADR 0004: Swappable, user-selectable text-generation providers

- Status: Accepted; the Codex CLI and Claude CLI providers described here are superseded by [0006](0006-the-agent-runs-on-mastra-with-api-models.md)
- Date: 2026-08-18
- Deciders: Kevin Julian
- Extends: ADR 0002 (content-provider abstraction) — the same seam, applied to the text domain.
- Composes with: ADR 0001 (durable workflows) — the agent loop keeps orchestration; a provider only generates.

## Context

ADR 0002 made image, tts, and research swappable and user-selectable. Text
generation was never brought along, and it is the one capability every other
one depends on: planning, intent routing, direction routing, scene extraction,
autofill, voice rewrite, and every per-step agent decision are LLM text calls.

All sixteen of those call sites go through one path:

```
runPrompt(prompt, {timeoutMs})  →  getRunner()  →  CodexCliRunner
                                                   Bun.spawn("codex exec …")
```

`getRunner()` was written as a seam and has never had a second implementation.
The only configuration is two env vars read at module load
(`AINCER_CODEX_MODEL`, `AINCER_CODEX_REASONING`). Consequences: a user cannot
choose a different AI; a cheap model cannot be used for the two 30-second
classify calls while a strong one handles the 240-second planner; and the
product cannot run at all on a machine without `codex` installed and
authenticated.

### Key discovery

Every text call is **single-shot text-in / text-out**. The tool loop, retry
policy, tracing, and reply parsing all live app-side — `agent/loop.ts`,
`tool-executor.ts`, `retry-policy.ts`. The model decides; the app executes.

So this seam needs no agent protocol, no session, no tool negotiation, no MCP.
`prompt → text + usage` covers all sixteen sites. That is what makes this a
small change rather than an agent-runtime project, and it is the single fact
most likely to be forgotten by a later reader looking at the surrounding
machinery and assuming a richer contract is required.

### Runner landscape (flags verified against locally installed CLIs, 2026-08-18)

| Runner | model                    | thinking                                             | schema-constrained output  |
| ------ | ------------------------ | ---------------------------------------------------- | -------------------------- |
| codex  | `-m <model>`             | `-c model_reasoning_effort=` minimal·low·medium·high | `--output-schema <FILE>`   |
| claude | `--model <model>`        | thinking token budget                                | `--json-schema '<schema>'` |
| pi     | `--provider` + `--model` | `--thinking` off…max (7 levels)                      | none                       |
| api    | request body             | `reasoning_effort` / `budget_tokens`                 | native                     |

`pi` (pi.dev) was evaluated and **deferred**. It is otherwise the best-behaved
CLI for this use — explicit `--no-tools`, `--no-session`, `--no-context-files`,
`--offline` flags — but it has no schema-constrained output. Excluding it means
every registered provider is structured-output-capable, which is what lets a
future typed-JSON layer skip a fallback path entirely (see Consequences).

## Decision

Extend ADR 0002's seam to a `text` capability owned by API, its sole runtime
consumer. Provider configuration field contracts remain pure and shared.

```
apps/api/src/lib/ai-provider/
  capabilities.ts   "text"
  types.ts          TextProvider · TextResult{text,usage,model,durationMs}
                    ProviderMeta{ id,label,models[],thinkingLevels[],traits,health() }
  registry.ts       id → provider
  selection.ts      resolveProvider / selectReadyProvider   (semantics copied from media)
  cli/spawn.ts      spawn · timeout · temp-file · cleanup · concurrency semaphore
  providers/
    codex/  claude/  api/  fake/

apps/api/src/lib/text-runner.ts   facade — resolve → call → recordUsage
                                       keeps runPrompt(); no call site changes

packages/shared/src/provider-config*  pure configuration resolver + field types

global_settings["ai.text.provider"] = { "default": { providerId, model, thinking } }
```

Load-bearing choices, each with the reason that is not recoverable from the code:

**The provider stays dumb.** Retries, tracing, prompt construction, and pricing
stay with the caller. `retry-policy.ts` already encodes which phases are safe to
retry — `decide` is read-only and retryable, others are not. That is knowledge
about the call site, not the runner; duplicating it per provider lets copies
drift.

**Explicit selection fails loudly.** A stale or unhealthy explicit choice
throws; only an unconfigured default falls through to the first ready provider.
Silent substitution is the worst failure mode available here — selecting Claude
with an unauthenticated CLI and generating on codex instead yields plausible
output from the wrong model with no signal at all. Same semantics as the media
seam, deliberately, so the repo has one answer to "how does a provider get
chosen".

**UI renders from provider metadata.** Each provider declares its models and
thinking levels; no list and no provider name appears as a literal in UI code.
The runners genuinely disagree — four reasoning efforts for codex, seven for pi,
per-model variation for api — so a hardcoded union is wrong for every provider
individually and rots whenever a runner adds a model.

**Thinking level is normalized** to `off | low | medium | high | max`, mapped by
each adapter to its native lever. A provider declares only levels it can honor;
requesting an undeclared level is an error, not a silent downgrade.

**One OpenAI-compatible `api` adapter** — `baseUrl` + `apiKey` + `model`, a plain
`POST /chat/completions`. That reaches OpenAI, Anthropic, Gemini, OpenRouter,
Groq, DeepSeek, xAI, Together, and local Ollama/vLLM through one file with zero
SDK dependencies, keeping the adapter small. Cost: no vendor extras
(Anthropic prompt caching, native thinking blocks). No current call site uses
them; a native adapter later is one more registry entry, which is the property
this seam exists for.

**CLI adapters run fully isolated** — tools, network, sessions, and user/project
config all disabled. This is recovered scar tissue, not precaution. Two
documented production failures: host lifecycle hooks caused codex never to exit,
so the timeout killed it (`exit 143`) with an empty result and every generation
failed; and built-in web search sent the model on 7+ autonomous searches during
a JSON-only planning call until it blew its timeout. A third hazard arrives with
new runners — `claude` and `pi` discover `CLAUDE.md` and `AGENTS.md` from the
working directory, and this repo has both, so every generation prompt would be
silently prefixed with project coding instructions. That failure does not throw
and does not log; it presents as model drift.

**Concurrency is bounded per provider.** CLI providers spawn one process per call
at 30–240s timeouts, and the agent loop issues a decision call per step.
`traits.maxConcurrency` is enforced by a semaphore in the shared spawn helper.

## Related decisions

**`workspace_settings` → `global_settings`.** The table's primary key is `key`
alone, with no workspace column — it is app-global and always has been. Adding
an app-level AI setting to a table named "workspace" would entrench the
misnaming exactly as the table gains a new class of consumer, during a pivot
where tenant/workspace terminology is already in flux. The migration must be a
guarded `ALTER TABLE`: the schema file uses `CREATE TABLE IF NOT EXISTS`, which
on an existing database would create an empty second table beside the populated
one and make every stored setting read back as missing, with no error anywhere.

**LLM pricing moves into the price table.** `generation-metering` already
requires that a price never appear as a literal at a call site, and the LLM path
was the standing exception — an inlined credit formula with
`providerCostUsd: 0`. That was _accurate_ while the only runner was a flat-rate
subscription CLI, where marginal cost genuinely was zero. With an API-key
provider it is not, so the exception would understate spend rather than round it.

## Consequences

Positive:

- One seam for text generation; swapping or adding a runner is a registry entry.
- User-selectable provider, model, and thinking level from settings, not env.
- The product runs on a machine without any particular CLI installed.
- Per-task routing (cheap model for classifiers, strong model for the planner)
  becomes additive — the persisted value is already a map keyed `default`, so no
  settings migration is needed to introduce it.
- With `pi` excluded, every registered provider is schema-capable, so a later
  typed `runJsonPrompt(schema)` needs no extraction-and-repair fallback: native
  schema flag, validate, fail loud. That also removes the ad-hoc reply scraping
  currently duplicated across call sites (`voice-rewrite.ts:130` and friends).

Costs / open work:

- **Parity is the real work, not the swap.** Prompts are tuned for `gpt-5.5` at
  `reasoning_effort=medium` and each call site parses replies its own way. Other
  models format differently. `golden-outcome`, `builders-parity`, and
  `crash-matrix` become a per-provider matrix; codex stays default until another
  provider passes. Transparency of the seam does not imply equivalence of output.
- **API key at rest.** `global_settings` is plaintext today. Must be resolved
  deliberately — reuse the secrets path behind `presentSecrets`, or record an
  explicit accepted-risk decision. Must not land by default.
- **Cost surprise.** Switching from a flat-rate CLI to a metered API turns free
  calls into billed ones. The metering change makes it visible on the same
  ledger; the settings UI must say so.
- Typed JSON at the call sites is deferred to its own change. Doing it together
  with the provider swap means a failed generation could be the provider or the
  new parser, with no way to tell which.

## Implementation history

The phased rollout notes that used to live here were moved to
[`history/0004-implementation-log.md`](./history/0004-implementation-log.md).
