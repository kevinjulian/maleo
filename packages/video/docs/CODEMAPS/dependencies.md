<!-- Generated: 2026-05-13 | Files scanned: package.json + .env.example | Token estimate: ~400 -->

# Dependencies

## Runtime

| Package                                                                                     | Purpose                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `remotion` + `@remotion/{bundler,renderer,cli,media-utils,shapes,transitions,google-fonts}` | Video composition + render                             |
| `@remotion/lambda`                                                                          | Cloud render on AWS                                    |
| `react` / `react-dom` 19                                                                    | JSX for compositions                                   |
| `hono` 4                                                                                    | HTTP framework on `Bun.serve`                          |
| `zod`                                                                                       | Schema validation at boundaries                        |
| `sharp`                                                                                     | Image resize / format conversion (`lib/image-prep.ts`) |
| `bun:sqlite` (built-in)                                                                     | Job queue                                              |

## Dev

`typescript` 5.6 · `bun-types` · `@types/react{,-dom}` 19.

## External services

| Service         | Used by                               | Env                                         |
| --------------- | ------------------------------------- | ------------------------------------------- |
| ElevenLabs      | `src/lib/tts.ts` (voiceover synth)    | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` |
| OpenAI Whisper  | `src/lib/transcribe.ts` (word timing) | `OPENAI_API_KEY`                            |
| remove.bg       | `src/lib/image-prep.ts` (bg removal)  | `REMOVE_BG_API_KEY`                         |
| AWS Lambda + S3 | `@remotion/lambda`                    | `AWS_*`, `REMOTION_LAMBDA_*`                |

## Sibling repos

| Repo               | Coupling                                          |
| ------------------ | ------------------------------------------------- |
| `maleo-dashboard`  | HTTP client of this API (via `MALEO_VIDEO_TOKEN`) |
| `maleo-chrome-ext` | Same — bearer-auth client                         |

## System

- `ffmpeg` on PATH (Remotion renderer hard requirement).
- Bun ≥ 1.1 (uses `bun:sqlite`, `Bun.serve`, `Bun.file`).
