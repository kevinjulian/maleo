<!-- Generated: 2026-05-13 | Files scanned: 26 src + 5 scripts | Token estimate: ~650 -->

# Architecture

Single-repo Bun + Remotion service. Two execution surfaces:

1. **Remotion compositions** (React) — declarative video timeline.
2. **Hono HTTP API + SQLite worker** — queue + render jobs.

## Data flow

```
operator-authored inputs/*.json ──► scripts/prep.ts ──► (TTS, captions, image cache)
        │
        ├──► scripts/render-all.ts ──► Remotion renderer ──► out/*.mp4
        │
        └──► POST /render ──► render_jobs (SQLite) ──► worker.tick
                                                          │
                                          local: @remotion/renderer
                                          lambda: @remotion/lambda
                                                          │
                                                          ▼
                                                       out/*.mp4
```

## Surfaces

| Surface     | Entry                              | Purpose                          |
| ----------- | ---------------------------------- | -------------------------------- |
| Studio      | `bun run dev` → `src/Root.tsx`     | Live Remotion preview            |
| API         | `apps/render-worker/src/index.ts`  | Job submit + status + file fetch |
| Worker      | `apps/render-worker/src/worker.ts` | Polls queue, drives renderer     |
| CLI scripts | `scripts/*.ts`                     | Prep, batch, Lambda              |

## Compositions

`src/Root.tsx` registers 3 sizes; all share `productSchema`:

- `ProductReel` 1080×1920 (vertical)
- `ProductSquare` 1080×1080
- `ProductWide` 1920×1080

`ProductReel` routes by `product.templateId` → classic / split-screen / before-after / testimonial.

## Key boundaries

- **Schema** (`src/schema.ts`) — single Zod source of truth at HTTP boundary and Remotion props.
- **Presets** (`src/lib/presets.ts`) — platform → composition + codec/bitrate.
- **Worker** owns Remotion bundle cache (`cachedServeUrl`) — one bundle per process.
