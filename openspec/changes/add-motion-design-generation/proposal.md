# Proposal

## Why

Generation produces images and voiceover, but every on-screen headline,
explainer and transition beat becomes one static plain-text overlay. Motion
design (typography, shapes and UI-like states that move with intent) is the
strongest part of recent code-drawn video work, and maleo already owns
everything it needs to render it: the plain-text and shape primitives, keyframe
tracks, the one-clip `motion-comp` composition, and
parity between Remotion and the Rust renderer. What is missing is a producer.

The published workflows also show why one-prompt motion looks generic: the
model fills every undecided motion choice with the same defaults. The fix is to
let the model decide content and intent only, and to put timing, easing, stagger
and spring behaviour in deterministic code.

## What Changes

- A model call authors a **motion intent** for one moment: layers built from
  the retained primitives (plain text, Rectangle, Circle, Triangle, Star,
  Cross), each with a role (`hero`, `secondary`, `ambient`) and an object class,
  plus an ordered list of states with the layer values at each state.
- A pure **motion compiler** turns a validated intent into a composition
  (`compositionConfigSchema`, schema version 1) whose layers carry keyframe
  tracks in the normalized form saved motion definitions use. It applies one set of
  motion tokens:
  closed-form springs sampled into keys, one hero move per state change,
  secondary moves delayed and shortened relative to the hero, bounded ambient
  motion, exits shorter than entrances, containers before their text, and
  offset leading and trailing edges for stretching shapes.
- A pure **motion lint** reports findings on the compiled result: more than one
  hero moving at once, text moving while it must be read, simultaneous entrance
  of every layer, exits longer than entrances, and layers outside the frame at
  rest.
- **Story generation** places a motion composition for each `headline`,
  `explainer` and `transition` beat that has on-screen text, in place of the
  plain-text overlay. When authoring, validation or compilation fails, that beat
  falls back to today's plain-text overlay and the run continues.
- **Chat** gains an `add_motion_design` tool that authors, compiles and places
  one motion composition at a requested time, through editor commands, so the
  result is one undo step.
- No change to the timeline document schema, the animation property registry,
  the easing set, `maleo-editor-core`, the Rust renderer or Remotion.

## Capabilities

### New Capabilities

- `motion-design-generation`: motion intent authoring, deterministic
  compilation to a primitive composition, motion lint, story-generation
  placement with plain-text fallback, and the chat tool.

### Modified Capabilities

- `visual-templates`: generation may emit a composition of retained primitives
  for on-screen text beats instead of plain text only; generated compositions
  are project clips, not saved library definitions.

## Impact

- `packages/shared/src/`: new motion tokens, spring sampling, intent schema,
  compiler and lint (pure, with tests).
- `apps/api/src/lib/`: one prompt template and one model call for motion
  intent, following the story-bible pattern (`runPrompt`, schema parse, test
  override).
- `apps/api/src/modules/agents/core/services/section-motion.ts` (new) and
  `services/story-assets.ts`: beat placement and fallback.
- `apps/api/src/modules/agents/core/tools/overlay/`: the `add_motion_design`
  tool, registered with the other overlay tools and exposed over MCP.
- Text-model spend rises by one call per eligible beat; metering follows the
  existing text-call path.
- Docs: `docs/CODEMAPS/pipeline-layers.md` (generated visual primitives),
  `apps/api/docs/agent-pipeline.md`, and a `CHANGELOG.md` entry.
