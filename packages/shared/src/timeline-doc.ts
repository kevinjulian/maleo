import type { CaptionConfig } from "./caption-config.ts";
import type { CaptionCue, CaptionSet } from "./caption-cues.ts";
import type { Bookmark } from "./timeline-bookmarks.ts";
/* Canonical clip-first timeline document (schemaVersion 2).
 *
 * One projection, in both directions. `toTimelineDoc()` projects the legacy
 * per-type arrays into one clip list and `fromTimelineDoc()` derives them back
 * with zero loss; both are assembled from the same per-family primitives this
 * module exports, so an editor that edits one family and the render worker that
 * reads the whole document agree by construction rather than by convention.
 *
 * The editor used to carry its own copy of these primitives — a `clip-edits.ts`
 * whose own header called itself "byte-identical to the legacy toTimelineDoc",
 * with a 2436-line snapshot corpus as the only thing holding the two
 * implementations together. Each clip keeps its typed source payload verbatim,
 * which is what makes the round-trip lossless; the payload's timing is a MIRROR
 * of the clip's, which is what `withMirroredTiming` maintains.
 */
import {
	clipId,
	type AudioOverlay,
	type EffectClip,
	type InfographicOverlay,
	type Scene,
	type SceneVisualClip,
	type TextOverlay,
	type TransitionClip,
	type VideoOverlay,
} from "./timeline-model.ts";
import { mergeMarkerMetadata } from "./timeline-markers.ts";
import type { ProjectSelection } from "./project-selection.ts";

export type ClipType =
	| "image"
	| "video"
	| "text"
	| "audio"
	| "effect"
	| "transition"
	| "infographic"
	| "caption";

export interface Clip {
	id: string;
	type: ClipType;
	startSec: number;
	durationSec: number;
	track: number;
	scene?: Scene;
	video?: VideoOverlay;
	text?: TextOverlay;
	audio?: AudioOverlay;
	infographic?: InfographicOverlay;
	effect?: EffectClip;
	transition?: TransitionClip;
	caption?: CaptionCue;
	markerId?: number;
	refIds?: string[];
	useGlobalReferences?: boolean;
	vis?: { sceneId: number; vclip: SceneVisualClip };
}

export interface SceneMarker {
	id: number;
	title: string;
	clipIds: string[];
	startSec: number;
	endSec: number;
	beat?: string;
	voiceoverText?: string;
	storyBeatId?: string;
	sourceRevisionId?: string;
}

/* A chapter: the container a run of scenes belongs to, and what the script view
 * renders a centred header for.
 *
 * Its own record rather than a reused `SceneMarker`, because a marker is a live
 * per-scene feature — the vui ruler projects every one of them as a draggable
 * labelled marker — and because a chapter has to outlive its scenes: it must be
 * representable while empty, must survive deletion of any member including the
 * first, and must let a scene be moved into it without rewriting what that scene
 * came from.
 *
 * Order is NOT here. A chapter's position is the position of its earliest scene,
 * derived on render, so it cannot disagree with the timeline. Neither are its
 * running time or word count, which are computed for display and would be a
 * stale total the moment a scene moved. */
export interface Chapter {
	id: string;
	title: string;
	/** Authored prose introducing what the chapter is for. Nothing generates one,
	 *  so it is absent until an operator writes it, and a chapter without one
	 *  renders its header with no brief rather than a placeholder. */
	brief?: string;
}

export interface TimelineDoc {
	schemaVersion: 2;
	clips: Clip[];
	markers: SceneMarker[];
	captionSet?: CaptionSet;
	captions?: CaptionConfig;
	/** Absent on every document written before chapters existed; seeded on read
	 *  by `seedChapters` so the script view always has one to render into. */
	chapters?: Chapter[];
	/** Independent point annotations; never participate in clip timing. */
	bookmarks?: Bookmark[];
	projectReferences?: ProjectSelection;
}

