import {
	CaptionClipSchema,
	CaptionSetSchema,
	captionSourceReferencesValid,
	type CaptionSet,
} from "./caption-cues.ts";
import { audioAnimationSchema, clipControlBlockers } from "./clip-animation.ts";
import { textOf } from "./object-keys.ts";
import { animationFromLegacyText } from "./legacy-text-animation.ts";
import { parseBookmarks, type Bookmark } from "./timeline-bookmarks.ts";
/* The persisted storyboard document — one module owns its shape and its decoding.
 *
 * `content_storyboards.storyboard_json` is the single source of truth for the
 * video editor, and it crossed four seams as `Record<string, unknown>`: five
 * writers emitted it, six `as` casts read it, and a 676-line bespoke reader in
 * `apps/web` reconstructed it field by field on load. Nothing declared the shape,
 * so the writers stayed compatible only by hand — and that patch was invented
 * twice independently, once in the agent (`preservedClientStoryboardFields`) and
 * once in the save route (the artifacts re-attach), neither aware of the other.
 *
 * Reading is TOLERANT and never throws. Documents written by three generations of
 * this system are in production, and the write path swallows its own failures, so
 * a malformed document can reach storage with no signal at all. A read that threw
 * would surface that as a project which will not open — punishing the user for a
 * bug on the write side. This follows `project-selection.ts`, which reads three
 * persisted shapes and normalises unknown input rather than raising.
 *
 * Writing is TOTAL. Strictness belongs here, where malformed documents stop being
 * produced: a writer that lacks a field reads it from the prior document and
 * supplies it explicitly, so adding a field to the type is a compile error in
 * every writer that ignores it rather than a silent drop on the next save.
 *
 * The blob carries no internal discriminant (`schemaVersion` appears on video
 * documents alone), so a variant union has to be tagged from OUTSIDE: the caller
 * knows the project's type and picks the decoder. `readStoryboardDocument` reads
 * the video variant; `readStoryboardSlides` and `readStoryboardPosts` read the
 * other two. What stays outside this module is the choice, not the decoding —
 * the slide and post shapes were being walked by hand in the web load path,
 * which is how a persisted field ends up with two readers that disagree.
 *
 * The load-time array→clip projection (`buildSeed`) is deliberately NOT here.
 * This module owns decode rules; that seed is a projection, and it needs the
 * editor's track layout to place derived overlays. */
import type {
	AudioOverlay,
	CustomMotion,
	EffectClip,
	InfographicOverlay,
	InfographicStyle,
	MotionEasing,
	MotionKeyframe,
	PacingDevices,
	Scene,
	TextOverlay,
	TextPreset,
	TransitionClip,
	VideoOverlay,
	EffectKind,
	TransitionType,
	TrackFlags,
	BrandKit,
} from "./timeline-model.ts";
import { clipId } from "./timeline-model.ts";
import type { Chapter, Clip, ClipType, SceneMarker } from "./timeline-doc.ts";
import { parseMarkers } from "./timeline-markers.ts";
import { parseChapters } from "./timeline-chapters.ts";
import type { ProjectSelection } from "./project-selection.ts";
import { normalizeProjectSelection } from "./project-selection.ts";
import type { ProjectMaterials } from "./project-materials.ts";
import { isEmptyMaterials, normalizeProjectMaterials } from "./project-materials.ts";
import type { CaptionConfig } from "./caption-config.ts";
import { normalizeSceneClips, resequenceScenes } from "./scene-timing.ts";
import { normalizeAudioOrigin, normalizeAudioOverlayKind } from "./audio-overlays.ts";
import { trimMediaTiming } from "./source-interval.ts";

/* ── Reading raw JSON ──────────────────────────────────────────────────────
 *
 * The row is JSON, so the input is `unknown` and has to stay `unknown` until a
 * decoder gives it a type. `prop` is the ONLY place in this module that reaches
 * into an untyped value; every decoder below takes `unknown` and reads through
 * it. That containment is the point: this module used to hand
 * `Record<string, unknown>` to twenty-one signatures, and a dictionary passed
 * between functions is indistinguishable from a decoded one at every call site
 * it reaches. */

/** One property off an unknown value: `undefined` when the value is not an
 *  object or does not carry the key. Never throws, like the rest of the read. */
function prop(value: unknown, key: string): unknown {
	if (value === null || typeof value !== "object") return undefined;
	return Object.getOwnPropertyDescriptor(value, key)?.value;
}

