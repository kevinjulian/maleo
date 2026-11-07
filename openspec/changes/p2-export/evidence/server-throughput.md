# Server throughput (task 3.5)

## Production host class

Coolify resource `maleo-core` (`mcn9di6ofudxswb0qsdvusuz`), container `render-worker`, deployment of commit `0a14d16` on 2026-11-07. The container sees 4 processors (`nproc`) under the Compose limit of 2 CPUs and 4 GiB. Vulkan is lavapipe; FFmpeg is the LGPL build with `libopenh264`.

Command, run once through a Coolify one-off task:

```text
maleo-render render --job b.json   # {"storyboard":{"scenes":[],"bgColor":"#203040"},"width":1080,"height":1920,"fps":30,"frames":90}
```

Result: `{"done":true,"frames":90}` in 44 s, so 2.0 fps for a plain frame, encode included. This is the best case: no image, text, video or blur.

## Remotion on the same host

The worker queue holds one finished job: a 14.5 s storyboard (436 frames) in 117 s from lease to finish, preparation and bundling included, so at least 3.7 fps for Remotion. One job is not a distribution; the shadow runs of task 5.1 give paired times on the same jobs.

## Limits set from this

- Rust render time limit: 120 s plus the frame count at 0.25 fps (`renderTimeoutSec` in `apps/render-worker/src/rust-export.ts`), 8x below the plain-frame rate. A 60 s video (1800 frames) may take 2 h 2 min. Past the limit the host gets SIGTERM and the job fails with `render host exceeded <s> s for <n> frames`.
- Lease: before this task, `reclaimStale` (10 min) took a running job whose lease was older than 10 min even while it rendered, because nothing renewed the lease. `setPhase` now renews it on every phase or progress report, so a 15–40 min shadow render is not reclaimed.

Tests: `tests/db.bun.test.ts` (a reporting job is not reclaimed), `tests/rust-export.isolated.ts` (a slow host is stopped at a 1 s limit and the job fails with the limit, within 5 s).

## Open

The plain-frame rate is the upper bound. The first shadow jobs of task 5.1 measure production content; this task stays open until those times are recorded here next to the Remotion times of the same jobs.
