# @maleo/video

Programmatic product video generator built on Remotion + Bun. Turns product images + metadata into ready-to-post videos for TikTok / Reels / Shorts / YouTube.

## Install

```bash
bun install            # from the repository root
```

Configuration comes from the root `.env`; there is no package-local one. See the
root [`.env.example`](../../.env.example) for the variables this package reads.

## Dev (Remotion Studio)

```bash
bun run dev
```

Live preview. Edit `inputs/*.json` or `src/lib/sample.ts`.

## Pipeline

```bash
# 1. Optional: prep operator-authored inputs (local image cache, TTS, captions)
bun run prep --aspect=vertical --tts=true

# 2. Render all inputs across all platform presets
bun run render:all --presets=tiktok,reels,shorts,ig-feed,yt-long
```

Outputs land in `out/`.

## Templates

Set `templateId` in product JSON:

| ID             | Layout                     |
| -------------- | -------------------------- |
| `classic`      | Hook → bullets → CTA       |
| `split-screen` | Top/bottom comparison      |
| `before-after` | Horizontal wipe reveal     |
| `testimonial`  | Quote overlay on hero shot |

## Platform presets

| Preset    | Aspect | Bitrate | Max len |
| --------- | ------ | ------- | ------- |
| `tiktok`  | 9:16   | 6M      | 60s     |
| `reels`   | 9:16   | 8M      | 90s     |
| `shorts`  | 9:16   | 8M      | 60s     |
| `ig-feed` | 1:1    | 6M      | 60s     |
| `yt-long` | 16:9   | 12M     | 600s    |

## TTS + captions

Add `voiceover` block to input JSON:

```json
{
	"voiceover": {
		"text": "Glass skin in 7 days, no filter needed.",
		"startSec": 0
	}
}
```

Then `bun run prep --tts=true` generates audio (ElevenLabs) + word-level captions (Whisper). Captions burn-in automatically. Music auto-ducks under voiceover.

## Music

Set `musicMood` (`upbeat` | `chill` | `luxury` | `energetic` | `minimal`). Drop tracks into `public/music/` matching the mood. Volume auto-ducks during voiceover.

## Cloud rendering (Remotion Lambda)

The Lambda deploy and render scripts live with the render server in
`apps/render-worker` (see `apps/render-worker/docs/RUNBOOK.md`):

```bash
cd apps/render-worker
bun run lambda:deploy                                    # one-time setup
bun run lambda:render --input=../../packages/video/inputs/example.json --preset=tiktok
```

Parallel chunked rendering, cost per video reported.

## Schema

See `src/schema.ts`. Zod-validated.

## Project structure

```
src/
  components/  KenBurnsImage, AnimatedText, PriceTag, Captions
  scenes/      Hook, Feature, CTA, SplitScreen, BeforeAfter, Testimonial
  compositions/ ProductReel (router) / ProductSquare / ProductWide
  lib/         presets, music ducking, tts, transcribe, image-prep
scripts/
  prep.ts            local image cache + TTS + captions
  render-all.ts      batch render every input × preset
  deploy-lambda.ts   one-time AWS setup
  render-lambda.ts   single render via Lambda
```
