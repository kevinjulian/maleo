# Comparison rows, report and explanations (task 4.3)

## Rows

`apps/render-worker/src/comparisons-db.ts` creates `render_comparisons`: one row per shadow job (`shadow_job_id` is unique). A row holds the job pair, the authority and shadow renderers, the configuration version, the status (`passed`, `failed` or `ineligible`), the failure lines, the scores, the artifact directory, and the explanation fields (`cause`, `resolution`, `resolution_ref`, `fix_deployed_at`, `explained_by`, `explained_at`).

`apps/render-worker/src/shadow-settle.ts` writes the row when a shadow job ends:

- An ineligible shadow writes `ineligible` with its coverage reason.
- A failed shadow writes `failed` with `shadow render failed: ...`.
- A finished shadow runs the comparison and writes `passed` or `failed`.
- A comparison that cannot run writes `failed` with `comparison failed: ...`, so an operator sees and explains it.

Both MP4s are removed after. `pruneComparisonArtifacts` removes artifact directories older than 30 days on the worker's reclaim interval.

## Window

`apps/render-worker/src/comparison-window.ts`: the window starts at the later of the first comparison and the latest `rust-fix` deployment. `compared` counts passed and failed rows in the window. The window is `closed` at 14 days and 50 compared jobs. `switchAllowed` needs a closed window and zero unexplained failed rows. `blockers` names each unmet condition. The report gives the ineligible count, share and reasons.

An explanation of a `passed` or `ineligible` row is refused. A `rust-fix` explanation without a commit (`ref`) and deployment time (`deployedAt`) is refused.

## Routes

- Worker, behind its bearer token: `GET /comparisons/report`, `GET /comparisons[?status=]`, `GET /comparisons/:id`, `POST /comparisons/:id/explain` (`apps/render-worker/src/comparison-routes.ts`).
- API, under `adminRoutes` (`instanceOwnerOnly`): `GET /api/admin/render-comparisons/report`, `GET /api/admin/render-comparisons`, `GET /api/admin/render-comparisons/:id`, `POST /api/admin/render-comparisons/:id/explain` (`apps/api/src/routes/admin-render-comparisons.ts`). The API sets `by` to the calling administrator and records `render_comparison.explain` in the admin audit with the outcome.

## Tests

- `apps/render-worker/src/comparison-window.bun.test.ts` (7): no comparisons; 14 days with 49 jobs is open and gives the count; 50 jobs in 13 days is open; 14 days and 50 jobs allows the switch; an unexplained divergence blocks and an explanation clears it; a `rust-fix` restarts the window at its deployment; ineligible share and reasons.
- `apps/render-worker/tests/comparisons.isolated.ts` (4): the routes close the window at the limits, block on an unexplained divergence and allow after an explanation; a `rust-fix` needs its commit and deployment and restarts the window; bad explanations get 409, 400 and 404; the list filters by status.
- `apps/render-worker/tests/rust-export.isolated.ts`: a finished Rust shadow writes a `passed` row and removes both MP4s; a failed shadow writes `failed`; an ineligible shadow writes `ineligible` with its reason.
- `apps/api/src/routes/admin-render-comparisons.bun.test.ts` (3): a member gets 403 and no request reaches the worker; an administrator reads the report through the worker token; an explanation sends the administrator as `by` (a body `by` is ignored), and both outcomes are audited.
