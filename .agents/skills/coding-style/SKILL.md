---
name: coding-style
description: Use when working in the maleo monorepo to follow local package boundaries, content-first api/web create-content contracts, media/render parity, commit style, verification flow, and Codex-only runner conventions.
---

# Maleo Monorepo Coding Style

Read this skill before non-trivial edits in this repo. Use it for local workflow and architecture decisions, not for generic coding advice.

## First Checks

- Read the root `AGENTS.md`, then the nearest package/app `AGENTS.md` if one exists, before editing.
- Use Bun commands, not npm/pnpm/yarn.
- Do not use `bun run --filter <pkg> <script> <args>` when positional args matter (bun filter drops positional args). Root no-arg scripts (`typecheck`/`test`/`build`) use `--filter '*'`; the `bun run web|api|video|...` convenience scripts `cd` into the package so args pass through.
- Keep Codex-only runner flows; do not reintroduce Claude or Anthropic-specific runners.
- Single root `.env` only. No package-local `.env` under `packages/*` or `apps/*`; dev scripts load it with `--env-file ../../.env`.
- No generic `PORT` in root `.env`; use per-service vars (`MALEO_API_PORT`, `MALEO_WEB_PORT`, `MALEO_MEDIA_WORKER_PORT`, `MALEO_VIDEO_PORT`).

## Commit Style

Prefer conventional commits. Common forms in this repo:

- `feat: add X`
- `fix: handle Y`
- `refactor: simplify Z`
- `docs: update runbook`
- `feat(web): ...`
- `fix(core): ...`

Messages are usually descriptive rather than ultra-short.

## Code Architecture

```
packages/
  db/             # Unified SQLite schema + entity-family access
  api/            # Content-first Bun.serve + Hono API
    src/routes/          # Hono route modules
    src/lib/             # workspace IO, chat agent, text providers, metering
  shared/         # Pure types + helpers consumed across packages
  inngest/        # Shared durable execution client + event schemas
  media/          # Content-gen providers (src/providers/<name>/) + worker runtime
  video/          # Remotion render pipeline (schema, scenes, compositions, lambda)
  stock/          # Stock media lookup
apps/
  web/            # Content-first React client
    src/pages/           # Content, CreateContent, Library, Video, Settings
    src/components/      # Shared UI
  chrome-ext/     # Browser extension
  media-worker/   # Thin deployable shell for @maleo/media worker
infra/            # Third-party services we deploy; no maleo source, no package.json
  inngest/        # Compose stack for the deployed core
  kokoro-tts/     # Dockerfile for the Kokoro TTS server
  pocket-tts-id/  # Dockerfile + server for the Pocket TTS Indonesian service
  searxng/        # Dockerfile + settings for the SearXNG instance
  crawl4ai/       # Dockerfile + config for the Crawl4AI instance
```

Note: the legacy standalone image package and the old combined `dashboard` package are gone. The API is `apps/api`, the client is `apps/web`, and image/audio generation lives in `packages/media`, run by `apps/media-worker`. Providers are directories under `packages/media/src/providers/<name>/`, never separate packages. Kokoro TTS deploys from `infra/kokoro-tts`, which holds only a Dockerfile.

## Package Boundaries

- `packages/shared`: pure types and pure logic only. No filesystem, DB, fetch, or Bun process APIs. Exposes content behavior, image/video policy, video style/blueprint/editorial, timeline/template/doc/model, creative direction, credits, and render storyboard helpers.
- `packages/db`: unified SQLite schema and database access only.
- `apps/api`: Hono server, workspace IO, chat agent, text providers, metering, and API-owned `agent-run` function.
- `apps/web`: React client for the content-first UI.
- `packages/inngest`: shared durable-execution client and event schemas only.
- `packages/media`: provider abstraction + generation function + worker runtime. Providers implement the abstraction, not the worker.
- `packages/video`: Remotion renderer; timeline-template driven, section-first compiler, viewer attention budget. Supports local + Lambda render.
- `packages/stock`: stock media lookup.
- `apps/media-worker`: thin deployable shell wrapping `@maleo/media` worker.
- `deploy/`: production compose stack for the core, Inngest included; local dev uses `.bin/inngest`.

