/* Persistence leaf — write a job's state to the content-storyboard store and read
 * a prior saved storyboard back into a new job (seed clips/slides/posts/artifacts).
 * Owns the unit-lifecycle projection and what the agent carries forward across its
 * writes; the clip-first (schemaVersion 2) serialization itself belongs to
 * `document.ts`, which projects a job through the editor's own `toTimelineDoc`.
 * Pure DB I/O + leaf helpers (overlay sync, plan-state getters); domain
 * types are imported type-only from the orchestrator, so both the orchestrator and
 * the flow services import these directly (no runtime cycle). */
import { DOCUMENT_FIELD_KINDS } from "./content-state.ts";
import type {
	AgentJob,
	AgentScene,
	AgentTextOverlay,
	AgentVideoOverlay,
	AgentAudioOverlay,
} from "./model.ts";
import type { StorySection } from "../../../lib/story.ts";
import {
	agentSceneFromScene,
	fromTimelineDoc,
	sourceAudioSettings,
	type Clip,
	type Scene,
} from "@maleo/shared";
import type { UnitLifecycle, UnitStatus } from "./pipeline.ts";
import {
	documentArtifacts,
	effectClipOf,
	pipelineArtifactKinds,
	seedableArtifactKind,
	type PipelineArtifact,
	readStoryboardDocument,
	transitionClipOf,
	writeStoryboardDocument,
	SCENE_TEXT_CLIP_MIGRATION_VERSION,
	VisualContractError,
} from "@maleo/shared";
import { getContentProject } from "@maleo/db/project-detail";
import { addContentStoryboard, StoryboardRevisionConflict } from "@maleo/db/storyboards";
import { agentTimelineDoc } from "./document.ts";
import { type EditorDoc, readAgentEditMarker } from "@maleo/shared/editor";
import { isEditOnlyRun, rebaseRunEdits } from "./edit-rebase.ts";
import { syncSceneTextOverlays, syncSceneTransitions } from "./overlays.ts";
import { getStoryPlan } from "./plan-state.ts";
import { saveRun } from "./run-repository.ts";
import { adoptJobArtifact, settleJobArtifacts } from "./artifact-store.ts";

type SeededOverlays = Pick<AgentJob, "textOverlays" | "videoOverlays" | "audioOverlays">;

// ── Unit lifecycle ──────────────────────────────────────────────────────────

function storyUnitStatus(status: StorySection["status"]): UnitStatus {
	if (status === "ready") return "ready";
	if (status === "failed") return "failed";
	if (status === "pending" || status === "voicing" || status === "imaging") return "generating";
	return "proposed";
}

export function buildUnitLifecycle(job: AgentJob): UnitLifecycle {
	const units: UnitLifecycle["units"] = [];
	const plan = getStoryPlan(job);
	if (plan) {
		const seen = new Set<string>();
		for (const section of plan.sections) {
			const sectionId = section.sectionId ?? section.id;
			if (seen.has(sectionId)) continue;
			seen.add(sectionId);
			units.push({
				id: `section:${sectionId}`,
				sourceId: sectionId,
				granularity: "section",
				status: storyUnitStatus(section.status),
				title: section.title,
			});
		}
		return { schemaVersion: 1, units };
	}
	for (const [i, scene] of job.scenes.entries()) {
		units.push({
			id: `beat:${i + 1}`,
			granularity: "beat",
			status: scene.image ? "ready" : "approved",
			title: scene.name || `Scene ${i + 1}`,
		});
	}
	return { schemaVersion: 1, units };
}

// ── Write ───────────────────────────────────────────────────────────────────