/** True when the value is a JSON object rather than an array or a scalar. */
function isObject(value: unknown): value is object {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

const items = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/* ── Carrying a written field back out ────────────────────────────────────
 *
 * Three readers for the fields this module does NOT decode. They exist because
 * the same claim was being made at fourteen separate fields, and fourteen
 * copies of a sentence is not fourteen pieces of evidence — it is one, written
 * out fourteen times. Stated once, here.
 *
 * The claim rests on two facts from the module header. The write is TOTAL and
 * typed: a field on a stored document was emitted from the domain type it is
 * being read back as, by a writer the compiler checked. The read is TOLERANT by
 * contract: a document written by an older build has to open rather than throw,
 * and three generations of this system are in production.
 *
 * So each reader verifies the JSON KIND — which is what separates a present
 * field from a missing or corrupted one — and carries the value at the type its
 * writer emitted. What is deliberately NOT verified is membership of a closed
 * union or the interior of a nested shape: checking those would reject a
 * document that the previous reader opened, which is the one regression this
 * work is not allowed to cause. */

/** An object-valued field, carried at the type its writer emitted. */
function carriedObject<T>(value: unknown, key: string): T | null {
	const v = prop(value, key);
	// SAFETY: the object check is the verification; see the contract above.
	return isObject(v) ? (v as T) : null;
}

/** An array-valued field, carried at the type its writer emitted. */
function carriedArray<T>(value: unknown, key: string): T | undefined {
	const v = prop(value, key);
	// SAFETY: the array check is the verification; see the contract above.
	return Array.isArray(v) ? (v as T) : undefined;
}

/** A closed-union string id, carried without checking membership so that an id
 *  from a retired spelling still loads. Falls back when the field is absent or
 *  is not a string at all. */
function carriedId<T extends string>(value: unknown, key: string, fallback: T): T;
function carriedId<T extends string>(
	value: unknown,
	key: string,
	fallback?: undefined,
): T | undefined;
function carriedId<T extends string>(value: unknown, key: string, fallback?: T): T | undefined {
	const v = prop(value, key);
	// SAFETY: the string check is the verification; see the contract above.
	return typeof v === "string" ? (v as T) : fallback;
}

/* Two coercions the decoders share. They were file-local in the reader this moved
 * from and stay that way — nothing outside this module should be reading a
 * persisted field by hand. */
const strArr = (v: unknown): string[] =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const imgOf = (o: unknown): string | undefined => {
	const image = prop(o, "image");
	if (typeof image === "string") return image;
	const url = prop(o, "image_url");
	return typeof url === "string" ? url : undefined;
};

/* Keyed by name so a lookup RETURNS the narrowed value rather than proving
 * membership and then asserting it back on — the set this replaced did the
 * check and still needed `as MotionEasing` to use the result. */
const MOTION_EASINGS_BY_NAME: ReadonlyMap<string, MotionEasing> = new Map(
	(["linear", "in", "out", "in-out", "bezier"] satisfies MotionEasing[]).map((e) => [e, e]),
);

function parseSectionTransition(raw: unknown): Scene["sectionTransition"] | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	return {
		type: carriedId<NonNullable<Scene["sectionTransition"]>["type"] & string>(raw, "type"),
		plateId: optStr(raw, "plateId"),
		text: optStr(raw, "text"),
		motion: carriedId<NonNullable<Scene["sectionTransition"]>["motion"] & string>(raw, "motion"),
		durationSec: optNum(raw, "durationSec"),
		plateImageUrl: optStr(raw, "plateImageUrl"),
		sfx: optStr(raw, "sfx"),
	};
}

function parseTextOverlays(latestStoryboard: unknown): TextOverlay[] {
	return items(prop(latestStoryboard, "text_overlays")).map((o, i): TextOverlay => ({
		id: optNum(o, "id") ?? i + 1,
		content: textOf(prop(o, "content")),
		start: Number(prop(o, "start_sec") ?? 0),
		dur: Math.max(0.5, Number(prop(o, "duration_sec") ?? 2)),
		preset: carriedId<TextPreset>(o, "preset", "title"),
		track: optNum(o, "track") ?? 0,
		layout: carriedObject<NonNullable<TextOverlay["layout"]>>(o, "layout") ?? undefined,
		style: carriedObject<NonNullable<TextOverlay["style"]>>(o, "style") ?? undefined,
	}));
}

/** Reconstruct a custom keyframe motion from stored JSON. Returns null when the
 *  value is absent or malformed (fewer than 2 valid keyframes). */
function parseCustomMotion(value: unknown): CustomMotion | null {
	if (!value || typeof value !== "object") return null;
	const raw = prop(value, "keyframes");
	if (!Array.isArray(raw)) return null;
	const keyframes: MotionKeyframe[] = [];
	for (const k of raw) {
		if (!k || typeof k !== "object") continue;
		const t = prop(k, "t");
		const scale = prop(k, "scale");
		const x = prop(k, "x");
		const y = prop(k, "y");
		if (
			typeof t !== "number" ||
			typeof scale !== "number" ||
			typeof x !== "number" ||
			typeof y !== "number"
		)
			continue;
		const rawEasing = prop(k, "easing");
		// The set membership is checked, so this narrowing is a real one.
		const easing = MOTION_EASINGS_BY_NAME.get(String(rawEasing));
		const rotate = prop(k, "rotate");
		keyframes.push({
			t,
			scale,
			x,
			y,
			rotate: typeof rotate === "number" ? rotate : undefined,
			easing,
		});
	}
	if (keyframes.length < 2) return null;
	const sorted = [...keyframes].sort((a, b) => a.t - b.t);
	return { keyframes: sorted };
}

/** A string field, or `undefined` when the value is not one. */
function optStr(value: unknown, key: string): string | undefined {
	const v = prop(value, key);
	return typeof v === "string" ? v : undefined;
}
/** A number field, or `undefined` when the value is not one. */
function optNum(value: unknown, key: string): number | undefined {
	const v = prop(value, key);
	return typeof v === "number" ? v : undefined;
}

