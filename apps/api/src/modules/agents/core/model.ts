/* Agent domain model — the canonical type-home for a chat-agent run. Every leaf,
 * service, tool, and the orchestrator itself imports these types from here (the
 * orchestrator re-exports them for back-compat). Pure types: all cross-package
 * references are type-only, so importing this file pulls in no runtime code and
 * can never introduce a cycle.
 *
 * The RUN CONTRACT — everything the editor receives — now lives in
 * `@maleo/shared/agent-wire`, declared once for both sides. It used to be
 * declared here and again by hand in the browser's API client, which is how
 * `AgentAudioOverlay.originalDur` came to be sent by the server and unknown to
 * the client. This file re-exports it so the importers below are unaffected, and
 * keeps what is genuinely the agent's own: `AgentJob`, its in-flight state. */
export type {
	AgentAudioOverlay,
	AgentCharacter,
	AgentClipLayout,
	AgentEvent,
	AgentPost,
	AgentScene,
	AgentSlide,
	AgentTextOverlay,
	AgentVideoOverlay,
	GenerationBatch,
	GenerationBatchUnit,
	StoryPlanContext,
	StoryPlanPayload,
	ResearchBundlePayload,
	OutcomeContract,
	OutcomeEvaluation,
	OutcomeFinding,
	OutcomeFixProposal,
	OutcomeRequirement,
	OutcomeRequirementId,
	StoryboardTableRow,
	VerificationStatus,
	WorkflowPlan,
	WorkflowPlanItem,
	WorkflowRoute,
	WorkflowStatus,
	CaptionWord,
	Intent,
	ToolEffect,
	ResearchSource,
	StorySection,
	StoryVoiceSegment,
	StoryVisualSegment,
	SourceEvidence,
	CitationStatus,
	SectionStatus,
} from "@maleo/shared/agent-wire";
import type { FlowRecord } from "./engine/flow-record.ts";
import type {
	AgentAudioOverlay,
	AgentCharacter,
	AgentEvent,
	AgentScene,
	AgentTextOverlay,
	AgentVideoOverlay,
	GenerationBatch,
	Intent,
	OutcomeContract,
	OutcomeEvaluation,
} from "@maleo/shared/agent-wire";
import type { CaptionSet } from "@maleo/shared";
import type { PipelineArtifact } from "@maleo/shared";
import type { EditorCommand } from "@maleo/shared/editor";
import type { Clip, Scene, TimelineTemplate, CreativeDirection, StyleKnobs } from "@maleo/shared";
import type { ProjectMaterials, ChatContextEnvelope, EntityFingerprint } from "@maleo/shared";
import type { PipelineRun } from "./pipeline.ts";
import type { StoryClarificationState } from "./story-clarification.ts";
import type { StoryClarificationBatch } from "@maleo/shared";

