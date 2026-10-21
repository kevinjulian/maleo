/* Applying an agent run's output onto the editor document.
 *
 * This lived as a 91-line closure inside `CreateContent`, reading three refs it
 * never declared as inputs and calling `Date.now()` four times with hand-picked
 * offsets (+2000, +3000, +3500, +4000) so its sub-merges would not mint colliding
 * ids. It could only be reached by mounting the editor, so its coverage was
 * source-text assertions rather than behaviour.
 *
 * Each family is a pure merge over the editor's current value, so the component
 * can keep calling them inside functional setters — the agent streams patches,
 * and reading `prev` from the setter rather than from a render closure is what
 * keeps a burst of commits from applying to stale state.
 *
 * Ids derive from a caller-supplied seed rather than the clock, so the same input
 * produces the same document. */
import {
	applyDirector,
	isPendingMediaUrl,
	sourceAudioSettings,
	trimMediaTiming,
	EMOTIONS,
	isStoryTitleOverlayId,
	oneOf,
	STORY_BEATS,
	TEXT_PRESETS,
	TRANSITION_TYPES,
	VISUAL_TYPES,
	type StyleKnobs,
	resequenceScenes,
	sceneFrameHash,
	sceneSpeechHash,
} from "@maleo/shared";
import { mergeAgentInfographicOverlays } from "@models/agent/merge-infographic-overlays.ts";
import { preserveAgentSceneTimeline } from "@models/timeline/editor-media.ts";
import type {
	AudioOverlay,
	InfographicOverlay,
	RefImage,
	Scene,
	TextOverlay,
	VideoOverlay,
} from "@maleo/shared";
import type {
	AgentAudioOverlayOut,
	AgentCharacterOut,
	AgentInfographicOverlayOut,
	AgentJobScene,
	AgentTextOverlayOut,
	AgentVideoOverlayOut,
} from "@models/agent/agent-wire.ts";
import { normalizeLayout } from "@models/timeline/clip-layout.ts";
import {
	resolveFreeTrack,
	upsertAgentClips,
	type TrackSpan,
} from "@models/timeline/timeline-clips.ts";
import { mergePool } from "@models/references/pool.ts";
import type { MediaAssetSeed } from "@models/timeline/media-admission.ts";
import {
	seedForArtifact,
	seedForGeneratedAudio,
	seedForGeneratedVideo,
	seedForSceneFrame,
} from "@models/timeline/media-seeds.ts";

/** Id ranges, one per family, so two sub-merges never mint the same id. The
 *  offsets are the ones the clock-based version used. */
const SCENE_ID_OFFSET = 0;
const TEXT_ID_OFFSET = 2000;
const VIDEO_ID_OFFSET = 3000;
const INFOGRAPHIC_ID_OFFSET = 3500;
const AUDIO_ID_OFFSET = 4000;

/** Admit a media URL to the project and answer with its identity.
 *
 *  Threaded in rather than imported: admission is a React closure over the
 *  reference library, and this module is pure so its merges stay testable
 *  without mounting the editor. An agent run placing thirty sound effects
 *  admits thirty assets in one pass, which the library's ref mirror supports —
 *  several admissions in one turn agree on the identity of a shared URL. */
export type AdmitMedia = (seed: MediaAssetSeed) => string;

export interface SceneMergeOptions {
	/** Base for any id this merge has to mint. */
	idSeed: number;
	/** The project's default voice, applied only where a scene has none. */
	defaultCastId?: string;
	/** Style knobs the Director resolves camera, transition and beat from. */
	style?: StyleKnobs;
	/** The style snapshot's NAME, which is its only stable identity — the knobs
	 *  themselves are anonymous. It goes into a frame's input hash, so it must be
	 *  the same value the staleness check reads later; sourcing it differently at
	 *  the two admission sites would make every agent frame read as stale. */
	styleName?: string;
	/** Admission for frames the agent supplies. An agent-written clip is a
	 *  placement like any other and records the asset it used. */
	admit: AdmitMedia;
}

