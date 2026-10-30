# Portable dependency and readiness contracts

Tasks 1.3 and 1.4, run 2026-10-27.

`previewMediaDependencies` inventories placed sources before track filtering.
It includes imported originals, valid reverse/audio derivatives, scene end
frames, promoted visuals and reference-image resolution. Unplaced library assets
and thumbnails are excluded. Media-free clips have empty dependencies.

```sh
bun run --cwd packages/shared test
bun run typecheck
cargo test -p maleo-media
```

Results: 106 shared test files, 1185 tests passed. All 12 workspace typechecks
passed. Seven Rust readiness tests passed. Focused lint passed for the fixture
generator, dependency projection/tests and browser baseline diagnostics.

Rust tests exercise shared-source aggregation, generation/revision rejection,
source add/replace/remove, unchanged projections, Retry attempt rejection,
successful siblings, stale-derivative blockers, malformed input, unknown byte
length and rejection of partial/unreadable/undecoded sources.

This is contract proof. Production source loading and playback remain unchanged.
WASM, browser byte storage and adapter integration need their later tasks.
