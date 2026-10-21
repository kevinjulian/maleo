# Architecture decision records

Decisions with a blast radius wider than the diff that made them — the ones a
future contributor or agent would otherwise re-derive from scratch, or quietly
reverse because the reasoning lived only in a pull request thread.

One file per decision, numbered in the order they were accepted:

```text
docs/decisions/NNNN-kebab-case-title.md
```

Format is Context, Decision, Consequences:

- **Context** — the forces, including what was actually measured or tried.
- **Decision** — what we do, in the imperative.
- **Consequences** — what this costs, and what would justify revisiting it.

Title the record as the claim it makes, not the topic it covers.
"Generation runs through Inngest, not an in-process queue" is a decision;
"Inngest" is a filing label.

## When to write one

Write an ADR when a decision **closes off an option someone will reasonably
propose again**. The signal is that you find yourself explaining _why not_
rather than _how_.

- Yes: "Media generation goes through the provider abstraction" — proposed as a
  direct provider call more than once.
- Yes: "The web client's dependency direction is one-way" — invisible to the
  type checker, so it gets violated by accident.
- No: "Use Bun's test runner" — that is just what the repo does; `AGENTS.md`
  covers it.
- No: anything already legible from the code, a test name, or a commit message.

**The bar is high, and it is meant to be.** These are for the handful of
decisions that shape the system, not a record of work done. A merged pull
request is not an occasion for an ADR. Neither is a decision that merely took
some thought, nor one you would like on the record because it was hard-won.

If a directory of ADRs reads like a changelog, it has stopped being useful — the
signal drowns, and the few entries that genuinely close off a road get skimmed
past with the rest.

Before adding one, both of these must be true:

1. **Someone has actually argued for the other road, or demonstrably will.** A
   real pull request, a real issue, a proposal you had to talk someone out of.
   "A future contributor might wonder" is not enough — that is what a comment is
   for.
2. **The argument has nowhere better to live.** If it fits at the line that
   would change, put it there: whoever reopens the question is reading that
   code, not this directory. An ADR is for reasoning that spans files, or that
   argues against a road with no single line to attach to.

When in doubt, don't. A comment at the point of change costs nothing and is read
by exactly the person who needs it. An ADR that did not need writing dilutes the
ones that did.

## An ADR is not an implementation log

Record the decision and the forces behind it. Do not record the sequence of work
that carried it out — which phase shipped when, what was smoke-tested on which
day, which kill switch existed for one release. That belongs in the OpenSpec
change that did the work, and in `CHANGELOG.md`.

A record that has to be re-read to find the decision inside the narrative has
already failed at its job.

## Superseding

A superseded ADR is never deleted, and never edited into agreement with the
present. Mark it `Superseded by NNNN` in its status line and write the new one.

The wrong turn is the useful part: it is the evidence that the road was
considered, which is exactly what stops it being proposed a third time.

## Relationship to the other docs

Nothing here restates what lives elsewhere. The point is the reasoning, once.

| Where             | What belongs there                                |
| ----------------- | ------------------------------------------------- |
| `AGENTS.md`       | the rule — short, normative, linking here for why |
| `docs/CODEMAPS/`  | how the system is built, as it stands today       |
| `README.md`       | how an operator runs it                           |
| `openspec/`       | what is being changed, and the tasks to change it |
| `docs/decisions/` | why a road was not taken                          |

## Index

| #                                                          | Decision                                                                          | Status                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------ |
| [0001](./0001-inngest-durable-workflows.md)                | Durable generation runs on Inngest workflows                                      | Accepted; agent loop superseded by 0006    |
| [0002](./0002-content-provider-abstraction.md)             | Media generation goes through a provider abstraction                              | Accepted                                   |
| [0003](./0003-reference-entity-model.md)                   | References are entities attached to a project roster                              | Accepted                                   |
| [0004](./0004-ai-text-provider-seam.md)                    | AI text generation sits behind a swappable provider seam                          | Accepted; CLI providers superseded by 0006 |
| [0005](./0005-runtime-database-is-postgres.md)             | The runtime database is Postgres, changed only by versioned migrations            | Accepted                                   |
| [0006](./0006-the-agent-runs-on-mastra-with-api-models.md) | The chat agent runs on Mastra with API-backed models; coding CLIs are MCP clients | Accepted                                   |
