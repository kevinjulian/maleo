# Task 1.5 WASM size decision

## Accepted limits

On 2026-10-27 the user instructed: "accept new limits". The enforced limits are
now 700 KiB raw (716800 bytes) and 270 KiB gzip (276480 bytes). This retains
design D1's single editor module. Runtime latency and transfer budgets remain
unchanged. The original failure below remains as measurement history.

Verification after approval:

```sh
bunx vp test run --project scripts scripts/editor-engine.test.ts scripts/media-readiness.test.ts
bun run --cwd apps/web playwright test --project=visual engine-wasm.spec.ts --grep 'normal editor startup' --workers=1
```

Task 2.5 readiness/invalidation build: 711165 raw bytes, 267758 gzip bytes. Both are within the accepted caps.

Results: five script tests passed, including size and unchanged runtime budgets.
Readiness JSON outputs match native Rust byte for byte through unknown-length
progress, incomplete-byte failure, Retry, stale attempt/revision completions,
source replacement, malformed input and removal. The initial cold compilation
exceeded the new test's default five-second timeout. Compilation now runs in a
120-second setup hook. Boundary operations retain the default test timeout.

Two browser tests passed, including warmup. The normal editor fetched
`/editor-engine.wasm`, displayed its timeline, accepted Play and Pause, and
requested no `/renderer/` resource or worker. Task 1.5 is complete.

## Original failure

Measured 2026-10-27 on macOS arm64. Tasks 1.1–1.4 are complete.
Task 1.5 remains unchecked. Its initial boundary is implemented and buildable,
but its size fails the existing editor-engine gate.

```sh
bun scripts/editor-engine.mts build
bunx vp test run --project scripts scripts/editor-engine.test.ts
```

Build passed. Budget suite: three passed, one failed.

```text
FAIL editor engine budgets > the WASM module stays within its size budget
AssertionError: expected 709094 to be less than or equal to 634880
```

| Measure            | Current module | Existing limit | Excess      |
| ------------------ | -------------- | -------------- | ----------- |
| Optimized raw WASM | 709094 bytes   | 634880 bytes   | 74214 bytes |
| Gzip, level 9      | 267126 bytes   | 245760 bytes   | 21366 bytes |

The first raw-size assertion stops the test before its gzip assertion. Gzip was
measured separately with Node `gzipSync(..., {level: 9})`.
`WebAssembly.Module.imports` returns an empty array. The media crate and editor
WASM depend on no renderer crate. This does not prove browser startup requests.

The added WASM smoke test passes. It verifies update/request/complete calls,
readiness aggregation, malformed-input preservation, disposal and unchanged
authored document state. Native media/preview boundary parity fixtures and the
normal-browser no-renderer startup check remain unfinished.

Other checks at pause:

- Shared package suite: 107 files, 1186 tests passed, including the WASM readiness smoke test.
- `bunx vp check`: formatting passed for 3196 files; no warnings, lint errors or type errors in 2349 files.
- `bun run typecheck`: all 12 workspaces passed.
- `cargo test -p maleo-media -p maleo-editor-wasm`: 25 tests passed.
- `cargo clippy -p maleo-media -p maleo-editor-wasm --all-targets -- -D warnings`: passed.
- Version and reference gates: passed.
- `openspec validate p2-media-playback --strict`: passed.

No size threshold was changed. Design D1 requires one existing editor WASM
module. Resolve this size conflict before starting group 2: optimize within
existing limits, or explicitly revise the size budget while retaining one module.
Full CI and phase acceptance have not passed. No archive, commit or deployment
was performed.

Task 2.5 rerun: during concurrent compilation the existing ripple timing gate
measured 0.14775 ms median against 0.1 ms. A subsequent isolated run passed all
five script tests. No runtime threshold changed. Invalidation boundary cases now
also compare native and WASM results, including stale reports after Retry.

Task 3.3 broker update (2026-10-28): weighted decoder grants and fair yield keep
transparent video within two physical codec slots. Current editor module measures
716620 raw bytes and 270017 gzip bytes with local Node `gzipSync` at level 9.
Both accepted limits hold; raw headroom is 180 bytes. Compression output varies
slightly across Node/zlib builds. The warm script suite passed all five tests,
including unchanged latency and transfer limits. No cap changed.
