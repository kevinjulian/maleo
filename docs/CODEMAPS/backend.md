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

`/api/operations` resolves the workspace once per request (`workspaceScope`).
Every `/projects/:id` route then refuses a project from another workspace with
`404 project_not_found` (`projectWorkspaceScope`).

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

## Media import

`modules/media-import` owns `/api/operations/projects/:id/media/import`. The
client mints the media identity of each file with `mintMediaId()` (UUIDv7,
`@maleo/shared`) and sends it as the import request key. The server refuses
any other key with `400`. The flow:

1. Reservation stores the key as `project_media_imports.media_id`. A key that a
   registry row or another import already uses gets `409 media_id_conflict`.
   The refusal does not name the owner.
2. The upload goes to quarantine. The media worker makes the playback copy.
3. On finish, the registry publishes the playback object under `media_id`.
   The document reference `/api/media/<id>` does not change. In the same
   transaction the asset enters the project's media library under `media_id`
   (`admitProjectMediaAsset`), with a versionless `media.admit` log entry, so
   every client sees the upload before anyone places it.

Until the import finishes, `GET|HEAD /api/media/:id` gives a member
`409 media_pending`. A failed or cancelled import and a non-member get the
same refusal as unknown media.

## Project command log

`routes/operations/commands.ts` and `lib/project-commands.ts` own the editor
command log (`p1-command-log`):

- `POST /api/operations/projects/:id/commands` takes
  `{baseSeq, commands: [{clientCommandId, command}]}`. Under the
  `storyboard-version:<project>` lock, each command executes against the head
  scope in the Rust engine. Its result must pass `prepareStoryboardSave`
  (`lib/storyboard-save.ts`), the save route's validation and merge. A refused
  command is rejected with the engine's or the save rule's reason, and the next
  command runs. The accepted commands become one version, at the next log
  sequence. The scope's `mediaAssets` are the project's library rows
  (`@maleo/db/project-media-assets`); the accepted library is written back as
  row changes in the same transaction. When every accepted command is
  `media.admit` or `media.update`, the entry names no version (`version: null`)
  and no storyboard is written. A submitted `scope.replace` keeps the server's
  library: the library changes only through `media.*` commands. The reply is `{headSeq, headVersion, accepted, rejected,
  delivered}`. `delivered` holds the entries after `baseSeq` that the client
  did not write. A repeated
  `clientCommandId` gets its first outcome back and does not execute again.
- `GET /api/operations/projects/:id/commands?after=<seq>` returns
  `{headSeq, headVersion, entries}`. When the log does not hold every entry
  after `after` (pruned), `entries` is one `scope.replace` of the head with the
  library, marked `snapshot: true`. Without `after`, `entries` is empty: a client reads where
  the head is when it loads.

Every other storyboard writer records its version as one `scope.replace`
(`@maleo/db/project-commands`), carrying the library.

## Project media library

The library is `project_media_assets` rows, not editor state.
`GET /api/operations/projects/:id` returns them as `mediaAssets`;
`PUT /projects/:id/editor-state` ignores `media_assets` and keeps the stored
list. Export preflight, the render route, the asset manifest and media
processing read the rows through `projectMediaLibrary`. The first read of a
project imports its stored list once. A non-member gets the workspace scope's
refusal before any command executes.

## Asset manifest

`GET /api/operations/projects/:id/asset-manifest` lists the media that the
current storyboard and the project media library reference. Each identity
appears once, with `origin`, `kind`, `contentType`, `size`, `sha256`, `state`
(`ready`, `pending`, `failed` or `external`) and `used`. `collectAssetReferences`
in `@maleo/shared` finds the references. `lib/asset-manifest.ts` resolves the
states with one import query and one registry query. Export preflight
(`lib/render-media-preflight.ts`) blocks on each used `pending` or `failed`
entry. A project outside the active workspace gets `404 project_not_found`.

## Verification

```bash
cd apps/api
bun run typecheck
bun run test       # Vitest suites; add a file path to run one
bun run test:bun   # suites that need the Bun runtime (*.bun.test.ts)
```
