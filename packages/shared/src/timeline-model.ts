import { VISUAL_PRIMITIVE_IDS } from "./visual-primitives.ts";
/* Canonical timeline domain model (shared source of truth).
 *
 * The video editor (dashboard) and the Remotion render worker (packages/video)
 * both read these types. They were extracted from the dashboard's create-content
 * data module so the render projection can run server-side against the persisted
 * clip document without the dashboard's editor-only, React-bound modules.
 *
 * Editor-only concerns (icons/JSX metadata, DnD mimes, picker defaults) stay in
 * the dashboard; only the render/persistence-relevant shape lives here.
 */
import type { Emotion, StoryBeat, StyleKnobs } from "./video-style.ts";
import type { ExplainerVisualType, SceneInformation } from "./video-blueprint.ts";
import type { MotionEasing } from "./motion-preset.ts";
import type { KeyframeEasing } from "./animation-properties.ts";
import type { ReferenceUse } from "./generation-cast.ts";
import type { SourceAudioSettings } from "./processed-audio.ts";
import type { ReverseMedia } from "./reverse-media.ts";
import type { ClipCompositing } from "./clip-compositing.ts";
import type { ClipAnimation, AudioAnimation } from "./clip-animation.ts";

export type { MotionEasing } from "./motion-preset.ts";

export type ContentType = "video" | "image" | "text";

/* ── Clip layout / text style (canvas placement, percent-of-canvas) ── */

// A clip's placement/transform on the canvas. All spatial values are PERCENT of
// the canvas (0-100) so they're resolution-independent and map 1:1 to the render.
export interface SourceAudioExtraction {
	audioClipId: string;
	priorVolume?: number;
	/** Empty captures an absent gain track; legacy links omit this field. */
	priorGainKeys?: AudioAnimation["tracks"]["volume"];
	priorAudio?: Pick<SourceAudioSettings, "preservePitch" | "audioMedia">;
	/** Original mapping is retained while the detached file samples forward at 1x. */
	source: {
		url: string;
		startSec: number;
		durationSec: number;
		playbackRate: number;
		preservePitch: boolean;
		reverse: boolean;
	};
	audioSnapshot: AudioOverlay;
}

export interface ClipLayout extends SourceAudioSettings, ClipCompositing {
	animation?: ClipAnimation;
	sourceAudioExtraction?: SourceAudioExtraction;
	xPct: number;
	yPct: number;
	widthPct: number;
	heightPct?: number;
	fit: "contain" | "cover" | "stretch";
	rotationDeg?: number;
	/** Resize the destination box proportionally; absent in legacy projects. */
	aspectLocked?: boolean;
	opacity?: number;
	crop?: { xPct: number; yPct: number; widthPct: number; heightPct: number };
	flipX?: boolean;
	flipY?: boolean;
	reverseMedia?: ReverseMedia;
}

/** What a clip's canvas box is when nothing has placed it — the box the editor
 *  fills a partial layout from, and the agent too, so both write the same box. */
export type ClipKind = "scene" | "image" | "video" | "text";
export function defaultClipLayout(kind: ClipKind): ClipLayout {
	// heightPct kept so a selected text/motion clip draws a grabbable box (not a
	// zero-height line). Motion templates override this with a full-frame layout.
	if (kind === "text")
		return { xPct: 8, yPct: 64, widthPct: 84, heightPct: 22, fit: "contain", opacity: 1 };
	// Base scene + media overlays default to full-frame.
	return {
		xPct: 0,
		yPct: 0,
		widthPct: 100,
		heightPct: 100,
		fit: kind === "scene" ? "cover" : "contain",
		opacity: 1,
	};
}

export interface ClipTextStyle {
	fontFamily: string;
	fontSize: number;
	weight: number;
	fill: string;
	background?: string;
	accent?: string;
	bodyFill?: string;
	bgOpacity?: number;
	scale?: number;
	align: "left" | "center" | "right";
	casing?: "none" | "upper";
	lineHeight?: number;
	letterSpacing?: number;
}

/* ── Audio overlay taxonomy ── */

export const AUDIO_OVERLAY_KINDS = ["voiceover", "music", "sfx", "ambient", "accent_hit"] as const;
export type AudioOverlayKind = (typeof AUDIO_OVERLAY_KINDS)[number];
export const AUDIO_ORIGINS = ["tts", "stock", "upload", "recorded", "generated"] as const;
export type AudioOrigin = (typeof AUDIO_ORIGINS)[number];

/* ── Motion / animation ── */

