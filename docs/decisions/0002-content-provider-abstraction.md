# ADR 0002: Swappable, user-selectable content-generation providers

- Status: Accepted, partly superseded 2026-09-02
- Date: 2026-07-12
- Deciders: Kevin Julian
- Extends: ADR 0001 (durable workflows) — the generation function resolves a provider through this seam.

> **Superseded 2026-09-02** (`retire-the-gemini-canvas-media-provider`). The seam,
> the registry, and capability-scoped selection below all stand. What changed is
> the provider landscape:
>
> - **`browseros` was never built as a media provider.** It exists only as the
>   research backend in `apps/api` (`web-research.ts` over `browseros-mcp.ts`),
>   which never routes through this registry. The "build a BrowserOS/MCP image
>   provider" item under _Consequences_ is **closed as won't-do**: driving a
>   browser to produce an image is automation standing in for an API that three
>   registered providers now offer, and it would re-create the fragility the CDP
>   path was retired for.
> - **`gemini-canvas` (Chrome CDP) is deleted**, as this ADR anticipated.
> - **The image default is `cloudflare-ai`; the TTS default is `supertonic`.**
>   Order in the registry is the policy, since an unconfigured default takes the
>   first ready provider.
> - **The `sandbox` mock is opt-in** (`AINCER_SANDBOX=1`) and registered last, so
>   fabricated output is unreachable unless it was asked for.
> - **`research` remains an interface with no implementation** in this package.

## Context

Content generation (image, tts, research) was wired through scattered,
env-only switches: `AINCER_TTS_DRIVER=browseros|canvas`, `resolveProvider()` in
`packages/image/.../gemini.ts` returning `canvas|api|scrape`. No unified
abstraction, and no way for a user to choose a provider — only ops via env.

We want:

1. Content generation the user can switch (per project / workspace), not just env.
2. The current provider — BrowserOS (agentic MCP driving Gemini Canvas, in
   `@aincer/media-provider-browseros`) — as the default, cleanly registered rather than special-cased.
3. Adding a provider (Chrome CDP Canvas, Fal, a real API, …) to be a registry entry, not a rewrite.

### Key discovery

BrowserOS runs the browser **externally** (`@aincer/media-provider-browseros` is only an MCP
client to `http://127.0.0.1:9000/mcp`). So a BrowserOS-based stack needs **no
Chrome-hosting worker process** of our own. `browseros` and the legacy
`gemini-canvas` (CDP) drive the _same_ Gemini Canvas — `gemini-canvas` just spawns
Chrome itself and is the fragile, redundant one.

Consequence: consolidate to BrowserOS and retire the CDP path + `packages/image`
service. One gap blocks full retirement — see below.

## Package structure (`@aincer/media`)

The whole content-generation domain lives in one package, `@aincer/media`, with
clear layers (not scattered across `@aincer/providers` + `apps/gen-worker` +
dashboard bits — that earlier split was consolidated):

```
packages/media/src/
  api/          centralized client API uses (createMediaClient) + DTOs — transport hidden
  providers/    capabilities · types · registry · selection · <provider>/ (image, tts)
  generation/   function (generation-run) · runtime (seam) · impl (resolve→run→persist) · store (bun:sqlite)
  worker.ts     buildMediaApp / startMediaWorker (serves /api/inngest + producer/poll + /files)
apps/media-worker/   thin shell: import { startMediaWorker } from "@aincer/media/worker"
packages/inngest/    shared Inngest client + event schemas
apps/api/        agent-run function beside agent orchestration
```

`research` is kept as a capability of the media domain (not yet wired behind the
interface). The dashboard talks to media only through `@aincer/media/api`.

## Decision

Capability-scoped interfaces + registry + user-selectable selection. Providers are
implementations behind the interface; call sites depend on the interface only.

```
UI picker → settings (persist selection) → resolveProvider(capability, ctx) → ContentProvider
                                                                                   ├─ cloudflare-ai (image default)
                                                                                   ├─ supertonic (tts default)
                                                                                   ├─ huggingface · codex (image)
                                                                                   └─ sandbox (mock, opt-in, last)
```

- `capabilities.ts` — `image | tts | research`.
- `types.ts` — `ImageProvider` / `TtsProvider` / `ResearchProvider` + `ProviderMeta` (id, label, capabilities, `health()`) + `ProviderCtx` (server-injected trust).
- `registry.ts` — id → provider; `providersFor(capability)`.
- `selection.ts` — `resolveProvider(capability, selection)`; precedence
  **project → workspace → env → first capable**; stale ids fall through.
- `providers/<name>/` — each wraps a leaf `@aincer/media-provider-*` package (no cycle).

Composition with ADR 0001: the Inngest `generation-run` function resolves the
selected provider through a `GenerationRuntime` seam and calls it. Provider =
_what_ generates; Inngest = _orchestration_ (retry / idempotency / concurrency).

## Provider landscape (today)

| Capability | Registered providers                               | Default         | Notes                                                                                                                             |
| ---------- | -------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| image      | `cloudflare-ai`, `huggingface`, `codex`, `sandbox` | `cloudflare-ai` | Cloudflare leads because it refuses what its model cannot honour; the HF router is permissive and is an explicit choice.          |
| tts        | `supertonic`, `sandbox`                            | `supertonic`    | Needs `AINCER_SUPERTONIC_URL`. With it unset TTS fails rather than falling through to the mock.                                   |
| research   | —                                                  | —               | Interface only. The working flow is `apps/api` `web-research.ts` over BrowserOS MCP, and it does not route through this registry. |

`sandbox` is a mock: registered last and gated on `AINCER_SANDBOX=1`, so an
unconfigured default can never resolve to fabricated output.

## Consequences

Positive:

- One seam for all generation; swap/add providers without touching call sites.
- User-selectable per project/workspace; env is just the fallback.
- Composes with durable execution (retry/idempotency/concurrency in Inngest,
  the provider only generates).
- Honest capability reporting via `health()` + `capabilities`.

Costs / open work:

- ~~Build a BrowserOS/MCP **image** provider~~ — closed as won't-do, see the
  superseding note at the top.
- Move `research` behind the interface (currently host-owned). Still open, and
  still not obviously worth doing while there is one research backend.

## Implementation history

The phased rollout notes that used to live here were moved to
[`history/0002-implementation-log.md`](./history/0002-implementation-log.md).