function parseVideoScenes(storyboardScenes: readonly unknown[]): Scene[] {
	return resequenceScenes(
		storyboardScenes.map((scene, index) => {
			const src = imgOf(scene);
			const endImage = optStr(scene, "end_image");
			const sceneKind = prop(scene, "sceneKind");
			const storyBeatId = optStr(scene, "storyBeatId");
			const sourceRevisionId = optStr(scene, "sourceRevisionId");
			return normalizeSceneClips({
				id: index + 1,
				dur: Number(prop(scene, "duration_sec") ?? 5),
				name: textOf(prop(scene, "name") ?? prop(scene, "key"), `Scene ${index + 1}`),
				shot: textOf(prop(scene, "shot") ?? prop(scene, "camera"), "Medium Shot"),
				move: textOf(prop(scene, "movement"), "Static"),
				motion: parseCustomMotion(prop(scene, "motion")),
				transition: carriedId<NonNullable<Scene["transition"]>>(scene, "transition", "fade"),
				transitionDur: optNum(scene, "transition_dur"),
				transitionColorPhase: optNum(scene, "transition_color_phase"),
				start: optNum(scene, "scene_start"),
				track: optNum(scene, "scene_track"),
				vis: textOf(prop(scene, "visual") ?? prop(scene, "beat")),
				vo: textOf(prop(scene, "voiceover") ?? prop(scene, "beat")),
				src,
				endSrc: endImage || undefined,
				img: Boolean(src),
				action: optStr(scene, "action"),
				sfx: optStr(scene, "sfx"),
				vignette: Boolean(prop(scene, "vignette")),
				grain: Boolean(prop(scene, "grain")),
				visualClips: parseVisualClips(prop(scene, "visual_clips")),
				audioClips: carriedArray<NonNullable<Scene["audioClips"]>>(scene, "audio_clips"),
				refIds: strArr(prop(scene, "reference_ids")),
				voiceIds: strArr(prop(scene, "voice_ids")),
				noteIds: strArr(prop(scene, "note_ids")),
				onScreenText: optStr(scene, "onScreenText"),
				motionGraphic:
					carriedObject<NonNullable<Scene["motionGraphic"]>>(scene, "motionGraphic") ?? undefined,
				// Checked against both members, so this one is a real narrowing.
				sceneKind:
					sceneKind === "section_intro" || sceneKind === "storyboard" ? sceneKind : undefined,
				sceneKey: optStr(scene, "sceneKey"),
				logicalSceneId: optStr(scene, "logicalSceneId"),
				sectionId: optStr(scene, "sectionId"),
				...(storyBeatId ? { storyBeatId } : {}),
				...(sourceRevisionId ? { sourceRevisionId } : {}),
				storyboardSceneId: optStr(scene, "storyboardSceneId"),
				imageSourceStoryboardSceneId: optStr(scene, "imageSourceStoryboardSceneId"),
				editorialPatternId: optStr(scene, "editorialPatternId"),
				information:
					carriedObject<NonNullable<Scene["information"]>>(scene, "information") ?? undefined,
				sectionTransition: parseSectionTransition(prop(scene, "sectionTransition")),
				layout: carriedObject<NonNullable<Scene["layout"]>>(scene, "layout") ?? undefined,
				history: carriedArray<NonNullable<Scene["history"]>>(scene, "history"),
			});
		}),
	);
}

/** Visual clips carry their own keyframe motion, which has to be decoded rather
 *  than carried through — the rest of the clip is a stored shape this system
 *  writes and reads back unchanged. */
function parseVisualClips(raw: unknown): Scene["visualClips"] {
	if (!Array.isArray(raw)) return undefined;
	return raw.map((clip) => ({
		// SAFETY: the same carried-field contract as `carriedArray`, applied to the
		// element rather than the array — this one has a decoder to run over it.
		...(clip as NonNullable<Scene["visualClips"]>[number]),
		motion: parseCustomMotion(prop(clip, "motion")),
	}));
}

function sourceInPoint(raw: unknown): { mediaStartSec?: number } {
	const value = optNum(raw, "media_start_sec") ?? optNum(raw, "mediaStartSec");
	return value != null && value >= 0 ? { mediaStartSec: value } : {};
}

function parseAudioOverlays(
	latestStoryboard: unknown,
	storyboardScenes: readonly unknown[],
): AudioOverlay[] {
	const raw = items(prop(latestStoryboard, "audio_overlays"));
	if (raw.length) {
		return raw.map((a, i): AudioOverlay => ({
			id: optNum(a, "id") ?? i + 1,
			kind: normalizeAudioOverlayKind(prop(a, "kind")),
			origin: normalizeAudioOrigin(prop(a, "origin")),
			content: textOf(prop(a, "content")),
			url: optStr(a, "url"),
			voice: optStr(a, "voice"),
			start: Number(prop(a, "start_sec") ?? 0),
			dur: Math.max(0.5, Number(prop(a, "duration_sec") ?? 2)),
			track: optNum(a, "track") ?? 0,
			volume: optNum(a, "volume") ?? 1,
			fadeIn: optNum(a, "fade_in_sec") ?? 0,
			fadeOut: optNum(a, "fade_out_sec") ?? 0,
			originalDur: optNum(a, "original_dur"),
			...sourceInPoint(a),
			...(audioAnimationSchema.safeParse(prop(a, "animation")).success
				? { animation: audioAnimationSchema.parse(prop(a, "animation")) }
				: {}),
		}));
	}
	// No saved audio: seed movable clips from scene voiceover/sfx.
	let acc = 0;
	let aid = 1;
	const seeded: AudioOverlay[] = [];
	for (const sc of storyboardScenes) {
		const d = Math.max(1, Number(prop(sc, "duration_sec") ?? 5));
		const vo = textOf(prop(sc, "voiceover")).trim();
		const sfx = textOf(prop(sc, "sfx")).trim();
		if (vo) seeded.push({ id: aid++, kind: "voiceover", content: vo, start: acc, dur: d });
		if (sfx) seeded.push({ id: aid++, kind: "sfx", content: sfx, start: acc, dur: d });
		acc += d;
	}
	return seeded;
}