/** The per-family views a document projects to. */
export interface EditorViews {
	scenes: Scene[];
	videoOverlays: VideoOverlay[];
	textOverlays: TextOverlay[];
	audioOverlays: AudioOverlay[];
	infographicOverlays: InfographicOverlay[];
	effects: EffectClip[];
	transitions: TransitionClip[];
	projectReferences?: ProjectSelection;
	/** Derived from canonical clips, never a second editable store. */
	captionClips?: Clip[];
	captionSet?: CaptionSet;
}

// ── Clip constructors: one family's payload → one clip ──

function videoClipOf(v: VideoOverlay): Clip {
	return {
		id: clipId("video", v.id),
		type: v.kind === "video" ? "video" : "image",
		startSec: v.start,
		durationSec: v.dur,
		track: v.track ?? 0,
		video: v,
	};
}
function textClipOf(t: TextOverlay): Clip {
	return {
		id: clipId("text", t.id),
		type: "text",
		startSec: t.start,
		durationSec: t.dur,
		track: t.track ?? 0,
		text: t,
	};
}
function audioClipOf(a: AudioOverlay): Clip {
	return {
		id: clipId("audio", a.id),
		type: "audio",
		startSec: a.start,
		durationSec: a.dur,
		track: a.track ?? 0,
		audio: a,
	};
}
export function infographicClipOf(g: InfographicOverlay): Clip {
	return {
		id: clipId("infographic", g.id),
		type: "infographic",
		startSec: g.start,
		durationSec: g.dur,
		track: g.track ?? 0,
		infographic: g,
	};
}
export function effectClipOf(e: EffectClip): Clip {
	return {
		id: clipId("effect", e.id),
		type: "effect",
		startSec: e.start,
		durationSec: e.dur,
		track: e.track ?? 0,
		effect: e,
	};
}
export function transitionClipOf(t: TransitionClip): Clip {
	// A transition is positioned by the clips it bridges, so it carries a duration
	// and no start — and its id is not a `source:refId` pair.
	return {
		id: `trans:${t.id}`,
		type: "transition",
		startSec: 0,
		durationSec: t.dur,
		track: 0,
		transition: t,
	};
}

// ── Family readers: one family off a document, timing reconciled ──
//
// Timing is owned by the clip and mirrored onto the payload. Reading the clip's
// timing back onto the payload is what keeps a reader that wants one family and
// a reader that wants the whole document in agreement.

function docVideoOverlays(doc: TimelineDoc): VideoOverlay[] {
	return doc.clips
		.filter((c) => c.video)
		.map((c) => ({ ...c.video!, start: c.startSec, dur: c.durationSec, track: c.track }));
}
function docTextOverlays(doc: TimelineDoc): TextOverlay[] {
	return doc.clips
		.filter((c) => c.text)
		.map((c) => ({ ...c.text!, start: c.startSec, dur: c.durationSec, track: c.track }));
}
function docAudioOverlays(doc: TimelineDoc): AudioOverlay[] {
	return doc.clips
		.filter((c) => c.audio)
		.map((c) => ({ ...c.audio!, start: c.startSec, dur: c.durationSec, track: c.track }));
}
function docInfographics(doc: TimelineDoc): InfographicOverlay[] {
	return doc.clips
		.filter((c) => c.infographic)
		.map((c) => ({ ...c.infographic!, start: c.startSec, dur: c.durationSec, track: c.track }));
}
export function docEffects(doc: TimelineDoc): EffectClip[] {
	return doc.clips
		.filter((c) => c.effect)
		.map((c) => ({ ...c.effect!, start: c.startSec, dur: c.durationSec, track: c.track }));
}
function docTransitions(doc: TimelineDoc): TransitionClip[] {
	// A transition's payload carries its own duration and no absolute timing.
	return doc.clips.filter((c) => c.transition).map((c) => c.transition!);
}

// ── Scenes ──
//
// The one family whose extra visual clips ride as separate `vis:` clips, so its
// two directions are more than a map.

