# Task 2.4 local preview inputs

The normal timeline editor projects dependencies before track filtering and passes
pending File handles without upload-staging mutation. Rust readiness owns queued,
loading, validating, ready and failed state. The browser adapter creates object
URLs only for successful current completions. Preview-specific substitution
changes media fields only; URL-like text, the authored document, undo history and
production/draft export inputs retain their original values. Unready visuals use
the existing studio blank pixel with image kind; unready audio has no source.

Both normal Remotion props and diagnostic Rust image enumeration receive the
same locally resolved storyboard. Video frame supply to Rust remains group 3.

Commands run:

```sh
bun run --cwd apps/web test src/hooks/timeline/use-preview-composition.test.tsx src/services/preview-media src/models/timeline/preview-local-sources.test.ts
bun run --cwd apps/web playwright test --project=visual preview-offline.spec.ts --workers=1
```

Portable run: six files, 24 tests passed before additional session tests.
Production browser: two tests passed including warmup. The real editor fetched a
complete five-second H.264 source, displayed a blob-backed video, decoded frames,
accepted Play/Pause, sought beyond two seconds through its ruler, resumed and
decoded more frames while offline. The source route explicitly aborts after
readiness and its request count stays unchanged. There is one worker full-source
fetch plus one existing timeline-thumbnail range request before readiness.
This verifies local preview playback, not tab-wide thumbnail download routing.

Separate tests verify pending-File preview waits for worker validation, source
replacement cannot accept an older completion, Rust image URLs resolve to local
blobs, unchanged export mapping and unchanged authored URLs. Common Play gating,
clip loading UX, later codec invalidation and lifecycle acceptance remain open.