function parseVideoOverlays(latestStoryboard: unknown): VideoOverlay[] {
	return items(prop(latestStoryboard, "video_overlays"))
		.filter((v) => typeof prop(v, "url") === "string")
		.map((v, i): VideoOverlay => {
			const source = prop(v, "source");
			const gen = carriedObject<NonNullable<VideoOverlay["gen"]>>(v, "gen");
			const layout = carriedObject<NonNullable<VideoOverlay["layout"]>>(v, "layout");
			const reveal = carriedObject<NonNullable<VideoOverlay["reveal"]>>(v, "reveal");
			return {
				id: optNum(v, "id") ?? i + 1,
				url: String(prop(v, "url")),
				thumb: optStr(v, "thumb"),
				kind: prop(v, "kind") === "video" ? "video" : "image",
				label: optStr(v, "label"),
				start: Number(prop(v, "start_sec") ?? 0),
				dur: Math.max(0.5, Number(prop(v, "duration_sec") ?? 3)),
				...(optNum(v, "sourceDurationSec") != null
					? { sourceDurationSec: optNum(v, "sourceDurationSec") }
					: {}),
				track: optNum(v, "track") ?? 0,
				...sourceInPoint(v),
				source:
					source === "generated" || source === "stock" || source === "upload" ? source : undefined,
				...(gen ? { gen } : {}),
				...(layout ? { layout } : {}),
				...(reveal ? { reveal } : {}),
			};
		});
}

function parseEffects(latestStoryboard: unknown): EffectClip[] {
	// An effect with no kind has nothing to render and is dropped, as it was
	// before. Dropping happens first so the fallback id stays the position among
	// the effects that survived, which is what the previous filter-then-map gave.
	const kept = items(prop(latestStoryboard, "effects"))
		.map((raw) => ({ raw, effect: carriedId<EffectKind>(raw, "effect") }))
		.filter((e): e is { raw: unknown; effect: EffectKind } => e.effect !== undefined);
	return kept.map(({ raw, effect }, i): EffectClip => ({
		id: optNum(raw, "id") ?? i + 1,
		effect,
		start: Number(prop(raw, "start_sec") ?? 0),
		dur: Math.max(0.2, Number(prop(raw, "duration_sec") ?? 1)),
		track: optNum(raw, "track") ?? 0,
		intensity: optNum(raw, "intensity") ?? 1,
	}));
}

function parseTransitions(
	latestStoryboard: unknown,
	storyboardScenes: readonly unknown[],
): TransitionClip[] {
	const transitions = prop(latestStoryboard, "transitions");
	const raw = Array.isArray(transitions) ? transitions : null;
	if (raw && raw.length) {
		// New schema stores clip ids; legacy stores numeric scene ids. Drop any whose
		// endpoints can't be recovered rather than coercing to a bogus scene:0.
		const resolveClip = (clipVal: unknown, sceneVal: unknown): string | null =>
			typeof clipVal === "string"
				? clipVal
				: Number.isFinite(Number(sceneVal)) && Number(sceneVal) > 0
					? clipId("scene", Number(sceneVal))
					: null;
		return raw
			.map((t, i): TransitionClip | null => {
				const fromClipId = resolveClip(prop(t, "from_clip"), prop(t, "from_scene"));
				const toClipId = resolveClip(prop(t, "to_clip"), prop(t, "to_scene"));
				if (!fromClipId || !toClipId) return null;
				return {
					id: optNum(t, "id") ?? i + 1,
					fromClipId,
					toClipId,
					type: carriedId<TransitionType>(t, "type", "fade"),
					dur: Math.max(0.2, Number(prop(t, "duration_sec") ?? 0.8)),
					colorPhase: optNum(t, "color_phase"),
				};
			})
			.filter((t): t is TransitionClip => t !== null);
	}
	// Legacy per-scene transitions: derive boundaries between scene i and i+1.
	const derived: TransitionClip[] = [];
	for (let i = 0; i < storyboardScenes.length - 1; i++) {
		// Bound once rather than indexed three times: identical behaviour, and the
		// element is only optional under the web app's typecheck of this file.
		const scene = storyboardScenes[i];
		if (!scene) continue;
		const t = carriedId<TransitionType>(scene, "transition", "fade");
		if (t === "cut") continue;
		derived.push({
			id: i + 1,
			fromClipId: clipId("scene", i + 1),
			toClipId: clipId("scene", i + 2),
			type: t,
			dur: Math.max(0.2, Number(prop(scene, "transition_dur") ?? 0.8)),
			colorPhase: optNum(scene, "transition_color_phase"),
		});
	}
	return derived;
}
/* ── The document ─────────────────────────────────────────────────────────── */