export async function persist(job: AgentJob): Promise<void> {
	// WP3: snapshot the full run to workflow_run on every settle point so a parked
	// or in-flight run survives a restart on any instance.
	await saveRun(job);
	// Approval/start checkpoints carry no authored edit; never save their stale snapshot.
	if (job.run && !job.run.jobWrites && !job.editCommands?.length) return;
	// Preserve client-owned fields (references, presentation settings, effects,
	// transitions, captions) from the latest saved storyboard — otherwise the server's
	// per-step writes become the newest version and a reload loses them.
	const latest = await (async () => {
		try {
			return (await getContentProject(job.projectId))?.storyboards?.[0] ?? null;
		} catch {
			/* best-effort */ return null;
		}
	})();
	const prev = latest?.storyboard_json ?? null;
	/* One read of the prior document, and the only one. This module used to read it
	 * twice: once through `readStoryboardDocument` for the editor-owned fields, and
	 * again by hand, walking `prev.clips`, `prev.effects` and `prev.transitions` as
	 * dictionaries to rebuild the clips to carry forward. Two readers of one blob is
	 * how the agent and the editor come to disagree about the same timeline — which
	 * is precisely what the comment below says this write exists to prevent. */
	const prior = readStoryboardDocument(prev);
	const priorDoc = prior.doc;
	syncSceneTextOverlays(job);
	syncSceneTransitions(job);
	// Client-owned clips to preserve (effects + transitions). When the client sent a
	// live doc, use its effect/transition clips verbatim (no autosave race). Otherwise
	// re-derive from the previous saved version (v2 clips, else legacy v1 arrays).
	const jobAudioIds = new Set(job.audioOverlays.map((a) => `audio:${a.id}`));
	let keepClient =
		job.clientClips ??
		priorDoc.clips.filter(
			(c) =>
				c.type === "effect" ||
				c.type === "transition" ||
				c.id.startsWith("vis:") ||
				(c.type === "audio" && !jobAudioIds.has(c.id)),
		);
	// Caption state comes from the latest save after concurrent edits, including an empty set.
	const captionState =
		(latest?.id ?? null) === (job.baseRevisionId ?? null) && job.clientCaptionSet
			? { captionSet: job.clientCaptionSet, clips: job.clientClips ?? [] }
			: priorDoc;
	keepClient = [
		...keepClient.filter((clip) => clip.type !== "caption"),
		...captionState.clips.filter((clip) => clip.type === "caption"),
	];
	if (!keepClient.length && !job.clientClips) {
		// Pre-v2 document: the same decode the editor's load path runs, projected
		// through the same clip constructors, rather than a second hand-rolled copy.
		keepClient = [
			...prior.legacyArrays.effects.map(effectClipOf),
			...prior.legacyArrays.transitions.map(transitionClipOf),
		];
	}
	// Write the canonical clip-first contract (schemaVersion 2) through the one
	// projection the editor also writes through, so an agent snapshot and a client
	// autosave produce the same clips for the same timeline. The agent owns the
	// scene / text / video clips + its voiceover audio; `keepClient` carries the
	// editor's effect and transition clips through untouched.
	/* An edit-only run saves its commands, executed onto the document as it now
	 * stands, not its own projection, which would overwrite anything saved since
	 * (`edit-rebase.ts`). */
	const rebased = isEditOnlyRun(job)
		? rebaseRunEdits(job, {
				id: latest?.id ?? null,
				doc: {
					schemaVersion: 2,
					clips: priorDoc.clips,
					markers: priorDoc.markers,
					...(priorDoc.captionSet ? { captionSet: priorDoc.captionSet } : {}),
				},
				marker: readAgentEditMarker(prev),
			})
		: undefined;
	if (rebased?.status === "unchanged") return;
	if (rebased?.status === "conflict") {
		job.editConflict = rebased.reason;
		await saveRun(job);
		return;
	}
	const doc: EditorDoc =
		rebased?.doc ??
		agentTimelineDoc(
			{ ...job, clientCaptionSet: captionState.captionSet ?? undefined },
			keepClient,
			{
				schemaVersion: 2,
				clips: [
					...priorDoc.clips.filter((clip) => clip.type !== "caption"),
					...keepClient.filter((clip) => clip.type === "caption"),
				],
				markers: priorDoc.markers,
				captionSet: captionState.captionSet ?? undefined,
				trackFlags: priorDoc.trackFlags ?? undefined,
			},
		);
	// The agent holds no captions or pacing devices — those are
	// the editor's. It reads the prior document and supplies them explicitly rather
	// than spreading a hand-listed set of keys and letting absence mean "not mine".
	const storyboard_json = {
		...writeStoryboardDocument({
			schemaVersion: 2,
			sceneTextClipMigrationVersion: SCENE_TEXT_CLIP_MIGRATION_VERSION,
			clips: doc.clips,
			markers: doc.markers,
			/* Chapters are the editor's, like captions below: the agent groups scenes by
			 * writing `sectionId`, and the chapter records that names come from the prior
			 * document. Carrying them through is what stops an agent run from erasing a
			 * chapter title or brief the operator wrote. */
			chapters: priorDoc.chapters,
			bookmarks: priorDoc.bookmarks,
			projectReferences: priorDoc.projectReferences,
			// Materials are the editor's too: the agent READS them to generate and must
			// never be the thing that rewrites what it was told to generate from.
			materials: priorDoc.materials,
			captions: priorDoc.captions,
			captionSet: doc.captionSet ?? captionState.captionSet ?? null,
			pacingDevices: priorDoc.pacingDevices,
			// Render-affecting presentation is the editor's, like the style config above:
			// carried through so an agent write does not silently un-hide a track.
			trackFlags: { ...priorDoc.trackFlags, ...doc.trackFlags },
			presentation: priorDoc.presentation,
			unitLifecycle: buildUnitLifecycle(job),
			artifacts: job.artifacts.filter((artifact) => !DOCUMENT_FIELD_KINDS.has(artifact.kind)),
		}),
		/* Which run wrote this version, and how many of its commands it holds: how
		 * the next save of the same run knows what is already in it. */
		agentEdit: { runId: job.id, applied: rebased?.applied ?? job.editCommands?.length ?? 0 },
	};
	try {
		await addContentStoryboard({
			project_id: job.projectId,
			expectedRevisionId: latest?.id ?? null,
			source_prompt: null,
			reference_notes: null,
			status: "storyboard",
			storyboard_json,
		});
	} catch (error) {
		if (error instanceof StoryboardRevisionConflict || error instanceof VisualContractError) {
			job.editConflict = error.message;
			await saveRun(job);
		}
		/* Other persistence remains best-effort; loop continues. */
	}
}

