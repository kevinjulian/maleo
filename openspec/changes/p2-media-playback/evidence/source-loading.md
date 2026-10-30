# Complete source bytes

Tasks 2.1 and 2.2, run 2026-10-27.

The lightweight `/preview-media-worker.js` asset builds independently of renderer
WASM. `usePreviewMedia` supplies the existing `mediaFetchTarget` authorization
resolver to its main-thread client. Authored source IDs and revisions remain
separate from temporary signed fetch targets. Worker request IDs prevent a late
result from completing a replacement attempt.

The loader streams responses through session-owned sinks with four concurrent
downloads. It rejects partial responses, missing bodies, empty files and length
mismatches. It waits for EOF and checks the resulting local File size. Compressed
responses do not reuse encoded Content-Length as decoded byte progress.
Sources without trustworthy lengths report indeterminate progress.

OPFS files live under `preview-media/<session-id>/`, separately from
`pending-uploads`. A missing or unavailable OPFS API permits at most 64 MiB of
stored compressed data in the session's memory backend. Quota failures stay
failures. Pending File leases retain the original handle without copying it.
Disposal releases leases without deleting staged originals or other sessions.

```sh
bun run --cwd apps/web test src/services/preview-media
bun run --cwd apps/web playwright test --project=visual preview-source-loading.spec.ts --workers=1
bun run --cwd apps/web check:layers
```

Results: 16 portable tests passed. Two browser tests passed, including warmup.
The real Chromium worker fetched 21 bytes once, returned an independently
readable local File with matching bytes, reported progress and acknowledged
session disposal. Layer checks passed.

This proves source byte loading. The worker does not yet declare codec readiness.
Initial decode validation, production preview URL replacement, project lifecycle
integration and abandoned-session reclamation require subsequent tasks.
