# ADR 0008: Projects sync through a server-sequenced command log, not CRDTs or replication

- Status: Accepted
- Date: 2026-10-22
- Deciders: Kevin Julian
- Related: ADR 0007, OpenSpec `platform-grandplan` (D7), `platform-p0-foundations`

## Context

Clients keep a local copy of each project (ADR 0007) and edit it offline. The
edits must reach the server and the other devices of the same person, and a
device that was offline must catch up.

Two other roads were argued in the platform discussion:

- **CRDTs** (for example Automerge or Yjs). They merge concurrent edits from
  many writers without a central order.
- **Database replication** (for example a SQLite-to-Postgres sync layer).
  It copies table rows between the client store and the server.

`maleo-editor-core` already defines the unit of change. Every edit, from the
web editor and from the API agent, is an `EditorCommand` executed by the same
engine. Execution is deterministic: the same command on the same document
gives the same result. The golden fixtures in
`crates/editor-core/tests/fixtures.rs` hold the engine to one expected result
per command, shared with the TypeScript contract. Execution also returns the command's inverse (`Executed::inverse` in
`crates/editor-core/src/execute.rs`), which undo already uses.

## Decision

- The unit of sync is an `editor-core` command.
- A device applies a command locally and appends it to a pending queue.
- The server validates each command with the same engine, assigns it the next
  sequence number for the project, and stores it in the project log.
- The server acknowledges the sequence number and sends the commands the
  device lacks. The device undoes its pending commands with their inverses,
  applies the server commands in order, and re-applies its pending commands
  on top (rebase).
- A command that no longer applies after rebase is dropped and reported to
  the user.
- AI agent edits enter the same log, so they reach devices like any edit.
- Snapshots plus log compaction let a new device start from a recent state.

Rejected: CRDTs. They solve concurrent editing by many people, which is a
non-goal: one person owns a project. They also add a second document model
beside `editor-core`, and every editing rule would need a CRDT form that
agrees with the engine.

Rejected: database replication. It syncs storage rows, not intent, so the
server cannot validate an edit as an edit. It also couples the client schema
to the server schema, which ADR 0007 keeps apart.

## Consequences

- Every command must stay deterministic and invertible. A command that reads
  the clock, a random source or host state breaks rebase. The fixture tests
  are the guard.
- The server runs `editor-core` to validate commands, so engine changes are
  sync protocol changes. A device and the server must agree on the command
  set, which needs a version in the protocol.
- Conflict handling is simple because conflicts are rare. Dropped commands
  are visible to the user, not merged silently.
- Revisit this if real-time editing by several people becomes a goal. That is
  the case CRDTs exist for.
