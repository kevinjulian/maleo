# Proposal

## Why

`platform-grandplan` sets the target: one Rust core for web, desktop (gpui) and
mobile (Kotlin Multiplatform), with rendering moved from Remotion into the
engine. Three of its decisions rest on things nobody has proved yet:

- that a wgpu frame plays inside a gpui window,
- that Kotlin Multiplatform can call the Rust core on iOS as well as Android,
- that Rust can draw maleo's captions close to what Remotion draws.

If one of these fails, phases P1 to P5 change. P0 proves or disproves them
before any phase builds on them, and records the decisions that the evidence
supports.

## What Changes

- Run three spikes. Each spike has pass criteria fixed in advance and records
  its measurements:
  - **gpui + wgpu**: draw a wgpu-rendered video frame inside a gpui window at
    the project frame rate, with the editor's panes around it.
  - **Kotlin Multiplatform bindings**: call `maleo-editor-core` from one shared
    Kotlin module on an Android emulator and an iOS simulator. Try the existing
    raw JSON ABI first. Try generated bindings only if the raw ABI fails.
  - **Rust captions**: draw the caption styles that maleo uses today in Rust,
    and compare frames against Remotion stills of the same fixtures.
- Write four architecture decision records, each from the evidence:
  - clients keep a local SQLite store. Postgres stays the server engine
    (scopes ADR 0005).
  - sync is a server-sequenced op log with rebase, not CRDTs or database
    replication.
  - the Rust engine owns rendering. Remotion retires after a parity window.
  - the core reaches each platform through one boundary (WASM, native link,
    Kotlin Multiplatform), with the binding chosen by the spike.
- Scope the `database-engine-parity` spec to servers. Name the client store
  rule in its place.
- Record a go, adjust or stop verdict for each grand-plan decision that a
  spike tested, and update `platform-grandplan/design.md` when a verdict
  changes it.

Non-goals:

- No production code path changes. Web, API and workers behave as before.
- No sync service, renderer, desktop app or mobile app. P1 to P5 build them.
- Spike code is proof, not product. It is not built by CI and it is not a
  workspace member.

## Capabilities

### New Capabilities

None. The spikes and ADRs add no product behavior.

### Modified Capabilities

- `database-engine-parity`: the Postgres-in-every-environment rule applies to
  server environments. Client devices may keep a local SQLite store. The
  dialect rule holds between development and production servers.

## Impact

- New `spikes/` directory with three standalone Cargo or Gradle projects,
  outside the Cargo workspace and outside CI.
- New ADRs `docs/decisions/0007` to `0010`. The ADR index and the status line
  of ADR 0005 change.
- `openspec/changes/platform-grandplan/design.md` changes only if a spike
  verdict changes a decision.
- `AGENTS.md` workspace map gains one row for `spikes/`.
- Local tool prerequisites for the spikes: Rust targets for iOS and Android
  (installed), Xcode (installed), a JDK, Gradle and the Android SDK
  (not installed yet).
- No change to runtime dependencies, deploy, database schema or HTTP API.