// Effective scene start: explicit start once moved, else sequential by order.
function sceneStarts(scenes: Scene[]): number[] {
	let acc = 0;
	return scenes.map((s) => {
		const start = s.start ?? acc;
		acc = start + Math.max(1, s.dur || 0);
		return start;
	});
}

/** Project a scene list into scene + `vis` clips and their derived markers. */
/** Scenes projected onto the timeline: the clips they become, and the markers
 *  that keep the scene boundaries addressable after the projection. */
interface ProjectedScenes {
	sceneClips: Clip[];
	markers: SceneMarker[];
}

function projectScenes(scenes: Scene[]): ProjectedScenes {
	const starts = sceneStarts(scenes);
	const sceneClips: Clip[] = [];
	const sceneMarkerClipIds: Record<number, string[]> = {};
	scenes.forEach((s, i) => {
		const start = starts[i]!;
		const vcs = s.visualClips ?? [];
		const primaryIdx = Math.max(
			0,
			vcs.findIndex((v) => v.primary),
		);
		const ids: string[] = [clipId("scene", s.id)];
		const primaryVc = vcs[primaryIdx];
		sceneClips.push({
			id: clipId("scene", s.id),
			type: s.img && s.endSrc ? "video" : "image",
			startSec: start,
			durationSec: Math.max(1, s.dur || 0),
			track: s.track ?? 0,
			markerId: s.id,
			refIds: s.refIds?.length ? s.refIds : undefined,
			useGlobalReferences: s.useGlobalReferences === false ? false : undefined,
			scene: { ...s, visualClips: primaryVc ? [primaryVc] : s.visualClips ? [] : undefined },
		});
		vcs.forEach((v, vi) => {
			if (vi === primaryIdx) return;
			const id = `vis:${s.id}:${v.id}`;
			ids.push(id);
			sceneClips.push({
				id,
				type: v.kind === "video" ? "video" : "image",
				startSec: start + (v.startSec ?? 0),
				durationSec: Math.max(0.5, v.durationSec ?? Math.max(1, s.dur || 0)),
				track: s.track ?? 0,
				markerId: s.id,
				vis: { sceneId: s.id, vclip: v },
			});
		});
		sceneMarkerClipIds[s.id] = ids;
	});
	const markers: SceneMarker[] = [];
	const markerByBeat = new Map<string, SceneMarker>();
	scenes.forEach((s, i) => {
		const own: SceneMarker = {
			id: s.id,
			title: s.name,
			clipIds: sceneMarkerClipIds[s.id] ?? [clipId("scene", s.id)],
			startSec: starts[i]!,
			endSec: starts[i]! + Math.max(1, s.dur || 0),
			beat: s.beat || undefined,
			voiceoverText: s.vo || undefined,
			...(s.storyBeatId ? { storyBeatId: s.storyBeatId } : {}),
			...(s.sourceRevisionId ? { sourceRevisionId: s.sourceRevisionId } : {}),
		};
		if (!s.storyBeatId) return void markers.push(own);
		const prior = markerByBeat.get(s.storyBeatId);
		if (!prior) {
			markerByBeat.set(s.storyBeatId, own);
			markers.push(own);
			return;
		}
		if (Math.abs(prior.endSec - own.startSec) > 0.001) {
			markerByBeat.set(s.storyBeatId, own);
			markers.push(own);
			return;
		}
		prior.clipIds.push(...own.clipIds);
		prior.startSec = Math.min(prior.startSec, own.startSec);
		prior.endSec = Math.max(prior.endSec, own.endSec);
		prior.voiceoverText =
			[prior.voiceoverText, own.voiceoverText].filter(Boolean).join(" ") || undefined;
	});
	return { sceneClips, markers };
}

/** The scene view of a document: promoted `vis` clips merged back into
 *  `visualClips`, and the primary re-elected from the merged list. */
