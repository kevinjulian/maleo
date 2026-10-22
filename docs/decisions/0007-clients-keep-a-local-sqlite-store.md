# ADR 0007: Clients keep a local SQLite store; Postgres stays the server engine

- Status: Accepted
- Date: 2026-10-22
- Deciders: Kevin Julian
- Related: ADR 0005, OpenSpec `platform-grandplan` (D6), `platform-p0-foundations`

## Context

ADR 0005 runs Postgres in every environment, so that development and
production never use two SQL dialects. When 0005 was written, every
environment was a server.

The platform plan adds clients that work offline: a desktop app, a mobile app
and the web editor. Each client needs a local copy of its projects and of its
media state. "Postgres everywhere" then means an embedded Postgres in every
client. That road was argued, because it keeps one engine and one dialect
across the whole system. It fails on three counts:

- **iOS.** iOS does not allow a client to start a separate server process.
  An embedded Postgres runs as a server process, so it cannot run there.
- **Browser.** A browser cannot run Postgres. The web client can use SQLite
  compiled to WASM over OPFS, or an equivalent OPFS store.
- **Weight.** Embedded Postgres ships tens of megabytes of binaries per
  platform, needs a data directory and a start-up step, and holds memory
  while it runs. SQLite is a library in the process.

0005 itself names the trigger to revisit the engine: "if the product becomes a
single-user desktop app". A client device is that case.

## Decision

- Client devices (web, desktop, mobile) keep a local SQLite store for their
  copy of projects and media state.
- Every server environment stays on Postgres, as 0005 requires. A development
  server does not use SQLite.
- The server holds the canonical copy of synced data in Postgres. No server
  code path reads or writes a client store.
- Data crosses between a client store and the server only as `editor-core`
  commands through the sync log (ADR 0008), never as SQL rows. The two
  schemas stay independent, so dialect drift cannot cross the sync boundary.

This scopes 0005 to servers. It does not reverse it.

## Consequences

- Two engines exist in the product, one on each side of the sync boundary.
  Client SQL never runs on a server, and server SQL never runs on a client.
- Client schema changes need their own migrations on the device. They do not
  share the `packages/db/migrations/` sequence.
- A client store is not a backup. The server copy is canonical, and a lost
  device recovers from it.
- Revisit this if clients must run server code paths offline, or if a
  Postgres build appears that runs in the browser and on iOS at library
  weight.
