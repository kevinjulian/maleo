// Creative style knobs + deterministic decision tables.
//
// This is the "decision layer" for the video pipeline: it turns abstract
// creative intent (a chosen style, a scene's emotion, a story context) into
// concrete renderer vocabulary (camera-movement labels, transition ids, music
// moods) that the existing Remotion pipeline in @maleo/video already
// understands. The renderer needs no changes — a blueprint is resolved into
// the same movement/transition/mood strings scenes already use.
//
// Consumed by:
//   - the Director agent (picks emotion/beat per scene, then resolves here)
//   - the blueprint -> render-storyboard builder (fills scene defaults)
import { z } from "zod";
import { oneOf } from "./one-of.ts";

// --- Renderer vocabulary (MUST match @maleo/video) ---
// Camera labels mirror UI_MOVEMENT_MAP keys in video/src/lib/motion-presets.ts.
export type CameraMove =
	| "Static"
	| "Slow Pan Left"
	| "Slow Pan Right"
	| "Slow Zoom In"
	| "Slow Zoom Out"
	| "Slight Push In"
	| "Slight Pull Out"
	| "Tilt Up"
	| "Tilt Down"
	| "Follow / Tracking"
	| "Orbit"
	| "Handheld"
	| "Glitch";

// Transition ids mirror TransitionId in video/src/lib/transitions.ts.
export type TransitionKind = "cut" | "fade" | "slide" | "zoom" | "wipe";

// Music moods mirror the musicMood enum in video/src/schema.ts.
export type MusicMood = "upbeat" | "chill" | "luxury" | "energetic" | "minimal";

// --- Creative intent vocabulary (single source of truth; Phase 3 schema
// fields will reference these unions) ---
// Exported as a runtime tuple, not only a type, so schemas that key on the whole
// vocabulary (blueprint beats, a template's per-emotion music map) enumerate it
// from here instead of restating the list.
/* The emotion vocabulary, and the only place it is defined.
 *
 * Everything downstream derives from this array rather than restating it: the
 * agent's output schema (z.enum), the agent's prompt and its JSON shape example,
 * the timeline template's per-emotion music cues, the picker in the web UI, and
 * the prompt that labels a music bed. Adding one here reaches all of them; there
 * is nowhere to forget.
 *
 * One copy exists outside this file, in the Pixabay capture extension, because a
 * browser extension cannot import from the workspace. A test there fails if the
 * two ever disagree.
 *
 * Order is part of the contract: the UI renders in this order, and beds are
 * scored against templates keyed by it. */
export const EMOTIONS = [
	"calm",
	"curiosity",
	"suspense",
	"tension",
	"shock",
	"sadness",
	"relief",
	"hope",
	"victory",
	"chaos",
] as const;

export type Emotion = (typeof EMOTIONS)[number];

export type StoryContext =
	| "same_location"
	| "continuation"
	| "time_skip"
	| "reveal"
	| "conflict"
	| "memory"
	| "ending";

/* The members as a value, so a boundary can CHECK a beat rather than assert one.
 * The union is derived from the array instead of the other way round, which is
 * what stops the two from disagreeing — see `EMOTIONS` above, and
 * `A Union Has One Declaration`.
 *
 * This list already existed as a file-local `StoryBeat[]` 240 lines below, for
 * the transition resolver: the same six members written out twice in one file,
 * with only the compiler's assignability check linking them. Now one list. */
export const STORY_BEATS = ["hook", "setup", "conflict", "twist", "resolution", "cta"] as const;

export type StoryBeat = (typeof STORY_BEATS)[number];

export type TextType =
	| "title"
	| "stat"
	| "quote"
	| "location"
	| "timeline"
	| "chapter"
	| "subtitle";

// --- Mapping tables (deterministic, cheap, no agent needed) ---

// Each emotion has a base camera move. Where the renderer lacks a literal
// match (no crane/punch-zoom), the nearest expressive preset is chosen.
const EMOTION_TO_CAMERA = {
	calm: "Static",
	curiosity: "Slow Zoom In",
	suspense: "Slight Push In",
	tension: "Slight Push In",
	shock: "Glitch",
	sadness: "Slow Zoom Out",
	relief: "Slight Pull Out",
	hope: "Tilt Up",
	victory: "Orbit",
	chaos: "Handheld",
} satisfies Record<Emotion, CameraMove>;

// Calmer alternative used when a preset asks for low camera intensity.
const CALM_CAMERA = {
	calm: "Static",
	curiosity: "Slow Zoom In",
	suspense: "Slow Zoom In",
	tension: "Slow Zoom In",
	shock: "Slow Zoom In",
	sadness: "Slow Zoom Out",
	relief: "Slow Zoom Out",
	hope: "Slow Zoom In",
	victory: "Slow Zoom In",
	chaos: "Slow Pan Right",
} satisfies Record<Emotion, CameraMove>;

