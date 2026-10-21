# ADR 0004: Swappable, user-selectable text-generation providers — implementation log

Moved out of [`../0004-ai-text-provider-seam.md`](../0004-ai-text-provider-seam.md) so the decision record states the
decision and its consequences, not the sequence of work that carried it out.
Kept verbatim for history. Nothing here is current guidance.

## What implementation changed

Four things were wrong or unresolved in the proposal above. They are corrected
here rather than edited into the text, because the corrections are the useful
part — each one was found by running something rather than by reading.

**`--bare` is mandatory for the claude adapter, and it costs OAuth.** The
proposal assumed an empty working directory would be enough to keep host
instruction files out of the prompt. Measured against the installed CLI:

| Configuration                                 | Sentinel reached the model?                          |
| --------------------------------------------- | ---------------------------------------------------- |
| `claude -p`, contaminated cwd                 | yes                                                  |
| `claude -p`, empty cwd                        | project files no, user `~/.claude/CLAUDE.md` **yes** |
| `claude --bare -p`, empty cwd                 | no                                                   |
| `codex exec --ephemeral --ignore-user-config` | no, in either cwd                                    |

`--bare` is the only flag that removes user-level memory, and under it the CLI
authenticates strictly through `ANTHROPIC_API_KEY` — OAuth and keychain are
never read. So a machine with an interactively logged-in `claude` and no API key
reports `unconfigured`. That is the correct trade: unavailable is visible,
whereas generating with the project's coding instructions silently prepended is
not.

**Asking a model about its own instructions is not a valid probe.** The first
reading of this table said codex leaked `AGENTS.md`, from a "do your
instructions contain X?" question. A control run with a token that had never
been written anywhere returned `YES` as well. Only the obedience form of the
sentinel — "end every response with X", then check the reply — discriminates.
The codex reading was withdrawn; the claude one stands because there the
identical question answered `YES` from a contaminated directory and `NO` from an
empty one.

**codex cannot offer `off`.** It would map to `model_reasoning_effort=minimal`,
and codex rejects that outright while the web_search tool is declared:
`"The following tools cannot be used with reasoning.effort 'minimal':
web_search"` — even though we set `tools.web_search=false`. That flag is not
negotiable, so `minimal` gives way. codex declares `low·medium·high` only. Found
by the parity matrix on its first real run, not by inspection.

**The parity matrix could not be built where the plan put it.** The plan named
`golden-outcome`, `builders-parity` and `crash-matrix`. None of the three
reaches a provider — the first calls `evaluateOutcome` directly, the second
reads the tool registry, the third drives the loop through
`setAgentDeciderForTests`. A provider dimension on those suites would pass
identically for every provider including a broken one, which is worse than no
matrix because it reads as evidence. The matrix lives in
`agent/provider-parity.test.ts` instead and runs the real generation path once
per provider, skipping providers that are not ready.

**API key at rest, resolved.** A new app-global `<data>/secrets.yaml`
(`chmod 0600`, under the already-gitignored `data/`), loaded into the
environment at boot. `global_settings` holds only the key's _name_. The
per-workspace `secrets.yaml` was left alone — it is live, and every key in it
(`THREADS_ACCESS_TOKEN`, `IG_ACCESS_TOKEN`, `TELEGRAM_BOT_TOKEN`,
`SHOPEE_AFFILIATE_TOKEN`) is genuinely a different account per workspace across
seven workspaces on disk. Plaintext in `global_settings` was rejected: SQLite
has no permission story and the key would land in every backup and dump.

**Model catalogs are static.** Runtime discovery needs a static fallback list
anyway for the CLI-absent case, so it does not remove the static list — it adds
a cache and a failure mode on top of it, and makes the settings page depend on
CLI health. The requirement that matters ("adding a model requires no UI change")
is satisfied by metadata: a new model is an adapter edit, never a React edit.

**The decider test seam stays.** `setAgentDeciderForTests` stubs `AgentDecision`
objects — a strictly higher layer than `prompt → text` — across 51 usages in 9
test files. Replacing it with the `fake` provider would mean re-authoring every
stub as text in the exact shape its extractor expects, and a failure would then
be ambiguous between a wrong stub and a parser bug. That is the same hazard this
ADR cites when deferring typed JSON, and it gets the same answer: not both at
once.