## Common Co-Changes

- Shared schema change: `packages/shared/src/*` plus re-export in `index.ts` plus db, api, and web consumers.
- API change: `apps/api/src/routes/*` plus the `apps/web` page that consumes it.
- Agent pipeline change: `apps/api/src/modules/agents/core/*` plus matching colocated tests.
- Media provider change: `packages/media/src/providers/<name>/` plus `apps/media-worker` if the worker contract shifts.
- Durable event change: `packages/inngest` schemas plus owning API/media function and producer.
- Content project API change: the `apps/api` content project routes plus `apps/api/src/modules/agents/core/*` and the `apps/web` create-content consumers.
- Create-content editor change: the `apps/web` create-content pages, matching agent persistence/load helpers, and Remotion preview/export mapping when timeline data changes.
- Video/render contract change: `packages/video/src/schema.ts` plus `components`/`scenes`/`compositions`/`lib`, the `buildRenderStoryboard` mapping, and relevant shared timeline/render types.

## Local Patterns

- Web UI authoring (Base UI behavior, shadcn `base-nova` recipes as `tw:` classes over tokens, overlay ownership in `apps/web/src/controllers/overlay`) is owned by `apps/web/DESIGN.md`; read it before touching `apps/web` components.
- Web client navigation state lives in `App.tsx` via a discriminated union view model.
- Content list is operator inventory: title, type, created date, last edit, search, and type filter.
- Create-content setup creates a project shell first, opens an empty workspace, and starts generation only through chat actions.
- All content types use the same chat-agent path through `useContentAgent` and the API server agent pipeline.
- Project-local All Media and global Reference Library remain distinct. Copy global refs into project-local media before project references point at them.
- Timeline preview is WYSIWYG by default: Remotion `Player` uses the same `buildRenderStoryboard`/`StoryboardReel` path as export.
- Timeline/editor state must preserve client-owned fields across agent snapshots: references, captions, pacing devices, infographic style, clip placement, and content duration.
- Runtime state lives under `data/`; generated media, DB snapshots, and other local artifacts are not source files.
- Video output is driven by `packages/video/schema.ts` and the render-storyboard mapping. The API produces the plan/storyboard/timeline data that feeds it.
- Tests are unit files close to package ownership boundaries: Vitest (`vite-plus/test`) by default, `bun:test` in `*.bun.test.ts` only when exercised production code needs the Bun runtime.

## Verification

Always run the smallest meaningful check, then broaden if the change crosses packages.

- Repo-wide: `bun run typecheck` (all workspaces), `bun run test` (all workspaces).
- Focused file: `bun run --cwd packages/db test tests/unit/<file>.test.ts` (Vitest); a Bun suite: `cd packages/db && bun test tests/unit/<file>.bun.test.ts`
- Package-focused: `cd packages/<name> && bun run typecheck`, `bun run test`, `bun run test:bun`.
- Behavior smoke:
  - api: `bun run api`; web: `bun run web`
  - video: `bun run video` (Studio) / `bun run render-worker` (render server)
  - service apps such as media-worker: start the server or run the package health command and hit `/health` when exposed. TTS service images deploy independently, so confirm configured service health.

Report actual failures. Do not claim green without running a check.

## Anti-Patterns

- No `bun run --filter <pkg> <script> <args>` when passing positional args (bun drops them); `--filter '*'` for no-arg root scripts is fine.
- No IO in `@maleo/shared`.
- No hardcoded project/reference/provider state in web client CSS.
- No committing local DB snapshots, generated media, or secrets.
- No package-local `.env` files; single root `.env`.
- No generic `PORT` in root `.env`; use per-service port vars.
- No reintroducing Claude/Anthropic-specific runner code.
- No reviving the removed standalone image package; use the `media` + `media-provider-*` stack.