// Story context -> the transition that reads correctly for it. Mapped onto the
// five transitions the renderer supports (no literal flash/blur/match-cut).
const CONTEXT_TO_TRANSITION = {
	same_location: "fade", // crossfade
	continuation: "cut",
	time_skip: "zoom", // flash-like jump
	reveal: "cut", // match cut -> hard cut
	conflict: "cut",
	memory: "fade", // blur dissolve -> fade
	ending: "fade", // fade to black
} satisfies Record<StoryContext, TransitionKind>;

// Default emotion for a story beat, when the Director hasn't set one.
const BEAT_TO_EMOTION = {
	hook: "curiosity",
	setup: "calm",
	conflict: "tension",
	twist: "shock",
	resolution: "relief",
	cta: "hope",
} satisfies Record<StoryBeat, Emotion>;

/**
 * Resolve a scene's emotion to a concrete camera move.
 * A preset with low cameraIntensity (< 0.35) softens energetic moves.
 */
export function cameraForEmotion(
	emotion: Emotion,
	style?: Pick<StyleKnobs, "cameraIntensity">,
): CameraMove {
	if (style && style.cameraIntensity < 0.35) return CALM_CAMERA[emotion];
	return EMOTION_TO_CAMERA[emotion];
}

/**
 * Resolve a story context to a transition.
 * High transitionIntensity (>= 0.7) promotes soft fades to a sharper cut so
 * fast-paced styles feel punchier; low intensity (< 0.3) softens cuts to fades.
 */
export function transitionForContext(
	context: StoryContext,
	style?: Pick<StyleKnobs, "transitionIntensity">,
): TransitionKind {
	const base = CONTEXT_TO_TRANSITION[context];
	if (!style) return base;
	if (style.transitionIntensity >= 0.7 && base === "fade") return "cut";
	if (style.transitionIntensity < 0.3 && base === "cut") return "fade";
	return base;
}

/** Default emotion for a beat, used when a scene leaves emotion unset. */
export function emotionForBeat(beat: StoryBeat): Emotion {
	return BEAT_TO_EMOTION[beat];
}

// --- Editing Rhythm Director ---
// Coarse felt-energy per emotion (0 = still, 1 = frantic). Drives cut snappiness
// and camera variety so the edit's rhythm follows the emotional arc.
const EMOTION_ENERGY = {
	calm: 0.15,
	sadness: 0.2,
	relief: 0.35,
	curiosity: 0.5,
	hope: 0.55,
	suspense: 0.8,
	tension: 0.8,
	victory: 0.75,
	shock: 1,
	chaos: 1,
} satisfies Record<Emotion, number>;

export function emotionEnergy(emotion: Emotion): number {
	return EMOTION_ENERGY[emotion];
}

/** Overlay entrance motions the renderer supports (infographics + layered visuals). */
export type OverlayMotion = "fade" | "slide_up" | "scale";

/**
 * Emotion-mapped entrance preset for overlays (infographics, callouts): calm
 * beats fade in, mid-energy beats rise, high-energy beats pop. Unknown/absent
 * emotion falls back to the neutral rise so wiring never has to special-case.
 */
export function overlayMotionForEmotion(emotion: string | undefined | null): OverlayMotion {
	// `EMOTION_ENERGY satisfies Record<Emotion, number>`, so `oneOf` against
	// `EMOTIONS` is exactly the membership test the `in` check was performing —
	// and it RETURNS the member, so the index needs no assertion.
	const key = oneOf(emotion, EMOTIONS);
	const energy = key ? EMOTION_ENERGY[key] : 0.5;
	if (energy >= 0.7) return "scale";
	if (energy < 0.4) return "fade";
	return "slide_up";
}

/**
 * Energy-aware transition: snap (hard cut) into a high-energy beat, dissolve
 * (fade) into a calm one, otherwise keep the context-chosen transition. This is
 * the rhythm layer on top of transitionForContext.
 */
export function rhythmTransition(base: TransitionKind, nextEmotion: Emotion): TransitionKind {
	const e = emotionEnergy(nextEmotion);
	if (e >= 0.8) return base === "fade" ? "cut" : base;
	if (e <= 0.25) return "fade";
	return base;
}

// Complementary camera move, used to break two identical moves in a row.
const CAMERA_COMPLEMENT: Partial<Record<CameraMove, CameraMove>> = {
	"Slow Zoom In": "Slight Push In",
	"Slight Push In": "Slow Zoom In",
	"Slow Zoom Out": "Slight Pull Out",
	"Slight Pull Out": "Slow Zoom Out",
	"Slow Pan Left": "Slow Pan Right",
	"Slow Pan Right": "Slow Pan Left",
};

/** Avoid two identical camera moves back-to-back — flip to a complement so the
 *  cut rhythm reads as deliberate motion, not a repeat. */
