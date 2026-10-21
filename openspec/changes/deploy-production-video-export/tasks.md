# Tasks

## 1. Render runtime image

- [x] 1.1 Add Remotion-compatible browser, required Linux libraries, and fonts to root Dockerfile. Verify final image can launch renderer browser from worker cwd without downloading browser at runtime; record image architecture and command output.
- [x] 1.2 Record image browser/cache contract in render-worker deployment guidance. Verify documented path matches browser launch proof and preserves existing FFmpeg/ffprobe checks.

## 2. Production wiring and regression checks

- [x] 2.1 Add internal render-worker service to both Compose files, required matching render tokens, API worker URL, worker authenticated API access, existing S3 settings, explicit cwd/SQLite path, and persistent data/output/public mounts. Keep dependency graph acyclic and one worker replica/job. Verify both files with `docker compose --env-file deploy/.env.example -f <file> config -q` after updating example with placeholder secret name.
- [x] 2.2 Extend existing deployment gate and tests to reject missing service/settings, mismatched token declarations, wrong worker URL, missing managed-media access, missing persistence, or public port exposure. Verify regression cases fail even when both Compose files share the same omission, then pass with corrected wiring.
- [x] 2.3 Configure and document explicit CPU, memory, and shared-memory limits, service healthcheck, deployment target and watch paths in deploy/AGENTS.md and apps/render-worker/AGENTS.md. Verify settings match rendered Compose and container render proof; do not claim measured production capacity before inspection.
- [x] 2.4 Update docs/self-hosting.md, docs/coolify.md, render-worker operator docs, and Unreleased changelog for required token, storage ownership, startup, rollback, and export verification. Remove obsolete no-deploy-target guidance. Verify `bun run check:version` and `bun run check:references`.

## 3. Container integration proof

- [x] 3.1 Exercise final production image on isolated stack with synthetic managed video/audio and authorized project. Submit render through API, poll completion, download output, and verify MP4 video/audio with ffprobe and playback/frame inspection. Assert unauthenticated/incorrect-token worker requests fail. Reuse existing integration proof where possible; keep meaningful regression coverage for any runtime fix.
- [x] 3.2 Recreate render worker with retained mounts. Verify prior job lookup and completed export download still succeed. Record volume paths and cleanup only test-owned resources.
- [ ] 3.3 Run `bun run typecheck`, focused deployment/render tests, `bun run check:deploy`, exact `bun run ci`, and `openspec validate deploy-production-video-export --strict`. Record actual results and distinguish environment blockers from passing focused checks.

## 4. Production rollout verification

- [ ] 4.1 Inspect current production revision, effective variable presence, any existing external render target/state, and host resource headroom without exposing secrets. Prepare concrete rollout settings and backup/rollback steps; keep live status pending if access is unavailable.
- [ ] 4.2 Once deployment is authorized, configure required render token and deploy reviewed image/Compose revision. Verify API-to-worker authentication, worker health, API health, and startup logs without secret output.
- [ ] 4.3 Drive authenticated production editor export through completion and download playable MP4. Record deployed revision, job ID, and render result, then verify job/artifact access after worker recreation. Do not mark live production verified from repository gates or health checks alone.

## Verification record

- Both production Compose files pass `docker compose --env-file deploy/.env.example -f <file> config -q`.
- Deployment regression suite: 37 passed, 0 failed. Both targets are checked independently, including matching omissions.
- `bun run typecheck`, `bun run check:deploy`, version and reference checks pass.
- Initial native Linux ARM64 image build fails in existing whisper.cpp 1.5.5 compilation (`ggml.o`, ARM FP16 intrinsics), before render browser installation. Linux AMD64 build is being verified separately; no whisper source change is included.

- Both Compose files reject an empty render token with `required variable MALEO_VIDEO_TOKEN is missing a value` for API and worker.
- Focused render-worker suite: 22 passed, 1 optional S3 integration skipped, 0 failed. Container S3 export/recreation proof remains separate.
- Production SSH inspection attempted through configured host; Cloudflare Access requires interactive browser authentication and SSH timed out during banner exchange. No production service settings or containers changed.

- Linux AMD64 image built successfully. Final-image browser check ran with `--network none`; `ensureBrowser` was configured to throw on download. Browser launched and closed using local cache at `/app/apps/render-worker/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell` (`platform: linux`, `arch: x64`). FFmpeg/ffprobe build checks passed.

- Connected image smoke reached render execution and reproduced `RangeError: Array length must be a positive integer of safe magnitude` in Remotion frame page pool creation. Same managed input rendered with explicit frame concurrency of one. Worker now sets that bound; final-image end-to-end rerun is pending.
- Full `bun run ci` passed static/type/Rust/deployment gates and test suites (API Bun suite: 1,481 passed, 5 optional skips), then failed at `check:layers`: `hooks/timeline/use-remotion-playhead.test.tsx` imports upward from `design-system/patterns/transport.tsx`. That file is unchanged by this change. Visual stage did not run.

- Final runtime smoke passed using Linux AMD64 production base plus exact updated worker source in image `maleo-export-proof:fixed` (`sha256:e136e67268b2f07ec53e367555e20ff24da686768f4a1ce7a54bd9b30eb50dbb`). The root Dockerfile built the production base successfully; subsequent full rebuilds stalled in unchanged `optimize-editor-wasm.mts` under Rosetta and were cancelled. The final worker fix was applied as a single source COPY layer for behavioral verification, not reported as a successful fresh root rebuild.
- Synthetic isolated stack reused production Postgres TLS, RustFS initialization, API and renderer service configuration. API submitted authorized managed video/audio export (202), job finished `done`, output had both video and audio streams, 2.048000-second measured duration for the two-second authored timeline, blue sample pixel [0, 0, 254], and audible source tone. Wrong/missing render credentials returned 401.
- Worker was recreated from image while retaining named volumes; completed job remained `done` and MP4 bytes were identical. Docker inspection confirmed 2 CPU quota, 4 GiB memory limit, and 1 GiB shared memory. Local Docker VM itself had about 2 GiB; this sample does not measure production capacity.
- Test-only containers, network, and volumes were removed. Synthetic proof logs and result JSON remain under `/tmp/maleo-export-proof/`; no runtime media or credentials were added to repository.
- After frame concurrency fix, full workspace typecheck, focused static checks, 37 deployment tests, 22 worker tests (one optional S3 test skipped), deployment/version/reference checks and strict OpenSpec validation pass. Task 3.3 remains open for exact CI completion and a successful fresh rebuild; baseline layering failure prevents visuals from running.
- User explicitly requested production remain pending. Tasks 4.1–4.3 are unverified; no production inspection, secret update or rollout completed.

- Container result: blue pixel [0, 0, 254], audio RMS 0.086438, duration 2.048000 seconds; recreation and byte equality passed.
