/* The agent run contract, as the browser receives it.
 *
 * These types used to be declared here by hand, in parallel with the server's
 * `apps/api/src/modules/agents/core/model.ts`. Nothing forced the two to agree, and on
 * one type they did not: `originalDur` and `mediaStartSec` were sent by the
 * server and missing here, so `mergeAgentAudioOverlays` — which copies field by
 * field rather than spreading — dropped them.
 *
 * The contract now lives in `@maleo/shared/agent-wire` and both sides import
 * it. The `Out` suffix survives as an alias only because ~30 editor files spell
 * it that way; the shared names are the real ones. */
export type {
	AgentEvent,
	GenerationBatch,
	GenerationBatchUnit,
	StoryPlanContext,
} from "@maleo/shared/agent-wire";
import type {
	AgentAudioOverlay as _AgentAudioOverlay,
	AgentCharacter as _AgentCharacter,
	AgentClipLayout as _AgentClipLayout,
	AgentPost as _AgentPost,
	AgentScene as _AgentScene,
	AgentSlide as _AgentSlide,
	AgentTextOverlay as _AgentTextOverlay,
	AgentVideoOverlay as _AgentVideoOverlay,
	StorySection as _LongformSection,
	OutcomeContract as _OutcomeContract,
	OutcomeEvaluation as _OutcomeEvaluation,
	OutcomeFinding as _OutcomeFinding,
	OutcomeFixProposal as _OutcomeFixProposal,
	OutcomeRequirement as _OutcomeRequirement,
	OutcomeRequirementId as _OutcomeRequirementId,
	ResearchSource as _ResearchSource,
	SectionStatus as _SectionStatus,
	StoryboardTableRow as _StoryboardTableRow,
	VerificationStatus as _VerificationStatus,
	WorkflowPlan as _WorkflowPlan,
	WorkflowPlanItem as _WorkflowPlanItem,
	WorkflowRoute as _WorkflowRoute,
	WorkflowStatus as _WorkflowStatus,
	AgentEvent,
	GenerationBatch,
} from "@maleo/shared/agent-wire";
import type {
	ChatContextEnvelope,
	EntityFingerprint,
	PipelineArtifact,
	SectionTransition as _SectionTransition,
} from "@maleo/shared";
import type { EditorCommand } from "@maleo/shared/editor";

export type AgentClipLayoutOut = _AgentClipLayout;
export type AgentSectionTransitionOut = _SectionTransition;
export type AgentJobScene = _AgentScene;
export type WorkflowRouteOut = _WorkflowRoute;
export type WorkflowStatusOut = _WorkflowStatus;
export type WorkflowPlanItemOut = _WorkflowPlanItem;
export type WorkflowPlanOut = _WorkflowPlan;
export type OutcomeRequirementIdOut = _OutcomeRequirementId;
export type OutcomeRequirementOut = _OutcomeRequirement;
export type OutcomeFixOut = _OutcomeFixProposal;
export type OutcomeFindingOut = _OutcomeFinding;
export type OutcomeContractOut = _OutcomeContract;
export type OutcomeEvaluationOut = _OutcomeEvaluation;
export type AgentTextOverlayOut = _AgentTextOverlay;
export type AgentVideoOverlayOut = _AgentVideoOverlay;
export type AgentAudioOverlayOut = _AgentAudioOverlay;
export type AgentCharacterOut = _AgentCharacter;
export type StoryboardTableRowOut = _StoryboardTableRow;
export type LongformSectionStatus = _SectionStatus;
export type VerificationStatusOut = _VerificationStatus;
export type LongformSectionOut = _LongformSection;
export type ResearchSourceOut = _ResearchSource;
export type AgentSlideOut = _AgentSlide;
export type AgentPostOut = _AgentPost;

/** A run's state as the poll endpoint returns it.
 *
 *  Not the server's `AgentJob`: that carries the in-flight bookkeeping (the
 *  transcript, the pending tool, the suspension cursor) which the browser has no
 *  business seeing. This is the projection sent over the wire. */
export interface AgentJobState {
	status: "running" | "done" | "needs_attention" | "error" | "awaiting_input";
	/** Frozen run context returned so reattached editors restore fencing. */
	context?: ChatContextEnvelope;
	events: AgentEvent[];
	scenes: AgentJobScene[];
	slides: AgentSlideOut[];
	posts: AgentPostOut[];
	textOverlays: AgentTextOverlayOut[];
	videoOverlays: AgentVideoOverlayOut[];
	audioOverlays: AgentAudioOverlayOut[];
	generatedCaptionSources?: import("@maleo/shared").GeneratedCaptionSources;
	characters: AgentCharacterOut[];
	artifacts: PipelineArtifact[];
	outcomeContract?: OutcomeContractOut;
	outcomeEvaluation?: OutcomeEvaluationOut;
	generationBatch?: GenerationBatch;
	/** The editor commands the run executed, present only when every document
	 *  change it made was one of them. The editor applies exactly these instead of
	 *  merging the run's families (`move-agent-tools-to-editor-commands`). */
	commands?: EditorCommand[];
	/** The fingerprints of the document the run started from, sent with `commands`.
	 *  The editor fences against these when it did not capture the run's start. */
	commandBase?: EntityFingerprint[];
	/** The run that executed `commands`: what a saved version's `agentEdit` marker names. */
	commandRun?: string;
	/** The server could not save the commands onto the latest document (it changed
	 *  under them); the editor still fences and applies them against its own. */
	commandConflict?: string;
	error: string | null;
}
