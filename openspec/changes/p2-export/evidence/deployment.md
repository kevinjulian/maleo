# Deployment with shadow runs (task 5.1)

## Deployment

- Coolify `maleo-core` (`mcn9di6ofudxswb0qsdvusuz`), commit `018da42`. Coolify marked the deployment failed: the build took 52 min and the 3600 s deploy timeout ran out while api and web started. The new containers started and are healthy. The render-worker container runs the new code (the lease renewal in `src/db.ts` is present) with `MALEO_EXPORT_SHADOW=on` and `MALEO_EXPORT_RENDERER=remotion`.
- Build time: Coolify injects every build-time env var as an `ARG` into every Dockerfile stage (`inject_build_args_to_dockerfile`). A new or changed var busts the cache of the FFmpeg, OpenH264, Mesa and render-host stages. Before p2-export a cold build took 8–9 min. The two `MALEO_EXPORT_*` vars are now runtime only.
- `018da42` also fixed a lease defect found before the shadow was turned on: `reclaimStale` took a running job after 10 min because nothing renewed its lease (`evidence/server-throughput.md`).

## One production export, 2026-11-07

Project `test` (`3d00be11-…`), Server render from the editor, signed in as the instance owner:

| Job                                    | Kind          | Renderer | Result                                                                                                     | Time    |
| -------------------------------------- | ------------- | -------- | ---------------------------------------------------------------------------------------------------------- | ------- |
| `f0a1dae6-3067-4f76-a4a6-6b27d780b301` | authoritative | Remotion | `done`, MP4 in the project's exports                                                                       | 151.3 s |
| `6325ba80-d330-4b0c-b99e-494b52cc8dca` | shadow        | Rust     | ineligible: `Rust renderer does not cover frame 271: textOverlays[0] no text style (browser default font)` | 0.4 s   |

- The shadow leased right after the authoritative job finished. It ran coverage and did not render.
- Operator view (API as the owner): `/api/video/jobs` and `/api/video/projects/3d00be11-…/exports` list the authoritative job and not the shadow. `/api/video/render/6325ba80-…` returns 404.
- `GET /api/admin/render-comparisons/report` returned 200: `compared` 0, `ineligible.count` 1, share 1, with the reason above; `state` open; blockers `window spans 0.0 of 14 days`, `0 of 50 compared jobs`.
- `GET /api/admin/render-comparisons` returned 404: the API forwarded to the worker's `/comparisons/`, which the worker's router does not match. Fixed in the next commit (path without a trailing slash, with a route test that fails without the fix).

## Eligible export, Rust shadow and comparison

Project `test` again, submitted through the editor's export route (`POST /api/video/render`) with the one uncovered `plain` text overlay removed; every other element unchanged.

1. `7619609c` (Remotion, done) → shadow `57947663` failed at media: the host decoded the voiceover, named `.x-wav` from its content type, as an image. Comparison `56fefce9` failed. Fix `1ac696c` (the host decodes only the URLs the renderer requests as images; regression test with an `.x-wav` input). Coolify's watch paths had no `crates/**`, so the fix did not deploy on push; the watch paths now include the Rust inputs, and a manual deploy finished 16:01:08 UTC. Explained as `rust-fix` with that commit and time: the window restarted at 16:01:08.
2. `2ea1b3db` (Remotion, done, 147.0 s) → shadow `95bdb4c6` (Rust, done, 179.4 s). Comparison `40a0e065` failed on audio only: format equal, every sampled frame above 0.955 (minimum 0.976), both clips 42.3 and 42.7 ms earlier in Rust, 9 of 20 loudness windows outside 1.5 dB. A local Remotion render of impulses at 0.5 and 1.5 s decodes at 0.54265 and 1.54265 s; the host is sample-exact. Remotion leaves 2048 AAC priming samples (42.67 ms) in its track. `comparison.json` v2 removes that delay from the Remotion side before audio scoring. Explained as `tolerance-change`, ref `comparison.json v2`.
3. `8fdfef90` (Remotion, done, 123.8 s) → shadow `a796e712` (Rust, done, 177.7 s). Comparison `2e374fcf` **passed** with version 2: format equal, minimum frame SSIM 0.976, 0 of 21 loudness windows outside, clip onsets 0 and 0.3 ms apart.

Report after step 3: window start 2026-11-07T16:01:08Z, 2 compared (1 passed, 1 failed and explained), 0 unexplained; blockers `window spans 0.0 of 14 days`, `2 of 50 compared jobs`.

## Outside p2-export

- The `How Visa Makes Money…` export fails in image preparation: one scene has no visual and the image service is unreachable from the worker.
- The editor console shows CORS failures on audio from `maleo-media.kvnjln.xyz/aincer-media/…`.
- Coolify's `inject_build_args_to_dockerfile` adds every build-time env var to every Dockerfile stage, which invalidates the heavy stages on an env change and writes secrets into build metadata. The Dockerfile needs none of them; the setting is to be turned off in the Coolify UI.
