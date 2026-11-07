# Environment Variables

Generated from `.env.example`. Bun auto-loads `.env` — no dotenv needed.

<!-- AUTO-GENERATED:env -->

## API server

| Variable                   | Required | Description                                                                          | Example                 |
| -------------------------- | -------- | ------------------------------------------------------------------------------------ | ----------------------- |
| `MALEO_VIDEO_TOKEN`        | Yes      | Bearer token enforced by `src/auth.ts`. Server refuses to boot if unset/`change-me`. | `s3cret-rotate-me`      |
| `MALEO_VIDEO_PORT`         | No       | HTTP port (default `8091`).                                                          | `8091`                  |
| `MALEO_VIDEO_CORS_ORIGINS` | No       | Comma-separated allowlist. CORS off if empty.                                        | `http://localhost:8090` |
| `MALEO_VIDEO_DB`           | No       | SQLite path for job queue.                                                           | `data/jobs.db`          |
| `MALEO_EXPORT_RENDERER`    | No       | Export authority: `remotion` (default) or `rust` (p2-export E8).                     | `remotion`              |
| `MALEO_EXPORT_SHADOW`      | No       | `off` turns shadow comparison runs off; any other value runs them.                   | `on`                    |
| `MALEO_RENDER_HOST`        | No       | Rust render host binary (default `maleo-render` on `PATH`).                          | `maleo-render`          |

## TTS

| Variable              | Required        | Description                             | Example                |
| --------------------- | --------------- | --------------------------------------- | ---------------------- |
| `ELEVENLABS_API_KEY`  | If `--tts=true` | ElevenLabs API key for voiceover synth. | `sk_...`               |
| `ELEVENLABS_VOICE_ID` | No              | Voice ID (default Rachel).              | `21m00Tcm4TlvDq8ikWAM` |

## Captions

| Variable         | Required                      | Description                            |
| ---------------- | ----------------------------- | -------------------------------------- |
| `OPENAI_API_KEY` | If word-level captions wanted | Whisper transcription for word timing. |

## Image prep

| Variable            | Required | Description                                               |
| ------------------- | -------- | --------------------------------------------------------- |
| `REMOVE_BG_API_KEY` | No       | remove.bg API key — enables background removal in `prep`. |

## Remotion Lambda

Auto-filled by `bun run lambda:deploy`.

| Variable                    | Required | Description                       |
| --------------------------- | -------- | --------------------------------- |
| `REMOTION_AWS_REGION`       | Lambda   | AWS region (default `us-east-1`). |
| `REMOTION_LAMBDA_FUNCTION`  | Lambda   | Deployed function name.           |
| `REMOTION_LAMBDA_SERVE_URL` | Lambda   | S3 serve URL of bundled site.     |
| `AWS_ACCESS_KEY_ID`         | Lambda   | AWS credential.                   |
| `AWS_SECRET_ACCESS_KEY`     | Lambda   | AWS credential.                   |

<!-- /AUTO-GENERATED:env -->

## Production Compose

Core Compose sets `MALEO_VIDEO_URL=http://render-worker:8091` on API and
requires matching `MALEO_VIDEO_TOKEN` on API and worker. Worker receives
`MALEO_API_URL=http://api:8090`, shared `MALEO_SERVICE_TOKEN`, and existing
S3 settings. `MALEO_VIDEO_PUBLIC_BASE=http://127.0.0.1:8091/public` serves
materialized inputs to its own render browser. `MALEO_VIDEO_CONCURRENCY=1`
keeps one job active. See root [self-hosting guide](../../../docs/self-hosting.md#video-export)
for mounts, resource limits, rollout and backup.

## Rotation

Treat `MALEO_VIDEO_TOKEN` and AWS keys as production secrets. Rotate via env injection on the host — never commit `.env`.
