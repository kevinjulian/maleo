# Media readiness at the preview boundary

Task 5.2 adds strict browser requests and state replies for readiness, per-clip
blockers, clock ownership, buffering and stalled output. The full placed-source
inventory supplies the readiness revision before mute or visibility filtering.
Input generations and source generations have separate fences. Readiness
sequences increase within a revision. Invalid or stale input cannot replace the
accepted storyboard, readiness or position. A refused replacement reports its
request generation separately from the accepted generation, allowing the client
to restore command routing without accepting older replies.

Play is refused before complete readiness. Paused seek still works. Completion
does not queue autoplay. Seek and buffering invalidate audio observations until
a fresh output generation arrives. This prevents delayed consumed samples from
moving position after recovery. The worklet's actual queue flush remains owned
by the output adapter and will be connected through the recovery/ownership tasks.

## Proof

- `CARGO_INCREMENTAL=0 cargo test -p maleo-preview`: 38 tests passed, including
  readiness, malformed atomicity, buffering, Pause and stale audio observations.
- Focused preview client, compare hook/panel and decoder router: four files,
  20 tests passed.
- `preview-media-state.spec.ts`: real worker and renderer WASM passed readiness
  rejection, paused scrubbing, no autoplay, malformed replacement, stale input
  and deterministic audio-clock observations. Two tests passed including warmup.
  Its audio observations are synthetic boundary data, not physical output proof.
- `preview-rendered-media.spec.ts`: both actual offline video/pixel and production
  compare controls passed. Together with the state probe, three browser tests and
  warmup passed across the final focused runs.
- Renderer WASM build: 15,083,338 raw bytes, 11,743,154 gzip bytes.
- `bun run typecheck` passed all twelve workspaces. `bun run check` passed
  version/reference, formatting, lint, static types and workspace typechecks.

The browser probe exposed a classic-script name collision with `window.status`.
The schema now has a specific module name. Coverage parsing retains strict
validation, and the original missing-media assertion passes unchanged.