/** Merge the agent's scenes onto the editor's, positionally.
 *
 *  `job.scenes` is the authoritative, stable order — the blueprint split is
 *  deterministic — and the editor's list is the prior render of the same job, so
 *  index carry-over preserves each scene's id and operator-edited fields. Name
 *  matching duplicated images: two scenes sharing a name both resolved to the
 *  first match, so a scene with no frame borrowed another's while patches streamed. */
export function mergeAgentScenes(
	prev: Scene[],
	scenes: AgentJobScene[],
	opts: SceneMergeOptions,
): Scene[] {
	const next = scenes.map((s, i): Scene => {
		const before = prev[i];
		// A frame still uploading is the editor's alone, and the agent cannot name one.
		const image =
			isPendingMediaUrl(before?.src) || isPendingMediaUrl(s.image) ? undefined : s.image;
		const src = image ?? before?.src;
		// Only admit the agent's own image: a carried-over `before.src` already
		// carries whatever identity it was placed with.
		const mediaAssetId = image
			? opts.admit(seedForSceneFrame({ url: image, sceneName: s.name, slot: "start" }))
			: before?.mediaAssetId;
		return {
			id: before?.id ?? opts.idSeed + SCENE_ID_OFFSET + i,
			...preserveAgentSceneTimeline(before, s.contentDurationSec),
			dur: s.durationSec,
			name: s.name,
			shot: s.shot,
			move: s.move,
			// Carry the agent's blueprint fields so the Director respects the planned
			// beat/emotion instead of falling back to positional inference.
			beat: oneOf(s.beat, STORY_BEATS) ?? before?.beat,
			emotion: oneOf(s.emotion, EMOTIONS) ?? before?.emotion,
			intent: s.intent ?? before?.intent,
			question: s.question ?? before?.question,
			claim: s.claim ?? before?.claim,
			evidence: s.evidence ?? before?.evidence,
			sourceEvidence: s.sourceEvidence ?? before?.sourceEvidence,
			analogy: s.analogy ?? before?.analogy,
			visualType: oneOf(s.visualType, VISUAL_TYPES) ?? before?.visualType,
			onScreenText: s.onScreenText ?? before?.onScreenText,
			motionGraphic: s.motionGraphic,
			sceneKind: s.sceneKind ?? before?.sceneKind,
			sceneKey: s.sceneKey ?? before?.sceneKey,
			logicalSceneId: s.logicalSceneId ?? before?.logicalSceneId,
			sectionId: s.sectionId ?? before?.sectionId,
			storyBeatId: s.storyBeatId ?? before?.storyBeatId,
			sourceRevisionId: s.sourceRevisionId ?? before?.sourceRevisionId,
			storyboardSceneId: s.storyboardSceneId ?? before?.storyboardSceneId,
			imageSourceStoryboardSceneId:
				s.imageSourceStoryboardSceneId ?? before?.imageSourceStoryboardSceneId,
			editorialPatternId: s.editorialPatternId ?? before?.editorialPatternId,
			information: s.information ?? before?.information,
			// SAFETY: the agent wire declares the same section-transition shape, filled
			// field by field by the model (see the api's `agents/core/document.ts`).
			sectionTransition:
				(s.sectionTransition as Scene["sectionTransition"]) ?? before?.sectionTransition,
			transition: oneOf(s.transition, TRANSITION_TYPES) ?? "fade",
			vis: s.visual,
			vo: s.voiceover,
			castId: before?.castId ?? opts.defaultCastId,
			action: s.action,
			sfx: s.sfx,
			img: Boolean(image || before?.img),
			src,
			mediaAssetId,
			endSrc: before?.endSrc,
			endMediaAssetId: before?.endMediaAssetId,
			seed: before?.seed,
			/* What produced this scene's assets, stamped only when the agent actually
			 * produced them. Carrying the prior hash for an untouched scene is the
			 * point: a run that rewrote nothing must not mark its frames stale. Both
			 * hashes read the merged scene's own fields, which is what keeps them
			 * comparable with the staleness check later. */
			frameInputHash: image
				? sceneFrameHash(
						{ vis: s.visual, refIds: s.refIds ?? before?.refIds ?? [], seed: before?.seed },
						{ stylePreset: opts.styleName },
					)
				: before?.frameInputHash,
			speechInputHash:
				s.contentDurationSec !== undefined
					? sceneSpeechHash({
							vo: s.voiceover,
							castId: before?.castId ?? opts.defaultCastId,
							voiceId: before?.voiceId,
						})
					: before?.speechInputHash,
			refIds: s.refIds ?? before?.refIds ?? [],
			voiceIds: before?.voiceIds ?? [],
			noteIds: before?.noteIds ?? [],
			layout: s.layout
				? normalizeLayout({ ...before?.layout, ...s.layout }, "scene")
				: before?.layout,
			...((before?.visualClips ?? s.visualClips)
				? { visualClips: before?.visualClips ?? s.visualClips }
				: {}),
		};
	});
	// Video Director: resolve camera/transition/beat per scene from the chosen
	// style preset (no-op when none is selected) so the editor reflects the blueprint.
	return resequenceScenes(applyDirector(next, opts.style));
}

