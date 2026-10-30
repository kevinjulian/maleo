# Task 2.5 source lifecycle

`createPreviewMediaSession` owns native readiness, worker requests and its own
object URLs. Replacement/removal cancels old requests and releases local handles.
Native invalidation requires current generation/revision/attempt, advances the
attempt and blocks readiness until Retry. Ready siblings retain their handles.
Changed track-kind requirements revalidate full bytes without another download.
Pending File revisions follow local staging leases; upload progress does not
advance unrelated source revisions.

The hook replaces sessions on workspace/project changes. Editor teardown closes
the session. Sign-out waits for all live media sessions before navigation; errors
are reported to the console and closed workers leave reclaimable session files.
The 64 MiB memory ledger spans all media workers in a tab, including queued writes.
Borrowed complete Files do not add copied-source memory.

OPFS ownership uses one exclusive Web Lock per session. Startup only removes
other preview directories while holding their nonblocking ownership lock. It
never traverses `pending-uploads`. Missing Web Locks means no automatic deletion
of unproven orphans. A closed/crashed worker releases its ownership lock.

Verified:

- Eight native readiness tests plus 18 editor-WASM tests passed.
- Thirty focused web tests passed across source loading/storage/authorization,
  shared memory, controller and preview-hook/projection tests; separate sign-out
  test passed and waits for worker disposal before navigation.
- Ten shared dependency/WASM tests passed, including pending File revisions.
- Five production browser checks passed including warmup: normal editor startup
  without renderer resources; local offline Play/seek; complete File loading;
  active-worker protection, crash reclamation, pending File lease and staged-file
  preservation through real OPFS/Web Locks.
- Full workspace typecheck, version and reference checks passed.

Commands:

```sh
cargo test -p maleo-media -p maleo-editor-wasm
bun run --cwd apps/web test src/services/preview-media src/hooks/timeline/use-preview-composition.test.tsx src/models/timeline/preview-local-sources.test.ts
bun run --cwd apps/web test src/hooks/auth/use-sign-out.test.tsx
bun run --cwd packages/shared test src/preview-media-dependencies.test.ts src/editor/media-readiness.test.ts
bun run --cwd apps/web playwright test --project=visual preview-source-loading.spec.ts preview-offline.spec.ts engine-wasm.spec.ts --grep 'ownership|complete local|normal editor startup' --workers=1
bun run typecheck
bun run check:version
bun run check:references
```

Initial test failures corrected: browser probe tried to borrow a deleted OPFS
snapshot instead of an independent pending File; the corrected probe borrows a
staging-owned complete File. Typechecking required the standard DOM.AsyncIterable
library for directory enumeration. Existing native ripple performance threshold
failed during concurrent builds and passed on a subsequent isolated run.
Authorization-in-flight requirement changes also retain their existing target
promise; a red/green regression test verifies no duplicate authorization.

Common playback gating, visible Retry actions and later runtime recovery remain
in their planned later tasks. Full CI and physical-device acceptance are open.
