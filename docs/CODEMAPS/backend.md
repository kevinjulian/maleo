<!-- Generated: 2026-09-09 -->

# Backend API

`apps/api` is content-studio composition root. It owns HTTP, workspace
filesystem configuration, chat orchestration, text-provider execution, service
clients, and metering. Database modules remain in `@maleo/db`.

## Routes

| Route family          | Purpose                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `/api/operations/*`   | Projects, storyboards, materials, references, templates, renders, outputs, events, generation chat |
| `/api/workspaces`     | Workspace registry and scaffold                                                                    |
| `/api/settings`       | Provider configuration, global settings, caption/research status                                   |
| `/api/capabilities`   | Effective provider readiness and selection                                                         |
| `/api/image-gen`      | Durable image submit/poll, ledger, gallery, worker-file proxy                                      |
| `/api/media/:id`      | Workspace-authorized stable media ID and private object delivery                                   |
| `/api/tts`            | Durable speech generation, ledger, gallery, samples                                                |
| `/api/stock`          | Stock visual and sound-effect search                                                               |
| `/api/video`          | Video service proxy                                                                                |
| `/api/inngest`        | API-owned `agent-run` function host                                                                |
| `/internal/config`    | Authenticated resolved provider configuration for media worker                                     |
| `/internal/media/:id` | Service-token media byte read for worker and render inputs                                         |

`/api/sources` does not exist; stock discovery uses `/api/stock`.

## Libraries

```text
src/lib/
  agent/             durable chat loop, tools, persistence, agent-run function
  ai-provider/       text contracts, registry, selection, CLI/API adapters
  generation/        image job + billed TTS kernels
  metering/          prices, reservations, usage capture
  workspace/         YAML loader, registry, paths, scaffold, branding
  image-gen-client.ts @maleo/media/api configuration
```

Image and TTS execution use `MALEO_GEN_WORKER_URL` through
`@maleo/media/api`. Missing worker configuration fails clearly; API has no
direct image-service fallback. New generated image, speech, upload, and render
URLs use `/api/media/:id`. API checks workspace membership and resolves a
private object or local development file on each read. The
`/api/image-gen/files/*` route remains for unmigrated legacy jobs.

## Verification

```bash
cd apps/api
bun run typecheck
bun run test       # Vitest suites; add a file path to run one
bun run test:bun   # suites that need the Bun runtime (*.bun.test.ts)
```