/** Which one-time clip migrations a document written today has been through. The
 *  reader compares against it to decide whether a document still needs the
 *  scene-text-clip split; it lived beside that reader in the editor. */
export const SCENE_TEXT_CLIP_MIGRATION_VERSION = 5;

/** The render-affecting half of the editor's global settings. The other half
 *  (which backend to render on, and other working preferences) stays editor
 *  state: it changes how a render is PRODUCED, not what it contains. */
export interface RenderPresentation {
	aspectRatio?: string;
	brand?: BrandKit;
	backgroundFill?: string;
}

/** What a video storyboard actually persists as. `TimelineDoc` is the render
 *  timeline; this is the whole record, including the doc-level style config the
 *  editor owns and the bookkeeping the agent writes. */
export interface StoryboardDocument {
	schemaVersion: 2;
	clips: Clip[];
	markers: SceneMarker[];
	/* Null when the document never carried chapters, which is what tells the reader
	 * to seed them. An empty array is an operator who deleted them all and must not
	 * be re-seeded, so the two are deliberately not collapsed.
	 *
	 * `| null` rather than optional on purpose: every field here is required, so a
	 * writer that forgets one fails to compile. See the test that pins that. */
	chapters: Chapter[] | null;
	bookmarks: Bookmark[] | null;
	projectReferences: ProjectSelection;
	/* The project's generation context — Story, Visual, Voice, Rules. It lives on the
	 * document rather than in `editor_state_json` for the same reason `projectReferences`
	 * does: it is written WITH the row at create, so a reload that races the debounced
	 * editor-state autosave still opens a project whose preset actually applied. */
	materials: ProjectMaterials;
	/* Null when the document does not carry one. The document stores what was
	 * persisted; applying `DEFAULT_CAPTIONS` is the consumer's job. Merging a
	 * default in here would change the bytes a writer emits, and the contract's
	 * whole point is that the payload does not move. */
	captions: CaptionConfig | null;
	captionSet: CaptionSet | null;
	pacingDevices: PacingDevices | null;
	infographicStyle: InfographicStyle | null;
	/** Which one-time clip migrations this document has already been through. */
	sceneTextClipMigrationVersion: number | null;
	/* Render-affecting presentation. These decide what a render CONTAINS -- which
	 * tracks are dropped, what aspect it is cut to, what brand it wears -- so by the
	 * placement test they belong to the version, not to the desk. They lived in
	 * `editor_state_json` (one overwritten cell, no history) while the render
	 * filtered clips by them, which meant restoring version N rendered differently
	 * depending on when it was restored. */
	trackFlags: TrackFlags | null;
	presentation: RenderPresentation | null;
	/** Agent bookkeeping. Opaque here — the agent owns the shape; the contract is
	 *  only that a writer which does not own them carries them through. */
	unitLifecycle: unknown;
	artifacts: unknown[];
}

/** What the read could not interpret. Tolerance without a signal cannot be told
 *  apart from correctness, so the signal exists even where nothing consumes it. */
export interface StoryboardReadDiagnostic {
	/** Keys present in the input that the document does not declare. */
	unknownKeys: string[];
	/** Fields that fell back to a default because the input was absent or wrong. */
	defaulted: string[];
	/** True when the input carried the pre-`schemaVersion` per-type arrays. */
	legacy: boolean;
}

export interface StoryboardRead {
	doc: StoryboardDocument;
	/** True when the input was already clip-first, so `doc.clips` is the persisted
	 *  clip list rather than an empty one waiting on the array projection. The
	 *  caller has to branch on this, and re-deriving it from the raw input is how a
	 *  caller ends up reading around the document. */
	clipFirst: boolean;
	/** The legacy per-type arrays, decoded. Empty for a clip-first document. The
	 *  caller projects these into clips; this module does not (see the header). */
	legacyArrays: LegacyArrays;
	diagnostic: StoryboardReadDiagnostic;
}

export interface LegacyArrays {
	scenes: Scene[];
	textOverlays: TextOverlay[];
	audioOverlays: AudioOverlay[];
	videoOverlays: VideoOverlay[];
	infographicOverlays: InfographicOverlay[];
	effects: EffectClip[];
	transitions: TransitionClip[];
}

const EMPTY_LEGACY: LegacyArrays = {
	scenes: [],
	textOverlays: [],
	audioOverlays: [],
	videoOverlays: [],
	infographicOverlays: [],
	effects: [],
	transitions: [],
};

/** Every key a persisted document may legitimately carry — the current shape plus
 *  every historical spelling. Anything else is reported, not dropped silently. */
