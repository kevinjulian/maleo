# Design

## Context

See proposal.md - Why. The current state that shapes this design:

- `crates/editor-core` is the one editing engine. The web and the API run it
  through a WASM binding. Its commands are deterministic and have inverses.
- Rendering is not in the engine. `packages/video` holds Remotion
  compositions as React components. `apps/web` previews them with
  `@remotion/player`. `apps/render-worker` exports them with headless Chromium.
- `apps/web` already decodes media with mediabunny (WebCodecs).
- The server stores state in Postgres. The `database-engine-parity` spec
  requires Postgres in every environment.
- Media reads already go through a stable API URL. The API authorizes the
  caller and redirects to a short-lived signed storage URL. The route answers
  `Range` requests with `206`. Server garbage collection uses a reachability
  check and a grace period.
- Object keys are unique per write and scoped by workspace. They are not
  content-addressed.

Three external products informed this design:

- ZapFast (Rust, egui): the local archive is the first read, the network
  fills it. The UI and the runtime talk only through typed commands and
  events. Local changes wait in a queue and replay on top of the server state.
- OpenCut: Rust crates compile to WASM for the web and link natively on
  desktop through one export macro. One wgpu compositor draws preview and
  export. Export runs on WebCodecs in the browser.
- CapCut: one C++ engine for mobile, desktop and web (Emscripten plus
  WebCodecs). Templates are engine data, so they moved to the web unchanged.
  Desktop projects are local folders. AI features are online-only additions.

## Goals / Non-Goals

**Goals:**

- One Rust core holds editing rules, rendering, media access, sync, the local
  store and editor state. Platform UIs draw and forward input only.
- Preview and export come from one renderer on every platform.
- A client opens a project from local data with no network wait.
- Each media byte crosses the network the fewest times possible.
- The hosted service and self-hosted servers differ only in configuration.

**Non-Goals:**

- CRDTs or concurrent multi-user editing.
- Peer-to-peer transfer between a user's devices.
- A transcode farm on the server.
- A design for the payment provider. The P3 or a later change owns it.

## Target architecture

```text
+--------------------------------------------------------------------+
|                     maleo-core (Rust workspace)                    |
|                                                                    |
|  editor-core   renderer      media         sync        store       |
|  commands,     wgpu scene,   decode,       op log,     SQLite,     |
|  document,     text,         encode,       rebase,     blob cache  |
|  time          captions      hashing       transfers               |
|                                                                    |
|  app-core: view-models, selection, undo, playback clock            |
+----------+------------------------+-------------------------+------+
           | WASM                   | native crate            | C ABI
           v                        v                         v
    +-------------+          +-------------+           +---------------+
    | web         |          | desktop     |           | mobile (KMP)  |
    | React UI    |          | gpui UI     |           | Compose UI    |
    | WebCodecs   |          | FFmpeg      |           | MediaCodec /  |
    | OPFS        |          | files       |           | AVFoundation  |
    +------+------+          +------+------+           +-------+-------+
           |                        |                          |
           +------------------------+--------------------------+
                                    | HTTPS: sign-in, sync, AI, media
                                    v
+--------------------------------------------------------------------+
|  server (same code for hosted and self-hosted)                     |
|  api: auth, sync, agent, generation, metering, capabilities        |
|  Postgres: canonical op log, snapshots, registry                   |
|  object storage: media     Inngest     media-worker                |
|  render-worker: headless maleo-core (after P6)                     |
+--------------------------------------------------------------------+
```

## Decisions

### D1. Rendering moves into the Rust engine

The engine gets a wgpu compositor. Preview and export both use it. Templates
and compositions become data that the engine reads.

- Why: a renderer in React DOM forces a browser into every client and into
  the server. Two renderers (one for preview, one for export) drift apart.
  CapCut and OpenCut both use one engine for both jobs.
- Rejected: keep Remotion and wrap it in Tauri. That ships a desktop app
  sooner, but Chromium stays, and gpui or Kotlin clients cannot draw Remotion
  compositions.
