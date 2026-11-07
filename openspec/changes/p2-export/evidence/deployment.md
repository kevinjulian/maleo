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

## Open

- No eligible production export has completed with shadows on, so no Rust shadow has rendered and no passed or failed comparison exists yet. A second export (project `How Visa Makes Money…`, which the export menu reports as fully covered) failed in image preparation before rendering: one scene has no visual and the image service was unreachable (`Unable to connect`). That failure is outside p2-export.
- The task stays open until one eligible export produces a compared row.