const KNOWN_KEYS = new Set([
	"schemaVersion",
	"clips",
	"markers",
	"chapters",
	"bookmarks",
	"projectReferences",
	"materials",
	"captions",
	"captionSet",
	"pacingDevices",
	"infographicStyle",
	"sceneTextClipMigrationVersion",
	"trackFlags",
	"presentation",
	"unit_lifecycle",
	"artifacts",
	// pre-v2 input, read but never emitted
	"scenes",
	"text_overlays",
	"audio_overlays",
	"video_overlays",
	"infographic_overlays",
	"overlays",
	"audioOverlays",
	"videoOverlays",
	"infographicOverlays",
	"effects",
	"transitions",
	"outline",
	// editor state, from before it moved to its own column
	"media_assets",
	"chat",
	// other content types, opaque on this path
	"slides",
	"posts",
]);

const CLIP_TYPES_BY_NAME: ReadonlyMap<string, ClipType> = new Map(
	(
		[
			"image",
			"video",
			"text",
			"audio",
			"effect",
			"transition",
			"infographic",
			"caption",
		] satisfies ClipType[]
	).map((t) => [t, t]),
);

/** Decode one persisted clip.
 *
 *  Returns null when the five fields a clip is POSITIONED by — id, type, start,
 *  duration, track — are not all present and correctly typed. Every other member
 *  is a typed payload this system writes and reads back, carried through under
 *  the module's tolerant-read contract.
 *
 *  Measured before it was written: across all 7,567,688 clips in the stored
 *  corpus, every one carries a string `id`, a numeric `startSec` and
 *  `durationSec`, an integer `track`, and a `type` drawn from the seven
 *  declared values. Nothing is rejected that the previous `as Clip[]` accepted,
 *  so a null here means a writer regressed rather than a legacy shape needing
 *  more tolerance — which is why it is reported in the diagnostic. */
function parseClip(raw: unknown, defaulted?: string[]): Clip | null {
	const id = prop(raw, "id");
	const type = CLIP_TYPES_BY_NAME.get(String(prop(raw, "type")));
	const startSec = prop(raw, "startSec");
	const durationSec = prop(raw, "durationSec");
	const track = prop(raw, "track");
	if (typeof id !== "string" || !type) return null;
	if (typeof startSec !== "number" || typeof durationSec !== "number" || typeof track !== "number")
		return null;
	// SAFETY: the positioning fields above are checked. The payload members
	// (`scene`, `video`, `text`, …) are the typed shapes this system wrote into
	// the row and reads straight back; the module header's tolerant-read contract
	// is what says they are carried rather than re-validated, and the write side
	// is where their strictness lives.
	let clip = { ...(raw as Clip), id, type, startSec, durationSec, track };
	if (type === "caption" && !CaptionClipSchema.safeParse(clip).success) return null;
	if (clip.video?.kind === "video" && clip.video.sourceDurationSec != null) {
		const timing = trimMediaTiming(
			{ ...clip.video, start: startSec, dur: durationSec },
			{ dur: durationSec },
			clip.video.sourceDurationSec,
		);
		if (timing && timing.dur < durationSec) {
			clip = {
				...clip,
				startSec: timing.start,
				durationSec: timing.dur,
				video: { ...clip.video, ...timing },
			};
			defaulted?.push("clips[].durationSec");
		}
	}
	return upgradeLegacyTextAnimation(clip, defaulted);
}

/** A text clip still carrying legacy normalized `anim` gets it converted into
 *  `layout.animation` (an existing `layout.animation` wins) and the field removed.
 *  Malformed legacy tracks are dropped and named in the diagnostic. */
function upgradeLegacyTextAnimation(clip: Clip, defaulted?: string[]): Clip {
	const text = clip.text;
	if (!text || !("anim" in text)) return clip;
	const { anim, ...rest } = text;
	const { animation, dropped } = anim
		? animationFromLegacyText(anim, rest.layout, rest.dur)
		: { animation: undefined, dropped: [] };
	for (const name of dropped) defaulted?.push(`clips[].text.anim.${name}`);
	// Missing box fields take the text renderer's own defaults, so placement is unchanged.
	const layout =
		animation && !rest.layout?.animation
			? { xPct: 0, yPct: 0, widthPct: 100, fit: "contain" as const, ...rest.layout, animation }
			: rest.layout;
	return { ...clip, text: { ...rest, ...(layout ? { layout } : {}) } };
}

/** Decode a clip list from any source — a persisted document, or a live one a
 *  client posted. Clips that do not carry the five positioning fields are
 *  dropped rather than carried as a claim; see `parseClip`.
 *
 *  Exported because the agent's HTTP surface accepts a live clip doc from the
 *  editor and used to carry it as `Record<string, unknown>[]` all the way to
 *  the timeline, where a chained assertion turned it back into `Clip[]`. The
 *  request body deserves the same decode the stored row gets. */
export function readClips(raw: unknown): Clip[] {
	const out: Clip[] = [];
	for (const c of items(raw)) {
		const clip = parseClip(c);
		if (clip) out.push(clip);
	}
	return out;
}

/** Read any persisted storyboard into the document. Never throws: unknown input,
 *  missing fields, wrong types and every historical spelling degrade to a default
 *  and are named in the diagnostic. */