- Rejected: a native renderer for desktop only, with Remotion for web. Two
  renderers drift.

Text and caption shaping move into Rust (a shaping stack such as parley or
cosmic-text with swash). Captions are the hardest visual feature, so a P0
spike proves them first.

### D2. A shared `app-core` holds editor state

View-models, selection, undo, snapping, the playback clock and inspector
logic live in Rust. Each UI renders that state and sends input events back.

- Why: three native UIs would otherwise implement the same behavior three
  times, and the copies drift. This extends the `cross-platform-editor` rule
  that no platform implements its own editing rules.
- Rejected: business logic per UI. That triples the cost of each feature.

### D3. Desktop UI is gpui

- Why: retained-mode, GPU-first, strong text rendering. Zed and the OpenCut
  rewrite use it. It supports macOS (Metal), Windows (DirectWrite) and Linux
  (Vulkan).
- Rejected: egui. It is mature and ZapFast proves it, but its immediate-mode
  model and text layout fit a dense editor less well.
- Rejected: Tauri or Electron. Both keep a webview, which D1 removes.
- Risk: gpui does not render through wgpu. The P0 spike must show a wgpu frame
  inside a gpui window at playback rate.

### D4. Mobile is Kotlin Multiplatform with Compose Multiplatform

One UI codebase serves Android and iOS. The Rust core reaches Kotlin through
the hand-written C ABI of D5: `cinterop` on iOS, a thin JNI shim on Android,
behind one `expect`/`actual` engine (ADR 0010).

- Why: one mobile UI instead of two.
- P0 spike B (adjust): the raw C ABI passed every criterion on an Android
  emulator and an iOS simulator, so no binding generator is used. Rejected:
  UniFFI and its community Kotlin Multiplatform generator.

### D5. The core reaches each platform through one calling convention

Each core crate exposes its public API once, through the calling convention
of `crates/editor-wasm`: UTF-8 JSON in `(ptr, len)` buffers, results in an
output buffer, documents behind handles. A WASM build exports it as WASM
imports. A native build exports it as a C ABI, which Kotlin reaches through
`cinterop` and JNI. Desktop Rust links the crate directly. No `wasm-bindgen`
or generated bindings (ADR 0010).

One exception: the renderer's browser module (`crates/renderer-wasm`) uses
`wasm-bindgen`, because wgpu reaches WebGPU only through `web-sys`. Its
exported calls still take and return JSON strings and byte buffers, and export
no Rust types (ADR 0011).

### D6. Clients store data in SQLite, the server stays on Postgres

Desktop and mobile use SQLite plus a blob directory. The web uses SQLite on
OPFS (or an equivalent OPFS store) and requests persistent storage. The local
database is encrypted, and its key lives in the OS keyring.

- Why: an embedded Postgres in every client is heavy and does not run on iOS
  or in a browser. The server keeps the canonical log, so dialect drift stays
  on the client side of the sync boundary.
- This conflicts with `database-engine-parity`. An ADR scopes that spec to
  servers.

### D7. Sync is a server-sequenced op log with rebase

```text
device                               server
------                               ------
apply command locally
append to pending queue      --->    validate in editor-core
                                     assign sequence number N
                             <---    ack(N) + ops the device lacks
rebase pending queue on top
```

- The unit of sync is an `editor-core` command. Commands are deterministic and
  carry inverses.
- The server validates every command with the same engine before it accepts
  it.
- Snapshots plus log compaction let a new device start from a recent state.
- AI agent edits enter the same log, so they reach devices like any edit.
- Conflicts are rare because one person owns a project. A command that no
  longer applies after rebase is dropped and reported to the user.
- Rejected: CRDTs. They solve concurrent multi-user editing, which is a
  non-goal, and they add a second document model beside `editor-core`.
- Rejected: database replication. It syncs storage rows, not intent, and it
  couples the client schema to the server schema.

