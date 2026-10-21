<!-- Generated: 2026-05-13 | Files scanned: src/schema.ts + apps/render-worker/src/db.ts | Token estimate: ~450 -->

# Data

Two data shapes: **Product** (Zod-validated job payload) and **render_jobs** (SQLite queue).

## Product schema (`src/schema.ts`)

```
Product {
  brand              string = "Maleo"
  title              string (required)
  subtitle?          string
  price?             string
  currency           string = "IDR"
  bullets            string[] ≤ 5
  cta                string = "Shop now"
  images             string[] ≥ 1  (required)
  accentColor        string = "#FF3E6C"
  bgColor            string = "#0B0B0F"
  fgColor            string = "#FFFFFF"
  musicUrl?          string
  musicMood          "upbeat"|"chill"|"luxury"|"energetic"|"minimal" = "upbeat"
  voiceover?         Voiceover
  templateId         "classic"|"split-screen"|"before-after"|"testimonial" = "classic"
}

Voiceover {
  text       string
  audioUrl?  string
  startSec   number = 0
  endSec?    number
  words      CaptionWord[] = []
}

CaptionWord { text, startSec, endSec }
```

`aspectMap`: vertical 1080×1920 · square 1080×1080 · horizontal 1920×1080.

## SQLite `render_jobs` (`apps/render-worker/src/db.ts`)

```
render_jobs
├── id            TEXT PK (uuid)
├── product_json  TEXT  (serialized Product)
├── preset        TEXT  (tiktok|reels|shorts|ig-feed|yt-long)
├── status        TEXT  queued|running|done|error
├── output_path   TEXT?
├── error         TEXT?
├── cost_usd      REAL?  (lambda only)
├── progress      REAL = 0
├── backend       TEXT  local|lambda
├── created_at    INT
├── started_at    INT?
└── finished_at   INT?

INDEX idx_jobs_status (status, created_at)
PRAGMA journal_mode = WAL
```

## External data sources

- `public/music/<mood>/*.{mp3,wav}` — selected by `musicMood`.
- `inputs/*.json` — product job files (matches `productSchema`).
- `out/*.mp4` — rendered videos.

## Migrations

None. Schema created idempotently in `db.ts` (`CREATE TABLE IF NOT EXISTS`). Add a `migrations/` dir before mutating columns in prod.
