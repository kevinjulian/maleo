/* Maleo — Content-First Create · Data, helpers, constants, types */
import type {
	ChatEntityKind,
	ChatEntityRef,
	ChatFocusSource,
	Emotion,
	ExplainerTeachingMove,
	MotionGraphicDecision,
	PovShot,
	PovStage,
	StoryClarificationBatch,
	StoryEditorialDecision,
} from "@maleo/shared";

/** The story spine the planner drafted with the sections. Mirrors
 *  `StoryEngagement` in @maleo/shared; every field optional because a plan
 *  persisted before engagement existed still has to load. */
export interface StoryEngagementMsg {
	premise?: string;
	hook?: string;
	tension?: string;
	escalation?: string;
	turn?: string;
	resolution?: string;
	emotionalArc?: Emotion[];
	visualMotif?: string;
}
import type { AgentErrorInfo } from "@maleo/shared/agent-errors";
import type { PipelineArtifact } from "@maleo/shared";

/** Pacing notes the editor computes itself. Not an agent artifact: no run
 *  produces it. */
export interface ChatCritique {
	title: string;
	findings: Array<{
		startSec: number;
		endSec: number;
		severity: "high" | "warn" | "info";
		message: string;
	}>;
}

export interface ChatToolCall {
	name: string;
	status: "running" | "done" | "error";
	note?: string;
	thumbs?: string[];
	// Effect class of the tool (drives card styling: patch/asset/proposal/etc).
	effect?: "note" | "patch" | "asset" | "proposal" | "await";
	errorInfo?: AgentErrorInfo;
}

export type LongformSectionStatus =
	| "draft"
	| "pending"
	| "voicing"
	| "imaging"
	| "ready"
	| "failed";

export type VerificationStatus = "verified" | "partial" | "unverified";

export interface StorySectionMsg {
	id: string;
	sectionId?: string;
	title: string;
	narration: string;
	visualPrompt: string;
	/** Felt tone the planner assigned. Selects this section's background music when
	 *  the selected timeline template scores per emotion. */
	emotion?: Emotion;
	teachingMove?: ExplainerTeachingMove;
	/** This section's job in the plan's story arc, and what that job obliges it to
	 *  do. Absent on plans made before arcs existed, which render as before. */
	chapterFunction?: string;
	chapterObligation?: string;
	/** A skeleton slot whose draft never succeeded: kept, empty, and marked. */
	needsDrafting?: boolean;
	povStage?: PovStage;
	povShots?: PovShot[];
	notes?: string;
	sourceNotes?: string;
	/** Real cited source URLs backing this section (from web research). */
	sourceUrls?: string[];
	sourceEvidence?: Array<{ url: string; quote: string }>;
	factual?: boolean;
	citationStatus?: "verified" | "unsupported" | "not_required";
	status?: LongformSectionStatus;
	estimatedDurationSec: number;
	audioUrl?: string;
	audioDurationSec?: number;
	imageUrl?: string;
	error?: string;
	startSec?: number;
	motionGraphic?: MotionGraphicDecision;
	editorial?: StoryEditorialDecision;
}

/* One entity a command was scoped to, as its chip read when the command was
 * submitted. Frozen on the instruction: an old run shows what it received, not
 * what happens to be selected now. */
export interface ChatScopeChip {
	kind: ChatEntityKind;
	id: string;
	label: string;
	source: ChatFocusSource;
}

/* What a settled run did to the editor.
 *
 * `held` is fencing refusing to apply: the user edited a touched entity while the
 * run worked, so nothing was written. It is its own state rather than a muted
 * success because a change summary there would claim an edit that never landed. */
export interface ChatRunResult {
	status: "applied" | "held";
	touched: ChatEntityRef[];
	/** Applied as one command-ledger entry, so it can be undone as one step. */
	undoable?: boolean;
	/** `refused`: the run's commands no longer apply to the document as it is now. */
	reason?: "changed" | "deleted" | "refused";
	conflicts?: ChatEntityRef[];
}

