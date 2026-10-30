/* Building a run. startAgentJob builds a job — seeding prior scenes, overlays,
 * slides, posts, artifacts and research — and saves it; the run service
 * (modules/agents/core/service.ts) then starts it on the agent runtime. */
import {
	clipFingerprint,
	readStoryboardDocument,
	type CaptionSet,
	fromTimelineDoc,
	researchBundleArtifact,
	storyPlanArtifact,
} from "@maleo/shared";
import { dropJobArtifacts, jobArtifactsOfKind } from "./artifact-store.ts";
import {
	loadPriorArtifacts,
	loadPriorDocClips,
	loadPriorEditorScenes,
	loadPriorScenes,
	loadPriorOverlays,
	overlaysFromV2Clips,
} from "./persistence.ts";
import { fingerprintBrief } from "./services/util.ts";
import { getContentProject } from "@maleo/db/project-detail";
import { unfinishedImportMediaIds } from "@maleo/db/media-imports";
import { JOBS, getLatestRunningJobForProject } from "./session-store.ts";
import { saveRun } from "./run-repository.ts";
import type { AgentJob, AgentScene, AgentSlide, AgentPost } from "./model.ts";
import type { Clip } from "@maleo/shared";
import { extractRequestedDurationSec } from "./duration.ts";
import { createOutcomeContract } from "./outcome.ts";
import type { CapturedTextSelection } from "@maleo/shared";
import {
	getContentTimelineTemplate,
	getDefaultTimelineTemplate,
} from "@maleo/db/timeline-templates";
import {
	type ChatContextEnvelope,
	type CreativeDirection,
	type ProjectMaterials,
	type StyleKnobs,
} from "@maleo/shared";

/** What a run is started from: the project, the instruction, and the client's live document and context. */
export type AgentJobInput = {
	textSelection?: CapturedTextSelection;
	projectId: string;
	instruction: string;
	scenes?: AgentScene[];
	aspect?: string;
	brief?: string;
	styleImageUrl?: string;
	projectRefIds?: string[];
	seedClips?: Clip[];
	captionSet?: CaptionSet;
	contentType?: "video" | "image" | "text";
	slides?: AgentSlide[];
	posts?: AgentPost[];
	direction?: CreativeDirection;
	materials?: ProjectMaterials;
	context?: {
		audience?: string;
		targetDurationSec?: number;
		slideCount?: number;
		platform?: string;
		thread?: boolean;
		voiceProvider?: string;
		voice?: string;
		language?: string;
		style?: string;
		styleKnobs?: StyleKnobs;
		styleName?: string;
		timelineTemplateId?: string;
	};
	context_envelope?: ChatContextEnvelope;
};

/* A job built from the project's state, neither registered nor persisted.
 * `startAgentJob` registers and runs it; a read over MCP (which must not create a
 * run) only inspects it. */
/** A job was asked for a project type that has no agent. */
export class UnsupportedContentTypeError extends Error {
	constructor(readonly contentType: string) {
		super(`AI is not available for ${contentType} projects`);
	}
}

