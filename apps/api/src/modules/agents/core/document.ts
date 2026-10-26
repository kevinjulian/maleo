import { applyCommand, diffScopeToCommand, type EditorDoc } from "@maleo/shared/editor";
/* A run's timeline document — the agent's families projected onto the canonical
 * clip-first contract (schemaVersion 2).
 *
 * The projection itself is NOT here. `toTimelineDoc()` in `@maleo/shared` owns
 * it and the editor writes through the same function, so a clip the agent
 * persists and a clip the editor autosaves are built by one implementation. This
 * module owns only what is genuinely the agent's: translating the wire types in
 * `@maleo/shared/agent-wire` (`startSec`/`durationSec`/`image`, ids optional on
 * agent-created clips) into the editor families the document is projected from
 * (`start`/`dur`/`src`, ids required).
 *
 * `persist()` used to assemble the clips by hand. The copy had drifted — its
 * scene clip type was a ternary with the same branch twice, and its markers
 * omitted the `startSec`/`endSec` the SceneMarker contract requires, which only
 * type-checked because the whole array was cast to `never` at the write. */
import type { AudioOverlay, Scene, TextOverlay, VideoOverlay, EditorViews } from "@maleo/shared";
import type { Clip } from "@maleo/shared";
import {
	EMOTIONS,
	clipControlBlockers,
	audioAnimationSchema,
	sourceAudioSettings,
	oneOf,
	STORY_BEATS,
	TEXT_PRESETS,
	TRANSITION_TYPES,
	VISUAL_TYPES,
} from "@maleo/shared";
import { withGeneratedNarrationCaptions, toTimelineDoc, trimMediaTiming } from "@maleo/shared";
import type { AgentJob } from "./model.ts";

/** The families the agent owns. Effects and transitions are the editor's and
 *  reach the document as carried-through client clips, never from a job. */
export type AgentEditorViews = Pick<
	EditorViews,
	"scenes" | "videoOverlays" | "textOverlays" | "audioOverlays"
>;

/* An id minter that starts above every id already in the family. A clip seeded
 * from a saved storyboard keeps its own id so transition refs (`video:5` …) and
 * moved rows survive the run; only agent-created clips take a fresh one. */
function freshId(existing: ReadonlyArray<number | undefined>): () => number {
	let next = existing.reduce<number>((m, v) => Math.max(m, v ?? 0), 0) + 1;
	return () => next++;
}

/* The agent sends these as loose strings — `AgentScene` types them `string`
 * because a model fills them, and that is right for the wire. What was wrong was
 * the next step: this function used to CAST each one into the editor's narrower
 * union, with a comment saying "the client narrows on read". It does not — by
 * the time the client sees the value it is already typed as a member, so there
 * is nothing left to reject, and a beat the model invented reached a renderer
 * with no case for it.
 *
 * Each is now checked against the union's own member list. A non-member falls
 * back rather than throwing: this runs on live generation output, and losing one
 * field to a fallback is a smaller failure than dropping the scene. */

/* A fallback that fires silently cannot be verified — not in a live run, and not
 * in production either. The value came from a model, so a non-member is the one
 * thing worth knowing about here: it says the prompt and the union have drifted
 * apart, and the only symptom otherwise is a field that quietly stopped arriving.
 *
 * Warn rather than throw, for the reason above: the scene is still worth having.
 * An absent field is silent, because the model declining to fill an optional
 * field is not drift. */
function sceneUnion<T extends string>(
	field: string,
	raw: unknown,
	members: readonly T[],
): T | undefined {
	const picked = oneOf(raw, members);
	if (picked === undefined && typeof raw === "string" && raw.trim() !== "") {
		console.warn(
			`[agent/document] scene.${field}: model returned ${JSON.stringify(raw)}, which is not one of ${members.join(" | ")} — falling back`,
		);
	}
	return picked;
}
const asSceneUnions = (
	s: AgentJob["scenes"][number],
): Pick<
	Scene,
	"transition" | "beat" | "emotion" | "visualType" | "layout" | "sectionTransition"
> => ({
	transition: sceneUnion("transition", s.transition, TRANSITION_TYPES) ?? "fade",
	beat: sceneUnion("beat", s.beat, STORY_BEATS),
	emotion: sceneUnion("emotion", s.emotion, EMOTIONS),
	visualType: sceneUnion("visualType", s.visualType, VISUAL_TYPES),
	// SAFETY: `layout` and `sectionTransition` are object shapes, not string
	// unions, so `oneOf` does not apply. Both are carried at the type the agent
	// wire declares for them — `AgentClipLayout` and the section-transition
	// shape — which the model fills field by field. Narrowing them needs a shape
	// check rather than a membership one; see task 1.6.
	layout: s.layout as Scene["layout"],
	// SAFETY: as above — the section-transition shape the agent wire declares.
	sectionTransition: s.sectionTransition as Scene["sectionTransition"],
});

