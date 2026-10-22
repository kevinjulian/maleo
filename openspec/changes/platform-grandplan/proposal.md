# Proposal

## Why

Maleo runs only as a web app against one server, and the server must be online
for every edit. Creators also want desktop and mobile apps that open fast and
keep working without a network. The current renderer blocks this goal. Remotion
draws every frame as React DOM, so each new client inherits a browser, and
export needs headless Chromium on the server.

This change records the target product shape and the phase order. Each phase
becomes its own OpenSpec change. This change adds no requirements by itself.

## What Changes

- Maleo ships three clients from one Rust core:
  - web: the React UI plus the Rust core compiled to WASM.
  - desktop: a native gpui UI that links the Rust core directly.
  - mobile: one Kotlin Multiplatform UI (Compose Multiplatform) for Android and
    iOS that calls the Rust core through its hand-written C ABI.
- The Rust engine owns editing and rendering. A wgpu compositor in Rust
  replaces Remotion for preview and export. Templates and compositions become
  data that the engine reads, not React code.
- Every client is local-first, the web client included. A client edits, plays
  back and exports with no network. A client syncs with its server when it is
  online.
- AI work always runs on the backend. Clients never hold provider keys. AI
  requests made offline wait in a queue and run on reconnect only with user
  consent.
- Each client connects to exactly one server. The default server is the paid
  hosted service. The user can enter the URL of a self-hosted server instead.
- The hosted service and a self-hosted server run the same backend code.
  Deployment configuration turns on billing, signup policy and storage quotas.
- Sync moves references, not bytes. The op log and an asset manifest always
  sync. A device uploads the originals it imports in the background. Other
  media downloads only when a client needs it, through range reads. Derived
  data (thumbnails, waveforms, frame indexes) never syncs.
- A clip whose bytes are not on the device shows a placeholder. Timeline
  editing continues.
- A client signs in through a browser approval flow on its server and stores a
  device-scoped token in the OS keyring.
- Remotion and headless Chromium leave the product after a measured parity
  window. **BREAKING** for any deployment that depends on the Remotion render
  path at that point.

Non-goals:

- Real-time collaboration, or more than one person editing one project.
- More than one server per client.
- Purchases inside the mobile apps in the first release. Purchases happen on
  the web.

## Phases

| Phase | Scope                                                                                  | Depends on |
| ----- | -------------------------------------------------------------------------------------- | ---------- |
| P0    | Architecture decisions and spikes                                                      | -          |
| P1    | Core boundaries: project format, asset manifest, client-minted IDs, op log, `app-core` | P0         |
| P2    | Rust renderer in web through WASM, dual run against Remotion, golden-frame parity      | P1         |
| P3    | Sync service: op-log rebase, media upload and download, device sign-in, capabilities   | P1         |
| P4    | Desktop client (gpui)                                                                  | P2, P3     |
| P5    | Mobile client (Kotlin Multiplatform), then media proxies                               | P3         |
| P6    | Remotion and Chromium removal                                                          | P2 window  |

P2 and P3 can run in parallel. design.md describes each phase.

## Capabilities

This change is a roadmap. It declares no spec deltas. Each phase change owns
its own specs. The phase changes are expected to introduce or modify these
capabilities:

### New Capabilities

- `project-sync`: op-log sync, rebase of pending local commands, snapshots.
- `media-sync`: asset manifest, background upload of originals, on-demand
  download, local cache and eviction rules.
- `device-sign-in`: browser approval flow, device tokens, device revocation.
- `server-capabilities`: the handshake that tells a client what its server
  supports, including billing, signup and quota.
- `engine-renderer`: the Rust compositor for preview and export.
- `desktop-client`, `mobile-client`: platform shells over the Rust core.

### Modified Capabilities

- `database-engine-parity`: scope the Postgres-everywhere rule to servers.
  Clients use SQLite.
- `cross-platform-editor`: extend "one authoritative engine" to rendering and
  to editor state (`app-core`).
- `object-storage-backend`: add a content hash to the media registry and
  accept client-minted asset IDs.
- `media-url-resolution`: replace pending import references with
  client-minted asset IDs.
- `executable-template-definitions`: templates become engine data.

## Impact

- New Rust crates beside `crates/editor-core`: renderer, media, sync, store,
  app-core.
- New apps: `apps/desktop` (gpui) and a Kotlin Multiplatform mobile app.
- `apps/web`: preview and export move from `@remotion/player` and the render
  worker to the Rust renderer. Project state moves to a local store (OPFS).
- `apps/api`: new sync, device sign-in and capability routes. Billing and
  quota behind configuration.
- `packages/storage`: content hash, multipart upload through presigned parts.
- `packages/video`, `apps/render-worker`: replaced by the Rust renderer and a
  headless core at P6.
- New dependencies: wgpu, gpui, a text shaping stack, SQLite, and FFmpeg
  (LGPL, dynamic link) on desktop.
- Removed dependencies at P6: Remotion and headless Chromium.
- New ADRs: client store engine, sync model, renderer ownership.
