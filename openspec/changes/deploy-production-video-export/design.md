# Design

## Context

See proposal.md for motivation. Both production Compose targets omit render execution. Root image already contains render-worker source and workspace dependencies, but installs FFmpeg only, without explicit render browser provisioning. Worker uses `cwd/public`, `cwd/out`, and a SQLite queue. Its `/health` checks output writes and queue access, not browser execution. Managed inputs require `MALEO_API_URL`, `MALEO_SERVICE_TOKEN`, and `MALEO_VIDEO_PUBLIC_BASE`. API render calls require `MALEO_VIDEO_URL` and `MALEO_VIDEO_TOKEN`.

Live production settings and available host capacity remain unverified. Reported production 503 also differs from current route's 502 error mapping. Deployment verification must establish deployed revision and effective configuration without exposing secrets.

## Goals / Non-Goals

**Goals:** Make existing local render path usable from the production editor, preserve queue state, reuse managed media authorization and storage, and prevent this omission from recurring.

**Non-Goals:** Lambda setup, editor changes, output-row transaction redesign, queue replacement, autoscaling, local dev startup changes, or moving other services.

## Decisions

### Deploy existing worker in the core network

Add `render-worker` to both complete Compose files. Reuse root image with working directory `/app/apps/render-worker` and direct `bun src/index.ts` command. Keep port 8091 internal. API receives `MALEO_VIDEO_URL=http://render-worker:8091` and required `MALEO_VIDEO_TOKEN`; worker receives the same token. Inject secrets at deployment time using the repository's supported `${VAR:?}` form.

Do not use localhost for API-to-worker calls: containers have separate network namespaces. Separate platform resource would add network coordination without benefit for this stack.

### Preserve worker paths and shared storage access

Use dedicated named mounts for worker `data/`, `out/`, and `public/` under its working directory. Set `MALEO_VIDEO_DB` explicitly. Do not mount over source code or share API's SQLite paths. Mounts preserve existing cwd contracts without introducing a new runtime-path abstraction.

Give worker the existing S3 environment used by API/media-worker, plus `MALEO_API_URL=http://api:8090` and existing `MALEO_SERVICE_TOKEN`. Set `MALEO_VIDEO_PUBLIC_BASE=http://127.0.0.1:8091/public` for browser requests from this local renderer. This address is deliberately local to worker; API's worker address uses service DNS instead. No browser-facing render domain is needed because completed output uses existing managed storage/API delivery.

### Provision browser during image build

Use installed Remotion version's browser installation support at image build time, with Linux runtime libraries and fonts required by that browser. Keep browser cache accessible from worker cwd and verify rendering from the final image. Prefer extending existing shared image over another install/build pipeline. Do not rely on runtime network downloads or on unrelated Playwright Chromium being selected automatically.

Keep one worker replica and existing one-job concurrency. Use one browser frame worker per local render. Container acceptance reproduced a Remotion automatic concurrency failure under Bun (`RangeError` in frame page pool creation); explicit concurrency of one rendered the same managed inputs successfully. This also bounds browser processes within the service CPU/memory limits. Record explicit container CPU/memory/shared-memory settings and prove the selected values with a short container render before rollout. Choose limits within actual production host capacity; multi-replica SQLite sharing is outside scope.

### Avoid circular readiness dependencies

Worker can start its HTTP server without API and already checks object storage at boot. Depend on storage initialization; API can depend on worker health, while worker must not depend on healthy API. Workspace media fetching happens after API becomes available. Existing worker health remains a liveness prerequisite, not proof of Chrome, bundling, or a complete export.

### Extend existing deployment gate

Add export wiring assertions to `scripts/check-deploy.ts` and its existing tests. Cover missing service, missing/mismatched token declarations, wrong API worker URL, missing authenticated media configuration, persistence, and internal-only exposure. Mutation cases must remove wiring from both Compose twins so parity cannot conceal omission. Keep current parity checks.

## Risks / Trade-offs

- Larger shared image and browser CPU/memory use -> install browser once at build time, limit resources, and verify host headroom before rollout.
- Health succeeds while browser or bundle fails -> require a real managed-media MP4 export from final image and deployed app.
- Persistent mounts retain temporary media -> preserve existing cleanup and record volume ownership and backup/retention expectations.
- Existing production may use another revision or custom configuration -> inspect deployed revision and effective variable presence before applying rollout instructions.
- One local renderer limits throughput -> retain current queue semantics; scale only after measured demand.

## Migration Plan

1. Build and validate repository change, including container export and recreation proof using synthetic managed media.
2. Record existing deployment revision and inspect production service configuration without printing secret values. Set a new `MALEO_VIDEO_TOKEN` in the existing core resource. Back up any existing externally operated render queue before changing its address.
3. Deploy both API wiring and worker together. Confirm storage initialization, worker health, API health, and correct internal addressing.
4. Submit export through authenticated production editor, poll completion, download and inspect MP4 video/audio. Record revision and job ID without private media or secret values in repository artifacts.
5. Recreate worker and verify job lookup and finished export access. Report production proof as pending if live access is unavailable.
6. Roll back to previous image/Compose revision if verification fails. Preserve new volumes, existing object storage, and credentials. Rollback restores prior application behavior; it does not claim to fix previously unavailable export.
