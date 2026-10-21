<!-- Generated: 2026-05-13 | Files scanned: 14 (React tree) | Token estimate: ~600 -->

# Frontend (Remotion compositions)

React 19. Entry `src/index.ts` → `src/Root.tsx` registers 3 compositions; `ProductReel` is the template router.

## Composition tree

```
Root
├── ProductReel  (1080×1920, 30fps, 18s)  ──┐
├── ProductSquare (1080×1080)                ├── share productSchema
└── ProductWide  (1920×1080)                 ┘
```

`ProductSquare` / `ProductWide` are thin wrappers (4 LOC each) reusing reel scenes.

## Template router (`ProductReel`)

```
templateId
├── classic       → Hook → Feature → CTA
├── split-screen  → SplitScreen → CTA
├── before-after  → BeforeAfter → CTA
└── testimonial   → Testimonial → Feature → CTA
```

Transitions: `@remotion/transitions` fade, 12-frame linear.

Overlays (always-on):

- `<Captions>` if `voiceover.words` present
- `<Audio>` voiceover at `voiceover.startSec`
- `<MusicTrack>` ducked via `duckEnvelope` from `lib/music.ts`

## Scenes (`src/scenes/`)

| Scene              | Lines | Used by templates    |
| ------------------ | ----- | -------------------- |
| `HookScene`        | 36    | classic              |
| `FeatureScene`     | 51    | classic, testimonial |
| `CTAScene`         | 46    | all                  |
| `SplitScreenScene` | 51    | split-screen         |
| `BeforeAfterScene` | 50    | before-after         |
| `TestimonialScene` | 48    | testimonial          |

## Reusable components (`src/components/`)

| Component       | Role                                           |
| --------------- | ---------------------------------------------- |
| `KenBurnsImage` | Slow pan/zoom on product image                 |
| `AnimatedText`  | Spring-in word/letter animation                |
| `PriceTag`      | Currency-formatted price badge                 |
| `Captions`      | Word-level burn-in synced to `voiceover.words` |

## State

No external store. Props flow Root → Composition → Scene → Component. Animation driven by `useCurrentFrame()` + `useVideoConfig()`.