function docScenes(doc: TimelineDoc): Scene[] {
	const scenes: Scene[] = [];
	const sceneStartById = new Map<number, number>();
	const extraVisuals = new Map<
		number,
		Array<{ vclip: SceneVisualClip; absStart: number; absDur: number }>
	>();
	for (const c of doc.clips) {
		if (c.scene) {
			scenes.push({
				...c.scene,
				start: c.startSec,
				track: c.track,
				dur: c.durationSec,
				...(c.refIds?.length ? { refIds: c.refIds } : {}),
				...(c.useGlobalReferences === false ? { useGlobalReferences: false } : {}),
			});
			sceneStartById.set(c.scene.id, c.startSec);
		} else if (c.vis) {
			const list = extraVisuals.get(c.vis.sceneId) ?? [];
			list.push({ vclip: c.vis.vclip, absStart: c.startSec, absDur: c.durationSec });
			extraVisuals.set(c.vis.sceneId, list);
		}
	}
	return scenes.map((s) => {
		const extras = extraVisuals.get(s.id);
		if (!extras?.length) return s;
		const sceneStart = sceneStartById.get(s.id) ?? s.start ?? 0;
		const base: SceneVisualClip[] = s.visualClips?.length
			? s.visualClips
			: s.src
				? [
						{
							id: `scene-${s.id}-visual-primary`,
							kind: "image",
							label: s.name || "Media",
							url: s.src,
							startSec: 0,
							durationSec: s.dur,
							primary: true,
						},
					]
				: [];
		const promoted = extras.map((e) => ({
			...e.vclip,
			startSec: Math.max(0, Math.round((e.absStart - sceneStart) * 100) / 100),
			durationSec: e.absDur,
		}));
		const merged = [...base, ...promoted].sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));
		const primary = merged.find((v) => v.primary) ?? merged[0];
		return {
			...s,
			visualClips: merged.map((v) => ({ ...v, primary: v === primary })),
			src: primary?.url ?? s.src,
			img: Boolean(primary?.url ?? s.src),
		};
	});
}

// ── Whole-document projection, both directions ──

export function toTimelineDoc(
	scenes: Scene[],
	videoOverlays: VideoOverlay[] = [],
	textOverlays: TextOverlay[] = [],
	audioOverlays: AudioOverlay[] = [],
	effects: EffectClip[] = [],
	transitions: TransitionClip[] = [],
	projectReferences?: ProjectSelection,
	infographicOverlays: InfographicOverlay[] = [],
	captionState: Pick<EditorViews, "captionClips" | "captionSet"> = {},
): TimelineDoc {
	const { sceneClips, markers } = projectScenes(scenes);
	return {
		schemaVersion: 2,
		clips: [
			...sceneClips,
			...videoOverlays.map(videoClipOf),
			...textOverlays.map(textClipOf),
			...audioOverlays.map(audioClipOf),
			...infographicOverlays.map(infographicClipOf),
			...effects.map(effectClipOf),
			...transitions.map(transitionClipOf),
			...(captionState.captionClips ?? []),
		],
		markers,
		projectReferences,
		...(captionState.captionSet ? { captionSet: captionState.captionSet } : {}),
	};
}

export function fromTimelineDoc(doc: TimelineDoc): EditorViews {
	return {
		scenes: docScenes(doc),
		videoOverlays: docVideoOverlays(doc),
		textOverlays: docTextOverlays(doc),
		audioOverlays: docAudioOverlays(doc),
		infographicOverlays: docInfographics(doc),
		effects: docEffects(doc),
		transitions: docTransitions(doc),
		projectReferences: doc.projectReferences,
		...(doc.captionSet
			? {
					captionClips: doc.clips.filter((clip) => clip.type === "caption"),
					captionSet: doc.captionSet,
				}
			: {}),
	};
}

// ── Document writers (pure; callers commit them through a command stack) ──

/** Append a clip. */
export function withClipInserted<D extends TimelineDoc>(doc: D, clip: Clip): D {
	return { ...doc, clips: [...doc.clips, clip] };
}

/** Drop the clip with `id`. */
export function withClipRemoved<D extends TimelineDoc>(doc: D, id: string): D {
	return { ...doc, clips: doc.clips.filter((c) => c.id !== id) };
}

