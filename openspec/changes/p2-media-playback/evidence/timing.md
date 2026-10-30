# Task 3.1 source timing

Moved existing Rust source-interval arithmetic into `maleo-media::timing`.
Editor-core retains its public API and error type through forwarding functions;
its source-window projection also uses the same portable scene-duration rule.
Reverse-source mapping validates managed derivative metadata, source identity,
revision and selected interval. Invalid derivatives never return forward originals.

`crates/media/tests/fixtures/timing.json` contains 115 cases consumed by native
Rust and TypeScript reference tests. Cases cover 0.25x/0.5x/1x/2x/4x rates,
nonzero source starts, clamped elapsed time, reverse direction, trim/split ranges,
retiming, scene holds and invalid/missing/stale reverse derivatives. The native
fixture assertion permits absolute timing error at most 1e-12. Audio PCM retains
its separate planned tolerance.

The existing SourceVideo exclusive-endpoint hold expression is now a shared
pure helper, consumed by the production component and the reference fixtures.
It retains one source frame within the selected endpoint at slow rates.

Verification so far:

- `cargo test -p maleo-media -p maleo-editor-core`: 65 tests passed, including
  current editor golden/corpus edits, source bounds, exact serialization,
  TypeScript timing reference and media fixtures.
- `cargo clippy -p maleo-media -p maleo-editor-core -p maleo-editor-wasm --all-targets -- -D warnings`: passed.
- Focused shared tests: two files, 124 tests passed (115 new timing fixtures).
- `bun run typecheck`: all 12 workspaces passed.
- WASM rebuild: 710925 raw bytes / 268012 gzip bytes; within accepted caps.
- Full video package suite: 20 files, 118 tests passed, including production
  rendered video hold/rate/reverse and sound cases. Runtime: 279.33 seconds.

The editor-core dependency guard initially rejected the new media dependency.
After reviewing media source and its serde-only production dependencies, the guard
now explicitly checks that manifest and scans both crates for forbidden host APIs.
No host-IO exclusion was removed.

A source-client regression also exposed duplicate authorization if track kinds
changed before the first target resolved. The client now retains that pending
authorization promise. Its focused test first failed with two authorization calls
and then verifies a single target/request for the replacement requirements.