// ── Read (seed a new job from the latest saved storyboard) ──────────────────

export async function loadPriorArtifacts(projectId: string): Promise<PipelineArtifact[]> {
	try {
		// The one caller that needs the whole version history: the scan below walks
		// newest→oldest looking for each artifact kind, so the detail read's default
		// of one version would silently drop every artifact not on the head.
		const detail = await getContentProject(projectId, undefined, { storyboardLimit: null });
		// Recover the newest of EACH artifact kind across versions, scanning newest→oldest.
		// A client timeline autosave serializes clips only (no artifacts), so the head
		// version can lack them; and a later partial run can persist one kind (e.g. a fresh
		// research_bundle) without the plan. Reading [0] — or stopping at the first version
		// with any artifacts — would drop the live longform_plan and force a re-plan on
		// approval. Singletons (longform_plan, research_bundle) take the newest single; the
		// collection kinds (knowledge, media) take the full set from the newest version that
		// carries that kind. style_bible is a singleton style lock reused by later
		// frame generation.
		const out: PipelineArtifact[] = [];
		const lockedSingletons = new Set<string>();
		const lockedSets = new Set<string>();
		for (const sb of detail?.storyboards ?? []) {
			// Artifacts are agent bookkeeping the document carries through; reading them
			// via the contract means this stops depending on the blob's shape.
			// The seedable-kind rule lives in `@maleo/shared` because storyboard
			// retention pins the same carriers.
			const valid = sb?.storyboard_json
				? documentArtifacts(readStoryboardDocument(sb.storyboard_json).doc.artifacts).filter(
						(a) => seedableArtifactKind(a) !== null,
					)
				: [];
			for (const a of valid) {
				if (pipelineArtifactKinds.get(a.kind)?.singleton) {
					if (lockedSingletons.has(a.kind)) continue;
					lockedSingletons.add(a.kind);
					out.push(a);
				} else if (!lockedSets.has(a.kind)) {
					out.push(a);
				}
			}
			for (const kind of ["knowledge", "media"]) {
				if (valid.some((a) => a.kind === kind)) lockedSets.add(kind);
			}
		}
		/* A new run takes over from whatever came before it. Progress a crashed run
		 * left in a saved document is that project's latest state, not progress this
		 * run can re-enter, so it is taken as settled. */
		const seeded = { artifacts: out };
		settleJobArtifacts(seeded);
		return seeded.artifacts;
	} catch {
		return [];
	}
}