/** Patch the clip matching `id` via `fn`; other clips untouched. */
export function withClipPatched<D extends TimelineDoc>(
	doc: D,
	id: string,
	fn: (clip: Clip) => Clip,
): D {
	return { ...doc, clips: doc.clips.map((c) => (c.id === id ? fn(c) : c)) };
}

/** Mirror a clip's timing onto its nested payload.
 *
 *  Timing is owned by the clip and the payload keeps the same timing mirrored, so
 *  a persisted clip round-trips identically to the array projection. Patching
 *  `startSec`/`durationSec`/`track` without this leaves the payload stale, and the
 *  family readers above read those payloads — so a stale one is wrong, not merely
 *  untidy.
 *
 *  Two payloads do not take absolute timing. A transition is positioned by its
 *  endpoints and carries only a duration. A `vis:` clip's payload timing is
 *  SCENE-LOCAL, so absolute clip timing must not be written onto it. */
export function withMirroredTiming(clip: Clip): Clip {
	// Only fields the payload ALREADY carries are refreshed. Adding one that was
	// never there would change the payload's shape, and a document built by the
	// array projection is the thing this has to match — including which keys exist.
	const mirror = <P extends object>(payload: P, keys: Record<string, number>): P => ({
		...payload,
		...Object.fromEntries(Object.entries(keys).filter(([k, v]) => k in payload && v !== undefined)),
	});
	const timing = { start: clip.startSec, dur: clip.durationSec, track: clip.track };
	if (clip.scene) return { ...clip, scene: mirror(clip.scene, timing) };
	if (clip.video) return { ...clip, video: mirror(clip.video, timing) };
	if (clip.text) return { ...clip, text: mirror(clip.text, timing) };
	if (clip.audio) return { ...clip, audio: mirror(clip.audio, timing) };
	if (clip.infographic) return { ...clip, infographic: mirror(clip.infographic, timing) };
	if (clip.effect) return { ...clip, effect: mirror(clip.effect, timing) };
	if (clip.transition)
		return { ...clip, transition: mirror(clip.transition, { dur: clip.durationSec }) };
	// `vis` payload timing is scene-local, so absolute clip timing must not touch it.
	return clip;
}

/** Per-family overrides for a canonical document rebuild (unset families read the doc). */
type FamilyOverrides = Partial<EditorViews>;

/** Rebuild the whole `clips[]` (+ derived markers) canonically from its families,
 *  overriding the given ones. Identical in construction and order to
 *  `toTimelineDoc`, so a single-family edit diffs to one narrow clip command.
 *  Marker metadata (title/beat/voiceover) is authoritative on the document and
 *  survives the rebuild; the range and clip ids are re-derived. */
export function rebuildDocWith<D extends TimelineDoc>(doc: D, over: FamilyOverrides): D {
	const { sceneClips, markers } = projectScenes(over.scenes ?? docScenes(doc));
	const rest: Clip[] = [
		...(over.videoOverlays ?? docVideoOverlays(doc)).map(videoClipOf),
		...(over.textOverlays ?? docTextOverlays(doc)).map(textClipOf),
		...(over.audioOverlays ?? docAudioOverlays(doc)).map(audioClipOf),
		...(over.infographicOverlays ?? docInfographics(doc)).map(infographicClipOf),
		...(over.effects ?? docEffects(doc)).map(effectClipOf),
		...(over.transitions ?? docTransitions(doc)).map(transitionClipOf),
		...(over.captionClips ?? doc.clips.filter((clip) => clip.type === "caption")),
	];
	const projectReferences =
		"projectReferences" in over ? over.projectReferences : doc.projectReferences;
	return {
		...doc,
		clips: [...sceneClips, ...rest],
		markers: mergeMarkerMetadata(markers, doc.markers),
		...("captionSet" in over ? { captionSet: over.captionSet } : {}),
		projectReferences,
	};
}
