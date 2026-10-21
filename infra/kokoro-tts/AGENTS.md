# infra/kokoro-tts — agent instructions

## Purpose

This directory deploys the **Kokoro-82M TTS server**: the upstream
`kokoro-fastapi` CPU image, pinned, serving an OpenAI-compatible
`POST /v1/audio/speech` and a `GET /v1/audio/voices` on port 8880.

It holds a `Dockerfile`, a `.dockerignore`, and this file — nothing else. There
is no TypeScript here and none belongs here: the client that calls this service
lives at `packages/media/src/providers/kokoro/`, with every other media
provider, and `MALEO_KOKORO_URL` is the only wiring between the two.

There is no build-time model warm. The upstream
image bakes the weights, the voice pack, and the UniDic dictionary Japanese
needs, so a cold start pays no download.

## THIS DIRECTORY'S PATH IS PRODUCTION CONFIGURATION

Coolify builds this service straight from this path. The settings live in
Coolify's database, **not in this repository**, so nothing here — no typecheck,
no test, no CI gate — can catch a change that breaks them.

| setting               | value                                                |
| --------------------- | ---------------------------------------------------- |
| app                   | `<deployment-app-id>` (`https://kokoro.example.com`) |
| project / environment | deployment-defined                                   |
| `base_directory`      | `/infra/kokoro-tts`                                  |
| `dockerfile_location` | `/Dockerfile`, relative to the base directory        |
| `ports_exposes`       | `8880`                                               |
| `watch_paths`         | `infra/kokoro-tts/**`                                |
| auto-deploy           | **enabled**                                          |
| healthcheck           | `GET /health` on `:8880`                             |

**Do not move, rename, or delete this directory without updating
`base_directory` and `watch_paths` first.** Auto-deploy is on: a push that
relocates these files while Coolify still points here builds against a path that
no longer exists. Update Coolify _before_ the push — the reverse order
guarantees one failed build.

Coolify keeps the previous image, so the rollback for a failed build is
redeploying the last good deployment while the path is corrected.

## Local Contracts

- **The base image tag is pinned and that pin is load-bearing.** `latest` on a
  third-party image plus auto-deploy means an upstream change can swap the model
  or the voice list on a rebuild triggered by an unrelated push. Moving the pin
  is a deploy decision, not a version bump, and
  `packages/media/src/providers/kokoro/voices.live.test.ts` is what catches a
  voice list that moved with it.
- **The image is the deployment artifact.** Changing the `Dockerfile` changes
  what runs in production; treat it as a deploy, not a refactor.
- `wget` is installed on purpose. The upstream runtime stage ships `curl` but not
  `wget`, and Coolify's generated healthcheck shells out to `wget`. The install
  needs `USER root` and **must** switch back to `appuser` — dropping that line
  runs the server as root.
- Port, healthcheck path, and exposed interface are contract: the client and the
  Coolify healthcheck both assume `:8880` and `GET /health`. The upstream
  entrypoint binds `0.0.0.0:8880` itself, which is why this `Dockerfile` states
  no `CMD`.
- `.dockerignore` excludes source and TypeScript config on purpose. The build
  needs neither, and pulling them in would rebuild the image on unrelated edits.

## Verification

Repository gates cannot see this service. After any change here, or to this
directory's path, confirm the deploy itself:

- the Coolify app rebuilds and reports `running:healthy`
- configured service `/health` responds
- `GET /v1/audio/voices` returns the full voice list, and it still matches the
  static catalogue in `packages/media/src/providers/kokoro/voices.ts`
- a real TTS generation returns audio — synthesis resolves `provider_id: kokoro`
  and returns a playable clip