// Extract text/video/audio overlays from a v2 clip list, preserving id + track (+
// audio volume/fade) so a run never re-homes or re-ids the user's clips.
export function overlaysFromV2Clips(clips: readonly Clip[]): SeededOverlays {
	const text: AgentTextOverlay[] = [];
	const video: AgentVideoOverlay[] = [];
	const audio: AgentAudioOverlay[] = [];
	for (const c of clips) {
		const track = c.track;
		if (c.type === "text" && c.text) {
			const t = c.text;
			text.push({
				id: t.id || undefined,
				content: t.content,
				startSec: t.start,
				durationSec: t.dur || 2,
				preset: t.preset || undefined,
				style: t.style,
				params: t.params,
				layout: t.layout,
				track,
			});
		} else if ((c.type === "image" || c.type === "video") && c.video) {
			const v = c.video;
			video.push({
				thumb: v.thumb,
				sourceDurationSec: v.sourceDurationSec,
				id: v.id || undefined,
				url: v.url,
				kind: c.type === "video" ? "video" : "image",
				startSec: v.start,
				durationSec: v.dur || 3,
				label: v.label || undefined,
				layout: v.layout,
				volume: v.volume,
				mediaStartSec: v.mediaStartSec,
				mediaAssetId: v.mediaAssetId,
				track,
			});
		} else if (c.type === "audio" && c.audio) {
			const a = c.audio;
			audio.push({
				...sourceAudioSettings(a),
				...(a.animation ? { animation: a.animation } : {}),
				id: a.id,
				kind: a.kind,
				origin: a.origin,
				content: a.content,
				url: a.url ?? "",
				voice: a.voice || undefined,
				startSec: a.start,
				durationSec: a.dur || 2,
				track,
				volume: a.volume ?? 1,
				fadeIn: a.fadeIn ?? 0,
				fadeOut: a.fadeOut ?? 0,
				originalDur: a.originalDur,
				mediaStartSec: a.mediaStartSec,
				words: a.words,
				duckUnderVoice: a.duckUnderVoice,
				mediaAssetId: a.mediaAssetId,
			});
		}
	}
	return {
		textOverlays: text,
		videoOverlays: video,
		audioOverlays: audio,
	};
}

/* The saved timeline's scenes, as the web sends its live ones. A run started
 * without the editor (MCP, a read) works on what the project holds. */
export async function loadPriorScenes(projectId: string): Promise<AgentScene[]> {
	return (await loadPriorEditorScenes(projectId)).map(agentSceneFromScene);
}

/** The saved timeline's clips, as the editor last saved them. */
export async function loadPriorDocClips(projectId: string): Promise<Clip[]> {
	const latest = (await getContentProject(projectId))?.storyboards?.[0]?.storyboard_json;
	return latest ? readStoryboardDocument(latest).doc.clips : [];
}

/** The saved timeline's scenes as the editor holds them, every field included. */
export async function loadPriorEditorScenes(projectId: string): Promise<Scene[]> {
	const latest = (await getContentProject(projectId))?.storyboards?.[0]?.storyboard_json;
	if (!latest) return [];
	const read = readStoryboardDocument(latest);
	return read.doc.clips.length
		? fromTimelineDoc({ schemaVersion: 2, clips: read.doc.clips, markers: read.doc.markers }).scenes
		: read.legacyArrays.scenes;
}

