# ADR 0002: Swappable, user-selectable content-generation providers — implementation log

Moved out of [`../0002-content-provider-abstraction.md`](../0002-content-provider-abstraction.md) so the decision record states the
decision and its consequences, not the sequence of work that carried it out.
Kept verbatim for history. Nothing here is current guidance.

## Retiring packages/image

The BrowserOS image flow now exists, so `packages/image` is no longer load-bearing:
the durable path runs generation through `apps/media-worker` (hosts the Inngest
`generation-run` function + BrowserOS providers), a **drop-in** for the image
service's `/generate` · `/tts` · `/jobs/:id` · `/files/` contract. The dashboard
switches to it via `AINCER_DURABLE_GEN=1` + `AINCER_GEN_WORKER_URL`.

`packages/image` (SQLite queue, poll worker, HTTP service, CDP `gemini-canvas`,
`processing/`) is kept **only as the default fallback** until the first-cut
BrowserOS image flow is verified against live BrowserOS. Once durable gen is
proven, delete `packages/image` — no code depends on it (its lib impls were not
carried over; `apps/media-worker` uses `@aincer/media/providers`).

## Status

Implemented: `@aincer/providers` (interfaces, registry, selection, browseros tts),
`generation-run` Inngest function + `GenerationRuntime` seam. Typechecked; 4
selection tests pass. Producer swap + provider migration + `packages/image`
deletion are staged follow-ups.
