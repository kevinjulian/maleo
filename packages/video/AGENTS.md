# @maleo/video — agent instructions

Remotion-based product video generator. Turns product images and metadata into ready-to-post videos for TikTok, Reels, and Shorts.

## Running

```bash
bun run video
```

Video scripts load the repo-root `.env` with `--env-file ../../.env`. Do not
add `packages/video/.env`.

## Architecture

```text
src/
  Root.tsx            Remotion root
  compositions/       video composition entrypoints
  scenes/             reusable scene blocks
  components/         lower-level visual building blocks
  lib/                presets, storyboard prep, TTS/music helpers
scripts/              ingest, prep, render-all, proof scripts
public/               images, scene assets, voiceover
inputs/               source assets
out/                  render output
```

## Boundaries

- Composition/schema/runtime prep lives in `src/`; CLI/render orchestration lives in scripts or Remotion entrypoints.
- TTS integration uses Kokoro through `MALEO_KOKORO_URL` when configured; keep transport logic out of scene components.
- Caption rendering is part of the Remotion storyboard contract: keep `src/schema.ts`, dashboard caption menu props, and `src/components/Captions.tsx` aligned. Caption chunks must optimize reading comfort, not only timing: respect max words/chars, pause/punctuation splits, active-word emphasis, width, motion, and shadow readability controls. Prefer official Remotion helpers where they fit, but preserve WYSIWYG parity with dashboard props.
- Infographic rendering is part of the Remotion storyboard contract: keep `src/schema.ts`, `src/components/InfographicRenderer.tsx`, dashboard `InfographicOverlay` payloads, and `buildRenderStoryboard` aligned. AI/director output must stay structured JSON (stat reveal, bar chart, table build), never generated JSX.
- Infographic clip styling may arrive per clip (`block.style`) and should merge
  over storyboard-level `infographicStyle`; storyboard style is fallback, not a
  forced override for customized clips.
- Storyboard `bgColor` may be either a CSS color or CSS gradient supplied by the dashboard Style rail; scene components must apply it as a background value and avoid nesting gradient strings inside another gradient.
- Remotion clips must use frame-derived animation (`useCurrentFrame`, `interpolate`, `Sequence` timing). Do not use CSS transitions/keyframes in rendered video components, and prefer individual transform props (`scale`, `translate`, `rotate`) over composed `transform` strings so Remotion Studio/render stays deterministic.
- Explainer scene metadata (`scene.explainer`) is part of the Remotion
  storyboard contract for animated essay styles, including validated
  `sourceEvidence` when factual beats carry evidence. It is provenance only:
  Remotion scenes must not render extra visible text from `explainer` fields
  (`onScreenText`, `claim`, `question`, `evidence`, `analogy`) or
  `sectionTransition.text`; dashboard persistence must convert that text into
  normal timeline text clips first. Keep `src/schema.ts`,
  `src/scenes/StoryboardScene.tsx`, and dashboard `buildRenderStoryboard`
  aligned when adding visual types or clip treatments.
- Generated assets in `out/` and prepared media in `public/voiceover` are runtime artifacts, not source of truth.
- Storyboard image preparation preserves source dimensions and transparency.
  Clip layout owns crop and fit in both preview and export. Keep its lossless
  source cache separate from product-image crops.
- Storyboards with absolute scene starts have authored timing. Preparation must
  preserve scene boundaries and existing audio instead of rescaling scenes or
  generating replacement narration. Include gaps and trailing overlays in duration.
- Storyboard audio mix gives dialogue priority without changing clip timing:
  music, ambient, SFX, and accent hits duck by kind under active voiceover;
  voiceover remains at user gain. Do not add SFX scheduling cooldown.
- A single scene visual is the scene plate: if voiceover regeneration or
  semantic pauses make the scene duration longer than that visual clip's stored
  duration, Remotion must hold the visual through the full scene instead of
  rendering black. Multi-visual beats keep their explicit per-visual timing.
- Before Remotion starts, `validateRenderStoryboard` must reject unresolved
  scene/overlay/audio media, invalid timing, and fully off-canvas/zero-size
  layouts. Keep this validation on the post-preparation storyboard so raw inputs
  may still generate their missing media first.
- Motion Studio text overlay animation is renderer contract, not dashboard-only
  metadata. Keep `src/schema.ts`, `src/lib/motion-keyframes.ts`, and text
  overlay composition paths aligned for numeric tracks: `x`, `y`, `width`,
  `height`, `scale`, `rotate`, `opacity`, `blur`, `bgOpacity`, `fontSize`,
  `letterSpacing`, and `lineHeight`; and color tracks: `fill`, `bodyFill`,
  `accent`, and `background`. Explicit blank structured text params are valid
  user edits and must render blank; only missing params may fall back to template
  defaults or legacy `content` lines.

## Verification

```bash
bunx vp check packages/video
bun run --cwd packages/video typecheck
```

For behavior changes, also run the Studio or the render server
(`apps/render-worker`, `bun run render-worker` from the repo root):

```bash
bun run dev
```

## Directory map

- `src/` — compositions, scenes, components, libs, and `paths.ts` (where this
  package lives, for the render server's bundler).
- `scripts/` — ingest, prep, batch render and proof scripts. The render server
  and its Lambda scripts live in `apps/render-worker`.
- `tests/` — package verification surface.
- `inputs/`, `public/`, `out/` — sample inputs and generated artifacts for the
  Studio and batch CLI.