function sceneOf(s: AgentJob["scenes"][number], id: number, editor: Scene | undefined): Scene {
	return {
		// The editor's own fields first; every field the agent's view carries wins.
		...editor,
		id,
		start: s.startSec,
		track: s.track,
		...(s.visualClips ? { visualClips: s.visualClips } : {}),
		dur: s.durationSec,
		contentDur: s.contentDurationSec,
		name: s.name,
		shot: s.shot,
		move: s.move,
		vis: s.visual,
		vo: s.voiceover,
		action: s.action,
		sfx: s.sfx,
		src: s.image,
		img: Boolean(s.image),
		refIds: s.refIds?.length ? s.refIds : undefined,
		useGlobalReferences: s.useGlobalReferences,
		intent: s.intent,
		question: s.question,
		claim: s.claim,
		evidence: s.evidence,
		sourceEvidence: s.sourceEvidence?.length ? s.sourceEvidence : undefined,
		analogy: s.analogy,
		onScreenText: s.onScreenText,
		sceneKind: s.sceneKind,
		sceneKey: s.sceneKey,
		logicalSceneId: s.logicalSceneId,
		sectionId: s.sectionId,
		...(s.storyBeatId ? { storyBeatId: s.storyBeatId } : {}),
		...(s.sourceRevisionId ? { sourceRevisionId: s.sourceRevisionId } : {}),
		storyboardSceneId: s.storyboardSceneId,
		imageSourceStoryboardSceneId: s.imageSourceStoryboardSceneId,
		editorialPatternId: s.editorialPatternId,
		information: s.information,
		...asSceneUnions(s),
	};
}

/** The editor families a job's own state projects to. */
export function agentEditorViews(job: AgentJob): AgentEditorViews {
	const nextVideoId = freshId(job.videoOverlays.map((v) => v.id));
	const nextTextId = freshId(job.textOverlays.map((t) => t.id));
	const nextSceneId = freshId(job.scenes.map((s) => s.id));

	const videoOverlays: VideoOverlay[] = job.videoOverlays
		.map((v) => ({
			...(v.thumb ? { thumb: v.thumb } : {}),
			...(v.sourceDurationSec != null ? { sourceDurationSec: v.sourceDurationSec } : {}),
			id: v.id ?? nextVideoId(),
			url: v.url,
			kind: v.kind,
			label: v.label,
			start: v.startSec,
			dur: v.durationSec,
			track: v.track ?? 0,
			// SAFETY: the agent wire's `AgentClipLayout`, carried as in `asSceneUnions` above.
			layout: v.layout as VideoOverlay["layout"],
			...(v.volume == null ? {} : { volume: v.volume }),
			...(v.mediaStartSec == null ? {} : { mediaStartSec: v.mediaStartSec }),
			...(v.mediaAssetId ? { mediaAssetId: v.mediaAssetId } : {}),
		}))
		.map((item) =>
			item.kind === "video" && item.sourceDurationSec != null
				? { ...item, ...trimMediaTiming(item, { dur: item.dur }, item.sourceDurationSec) }
				: item,
		);
	const textOverlays: TextOverlay[] = job.textOverlays.map((t) => ({
		id: t.id ?? nextTextId(),
		content: t.content,
		start: t.startSec,
		dur: t.durationSec,
		track: t.track ?? 0,
		preset: sceneUnion("textOverlay.preset", t.preset, TEXT_PRESETS) ?? "plain",
		style: t.style,
		params: t.params,
		// SAFETY: the agent wire's `AgentClipLayout`, carried as in `asSceneUnions` above.
		layout: t.layout as TextOverlay["layout"],
	}));
	const audioOverlays: AudioOverlay[] = job.audioOverlays.map((a) => ({
		...sourceAudioSettings(a),
		...(a.animation ? { animation: audioAnimationSchema.parse(a.animation) } : {}),
		id: a.id,
		kind: a.kind,
		origin: a.origin,
		content: a.content,
		url: a.url,
		voice: a.voice,
		start: a.startSec,
		dur: a.durationSec,
		track: a.track ?? 0,
		volume: a.volume ?? 1,
		fadeIn: a.fadeIn ?? 0,
		fadeOut: a.fadeOut ?? 0,
		originalDur: a.originalDur,
		mediaStartSec: a.mediaStartSec,
		words: a.words?.length ? a.words : undefined,
		...(a.duckUnderVoice == null ? {} : { duckUnderVoice: a.duckUnderVoice }),
		...(a.mediaAssetId ? { mediaAssetId: a.mediaAssetId } : {}),
	}));

	const editorById = new Map((job.editorScenes ?? []).map((scene) => [scene.id, scene]));
	return {
		scenes: job.scenes.map((s) =>
			sceneOf(s, s.id ?? nextSceneId(), s.id === undefined ? undefined : editorById.get(s.id)),
		),
		videoOverlays,
		textOverlays,
		audioOverlays,
	};
}

/** The job's snapshot as a document: the agent's clips, then the editor-owned
 *  clips (effects, transitions, `vis:`, client audio) carried through verbatim.
 *  Client clips are appended rather than projected — they are opaque to the
 *  agent, which must not re-derive what it does not own. */
export function agentTimelineDoc(
	job: AgentJob,
	clientClips: readonly Clip[] = [],
	before?: EditorDoc,
): EditorDoc {
	const views = agentEditorViews(job);
	const doc = toTimelineDoc(
		views.scenes,
		views.videoOverlays,
		views.textOverlays,
		views.audioOverlays,
	);
	const keyIssues = clipControlBlockers(doc);
	if (keyIssues.length) throw new Error(keyIssues.join(" "));
	let next: EditorDoc = {
		...doc,
		clips: [...doc.clips, ...clientClips],
		...(job.clientCaptionSet ? { captionSet: job.clientCaptionSet } : {}),
	};
	if (before) {
		const scope = { doc: before, slides: [], posts: [], mediaAssets: [] };
		next = applyCommand(
			scope,
			diffScopeToCommand(scope, { ...scope, doc: { ...before, ...next } }, "agent.sources"),
		).doc;
	}
	return withGeneratedNarrationCaptions(next, job.generatedCaptionSources, applyCommand);
}