export interface ChatLogMessage {
	id: number;
	role: "user" | "assistant";
	/* The agent run this card was streamed from, when it was.
	 *
	 * A reload replays a still-running job from its first event, so anything that
	 * run already wrote into the log has to be dropped before the replay or it
	 * appears twice. Cutting the log at the last user message is not enough: a
	 * question card is followed by the user's own answer, so it survives that cut
	 * and the replay re-emits it. Attribution is what makes the drop exact. */
	jobId?: string;
	text?: string;
	/** On a user instruction: the context chips it was submitted with. */
	scope?: ChatScopeChip[];
	/** On a run's settle: what it applied, or why it was held. */
	result?: ChatRunResult;
	/** The run was stopped by the user. */
	stopped?: boolean;
	/** On a user message: an answer to the run's decision, not a new
	 *  instruction. It stays in the run it answers. */
	reply?: boolean;
	error?: AgentErrorInfo;
	// Optional clip reference — clicking the message seeks/selects the clip.
	ref?: { type: "scene" | "broll" | "audio" | "text"; id: number };
	// Agent tool-call entry (structured "called a tool" with result thumbnails).
	tool?: ChatToolCall;
	// Read-only workflow progress from the server-side agent router/pipeline.
	workflow?: WorkflowPlanMsg;
	// Deterministic delivery evaluation against the user's run contract. Findings
	// include executable repair commands, so blocked output is actionable in chat.
	outcome?: {
		status: "passed" | "needs_attention" | "failed";
		score: number;
		findings: Array<{
			id: string;
			severity: "pass" | "info" | "warning" | "blocker";
			message: string;
			fix?: { command: string; scope?: string };
		}>;
		metrics: { blockerCount: number; warningCount: number };
	};
	// Readable working note (clip-first "thinking" block) — observation + plan.
	// While running, the card ticks a live timer (startedAt = client ms) until the
	// note body arrives and it settles to a final elapsedSec.
	note?: { title: string; body: string; elapsedSec: number; running?: boolean; startedAt?: number };
	// ask_user question card: the run is suspended awaiting an answer. Selecting an
	// option (or typing a reply) resumes the job identified by jobId.
	/* `freeText` marks a question the operator answers by typing — the rejected
	 * story-plan gate, where the next message is the revision. The composer sends
	 * that message to this parked run instead of starting a new one. */
	/* `batch` is the pre-research story clarification: one to three questions
	 * answered together in one card and one structured submission. When it is
	 * absent the card is the legacy single question, which still renders its two
	 * to four option chips and answers with a plain string. */
	question?: {
		question: string;
		options?: Array<{ label: string; value: string }>;
		jobId: string;
		actionId?: string;
		answered?: boolean;
		freeText?: boolean;
		batch?: StoryClarificationBatch;
	};
	// Artifact card an agent run produced (knowledge outline, media clip with
	// "Add to timeline", storyboard table, plan, research, style bible). The
	// envelope as the run wrote it; renderers narrow it with `payloadOfKind`.
	artifact?: PipelineArtifact;
}

export type WorkflowStatusMsg = "pending" | "running" | "done" | "blocked" | "failed" | "skipped";

export interface WorkflowPlanMsg {
	id: string;
	title: string;
	route: "plan_story" | "edit_scene" | "react";
	readonly: true;
	reason?: string;
	items: Array<{
		id: string;
		label: string;
		status: WorkflowStatusMsg;
		tool?: string;
		reason?: string;
	}>;
}

// One cited source in the living Research card — links open safely in a new tab.

export interface ResearchSourceMsg {
	title: string;
	url: string;
	excerpt: string;
	retrievedAt: string;
}

// Free-form audio clip (voiceover or music/SFX) — positioned anywhere on its
// track, independent of scenes (clip-first model). Voiceover carries narration
// text (TTS); music carries an asset url.