// Existing overlay clips from the latest saved storyboard. Seeded into a new job so
// the agent operates on the FULL timeline and persist() writes them back — otherwise
// a run would drop the user's b-roll/titles. Handles v2 clips + legacy v1 arrays.
export async function loadPriorOverlays(projectId: string): Promise<SeededOverlays> {
	const empty = { textOverlays: [], videoOverlays: [], audioOverlays: [] };
	try {
		const latest = (await getContentProject(projectId))?.storyboards?.[0]?.storyboard_json;
		if (!latest) return empty;
		const read = readStoryboardDocument(latest);
		if (read.doc.clips.length) return overlaysFromV2Clips(read.doc.clips);
		/* Below here the document is pre-v2. The legacy arrays are legacy INPUT — the
		 * contract never emits them — but the module that owns the document already
		 * decodes them into `legacyArrays`, so this branch reads THAT rather than
		 * walking the blob a second time with its own spelling of the same fields.
		 * The two walks had already drifted: this one read `a.words` off a legacy
		 * audio overlay, which the decoder does not carry, so caption words were
		 * being recovered here and nowhere else. */
		const { textOverlays, videoOverlays, audioOverlays } = read.legacyArrays;
		return {
			textOverlays: textOverlays.map((t): AgentTextOverlay => ({
				id: t.id || undefined,
				content: t.content,
				startSec: t.start,
				durationSec: t.dur || 2,
				preset: t.preset || undefined,
				style: t.style,
				params: t.params,
				layout: t.layout,
				track: t.track ?? 0,
			})),
			videoOverlays: videoOverlays.map((v): AgentVideoOverlay => ({
				thumb: v.thumb,
				sourceDurationSec: v.sourceDurationSec,
				id: v.id || undefined,
				url: v.url,
				kind: v.kind === "video" ? "video" : "image",
				startSec: v.start,
				durationSec: v.dur || 3,
				label: v.label || undefined,
				layout: v.layout,
				volume: v.volume,
				mediaStartSec: v.mediaStartSec,
				mediaAssetId: v.mediaAssetId,
				track: v.track ?? 0,
			})),
			audioOverlays: audioOverlays.map((a): AgentAudioOverlay => ({
				...sourceAudioSettings(a),
				...(a.animation ? { animation: a.animation } : {}),
				id: a.id,
				kind: a.kind,
				origin: a.origin,
				content: a.content,
				url: a.url ?? "",
				voice: a.voice || undefined,
				startSec: a.start,
				durationSec: a.dur || 2,
				track: a.track ?? 0,
				volume: a.volume ?? 1,
				fadeIn: a.fadeIn ?? 0,
				fadeOut: a.fadeOut ?? 0,
				originalDur: a.originalDur,
				mediaStartSec: a.mediaStartSec,
				words: a.words,
				duckUnderVoice: a.duckUnderVoice,
				mediaAssetId: a.mediaAssetId,
			})),
		};
	} catch {
		return empty;
	}
}

/* The story plan as the project now holds it.
 *
 * A run captures the plan when it starts and keeps its own copy while parked on
 * the approval gate. The Storyboard view edits the SAVED plan, so by the time
 * the gate is answered the run's copy may be stale — and continuing from it
 * would generate the pre-edit narration, then persist that copy back over the
 * edit. The saved plan is never older than the run's: the run persists its plan
 * when it drafts it and again when it parks. With nothing saved, the run keeps
 * the plan it holds. */
export async function reloadStoryPlan(job: AgentJob): Promise<void> {
	const saved = (await loadPriorArtifacts(job.projectId)).find(
		(artifact) => artifact.kind === "story_plan",
	);
	if (!saved) return;
	adoptJobArtifact(job, saved);
}