export interface MotionKeyframe {
	t: number;
	scale: number;
	x: number;
	y: number;
	rotate?: number;
	easing?: MotionEasing;
}
export interface CustomMotion {
	keyframes: MotionKeyframe[];
}

export const VISUAL_REVEAL_TYPES = ["fade", "wipe", "spotlight", "sketch_draw"] as const;
export type VisualRevealType = (typeof VISUAL_REVEAL_TYPES)[number];
export const VISUAL_REVEAL_DIRECTIONS = [
	"left",
	"right",
	"top",
	"bottom",
	"top_left_to_bottom_right",
	"draw_top_left_to_bottom_right",
	"center",
] as const;
export type VisualRevealDirection = (typeof VISUAL_REVEAL_DIRECTIONS)[number];
export const VISUAL_REVEAL_BLACK_DIRECTIONS = ["none", "left", "right", "top", "bottom"] as const;
export type VisualRevealBlackDirection = (typeof VISUAL_REVEAL_BLACK_DIRECTIONS)[number];
export const VISUAL_REVEAL_PHASES = ["dark_pixels_first", "black_then_color", "direct"] as const;
export type VisualRevealPhase = (typeof VISUAL_REVEAL_PHASES)[number];
export const VISUAL_REVEAL_TEXTURES = ["clean", "paper", "ink", "dust", "glitch"] as const;
export type VisualRevealTexture = (typeof VISUAL_REVEAL_TEXTURES)[number];
export const VISUAL_REVEAL_COLOR_BUILDS = ["none", "muted_to_full"] as const;
export type VisualRevealColorBuild = (typeof VISUAL_REVEAL_COLOR_BUILDS)[number];
export interface VisualRevealEffect {
	type: VisualRevealType;
	direction?: VisualRevealDirection;
	blackDirection?: VisualRevealBlackDirection;
	phase?: VisualRevealPhase;
	texture?: VisualRevealTexture;
	colorBuild?: VisualRevealColorBuild;
	/** Undefined means Auto: resolve to the current clip duration at render time. */
	durationSec?: number;
	delaySec?: number;
	intensity?: number;
}
export interface ValueKeyframe {
	t: number;
	v: number;
	easing?: KeyframeEasing;
	/** Retained part of an original easing segment after a reversible cut. */
	easingRange?: [number, number];
}
export type AnimatableProp =
	| "x"
	| "y"
	| "scale"
	| "rotate"
	| "opacity"
	| "width"
	| "height"
	| "blur"
	| "bgOpacity"
	| "fontSize"
	| "letterSpacing"
	| "lineHeight";
export interface ColorKeyframe {
	t: number;
	v: string;
	easing?: KeyframeEasing;
	/** Retained part of an original easing segment after a reversible cut. */
	easingRange?: [number, number];
}
export type ColorAnimatableProp = "fill" | "bodyFill" | "accent" | "background";
/** A layer of a reusable composition clip (Motion Studio, saved compositions):
 *  a text overlay whose animation is still the normalized `OverlayAnim`. */
export type CompositionLayer = TextOverlay & { anim?: OverlayAnim | null };
/** Normalized (0..1) overlay animation. Only reusable composition clips (Motion
 *  Studio) still store it; timeline text overlays use `layout.animation`. */
export interface OverlayAnim {
	tracks: Partial<Record<AnimatableProp, ValueKeyframe[]>>;
	colorTracks?: Partial<Record<ColorAnimatableProp, ColorKeyframe[]>>;
}

/* ── Scene (a narrated visual beat) ── */

export type SceneVisualClipKind = "image" | "video";
export type SceneAudioClipKind = "voiceover" | "sfx" | "music";

export interface SceneVisualClip {
	id: string;
	kind: SceneVisualClipKind;
	label: string;
	url: string;
	/** Which admitted asset this visual came from. Absent on a visual that
	 *  predates the recording, or on one the app synthesised from `Scene.src`. */
	mediaAssetId?: string;
	startSec: number;
	durationSec: number;
	/** Original source seconds; omitted on legacy visuals. */
	mediaStartSec?: number;
	layout?: ClipLayout;
	primary?: boolean;
	/** Explicit source gain; legacy rendering retains each scene path's default. */
	volume?: number;
	motion?: CustomMotion | null;
	reveal?: VisualRevealEffect;
}

export interface SceneAudioClip {
	id: string;
	kind: SceneAudioClipKind;
	label: string;
	content: string;
	startSec: number;
	durationSec: number;
}