export async function buildAgentJob(input: AgentJobInput): Promise<AgentJob> {
	/* Image and text projects are retired: they stay editable by hand but never
	 * start a run. Every entry point — chat, MCP reads, edits and run_agent —
	 * builds its job here, so the refusal is made once. */
	if (input.contentType && input.contentType !== "video")
		throw new UnsupportedContentTypeError(input.contentType);
	const contentType = "video" as const;
	const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
	// Prefer the client's live clip doc (no autosave race); fall back to latest saved.
	const hasSeed = input.seedClips !== undefined;
	const prior = hasSeed
		? overlaysFromV2Clips(input.seedClips!)
		: await loadPriorOverlays(input.projectId);
	// Client-owned clips to carry through verbatim: effects, transitions, and PROMOTED
	// visual clips (vis:N:x — extra images in a beat the agent doesn't manage).
	const clientClips = hasSeed
		? input.seedClips!.filter(
				(c) =>
					c.type === "effect" ||
					c.type === "transition" ||
					c.type === "caption" ||
					c.id.startsWith("vis:"),
			)
		: undefined;
	const inferredTargetDurationSec =
		contentType === "video" ? extractRequestedDurationSec(input.instruction) : undefined;
	const startedAt = Date.now();
	const targetDurationSec = inferredTargetDurationSec ?? input.context?.targetDurationSec;
	const aspect = input.aspect || "9:16";
	const timelineTemplate =
		contentType === "video"
			? // The shipped default is resolved by slug, not by a hardcoded id: fixture ids are
				// local to a database now, so a fresh install assigns its own.
				((input.context?.timelineTemplateId
					? await getContentTimelineTemplate(input.context.timelineTemplateId)
					: null) ??
				(await getDefaultTimelineTemplate()) ??
				undefined)
			: undefined;
	const outcomeContract = createOutcomeContract({
		instruction: input.instruction,
		brief: input.brief,
		contentType,
		audience: input.context?.audience,
		platform: input.context?.platform,
		format: aspect,
		targetDurationSec,
		createdAt: startedAt,
	});
	// The run's generation lock is the project's own selection. A timeline template
	// used to contribute reference ids here, which never worked: the ids are resolved
	// against the project's ROSTER, and nothing attaches a template's references to
	// one, so every id a template supplied was filtered out before it could reach a
	// scene — silently, because a roster miss cannot appear in the subject-cap report.
	const projectRefIds = Array.from(new Set(input.projectRefIds ?? []));
	// Whose budget this run spends, and whose generation quota gates it.
	const project = await getContentProject(input.projectId);
	const workspace = project?.project.workspace ?? undefined;
	// The saved version the run starts from, which an edit-only save fences against.
	const baseRevisionId =
		contentType === "video" ? (project?.storyboards?.[0]?.id ?? null) : undefined;
	// The document the run starts from: the client's live clips, else the saved ones.
	const baseClips =
		contentType !== "video"
			? []
			: hasSeed
				? input.seedClips!
				: await loadPriorDocClips(input.projectId);
	// The editor's full scenes; a pre-v2 saved document has no clips and reads its legacy arrays.
	const editorScenes =
		contentType !== "video"
			? undefined
			: baseClips.length
				? fromTimelineDoc({ schemaVersion: 2, clips: baseClips, markers: [] }).scenes
				: await loadPriorEditorScenes(input.projectId);
	const baseFingerprints = contentType === "video" ? baseClips.map(clipFingerprint) : undefined;
	const clientCaptionSet = hasSeed
		? input.captionSet
		: (readStoryboardDocument(project?.storyboards?.[0]?.storyboard_json).doc.captionSet ??
			undefined);
	const job: AgentJob = {
		id,
		projectId: input.projectId,
		workspace,
		contentType,
		status: "running",
		events: [],
		scenes: [
			...(input.scenes ?? (contentType === "video" ? await loadPriorScenes(input.projectId) : [])),
		],
		editorScenes,
		baseFingerprints,
		baseRevisionId,
		textOverlays: prior.textOverlays,
		videoOverlays: prior.videoOverlays,
		audioOverlays: prior.audioOverlays,
		characters: [],
		artifacts: await loadPriorArtifacts(input.projectId),
		clientClips:
			clientClips ??
			baseClips.filter(
				(c) =>
					c.type === "effect" ||
					c.type === "transition" ||
					c.type === "caption" ||
					c.id.startsWith("vis:"),
			),
		clientCaptionSet,
		pendingMediaIds: workspace ? await unfinishedImportMediaIds(workspace, input.projectId) : [],
		aspect,
		brief: input.brief ?? "",
		styleImageUrl: input.styleImageUrl,
		projectRefIds,
		materials: input.materials,
		startedAt,
		audience: input.context?.audience,
		targetDurationSec,
		slideCount: input.context?.slideCount,
		platform: input.context?.platform,
		thread: input.context?.thread,
		voiceProvider: input.context?.voiceProvider,
		voice: input.context?.voice,
		language: input.context?.language,
		style: input.context?.style,
		styleKnobs: input.context?.styleKnobs,
		styleName: input.context?.styleName,
		direction: input.direction,
		timelineTemplate,
		outcomeContract,
		context: input.context_envelope,
		...(input.textSelection ? { textSelection: input.textSelection } : {}),
	};
	// Rehydrate prior research so a re-run grounds the plan instead of re-fetching —
	// but ONLY when it still applies. A changed (non-empty) brief invalidates stale
	// research: drop it so the factual auto-route researches the new topic afresh.
	const priorResearch = jobArtifactsOfKind(job, researchBundleArtifact)[0]?.payload;
	if (priorResearch) {
		const priorPlan = jobArtifactsOfKind(job, storyPlanArtifact)[0]?.payload;
		const expectedKey = priorPlan?.researchKey
			? priorPlan.researchKey
			: fingerprintBrief(job.brief);
		// Legacy artifacts without briefKey are reusable only when their stored topic
		// matches the active plan/brief; otherwise fail closed and research again.
		const storedKey = priorResearch.briefKey || fingerprintBrief(priorResearch.topic);
		const stale = Boolean(expectedKey) && storedKey !== expectedKey;
		// Research that still applies stays as the seeded artifact; the run reads it
		// from there.
		if (stale) dropJobArtifacts(job, researchBundleArtifact.kind);
	}
	return job;
}

/** Build and save a run for the project — or return the run already in flight
 *  for it, so a double submit or a remount cannot race the first. */
export async function startAgentJob(input: AgentJobInput): Promise<AgentJob> {
	const existing = await getLatestRunningJobForProject(input.projectId);
	if (existing) return existing;
	const job = await buildAgentJob(input);
	JOBS.set(job.id, job);
	// Registered at birth, so a restart mid-first-turn can still rehydrate it.
	await saveRun(job);
	// Bound memory: drop jobs older than ~30 min.
	for (const [k, j] of JOBS) if (Date.now() - j.startedAt > 30 * 60_000) JOBS.delete(k);
	return job;
}