export interface AgentJob {
	id: string;
	textSelection?: import("@maleo/shared").CapturedTextSelection;
	projectId: string;
	/* Set on a job an MCP client started (mcp/dispatch.ts): the user the key acts
	 * as, whose name its tool calls are traced under. A read's job is never saved
	 * and writes nothing but its trace; a direct edit's job is a single-tool run. */
	mcpActor?: string;
	/* The context this run was started with, frozen at start.
	 *
	 * Frozen, not re-read: the user keeps editing while a run works, and a run
	 * that re-read the project mid-flight could plan against one state and apply
	 * against another. It rides in the run snapshot, so a resume after a restart
	 * continues with the same context rather than rebuilding a different one. */
	context?: ChatContextEnvelope;
	/** The workspace this run's project belongs to — whose budget it spends and
	 *  whose generation quota gates it. Absent only when the project is gone. */
	workspace?: string;
	/** Only video runs exist; image and text projects are retired and never start one. */
	contentType: "video";
	status: "running" | "done" | "needs_attention" | "error" | "awaiting_input";
	events: AgentEvent[];
	// Suspended-run state (Design B): when the model calls ask_user the loop
	// persists its position here + flips status to "awaiting_input"; resume reads
	// this back, appends the answer to the transcript, and continues from `step`.
	run?: {
		instruction: string;
		transcript: string;
		step: number;
		builtSomething: boolean;
		finishRejected: boolean;
		asks: number;
		intent?: Intent | null;
		pipeline?: PipelineRun;
		/* The step index each agent tool call runs under, by the model's tool-call id.
		 * The executor keys its durable tool record on the step, so a retry of the
		 * same call keeps its index (and is deduplicated) while a new call gets the
		 * next one. Used by the Mastra runtime, where steps are not a loop cursor. */
		toolCallSteps?: Record<string, number>;
		/* The user answered "Approve all" at a gate: the rest of this run's gates
		 * proceed without asking, as the pipeline's `auto` mode did. */
		approveAll?: boolean;
		/* What a workflow step's stage ended as, by "<workflow run id>:<step id>",
		 * saved with the stage's outputs. A step retried after its outputs were saved
		 * but before the workflow recorded its result returns this instead of running
		 * the stage again. */
		stepOutcomes?: Record<string, { ok: boolean; note: string }>;
		/* Workflow-engine runs inside agent tool calls, by tool-call id: definition
		 * snapshot, revision, cursor, flow state and per-node trace, saved with the
		 * run after every node (engine/flow-record.ts). */
		flows?: Record<string, FlowRecord>;
		/* External MCP servers already reported unreachable on this run. */
		mcpUnavailable?: string[];
		/* The Mastra run executing this AgentJob; the job's id until a resume of an
		 * errored run starts a fresh execution for the same job. */
		executionId?: string;
		/* Set by the internal agent runtime when it starts the run. A run without it
		 * was started by the agent loop this runtime replaced and has nothing here to
		 * resume (modules/agents/core/service.ts). */
		runtime?: "agent";
		/* Set on a single-tool run (an MCP client's direct edit): the one call the
		 * run makes. Its model is runtime/direct-call.ts, not the selected provider. */
		directCall?: { tool: string; args: Record<string, unknown>; callId: string };
		/* A build tool other than an editing tool changed the job: the run settles as
		 * generation output, merged whole, rather than as its `editCommands`. */
		jobWrites?: boolean;
		/* The tool a stage is running as while it runs (the plan stage reports as
		 * `plan_story`); writes outside a stage scope are attributed to it. */
		pendingTool?: { tool: string; args: Record<string, unknown> };
		/* The post-research batch, when completed research raised a material editorial
		 * choice. Its own slot beside `storyClarification`: a plan carries BOTH
		 * provenances, and they answer different questions — what the user wanted, and
		 * what they decided once the sources were in front of them. */
		postResearchClarification?: StoryClarificationState;
		/* The plan gate was rejected and the run is parked holding its frame,
		 * skeleton and research, waiting for the revision to draft against. Set only
		 * by the reject branch, cleared by the redraft. While it is set, free text is
		 * a revision instruction rather than a ReAct instruction — which is what keeps
		 * a rejection inside pre-production instead of ending the run. */
		awaitingRevision?: boolean;
		/* How many revisions this run has already drafted, so a loop that never
		 * converges is reported rather than running forever. */
		revisions?: number;
		/* The ONE pre-research clarification batch this build owes, its answers, and
		 * its bypass. Part of the snapshot, so it rehydrates with the run on any
		 * instance — there is no separate table and no migration. */
		storyClarification?: StoryClarificationState;
	};
	// The open question awaiting an answer (mirrors the last "question" event).
	pendingQuestion?: {
		question: string;
		options?: { label: string; value: string }[];
		freeText?: boolean;
		batch?: StoryClarificationBatch;
	};
	// Unique id of the required_action for the CURRENT suspension. Threaded into the
	// Inngest waitForEvent filter (runId + actionId) so a stale or double-clicked
	// answer meant for a past/other suspension can't satisfy the current wait.
	pendingActionId?: string;
	scenes: AgentScene[];
	textOverlays: AgentTextOverlay[];
	/** Motion compositions authored this run for directed on-screen text, keyed by
	 *  `motionInputHash`. A failure is kept too, so the run does not ask again; the
	 *  section then keeps plain text. Run-scoped: a later run keeps the clips already
	 *  placed in the beat's reserved id range (`services/section-motion.ts`). */
	sceneMotion?: Record<
		string,
		{ clips: import("@maleo/shared").MotionClip[] } | { failure: string }
	>;
	videoOverlays: AgentVideoOverlay[];
	audioOverlays: AgentAudioOverlay[];
	characters: AgentCharacter[];
	artifacts: PipelineArtifact[];
	// Client-owned clips to carry through verbatim (effect + transition), captured
	// from the live doc the client sent. When set, persist() preserves these instead
	// of re-deriving from the stale saved storyboard — closing the autosave race for
	// effects/transitions too. Undefined = fall back to prev-saved.
	clientClips?: Clip[];
	/** Minted media identities whose import had not finished when the run started.
	 *  A clip on one is the editor's alone. A finish
	 *  during the run still reads as pending, which only refuses an edit. */
	pendingMediaIds?: string[];
	clientCaptionSet?: CaptionSet;
	/** Fresh synthesis only; never reconstructed from historical audio words. */
	generatedCaptionSources?: import("@maleo/shared").GeneratedCaptionSources;
	/* The editor commands this run's editing tools executed, in order
	 * (`edit-document.ts`). A settled run that made no other document change
	 * carries them, and the editor applies exactly these. */
	editCommands?: EditorCommand[];
	/* The editor's own scenes, every field included, as the run started (and as its
	 * last edit left them). The agent reads only the `AgentScene` view; the document
	 * a command is built against carries these too, so a scene command keeps the
	 * fields the agent never sees (cast, seed, frame provenance, audio clips). */
	editorScenes?: Scene[];
	/* What every clip of the document this run started from contained, by the
	 * editor's own fingerprint rule. The editor fences a settled run's commands
	 * against these when it did not capture the run's start itself (an MCP edit,
	 * another tab), so a clip changed meanwhile is held rather than overwritten. */
	baseFingerprints?: EntityFingerprint[];
	/* The saved version the run started from (null: the project had none). An
	 * edit-only run's save executes its commands onto the latest version, and
	 * fences them when that is not this one (`edit-rebase.ts`). */
	baseRevisionId?: string | null;
	/* Why an edit-only run's commands were not saved: the document changed under
	 * them. Sent with the commands; the editor, when open, still fences and
	 * applies them against its live document. */
	editConflict?: string;
	aspect: string;
	brief: string;
	/** Global style lock image (absolute/relative url) — applied to agent frames. */
	styleImageUrl?: string;
	/** Project-wide visual refs applied to generated video frames. */
	projectRefIds?: string[];
	/** Project Materials snapshot; Visual reference settings carry referenceUse. */
	materials?: ProjectMaterials;
	/** Generated style bible when no style reference image exists. */
	visualStyle?: string;
	error?: string;
	startedAt: number;
	/** Structured brief context for image/text builders. */
	audience?: string;
	targetDurationSec?: number;
	slideCount?: number;
	platform?: string;
	thread?: boolean;
	/** Voiceover context for narration-first longform (provider/voice/language). */
	voiceProvider?: string;
	voice?: string;
	language?: string;
	/** Video Director style directive — a compact description of the chosen style,
	 *  injected into the video agent prompt so it plans beats/emotions. */
	style?: string;
	/** The chosen style's knobs. Resolution is by value: nothing looks a style up
	 *  by id, so an operator-authored style works like a shipped one. */
	styleKnobs?: StyleKnobs;
	/** Name of the preset the knobs came from, for traces and the directive. */
	styleName?: string;
	/** Creative direction split into channels (story/visual/voice). Each channel is
	 *  consumed by only its stage so a directive can't leak across dimensions. */
	direction?: CreativeDirection;
	/** Immutable snapshot of selected global timeline template for this run. */
	timelineTemplate?: TimelineTemplate;
	/** Immutable normalized delivery target captured when the run starts. Optional
	 * only for legacy snapshots written before outcome contracts existed. */
	outcomeContract?: OutcomeContract;
	/** Latest deterministic delivery evaluation, refreshed before completion. */
	outcomeEvaluation?: OutcomeEvaluation;
	/** Durable per-unit generation schedule for the latest batch. */
	generationBatch?: GenerationBatch;
}