// Per-clip generation record + version history.
export interface GenVersion {
	id: number;
	url: string;
	thumb?: string;
	prompt?: string;
	model?: string;
	voice?: string;
	durationSec?: number;
}
export interface ClipGeneration {
	prompt?: string;
	model?: string;
	voice?: string;
	durationSec?: number;
	history?: GenVersion[];
}

/* How a scene's timeline duration is decided.
 *
 * `pinned` — `dur` is authoritative; the operator set it and generated speech
 *   running longer is an overflow to report, never a reason to retime.
 * `auto`   — `dur` follows the measured speech (`contentDur`) plus a semantic
 *   gap, recomputed whenever that speech is admitted.
 *
 * Absent means pinned. Every document written before this existed set `dur`
 * explicitly, so reading absence as pinned is what keeps their timing intact. */
export type SceneDurationMode = "pinned" | "auto";

export interface Scene {
	id: number;
	dur: number;
	/** Measured duration of the scene's own generated content, when it has any.
	 *  Under `durMode: "auto"` this is what `dur` is derived from; under
	 *  `pinned` it is what an overflow is measured against. */
	contentDur?: number;
	/** Absent means `"pinned"` — see `SceneDurationMode`. */
	durMode?: SceneDurationMode;
	/** Hash of the inputs that produced this scene's speech and frame, recorded
	 *  when each asset was admitted. Compared against the current inputs to tell
	 *  whether an asset still matches the text or prompt it came from. Absent
	 *  means "nothing recorded", which reads as fresh, never as stale. */
	speechInputHash?: string;
	frameInputHash?: string;
	start?: number;
	track?: number;
	name: string;
	shot: string;
	move: string;
	motion?: CustomMotion | null;
	transition?: TransitionType;
	transitionDur?: number;
	transitionColorPhase?: number;
	vis: string;
	vo: string;
	voiceId?: string;
	castId?: string;
	img: boolean;
	seed?: number;
	src?: string;
	endSrc?: string;
	/** Which admitted asset this beat's frame came from. Carried on the scene
	 *  because `src` exists whether or not the beat has visual clips. */
	mediaAssetId?: string;
	/** The companion to `endSrc` that `mediaAssetId` is to `src`. Without it an
	 *  end frame can be admitted but never read as used, so it would sit in
	 *  "Ready to place" forever while visibly on the timeline. */
	endMediaAssetId?: string;
	action?: string;
	sfx?: string;
	focalPoint?: { xPct: number; yPct: number };
	vignette?: boolean;
	grain?: boolean;
	beat?: StoryBeat;
	emotion?: Emotion;
	intent?: string;
	question?: string;
	claim?: string;
	evidence?: string;
	sourceEvidence?: Array<{ url: string; quote: string }>;
	analogy?: string;
	visualType?: ExplainerVisualType;
	onScreenText?: string;
	sceneKind?: "section_intro" | "storyboard";
	sceneKey?: string;
	logicalSceneId?: string;
	/* Which chapter this scene is in. A section and a chapter are the same thing:
	 * the agent's plan calls it a section and the script view calls it a chapter,
	 * and this one field is the membership both read. The name stays `sectionId`
	 * because it is on the agent wire — renaming it to match a UI label would
	 * touch four packages and every persisted agent payload to change nothing.
	 *
	 * An agent re-run reassigns it, so a restructured story restructures the
	 * chapters. That is the same last-writer-wins the agent already has over `vo`
	 * and `vis`. */
	sectionId?: string;
	storyBeatId?: string;
	sourceRevisionId?: string;
	storyboardSceneId?: string;
	imageSourceStoryboardSceneId?: string;
	editorialPatternId?: string;
	information?: SceneInformation;
	sectionTransition?: {
		type?:
			| "question_card"
			| "timeline_advance"
			| "evidence_stamp"
			| "diagram_wipe"
			| "match_cut"
			| "chapter_card";
		plateId?: string;
		text?: string;
		motion?: "line_draw" | "paper_wipe" | "stamp" | "push" | "zoom_cut" | "none";
		durationSec?: number;
		plateImageUrl?: string;
		sfx?: string;
	};
	refIds?: string[];
	useGlobalReferences?: boolean;
	voiceIds?: string[];
	noteIds?: string[];
	visualClips?: SceneVisualClip[];
	audioClips?: SceneAudioClip[];
	layout?: ClipLayout;
	history?: GenVersion[];
}

/* ── Text overlay ── */

/* The members as a value, so a boundary that receives a preset name from a model
 * or a stored document can check it rather than assert it. The union is derived
 * from the array so the two cannot disagree. */