/** Merge text overlays, placing each incoming clip on a track it does not collide
 *  on. Overlays the agent re-sends replace the editor's copy; ones it does not
 *  mention survive. */
export function mergeAgentTextOverlays(
	prev: TextOverlay[],
	incoming: AgentTextOverlayOut[],
	idSeed: number,
): TextOverlay[] {
	const incomingIds = new Set(
		incoming.map((t) => t.id).filter((id): id is number => typeof id === "number"),
	);
	const stableTitles = incoming.filter((clip) => isStoryTitleOverlayId(clip.id));
	// A longform section title used to be minted fresh each run, so the previous
	// run's copy survives as a content-and-position duplicate unless dropped.
	const isLegacyTitleDuplicate = (clip: TextOverlay): boolean =>
		stableTitles.some(
			(title) =>
				clip.content === title.content &&
				Math.abs(clip.start - title.startSec) < 0.01 &&
				(clip.preset ?? "title") === (title.preset ?? "title"),
		);

	const map = new Map<number, TextOverlay>(
		prev
			.filter((clip) => !incomingIds.has(clip.id) && !isLegacyTitleDuplicate(clip))
			.map((clip) => [clip.id, clip]),
	);
	const occupied: TrackSpan[] = [...map.values()].map((clip) => ({
		start: clip.start,
		dur: clip.dur,
		track: clip.track ?? 0,
	}));
	let nextId = idSeed + TEXT_ID_OFFSET;
	for (const t of incoming) {
		const id = t.id ?? nextId++;
		const start = t.startSec;
		const dur = t.durationSec;
		const track = resolveFreeTrack(occupied, { start, dur }, t.track ?? 0);
		map.set(id, {
			id,
			content: t.content,
			start,
			dur,
			preset: oneOf(t.preset, TEXT_PRESETS) ?? "title",
			track,
			layout: t.layout ? normalizeLayout(t.layout, "text") : undefined,
		});
		occupied.push({ start, dur, track });
	}
	return [...map.values()];
}

export function mergeAgentVideoOverlays(
	prev: VideoOverlay[],
	incoming: AgentVideoOverlayOut[],
	idSeed: number,
	admit: AdmitMedia,
): VideoOverlay[] {
	return upsertAgentClips(
		prev,
		incoming,
		(v) => v.id,
		(v, id) => {
			const existing = prev.find((p) => p.id === id);
			const item: VideoOverlay = {
				...existing,
				id,
				url: v.url,
				mediaAssetId: admit(
					v.kind === "video"
						? seedForGeneratedVideo({
								url: v.url,
								label: v.label,
								thumb: v.thumb ?? existing?.thumb,
								durationSec: v.sourceDurationSec ?? v.durationSec,
							})
						: seedForArtifact({
								url: v.url,
								mediaType: "image",
								label: v.label,
								durationSec: v.durationSec,
							}),
				),
				kind: v.kind,
				label: v.label,
				start: v.startSec,
				dur: v.durationSec,
				thumb: v.thumb ?? existing?.thumb,
				sourceDurationSec: v.sourceDurationSec ?? existing?.sourceDurationSec,
				track: v.track ?? existing?.track ?? 0,
				source: existing?.source ?? "generated",
				volume: existing?.volume ?? v.volume,
				mediaStartSec: v.mediaStartSec ?? existing?.mediaStartSec,
				layout: v.layout
					? normalizeLayout({ ...existing?.layout, ...v.layout }, v.kind)
					: existing?.layout,
			};
			return item.kind === "video" && item.sourceDurationSec != null
				? { ...item, ...trimMediaTiming(item, { dur: item.dur }, item.sourceDurationSec) }
				: item;
		},
		idSeed + VIDEO_ID_OFFSET,
	);
}