export function readStoryboardDocument(raw: unknown): StoryboardRead {
	// `r` is an object or the empty object — `isObject` is the check, on the line
	// above — so its own keys are the document's keys.
	const r: object = isObject(raw) ? raw : {};
	const defaulted: string[] = [];
	const unknownKeys = Object.keys(r).filter((k) => !KNOWN_KEYS.has(k));

	const rawClips = prop(r, "clips");
	const clips: Clip[] = [];
	if (Array.isArray(rawClips)) {
		for (const c of rawClips) {
			const clip = parseClip(c, defaulted);
			if (clip) clips.push(clip);
			else defaulted.push("clips[]");
		}
	} else {
		defaulted.push("clips");
	}
	const rawCaptionSet = prop(r, "captionSet");
	const parsedCaptionSet = CaptionSetSchema.safeParse(rawCaptionSet);
	const hasCaptionState =
		rawCaptionSet != null ||
		clips.some((clip) => clip.type === "caption") ||
		items(rawClips).some((clip) => prop(clip, "type") === "caption");
	const captionSet = parsedCaptionSet.success ? parsedCaptionSet.data : null;
	if (hasCaptionState && !parsedCaptionSet.success) defaulted.push("captionSet");
	for (let index = 0; index < clips.length; index++) {
		const clip = clips[index]!;
		if (clip.caption && !captionSourceReferencesValid(clip.caption, clips)) {
			clips[index] = { ...clip, caption: { ...clip.caption, status: "needs-refresh" } };
			defaulted.push("clips[].caption.sources");
		}
	}
	// Markers retain tolerant field-by-field decoding.
	const rawMarkers = prop(r, "markers");
	const markers = Array.isArray(rawMarkers)
		? parseMarkers(rawMarkers)
		: (defaulted.push("markers"), []);
	/* Not defaulted when absent: absence is meaningful here (seed them) rather than
	 * a field the writer forgot, so reporting it would make every pre-chapters
	 * document read as incomplete. */
	const rawChapters = prop(r, "chapters");
	const chapters = Array.isArray(rawChapters) ? parseChapters(rawChapters) : null;
	const isClipFirst = prop(r, "schemaVersion") === 2 && Array.isArray(rawClips);

	// The per-type arrays are legacy INPUT: read when present so a pre-v2 document
	// still loads, never emitted by the write.
	const storyboardScenes = items(prop(r, "scenes"));
	const legacy =
		!isClipFirst &&
		(storyboardScenes.length > 0 ||
			["text_overlays", "overlays", "video_overlays", "audio_overlays"].some(
				(key) => prop(r, key) !== undefined,
			));
	const legacyArrays: LegacyArrays = legacy
		? {
				scenes: parseVideoScenes(storyboardScenes),
				textOverlays: parseTextOverlays(r),
				audioOverlays: parseAudioOverlays(r, storyboardScenes),
				videoOverlays: parseVideoOverlays(r),
				infographicOverlays: [],
				effects: parseEffects(r),
				transitions: parseTransitions(r, storyboardScenes),
			}
		: EMPTY_LEGACY;

	const migrationVersion = prop(r, "sceneTextClipMigrationVersion");
	if (migrationVersion === undefined || migrationVersion === null)
		defaulted.push("sceneTextClipMigrationVersion");

	return {
		doc: {
			schemaVersion: 2,
			clips,
			markers,
			chapters,
			bookmarks: parseBookmarks(prop(r, "bookmarks")) ?? null,
			projectReferences: normalizeProjectSelection(prop(r, "projectReferences")),
			materials: normalizeProjectMaterials(prop(r, "materials")),
			/* These five are DELIBERATE passthroughs, not missed parses: each must come
			 * back out byte-identical, so decoding and re-emitting them would move the
			 * payload of every document that carries one. They are read through
			 * `carriedObject`, whose contract is stated where it is defined. */
			captions: carriedObject<CaptionConfig>(r, "captions"),
			captionSet,
			pacingDevices: carriedObject<PacingDevices>(r, "pacingDevices"),
			infographicStyle: carriedObject<InfographicStyle>(r, "infographicStyle"),
			sceneTextClipMigrationVersion: typeof migrationVersion === "number" ? migrationVersion : null,
			trackFlags: carriedObject<TrackFlags>(r, "trackFlags"),
			presentation: carriedObject<RenderPresentation>(r, "presentation"),
			unitLifecycle: prop(r, "unit_lifecycle") ?? null,
			artifacts: items(prop(r, "artifacts")),
		},
		clipFirst: isClipFirst,
		legacyArrays,
		diagnostic: { unknownKeys, defaulted, legacy },
	};
}

/* ── The other two variants ────────────────────────────────────────────────
 *
 * A carousel slide and a text post as they are PERSISTED. These describe the
 * row, not the editor's view of it: the editor's `Slide` and `Post` carry ids,
 * seeds and an `img` flag it derives on load, and deriving those is the load
 * path's job, exactly as the array→clip projection is. */

export interface StoryboardSlide {
	key: string;
	name?: string;
	caption: string;
	visual: string;
	image?: string;
	referenceIds: string[];
	noteIds: string[];
}

export interface StoryboardPost {
	key: string;
	body: string;
	image?: string;
}

/** Read the `slides` of an image storyboard. Empty when the document is not one.
 *
 *  Measured against the stored corpus before it was written: across all 16,173
 *  persisted slides, `key`, `caption` and `visual` are always strings, and
 *  `reference_ids`/`note_ids` are arrays or absent. Nothing here rejects a slide
 *  the previous hand-walk read. */