export const TEXT_PRESETS = [...VISUAL_PRIMITIVE_IDS, "motion-comp"] as const;

export type TextPreset = (typeof TEXT_PRESETS)[number];
/** One value a text template's parameter can hold.
 *
 *  The KEYS stay open — each preset names its own fields, and `motion-comp`
 *  stores a whole composition bundle here rather than field values — but the
 *  values were never `unknown`. Params are written to a document and read back
 *  from JSON, so JSON is exactly what they are, and saying so lets a reader
 *  index them without re-narrowing what the field schema already decided.
 *
 *  What a given key holds is `TemplateField["type"]`'s business: `text` /
 *  `textarea` / `image` give a string, `number` a number, `list` rows. */
export type TemplateParamValue =
	| string
	| number
	| boolean
	| null
	| TemplateParamValue[]
	| { [key: string]: TemplateParamValue };
export interface TemplateParamRow {
	[key: string]: TemplateParamValue;
}
export type TemplateParams = Record<string, TemplateParamValue>;

export interface TextOverlay {
	id: number;
	content: string;
	start: number;
	dur: number;
	preset: TextPreset;
	track?: number;
	layout?: ClipLayout;
	style?: ClipTextStyle;
	params?: TemplateParams;
}

/* ── Video overlay ── */

export interface VideoOverlay {
	sourceDurationSec?: number;
	id: number;
	mediaAssetId?: string;
	url: string;
	thumb?: string;
	kind: "image" | "video";
	label?: string;
	start: number;
	dur: number;
	track?: number;
	gen?: ClipGeneration;
	source?: "generated" | "stock" | "upload";
	layout?: ClipLayout;
	mediaStartSec?: number;
	volume?: number;
	reveal?: VisualRevealEffect;
}

/* ── Audio overlay ── */

export interface AudioOverlay extends SourceAudioSettings {
	animation?: AudioAnimation;
	id: number;
	kind: AudioOverlayKind;
	origin?: AudioOrigin;
	content: string;
	url?: string;
	/** Which admitted asset this clip plays. Absent for generated speech, which
	 *  is not admitted from a browsing surface. */
	mediaAssetId?: string;
	voice?: string;
	start: number;
	dur: number;
	track?: number;
	volume?: number;
	/** How far this clip drops while voiceover is speaking, 0..1 of its own
	 *  volume. 1 is no ducking at all.
	 *
	 *  Optional, and the default lives with the renderer that applies it. It is
	 *  here because a fixed duck is what made the volume slider read as broken:
	 *  a music bed under continuous narration sat at 35% of whatever the slider
	 *  said, so moving the slider moved a number the ear could barely find. The
	 *  duck is right; being unable to see or change it was not. */
	duckUnderVoice?: number;
	fadeIn?: number;
	fadeOut?: number;
	words?: Array<{ text: string; startSec: number; endSec: number }>;
	originalDur?: number;
	mediaStartSec?: number;
}

/* ── Effects + transitions ── */

export type EffectKind =
	| "fade_in"
	| "fade_out"
	| "zoom_out_from_black"
	| "flash"
	| "zoom_punch"
	| "whip_pan";
export interface EffectClip {
	id: number;
	effect: EffectKind;
	start: number;
	dur: number;
	track?: number;
	intensity?: number;
}

/* The members as a value, so a boundary can check a transition rather than
 * assert one. The union is derived from the array so the two cannot disagree. */
export const TRANSITION_TYPES = [
	"cut",
	"fade",
	"slide",
	"zoom",
	"wipe",
	"flip",
	"clock_wipe",
	"pixel",
] as const;

export type TransitionType = (typeof TRANSITION_TYPES)[number];
export interface TransitionClip {
	id: number;
	fromClipId: string;
	toClipId: string;
	type: TransitionType;
	dur: number;
	colorPhase?: number;
}

/* ── Pacing devices ── */

export interface PacingDevices {
	chapterPills?: boolean;
	progressBar?: boolean;
	variant?: "pill" | "minimal";
}

/* ── Per-track hide/mute/lock state, and the lane's declared group ──
 *
 * A lane's group says what the lane ACCEPTS. It is declared, never inferred from
 * the clips currently on the lane: an inferred group changes meaning when
 * something is dropped and has no meaning at all when the lane is empty, and a
 * typed empty lane is the point.
 *
 * `group` is optional in the type and required in practice for every free lane
 * (row >= 0). Two reasons it cannot be required here: the base scene track is
 * row -1 and has no group, and every existing document predates the field —
 * `migrateLaneGroups` fills it on load. Readers of a free lane's group should go
 * through that migration's output rather than defaulting inline. */