export function mergeAgentInfographics(
	prev: InfographicOverlay[],
	incoming: AgentInfographicOverlayOut[] | undefined,
	idSeed: number,
): InfographicOverlay[] {
	return mergeAgentInfographicOverlays(prev, incoming, idSeed + INFOGRAPHIC_ID_OFFSET);
}

/** Merge audio, preferring the operator's mix. Volume and fades are theirs to
 *  set; caption words come from the agent only when it has some. */
export function mergeAgentAudioOverlays(
	prev: AudioOverlay[],
	incoming: AgentAudioOverlayOut[],
	idSeed: number,
	admit: AdmitMedia,
): AudioOverlay[] {
	return upsertAgentClips(
		prev,
		incoming,
		(a) => a.id,
		(a, id) => {
			const existing = prev.find((p) => p.id === id);
			// One agent run can place thirty sound effects; admission dedups on URL,
			// so the same effect reused across beats is one asset and thirty clips.
			const mediaAssetId = a.url
				? admit(
						seedForGeneratedAudio({
							url: a.url,
							content: a.content,
							kind: a.kind,
							durationSec: a.durationSec,
						}),
					)
				: existing?.mediaAssetId;
			return {
				...sourceAudioSettings(a),
				...existing,
				animation: existing ? existing.animation : a.animation,
				id,
				kind: a.kind,
				origin: a.origin,
				content: a.content,
				url: a.url,
				mediaAssetId,
				voice: a.voice,
				start: a.startSec,
				dur: a.durationSec,
				track: a.track ?? existing?.track ?? 0,
				volume: existing?.volume ?? a.volume,
				fadeIn: existing?.fadeIn ?? a.fadeIn,
				fadeOut: existing?.fadeOut ?? a.fadeOut,
				duckUnderVoice: existing?.duckUnderVoice ?? a.duckUnderVoice,
				// The clip's source length and in-point. The server sends both (a generated
				// voiceover gets originalDur = its measured duration); this merge copies
				// field by field, and the client's copy of the contract did not declare
				// them, so they were dropped — which is why an agent-created audio clip
				// showed no length-percent badge while a dragged-in one did.
				originalDur: a.originalDur ?? existing?.originalDur,
				mediaStartSec: a.mediaStartSec ?? existing?.mediaStartSec,
				words: a.words?.length ? a.words : existing?.words,
			};
		},
		idSeed + AUDIO_ID_OFFSET,
	);
}

/** Fold agent-created characters into the reference pool, attached to the roster.
 *
 *  The server's entity id is authoritative: minting one here gave the same
 *  character a new identity on every apply, so re-applying a settled job — a run,
 *  then a reload that resumes it — duplicated it. Generation resolves ids through
 *  the roster, so an unattached entity would render nothing. */
export function mergeAgentCharacters(
	prev: RefImage[],
	characters: AgentCharacterOut[],
): RefImage[] {
	const chars: RefImage[] = characters.map((ch, i) => ({
		id: ch.id ?? `char-${ch.name}`,
		label: ch.name,
		note: ch.description,
		src: ch.image,
		seed: i,
		tags: ["character"],
		kind: "character",
		gen: true,
	}));
	return mergePool(prev, chars, { inRoster: true });
}
