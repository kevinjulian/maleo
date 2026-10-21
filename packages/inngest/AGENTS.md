# @maleo/inngest — agent instructions

## Purpose

`@maleo/inngest` owns shared durable execution infrastructure: Inngest client
and event schemas.

## Ownership

- `src/client.ts` owns the shared Inngest client.
- `src/events.ts` owns event schemas and event type exports.

## Local Contracts

- Keep this package app-independent. Domain functions live with API or media.
- Event payload schemas must stay compatible with dashboard producers and media
  worker producers.
- `generation/requested` carries both `providerId` and `providerSource`; preserve
  the producer's project/workspace/env provenance through durable retries.
- Agent runs are the Mastra agent's own durable functions
  (`apps/api/src/modules/agents/core/runtime/durable.ts`); this package carries
  no agent events. A run is stopped on its product record, not by an event.

## Work Guidance

- Add event schemas before producers/functions emit them.
- Keep function ids stable unless intentionally migrating durable state.

## Verification

```bash
cd packages/inngest
bun run typecheck
bun run test    # Vitest project `inngest`; add a file path to run one file
```