export function readStoryboardSlides(raw: unknown): StoryboardSlide[] {
	return items(prop(raw, "slides")).map((slide): StoryboardSlide => ({
		key: textOf(prop(slide, "key")),
		name: optStr(slide, "name"),
		caption: textOf(prop(slide, "caption")),
		visual: textOf(prop(slide, "visual")),
		image: imgOf(slide) || undefined,
		referenceIds: strArr(prop(slide, "reference_ids")),
		noteIds: strArr(prop(slide, "note_ids")),
	}));
}

/** Read the `posts` of a text storyboard. Empty when the document is not one. */
export function readStoryboardPosts(raw: unknown): StoryboardPost[] {
	return items(prop(raw, "posts")).map((post): StoryboardPost => ({
		key: textOf(prop(post, "key")),
		body: textOf(prop(post, "body")),
		image: imgOf(post) || undefined,
	}));
}

/** A slide as a storyboard stores it. */
export interface StoredSlide {
	key: string;
	name: string | null;
	caption: string;
	visual: string;
	image: string | null;
	reference_ids: string[];
	note_ids: string[];
}

/** A post as a storyboard stores it. */
export interface StoredPost {
	key: string;
	body: string;
	has_image: boolean;
	image: string | null;
}

/** The stored form of a carousel's slides — the one spelling the agent's save and
 *  the editor's autosave both write. */
export function writeStoryboardSlides(slides: readonly StoryboardSlide[]): StoredSlide[] {
	return slides.map((s) => ({
		key: s.key,
		name: s.name ?? null,
		caption: s.caption,
		visual: s.visual,
		image: s.image ?? null,
		reference_ids: s.referenceIds,
		note_ids: s.noteIds,
	}));
}

/** The stored form of a thread's posts. */
export function writeStoryboardPosts(posts: readonly StoryboardPost[]): StoredPost[] {
	return posts.map((p) => ({
		key: p.key,
		body: p.body,
		has_image: Boolean(p.image),
		image: p.image ?? null,
	}));
}

/** Emit the whole document. Every field is written, so a writer that does not
 *  hold one has to read it from the prior document and pass it explicitly rather
 *  than letting absence mean "not mine".
 *
 *  The return stays a plain record: this is the SERIALIZED form, whose keys are
 *  the persisted spellings and whose values have been flattened for
 *  `JSON.stringify`. Naming a type for it was tried and abandoned — an alias and
 *  an index signature both describe the same thing the rule objects to, because
 *  the objection is true. A JSON payload has no value contract; that is what
 *  makes it a payload. `readStoryboardDocument` is where it gets one. */
export function writeStoryboardDocument(doc: StoryboardDocument) {
	if (doc.captionSet != null) CaptionSetSchema.parse(doc.captionSet);
	for (const clip of doc.clips) {
		if (clip.type !== "caption") continue;
		const parsed = CaptionClipSchema.parse(clip);
		if (!doc.captionSet || !captionSourceReferencesValid(parsed.caption, doc.clips))
			throw new Error("Captions require an initialized set and valid source bindings");
	}
	const keyIssues = clipControlBlockers(doc);
	if (keyIssues.length) throw new Error(keyIssues.join(" "));
	return {
		schemaVersion: 2,
		sceneTextClipMigrationVersion: doc.sceneTextClipMigrationVersion,
		// A live document can still hold a clip decoded before the upgrade; never emit legacy `anim`.
		clips: doc.clips.map((clip) => upgradeLegacyTextAnimation(clip)),
		markers: doc.markers,
		projectReferences: doc.projectReferences,
		captions: doc.captions,
		...(doc.captionSet == null ? {} : { captionSet: doc.captionSet }),
		pacingDevices: doc.pacingDevices,
		infographicStyle: doc.infographicStyle,
		trackFlags: doc.trackFlags,
		presentation: doc.presentation,
		/* Omitted when empty, like the two below. Materials arrived after thousands of
		 * documents were written; emitting an all-empty object on every save would move
		 * the payload of every one of them for no information. */
		...(isEmptyMaterials(doc.materials) ? {} : { materials: doc.materials }),
		...(doc.unitLifecycle == null ? {} : { unit_lifecycle: doc.unitLifecycle }),
		...(doc.artifacts.length === 0 ? {} : { artifacts: doc.artifacts }),
		/* Omitted when absent, for the reason materials are: every document written
		 * before chapters existed would otherwise gain an empty array on its next
		 * save. Absent and empty are also NOT the same here — absent means "never
		 * had chapters, seed them on read", empty means "the operator deleted them
		 * all", and emitting `[]` for the first would make them stop being seeded. */
		...(doc.chapters === null ? {} : { chapters: doc.chapters }),
		...(doc.bookmarks === null ? {} : { bookmarks: doc.bookmarks }),
	};
}

/** Exported for the load path, which still owns the array→clip projection these
 *  feed. `sceneMetadataTextOverlays` and `migrateSceneTextOverlays` deliberately
 *  stayed in web: they DERIVE overlays from scenes and need track layout
 *  (`resolveFreeTrack`), which makes them projection rather than decoding. The
 *  line this module holds is that one: decode a persisted field here, project it
 *  there. */
export { parseCustomMotion, parseVideoScenes };
