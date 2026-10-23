/* Durable rehydration: rebuild a full AgentJob from a persisted awaiting_input
 * checkpoint in the project's event log. Lets a parked run (ask_user pause or a
 * pipeline stage approval) survive a process restart / land on a different
 * instance.
 *
 * Reconstruction only reads. Seeding the in-process cache is the session store's
 * job, and its callers already do it — writing JOBS from here closed a cycle
 * (session-store needs this module to fill a miss, this module needed the cache
 * to record the fill) for a line the callers duplicate anyway. */
import { documentArtifacts } from "@maleo/shared";
import type {
	AgentJob,
	AgentScene,
	AgentTextOverlay,
	AgentVideoOverlay,
	AgentAudioOverlay,
	AgentCharacter,
} from "./model.ts";
import { arr, obj, str } from "./services/util.ts";
import { listContentProjectEvents } from "@maleo/db/events";
import type { EditorCommand } from "@maleo/shared/editor";
import type { EntityFingerprint, Scene } from "@maleo/shared";
import {
	projectMaterialsSchema,
	CaptionSetSchema,
	GeneratedCaptionSourcesSchema,
	readClips,
	storyClarificationBatchSchema,
	timelineTemplateSchema,
	styleKnobsSchema,
} from "@maleo/shared";

// Reconstruct a full AgentJob from a persisted awaiting_input checkpoint payload.
// Pipeline is optional: an ask_user pause has `run` without `run.pipeline`, a stage
// approval has `run.pipeline` — both rehydrate. Shared by the by-project resume
// poll and the durable by-run rehydration, so a parked run survives a process
// restart / lands on a different instance (Phase 4: retire the in-mem-only JOBS).
export function reconstructCheckpointJob(
	payload: Record<string, unknown> | null,
): AgentJob | undefined {
	if (!payload || payload.status !== "awaiting_input") return undefined;
	const raw = obj(payload.job);
	if (!raw || typeof raw.projectId !== "string" || typeof raw.id !== "string") return undefined;
	// Image and text runs are retired and never resume.
	if (raw.contentType === "image" || raw.contentType === "text") return undefined;
	const projectId = raw.projectId;
	const run = obj(raw.run);
	const pendingQuestion = obj(raw.pendingQuestion);
	if (!run || !pendingQuestion) return undefined;
	const pendingActionId = typeof raw.pendingActionId === "string" ? raw.pendingActionId : undefined;
	// A parked clarification batch has to come back with its controls, not as the
	// bare first question — otherwise a restart turns a three-question card into a
	// one-question one the server would then reject as incomplete.
	const batch = storyClarificationBatchSchema.safeParse(pendingQuestion.batch).data;
	const job: AgentJob = {
		id: raw.id,
		projectId,
		contentType: "video",
		status: "awaiting_input",
		events: [
			{
				kind: "question",
				question: str(pendingQuestion.question, "Approve this stage?"),
				options: arr<{ label: string; value: string }>(pendingQuestion.options),
				actionId: pendingActionId,
				batch,
			},
		],
		// SAFETY: `run` comes from the checkpoint `agent-trace.ts` wrote from this job's
		// own `AgentJob["run"]`; its presence was checked above.
		run: run as AgentJob["run"],
		pendingQuestion: {
			question: str(pendingQuestion.question, "Approve this stage?"),
			options: arr<{ label: string; value: string }>(pendingQuestion.options),
			batch,
		},
		pendingActionId,
		scenes: arr<AgentScene>(raw.scenes),
		textOverlays: arr<AgentTextOverlay>(raw.textOverlays),
		videoOverlays: arr<AgentVideoOverlay>(raw.videoOverlays),
		audioOverlays: arr<AgentAudioOverlay>(raw.audioOverlays),
		characters: arr<AgentCharacter>(raw.characters),
		artifacts: documentArtifacts(raw.artifacts),
		// Absent and empty mean different things downstream — an empty array is the
		// client asserting it has no clips to carry, absence falls back to the saved
		// document — so the array check stays and only its contents are decoded.
		clientClips: Array.isArray(raw.clientClips) ? readClips(raw.clientClips) : undefined,
		clientCaptionSet: CaptionSetSchema.safeParse(raw.clientCaptionSet).data,
		generatedCaptionSources: GeneratedCaptionSourcesSchema.safeParse(raw.generatedCaptionSources)
			.data,
		editCommands: Array.isArray(raw.editCommands)
			? arr<EditorCommand>(raw.editCommands)
			: undefined,
		editorScenes: Array.isArray(raw.editorScenes) ? arr<Scene>(raw.editorScenes) : undefined,
		baseFingerprints: Array.isArray(raw.baseFingerprints)
			? arr<EntityFingerprint>(raw.baseFingerprints)
			: undefined,
		baseRevisionId:
			typeof raw.baseRevisionId === "string"
				? raw.baseRevisionId
				: raw.baseRevisionId === null
					? null
					: undefined,
		editConflict: typeof raw.editConflict === "string" ? raw.editConflict : undefined,
		workspace: typeof raw.workspace === "string" ? raw.workspace : undefined,
		aspect: str(raw.aspect, "9:16"),
		brief: str(raw.brief),
		styleImageUrl: typeof raw.styleImageUrl === "string" ? raw.styleImageUrl : undefined,
		projectRefIds: arr<string>(raw.projectRefIds),
		materials: projectMaterialsSchema.safeParse(raw.materials).data,
		visualStyle: typeof raw.visualStyle === "string" ? raw.visualStyle : undefined,
		error: typeof raw.error === "string" ? raw.error : undefined,
		startedAt: typeof raw.startedAt === "number" ? raw.startedAt : Date.now(),
		audience: typeof raw.audience === "string" ? raw.audience : undefined,
		targetDurationSec:
			typeof raw.targetDurationSec === "number" ? raw.targetDurationSec : undefined,
		slideCount: typeof raw.slideCount === "number" ? raw.slideCount : undefined,
		platform: typeof raw.platform === "string" ? raw.platform : undefined,
		thread: typeof raw.thread === "boolean" ? raw.thread : undefined,
		voiceProvider: typeof raw.voiceProvider === "string" ? raw.voiceProvider : undefined,
		voice: typeof raw.voice === "string" ? raw.voice : undefined,
		language: typeof raw.language === "string" ? raw.language : undefined,
		style: typeof raw.style === "string" ? raw.style : undefined,
		// A job persisted before knobs shipped carries an identifier we can no
		// longer resolve. It rehydrates with no style and falls back to default
		// camera and transitions rather than failing — a job is minutes long, so
		// the blast radius is one deploy window.
		styleKnobs: styleKnobsSchema.safeParse(raw.styleKnobs).data,
		styleName: typeof raw.styleName === "string" ? raw.styleName : undefined,
		timelineTemplate: timelineTemplateSchema.safeParse(raw.timelineTemplate).success
			? timelineTemplateSchema.parse(raw.timelineTemplate)
			: undefined,
	};
	return job;
}

export async function rehydrateLatestAwaitingPipelineJob(
	projectId: string,
): Promise<AgentJob | undefined> {
	const checkpoint = (await listContentProjectEvents(projectId)).find(
		(e) => e.kind === "agent.pipeline_checkpoint",
	);
	return reconstructCheckpointJob(obj(checkpoint?.payload_json));
}

// Durable rehydration by run id: find this run's latest awaiting_input checkpoint
// in its project's event log and rebuild the job, so begin/resume survive a
// redeploy or land on a different instance. projectId scopes the query (the event
// log is per-project); the durable function threads it from the event payload.
export async function rehydrateRunById(
	runId: string,
	projectId: string,
): Promise<AgentJob | undefined> {
	const checkpoint = (await listContentProjectEvents(projectId)).find(
		(e) => e.kind === "agent.pipeline_checkpoint" && obj(e.payload_json)?.job_id === runId,
	);
	const job = reconstructCheckpointJob(obj(checkpoint?.payload_json));
	return job && job.id === runId ? job : undefined;
}