export type LaneGroup = "visual" | "audio" | "text" | "caption" | "effect";

/* Canonical vertical order. Visual on top because it carries the base render;
 * audio under it because that is where an editor looks for it; the three label
 * lanes below, in decreasing frequency of use. */
export const LANE_GROUP_ORDER: readonly LaneGroup[] = [
	"visual",
	"audio",
	"text",
	"caption",
	"effect",
];

export type TrackFlags = Record<
	number,
	{ hidden?: boolean; muted?: boolean; locked?: boolean; group?: LaneGroup }
>;

/* ── Project-level references ──
 * The selection itself lives in `project-selection.ts` as `ProjectSelection`
 * ({ prompt, entityIds }). It used to be four parallel id arrays declared here. */

/* ── Reference library (image resolution at projection time) ── */

/* One entity as the editor's reference pool holds it.
 *
 * The persisted half uses the same names as `ReferenceEntityWire`, because it IS
 * that entity: it used to rename role->kind, description->note, primary->default,
 * origin->gen and imageUrl->src on the way in, so the same field answered to two
 * names either side of `parseProjectRefs` and every reader had to know which side
 * it was on. The remaining fields are genuinely editor-side: `seed` is a derived
 * hue, and the pool/roster bookkeeping below has no persisted counterpart. */
export interface RefImage {
	id: string;
	label: string;
	tags?: string[];
	role?: string;
	description?: string;
	seed: number;
	primary?: boolean;
	referenceUse?: ReferenceUse;
	generated?: boolean;
	imageUrl?: string;
	prompt?: string;
	workspace?: string;
	collection?: string;
	item_id?: string;
	/** Attached to the current project's roster (`project_reference`). Editor-side
	 *  and transient — the DB owns the attachment, so this is never persisted; it
	 *  exists so one pool can carry both the workspace library and the roster, and
	 *  cast defaulting can size itself against the roster alone. */
	inRoster?: boolean;
}
export interface CustomVoice {
	desc: string;
	hue: number;
}
/* A voice identity. Audio-only and deliberately not a reference entity: it has
 * no image and cannot be cast into a frame. Named `Speaker` because "cast" now
 * means visual reference entities only. */
export interface Speaker {
	id: string;
	name: string;
	voiceId?: string;
	voiceDesc?: string;
	hue?: number;
	lang?: string;
	custom?: CustomVoice;
	default?: boolean;
}
export interface Note {
	id: string;
	label: string;
	body: string;
	tags?: string[];
	kind?: string;
	default?: boolean;
	proofSource?: string;
	proofUrl?: string;
}
export interface RefStyle {
	tone: string;
	palette: string;
	music: string;
}
export interface RefsState {
	images: RefImage[];
	speakers: Speaker[];
	notes: Note[];
	style: RefStyle;
}

export interface BrandKit {
	accentColor?: string;
	fontFamily?: string;
	logoUrl?: string;
}

/* ── Wizard config ── */

export interface Config {
	title?: string;
	brief?: string;
	description?: string;
	audience?: string;
	length?: string;
	format?: string;
	slides?: number;
	platform?: string;
	thread?: boolean;
	/** Style knobs, snapshotted from the content preset at project creation.
	 *  A snapshot rather than a preset reference, so editing the preset later
	 *  never re-directs a project that was already planned under it. */
	style?: StyleKnobs | null;
	/** Name + description of the preset the knobs were snapshotted from. Part of
	 *  the snapshot, not a live reference: the knobs themselves are anonymous, and
	 *  the planner prompt needs to say what the style IS, not just its numbers. */
	styleName?: string;
	styleDescription?: string;
}

/* ── Clip id helpers (source:refId) ── */

export type ClipSource = "scene" | "video" | "text" | "audio" | "effect" | "caption";

export function clipId(source: ClipSource, refId: number): string {
	return `${source}:${refId}`;
}
export function parseClipId(id: string | null): { source: ClipSource; refId: number } | null {
	if (!id) return null;
	const [s, idRaw] = id.split(":");
	const refId = Number(idRaw);
	if (!Number.isFinite(refId)) return null;
	if (
		s === "scene" ||
		s === "video" ||
		s === "text" ||
		s === "audio" ||
		s === "effect" ||
		s === "caption"
	)
		return { source: s, refId };
	return null;
}