### D8. Media sync moves references, not bytes

The op log and an asset manifest always sync. A manifest row holds the asset
ID, content hash, size, kind, duration, origin and per-device state. Bytes
move only when a client needs them.

| Media class                   | Origin   | Upload                 | Download                               |
| ----------------------------- | -------- | ---------------------- | -------------------------------------- |
| AI output (image, TTS, video) | server   | already on server      | on demand. Small assets prefetch.      |
| Stock and music library       | server   | already on server      | on demand                              |
| Imported footage              | a device | background, at import  | on demand on other devices             |
| Derived data                  | computed | never                  | never. Each client derives it locally. |
| Exports                       | a device | never (optional share) | never                                  |

Imported originals upload eagerly. There is no peer-to-peer link, so a lazy
upload leaves the only copy on a closed laptop. Other devices, server AI and
server export then fail. The upload runs in the background and never blocks
editing. A per-asset "keep local only" flag lets the user opt out. Other
devices show that asset as unavailable.

Downloads:

```text
client --GET stable media URL--> api (authorize) --302--> signed storage URL
client --Range GET-------------> object storage (bytes never pass the api)
```

- Opening a project reads the manifest locally. The timeline draws at once
  with placeholders.
- Playback range-reads the region near the playhead into a chunk cache.
- A background task prefetches small assets, then video near the playhead.
- "Make available offline" downloads every asset of a project and pins it.

Per-device asset state:

```text
  import
    |
    v
[local-only] --upload--> [synced, local] --evict--> [remote]
                               ^                        |
                               +-------download---------+
                                                        |
                                    range read --> [partial cache]
```

Rules:

- A client never evicts a `local-only` asset. It can be the only copy.
- A client checks every download against the manifest hash.
- A client mints the asset ID (UUIDv7) at import. The document uses it
  offline at once, and no ID remap happens after upload. This replaces the
  pending import reference.
- A client computes a BLAKE3 hash at import. An upload first asks the server
  for that hash. If the server has it, no bytes move.
- Large uploads use S3 multipart through presigned parts. The API never
  proxies upload bytes.
- Server garbage collection counts asset IDs referenced by any synced
  document or pending client state as reachable.
- Export runs a preflight. It downloads missing assets or offers a server
  export.

Proxies are deferred to P5. Range reads of originals serve web and desktop.
When mobile needs proxies, the importing device generates them, because it
holds the original. The server stays free of a transcode farm.

### D9. A missing asset is a placeholder, not a block

When a clip's bytes are not on the device (for example, still uploading from
another device), the clip shows "uploading from <device>" or "not
downloaded". Timeline edits work, because they need the document, not the
bytes. Preview draws a placeholder for that clip.

### D10. Offline AI requests wait for consent

AI needs the server. An AI request made offline enters a queue with its
estimated cost. On reconnect, the client asks the user before it sends the
queue, because each request spends credits. The timeline shows a placeholder
for the pending result. `generated-asset-staleness` tracks it after it lands.

### D11. One backend build, configured for hosted or self-hosted

The hosted paid service and a self-hosted server run the same code.
Configuration sets:

- billing on or off,
- signup policy (open, invite, closed),
- storage quota per plan,
- rate limits and abuse controls.

A capability handshake tells each client the server version, the minimum
client version, enabled features (AI providers, render, music library),
billing mode and quota. The client hides what the server lacks.

On the hosted service, user footage costs storage and download traffic. D8
keeps that cost low. The server rejects an upload that exceeds quota before
any bytes move. An object store with no egress fee (for example R2) is a
configuration choice, not a code change.

Purchases happen on the web only in the first release. The mobile apps show
no prices and no buy buttons, to stay inside app store payment rules. A
legal check confirms the current rules before launch.

### D12. Device sign-in uses a browser approval flow