export function varyCamera(move: CameraMove, prevMove?: CameraMove): CameraMove {
	if (prevMove && move === prevMove && CAMERA_COMPLEMENT[move]) return CAMERA_COMPLEMENT[move]!;
	return move;
}

// The story context of the cut INTO `next` (from the previous beat). Drives which
// transition reads correctly at a scene boundary.
const BEAT_ARRIVAL_CONTEXT = {
	hook: "continuation",
	setup: "continuation",
	conflict: "conflict",
	twist: "reveal",
	resolution: "same_location",
	cta: "ending",
} satisfies Record<StoryBeat, StoryContext>;

/**
 * Resolve the story context of the boundary arriving at `next`, given the
 * previous beat. The first scene (no previous beat) is a plain continuation.
 * Same beat repeated reads as staying in place (same_location).
 */
export function contextForBeats(prev: StoryBeat | undefined, next: StoryBeat): StoryContext {
	if (!prev) return "continuation";
	if (prev === next) return "same_location";
	return BEAT_ARRIVAL_CONTEXT[next];
}

// --- Style knobs ---
//
// A style is a plain value object carried inside a content preset's bundle.
// There is no registry: nothing looks a style up by id, so an operator-authored
// knob set works exactly as well as a shipped one. Identity (id/name/
// description) lives on the ContentPreset row that owns the knobs, so there is
// one place a style is named.

/** A reusable image plate a transition motif draws from. */
export const stylePlateSchema = z
	.object({
		id: z.string().min(1),
		reusable: z.boolean().default(true),
		prompt: z.string().min(1),
	})
	.strict();

/** Recurring section-transition motif. Presets that leave this null get no
 *  section transitions; presets that set it get the motif, its reusable plates,
 *  and per-scene section transitions derived from each scene's visual type. */
export const styleTransitionSystemSchema = z
	.object({
		motif: z.string().min(1),
		plates: z.array(stylePlateSchema).default([]),
	})
	.strict();

export const styleKnobsSchema = z
	.object({
		pacing: z.enum(["slow", "medium", "fast"]),
		/** Typical seconds per scene; the Director uses this to size the timeline. */
		avgSceneDurationSec: z.number().positive().max(60),
		cameraIntensity: z.number().min(0).max(1),
		transitionIntensity: z.number().min(0).max(1),
		/** How much on-screen text/overlay. */
		textDensity: z.number().min(0).max(1),
		/** How many accent SFX hits. */
		sfxDensity: z.number().min(0).max(1),
		musicMood: z.enum(["upbeat", "chill", "luxury", "energetic", "minimal"]),
		/** Free-text hint for music generation/selection. */
		musicDescription: z.string(),
		/** Speech-rate multiplier (1 = normal). */
		voiceSpeed: z.number().min(0.5).max(2),
		/** Color-grading hint injected into image-gen prompts. */
		colorMood: z.string(),
		/** Section-transition motif; null when the style uses none. */
		transitionSystem: styleTransitionSystemSchema.nullish(),
	})
	.strict();

export type StylePlate = z.infer<typeof stylePlateSchema>;
export type StyleTransitionSystem = z.infer<typeof styleTransitionSystemSchema>;
export type StyleKnobs = z.infer<typeof styleKnobsSchema>;

// --- Auto transition resolver (any storyboard, not just blueprints) ---

// Positional beat fallback when a scene never declared one — mirrors the arc the
// Director would assign (open on a hook, close on a cta).
function inferBeatByPosition(i: number, total: number): StoryBeat {
	if (i <= 0) return "hook";
	if (i >= total - 1) return "cta";
	if (i === 1) return "setup";
	return "conflict";
}
const coerceBeat = (v: string | undefined, i: number, total: number): StoryBeat =>
	oneOf(v, STORY_BEATS) ?? inferBeatByPosition(i, total);
const coerceEmotion = (v: string | undefined, beat: StoryBeat): Emotion =>
	oneOf(v, EMOTIONS) ?? emotionForBeat(beat);

/**
 * Resolve each scene's OUTGOING transition (to the next scene) from its beat +
 * the next scene's emotion, using the same context/rhythm tables the blueprint
 * builder uses. Lets manually-added, story, and edited scenes get a varied,
 * intentional cut rhythm instead of a static default. The final scene returns
 * undefined (no scene follows it).
 */
export function autoTransitionForScenes(
	scenes: ReadonlyArray<{ beat?: string; emotion?: string }>,
	style?: StyleKnobs,
): (TransitionKind | undefined)[] {
	const total = scenes.length;
	return scenes.map((s, i) => {
		if (i >= total - 1) return undefined;
		const beat = coerceBeat(s.beat, i, total);
		const next = scenes[i + 1]!;
		const nextBeat = coerceBeat(next.beat, i + 1, total);
		const nextEmotion = coerceEmotion(next.emotion, nextBeat);
		return rhythmTransition(
			transitionForContext(contextForBeats(beat, nextBeat), style),
			nextEmotion,
		);
	});
}
