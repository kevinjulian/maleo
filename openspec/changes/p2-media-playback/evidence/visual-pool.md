# Task 3.2 decoder leases and visual reservations

`maleo-media` now owns visual request queues, frame identities, decoder leases
and CPU RGBA reservations. Cache plus in-flight allocations share the 256 MiB
limit. Current/next retained frames survive eviction; remaining entries use LRU.
Per-consumer queues hold one active and one replaceable latest request. Source
revision/presentation interval identifies frames, so overlapping placements can
sample independent times. Actual-dimension reservation changes precede host copy.
Named errors reject minimum working sets that cannot fit; no resolution downgrade.

The existing renderer WASM exposes `MediaPool` with JSON commands without GPU
initialization. A separate host-wide native broker, exposed through editor WASM,
grants two video and two audio slots across normal source probes and adapters.
Normal mode still requests no renderer module. Main-thread code only routes
native grants; workers return them after finite decoder iterators close.

Verified:

- Nineteen native media tests passed (six visual-pool, three global decoder,
  eight readiness and two timing tests); eighteen editor-WASM tests also passed.
- Focused web tests: nine files, 34 passed, including shared WASM slots, foreign
  lease release rejection, cancellation and sibling preservation.
- Browser pool probe: native WASM grants two active video leases and queues the
  third; completion moves its reservation into cache and disposal returns zero.
- Real production source-client/worker probe: four simultaneous H.264/AAC files
  reached maximum two video and two audio WebCodecs instances across workers;
  both active counts returned to zero after validation/disposal. The test adds
  a 100 ms flush delay to force overlapping probes. This proves lease enforcement,
  not playback throughput or physical sound output.
- Browser run: three passed including warmup, pool-boundary and real-codec probes.
- Whole static check passed: 3229 files formatted, 2374 code files checked.
- Full typecheck passed before the browser-only probe addition.

Commands:

```sh
cargo test -p maleo-media -p maleo-editor-wasm
bun run --cwd apps/web test src/services/preview-media src/hooks/auth/use-sign-out.test.tsx src/hooks/timeline/use-preview-composition.test.tsx src/models/timeline/preview-local-sources.test.ts
bun run --cwd apps/web playwright test --project=visual preview-media-pool.spec.ts --workers=1
bunx vp check
```

The initial decoder broker used tree containers and increased editor WASM to
734388 raw bytes, over the accepted 716800-byte limit. Replacing those containers
with small vectors retained FIFO/ownership semantics and reduced the module to
715865 raw / 269634 gzip bytes, within the existing 700/270 KiB caps. No cap changed.
An overlapping renderer build also caused one budget suite setup timeout; a warm,
sequential rerun passed. Performance thresholds remain unchanged.

Sequential/random-access frame adapters and their real 100-seek stress proof
are now recorded in `video-decode.md` for task 3.3. Renderer frame supply and production golden parity remain 3.4–3.5.
The final memory/performance acceptance fixture remains group 7.

Task 3.3 adds weighted transparent-video grants, fair yield and temporary-copy
reservations. The media crate now has 21 tests: four decoder, seven visual-pool,
eight readiness and two timing tests. The later Chromium pool/source-worker
probe still passes. Latest WASM sizes are recorded in `wasm-budget.md`.
