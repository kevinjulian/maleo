# Shadow jobs (task 4.1)

## What the worker does

- When an authoritative job finishes and `MALEO_EXPORT_SHADOW` is not `off`, the worker queues one shadow row (`shadow_of` = the job ID) on the other renderer. `apps/render-worker/src/worker.ts` (`runJob` end).
- The shadow row's input is the prepared storyboard with the stable managed URLs put back (`ManagedInputs.restore`). The voiceover audio and images are already present, so the shadow does not prepare again. It downloads the managed inputs again by their IDs, with the SHA-256 check.
- The authoritative output moves to `out/shadow/<shadow id>.reference.mp4` after the upload. The shadow writes `out/shadow/<shadow id>.mp4`. Task 4.2 compares the two files and removes them.
- A shadow job has one attempt, runs on the local backend, and never uploads output, poster or manifest.
- A Rust shadow runs coverage first. If the host does not cover the storyboard, the row ends as `error` with `error_code` `INELIGIBLE` and the reason in `renderer_note`. A shadow that fails or is ineligible removes the reference file.

## Visibility

- `jobWhere` always adds `shadow_of IS NULL`. This covers `listJobs`, `countJobs` and `jobOwners`, so `/jobs` and `/jobs/query` exclude shadow rows.
- `GET /render/:id`, `POST /render/:id/cancel`, `POST /render/:id/retry` and `GET /render/:id/file` use `getVisibleJob` and return 404 for a shadow ID.
- The API reads render jobs only through `/jobs/query` and `/render/:id` (`apps/api/src/lib/video-client.ts`). Project status, the Video collection and charges come from those reads, so shadow rows do not reach them.

## Leasing

`leaseNext` orders by `(shadow_of IS NOT NULL)` and then `created_at`. A queued authoritative job always leases before a shadow job, also before an older one.

## Tests

`apps/render-worker/tests/rust-export.isolated.ts`, describe "shadow jobs (p2-export E6)":

- A finished job queues one shadow on the other renderer with its prepared input and the reference file.
- `MALEO_EXPORT_SHADOW=off` queues no shadow.
- Shadow rows never appear in `listJobs`, `countJobs`, `jobOwners` or `getVisibleJob`, with and without workspace filters.
- An authoritative job leases before an older shadow job.
- A Rust shadow renders to `out/shadow/`, stores nothing and keeps both files. The authoritative row is unchanged.
- A shadow failure leaves the authoritative row unchanged, has one attempt, and removes the reference file.
- An ineligible shadow records its reason and does not run the host.

`managed-inputs.bun.test.ts` checks that `restore` puts the stable managed URL back.

Result: `bun run --cwd apps/render-worker test:bun`: 41 pass, 1 skip, then 14 pass in the isolated run. Render-worker and API typecheck clean. `bunx vp check` clean.