The client opens `<server>/device`. The user signs in on the web and approves
the device. The client receives a device-scoped token and stores it in the OS
keyring. Mobile can scan a QR code shown by the desktop or web app as a
shortcut to the same approval. The web lists devices, and the user can revoke
each one. The flow is the same for hosted and self-hosted servers.

Self-hosted servers need valid HTTPS. iOS App Transport Security and the
desktop client refuse plain HTTP to a remote host. The self-hosting docs must
state this.

### D13. Media decode and encode sit behind one trait

| Platform | Backend                                  |
| -------- | ---------------------------------------- |
| web      | WebCodecs (mediabunny today)             |
| desktop  | FFmpeg, LGPL, dynamic link, pinned build |
| Android  | MediaCodec                               |
| iOS      | AVFoundation / VideoToolbox              |

The renderer and export see one interface. Hardware acceleration is required
on mobile.

## Risks / Trade-offs

- [Rust renderer misses Remotion fidelity, mostly in captions] → Golden-frame
  corpus compares both renderers within a tolerance. Authority moves only
  after the corpus passes. Production dual-runs the way `cross-platform-editor`
  already requires for edit execution.
- [GPU output differs across vendors] → Compare frames with a perceptual
  tolerance, not byte equality. Pin the corpus per renderer version.
- [gpui API churn, because it follows Zed] → Pin a gpui version. Keep UI code
  thin through `app-core`, so an upgrade or a move to egui touches only the
  shell.
- [No official UniFFI target for iOS] → Resolved in P0: the hand-written C
  ABI with cinterop passed spike B, so no generator is needed.
- [Three UIs cost three times the work] → `app-core` keeps logic shared.
  Platform UIs only draw. Web stays the reference UI.
- [Browser evicts OPFS data] → Request persistent storage. Never hold the only
  copy of an asset in the browser longer than the upload takes. Show upload
  state.
- [Hosted storage and traffic cost] → D8 transfer rules, hash dedupe, quotas,
  and an egress-free object store option.
- [Offline cache of licensed stock media] → Check each provider's license
  before allowing offline pinning. Stream-only for providers that forbid
  caching.
- [Client and server version skew] → Projects and commands already carry
  compatibility data. The capability handshake sets a minimum client version.
  A client refuses a project it cannot preserve.
- [App store payment rules change] → Web-only purchases in the first release.
  Legal check before launch.

## Migration Plan

1. P0. Write ADRs: client store engine, sync model, renderer ownership, binding
   strategy. Run spikes: wgpu inside gpui, Kotlin bindings on iOS, caption
   shaping in Rust.
2. P1. Define the project format and asset manifest. Add the content hash and
   client-minted IDs to the registry. Add the op log to the API with web as
   its first online client. Extract `app-core` from web logic.
3. P2. Build the Rust renderer. Run it in web through WASM beside Remotion.
   Compare golden frames. Move export to WebCodecs on the web and to a
   headless core in the render worker. P2 ships as four changes:
   `p2-render-foundation` (the renderer crate with static layers and
   captions, the golden-frame parity gate, and the web compare mode), then
   motion (keyframes, camera motion, reveals, scene transitions, effects, text
   templates), then media (video frames through WebCodecs, the audio mix),
   then export (WebCodecs export in the browser, a headless core in the render
   worker, production dual-run).
4. P3. Build the sync service: pending queue and rebase, snapshots, media
   upload and download, device sign-in, capability handshake. Move the web
   client to a local store.
5. P4. Ship the desktop client.
6. P5. Ship the mobile client. Add proxies.
7. P6. After a parity window with no unexplained divergence, remove Remotion,
   `packages/video` compositions and headless Chromium.

Rollback: until P6, Remotion stays the authoritative renderer and the Rust
renderer runs in shadow. Each phase change defines its own rollback.

## Open Questions

- Proxy resolution and codec for mobile. P5 decides with real footage.
- Size threshold for "small asset" prefetch. P3 tunes it with measurements.
- Cache size defaults and eviction order per platform. P3 decides.
- Payment provider for the hosted service. A later change owns it.
