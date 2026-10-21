# Storyteller — long-format 16:9 video with free TTS

Renders ~6-minute YouTube (16:9) narrated stories from many short scenes
(multiple images + motion), with image–caption–audio sync and image reuse.

## Pieces

- **Preset** `storyboard-wide` (16:9), selected per project, which references
  the `storyteller` + `hook_writer` library skills.
- **Skill** `storyteller` (local `data/skills/storyteller.yaml`, VIDEO phase) —
  generates a storyboard of 70–110 short scenes (3–5s) so visuals never feel
  static; image reuse encouraged.
- **Composition** `StoryboardWide` (1920×1080) with motion presets (ken burns,
  zoom, pan) and transitions.
- **Render prep** `src/lib/prepare-storyboard.ts` — preps/reuses images (content-hash
  cache = instant reuse), synthesizes the voiceover, and aligns each scene's
  duration + caption words to the real audio. Runs automatically in the worker
  for any storyboard submitted without `voiceover.audioUrl`.

## Free TTS (Kokoro)

TTS provider is selected by env. Kokoro is self-hosted through the service image
in `infra/kokoro-tts` and exposes an OpenAI-compatible endpoint.

```bash
docker build -t maleo-kokoro infra/kokoro-tts
docker run --rm -p 8880:8880 maleo-kokoro
```

Then point the video service at it:

```bash
export MALEO_KOKORO_URL=http://127.0.0.1:8880
# optional: export MALEO_KOKORO_VOICE=af_heart
# optional: export MALEO_TTS_PROVIDER=kokoro
```

`MALEO_TTS_PROVIDER=elevenlabs` (or just having `ELEVENLABS_API_KEY` and no
Kokoro URL) keeps the paid path. WAV duration is read from the file header,
so caption/audio sync tracks the true audio length.

## Render a storyboard directly

```bash
curl -X POST "$MALEO_VIDEO_URL/render" \
  -H 'content-type: application/json' \
  -d '{ "preset": "storyboard-wide", "storyboard": { "scenes": [
    {"image":"<url>","voiceover":"Pada suatu hari...","movement":"Slow Zoom In","transition":"fade"},
    {"image":"<url>","voiceover":"...","movement":"Ken Burns","transition":"cut"}
  ] } }'
```

The worker auto-preps (images + TTS + caption sync) then renders 16:9 MP4.

## Notes

- Per-scene image generation is now wired: when a scene carries a `visual`
  description, the core storyteller path leaves its `image` empty so the worker
  generates one via `maleo-image` (cached by visual). Scenes without a `visual`
  still fall back to cycling the draft's image pool. Set `MALEO_IMAGE_URL` to
  enable real generation; otherwise a deterministic placeholder is rendered.
- Async render: set `MALEO_VIDEO_ASYNC=1` so the publish path submits the job
  and returns immediately (draft marked `rendering`); the reconciler
  (`video-reconciler.ts`) persists the finished artifact and resumes publishing.
  Default is the synchronous poll-to-completion path.
- A full 6-min render requires the Kokoro server running + scene images +
  Remotion; verify locally before relying on the autonomous path.
