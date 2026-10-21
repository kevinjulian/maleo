/* The chat log, read as a conversation instead of an event stream.
 *
 * The log is flat: every tool call, working note and workflow tick is a peer of
 * the instruction that caused it, so a twelve-event run separates a question from
 * its answer however it is styled. This groups the log into runs — one user
 * instruction and everything it caused — and sorts what the run produced into
 * the four things a reader distinguishes: activity (how it is working), decisions
 * (what it needs from you), answers (what it says) and outputs (what it made).
 *
 * Grouping is a reading of the log, not a change to it: nothing here writes, and
 * the persisted log stays the shape the agent streams.
 *
 * Pure, so the hierarchy is testable without a renderer. */
import { payloadOfKind, storyPlanArtifact } from "@maleo/shared";
import type { AgentErrorInfo } from "@maleo/shared/agent-errors";
import type { ChatLogMessage, ChatRunResult } from "./chat-log.ts";

export interface ChatRun {
	key: string;
	/** The instruction that started it. Absent for output that predates any. */
	user?: ChatLogMessage;
	jobId?: string;
	/** Working notes, tool calls and workflow progress. Safe summaries only. */
	activity: ChatLogMessage[];
	/** Approvals and clarifications the run asked for. */
	decisions: ChatLogMessage[];
	/** Prose the assistant wrote back. */
	answers: ChatLogMessage[];
	/** The user's answers to the run's decisions. */
	replies: ChatLogMessage[];
	/** Artifacts, delivery checks, errors and clip links. */
	outputs: ChatLogMessage[];
	result?: ChatRunResult;
	stopped: boolean;
}

/* A reply answers the run's decision and stays in that run. Were it an
 * instruction, answering would supersede the very decision it answers. */
const isInstruction = (m: ChatLogMessage): boolean =>
	m.role === "user" && !m.reply && !m.note && !m.tool && !m.artifact;
const isActivity = (m: ChatLogMessage): boolean => Boolean(m.note || m.tool || m.workflow);
const isAnswer = (m: ChatLogMessage): boolean =>
	m.role === "assistant" &&
	Boolean(m.text) &&
	!m.ref &&
	!m.error &&
	!m.artifact &&
	!m.outcome &&
	!m.question;

export function groupChatRuns(messages: readonly ChatLogMessage[]): ChatRun[] {
	const runs: ChatRun[] = [];
	const open = (key: string, user?: ChatLogMessage): ChatRun => {
		const run: ChatRun = {
			key,
			user,
			activity: [],
			decisions: [],
			answers: [],
			replies: [],
			outputs: [],
			stopped: false,
		};
		runs.push(run);
		return run;
	};
	for (const m of messages) {
		if (isInstruction(m)) {
			open(`run-${m.id}`, m);
			continue;
		}
		const run = runs[runs.length - 1] ?? open("run-lead");
		if (m.jobId && !run.jobId) run.jobId = m.jobId;
		if (m.stopped) run.stopped = true;
		if (m.reply) run.replies.push(m);
		else if (m.result) run.result = m.result;
		else if (isActivity(m)) run.activity.push(m);
		else if (m.question) run.decisions.push(m);
		else if (isAnswer(m)) run.answers.push(m);
		else run.outputs.push(m);
	}
	return runs;
}

/* The decision the conversation is waiting on: the newest unanswered question
 * of the newest run, and nothing older. A newer instruction supersedes an
 * earlier run's question — searching the whole log kept that question pinned
 * after the user had moved on, with a Stop that acted on whatever ran now. */
export function frontierDecision(runs: readonly ChatRun[]): ChatLogMessage | null {
	const run = runs[runs.length - 1];
	if (!run) return null;
	for (let i = run.decisions.length - 1; i >= 0; i--) {
		const m = run.decisions[i]!;
		if (m.question && !m.question.answered) return m;
	}
	return null;
}

export type RunPhase =
	| "running"
	| "awaiting"
	| "done"
	| "partial"
	| "failed"
	| "stopped"
	| "interrupted"
	| "held"
	| "credit";

export interface RunProgress {
	phase: RunPhase;
	/** What the pipeline says it is doing, in its own words. */
	stage: string | null;
	/** A measurable count when the pipeline knows one. */
	count: { done: number; total: number; unit: "sections" | "steps" } | null;
	/** Story-plan sections that finished and were kept. */
	readySections: number;
	failedSections: number;
	error?: AgentErrorInfo;
}

const IN_FLIGHT_SECTION = new Set(["pending", "voicing", "imaging"]);

function storyPlanOf(run: ChatRun) {
	for (let i = run.outputs.length - 1; i >= 0; i--) {
		const plan = payloadOfKind(run.outputs[i]!.artifact, storyPlanArtifact);
		if (plan) return plan;
	}
	return null;
}

function latestWorkflow(run: ChatRun) {
	for (let i = run.activity.length - 1; i >= 0; i--) {
		const workflow = run.activity[i]!.workflow;
		if (workflow) return workflow;
	}
	return null;
}

function runningTool(run: ChatRun): string | null {
	for (let i = run.activity.length - 1; i >= 0; i--) {
		const tool = run.activity[i]!.tool;
		if (tool?.status === "running") return tool.name.replace(/_/g, " ");
	}
	return null;
}

export interface RunProgressContext {
	/** This run is the one executing now. */
	active: boolean;
	/** The job a server restart interrupted, if any. */
	interruptedJobId?: string | null;
	/** Credit limits currently block generation. */
	creditBlocked?: boolean;
}

/* Where a run is and what it can honestly claim.
 *
 * Stage and count come from the pipeline's own events — the workflow plan and
 * the story plan's section statuses — and fall back to the stage name alone,
 * then to a generic label, rather than inventing a number. */
export function runProgress(run: ChatRun, ctx: RunProgressContext): RunProgress {
	const plan = storyPlanOf(run);
	const sections = Array.isArray(plan?.sections) ? plan.sections : [];
	const readySections = sections.filter((s) => s.status === "ready").length;
	const failedSections = sections.filter((s) => s.status === "failed").length;
	const generating = sections.some((s) => IN_FLIGHT_SECTION.has(s.status ?? ""));
	const workflow = latestWorkflow(run);
	const error = [...run.outputs].reverse().find((m) => m.error)?.error;

	let stage: string | null = null;
	let count: RunProgress["count"] = null;
	if (generating && sections.length) {
		stage = `Generating section ${Math.min(sections.length, readySections + failedSections + 1)} of ${sections.length}`;
		count = { done: readySections, total: sections.length, unit: "sections" };
	} else if (workflow) {
		const active = workflow.items.find(
			(item) => item.status === "running" || item.status === "blocked",
		);
		stage = active?.label ?? workflow.title;
		count = {
			done: workflow.items.filter((item) => item.status === "done" || item.status === "skipped")
				.length,
			total: workflow.items.length,
			unit: "steps",
		};
	}
	if (!stage) stage = runningTool(run);

	const unresolved = run.decisions.some((m) => m.question && !m.question.answered);
	const base = { stage, count, readySections, failedSections, error };
	if (ctx.active) return { phase: "running", ...base, stage: stage ?? "Working" };
	if (unresolved) return { phase: "awaiting", ...base };
	if (run.jobId && ctx.interruptedJobId === run.jobId) return { phase: "interrupted", ...base };
	if (run.stopped) return { phase: "stopped", ...base };
	if (run.result?.status === "held") return { phase: "held", ...base };
	const failed = Boolean(error) || failedSections > 0;
	if (failed && ctx.creditBlocked) return { phase: "credit", ...base };
	if (failed && readySections > 0) return { phase: "partial", ...base };
	if (failed) return { phase: "failed", ...base };
	return { phase: "done", ...base };
}

/* The one place in the transcript that may still act.
 *
 * Only the newest run can be the frontier, and a newer instruction ends it:
 * once the user has moved on, an older run's Retry, Show changes or Undo would
 * act on a project that run no longer describes. Everything that is not the
 * frontier is history and is rendered with no actions at all.
 *
 * `action` is the single thing the frontier offers in its state. A settled run
 * with nothing to act on still owns the frontier, with no action. */
export type FrontierAction =
	| "stop"
	| "decide"
	| "retry"
	| "retry_failed"
	| "resume"
	| "credits"
	| "result"
	| "held";

export interface ChatFrontier {
	runKey: string;
	action: FrontierAction | null;
	/* Whether the run's outputs may offer their own actions (fix, seek, add to
	 * timeline, clip links, open the Storyboard). Only when the run settled with
	 * nothing pending: every other state offers its own action set and nothing
	 * else, so a failed run cannot show Retry beside a stray Fix this. */
	outputs: boolean;
}

const FRONTIER_ACTION: Record<RunPhase, FrontierAction | null> = {
	running: "stop",
	awaiting: "decide",
	partial: "retry_failed",
	interrupted: "resume",
	credit: "credits",
	held: "held",
	stopped: null,
	failed: "retry",
	done: "result",
};

export function chatFrontier(
	runs: readonly ChatRun[],
	progress: RunProgress | null,
): ChatFrontier | null {
	const run = runs[runs.length - 1];
	if (!run || !progress) return null;
	let action = FRONTIER_ACTION[progress.phase];
	// Retrying needs an instruction to retry and an error that allows it.
	if (action === "retry" && (!run.user?.text?.trim() || progress.error?.retryable === false))
		action = null;
	// A result is the state's action only when there is something to show or
	// undo. A video run settles "applied" with nothing touched; that offers no
	// result action, so its outputs keep theirs.
	if (
		action === "result" &&
		!(run.result?.status === "applied" && (run.result.touched.length > 0 || run.result.undoable))
	)
		action = null;
	return { runKey: run.key, action, outputs: progress.phase === "done" && action === null };
}

/* What the phone Editor view says about chat while chat is out of sight.
 *
 * Three states and nothing else — it is a pointer to Chat, not a second feed.
 * A parked decision outranks running because it is the one state that waits on
 * the user; only the newest run counts, so a newer instruction ends an older
 * failure the same way it ends an older decision. */
export type RunIndicator = "running" | "input" | "failed";

const INDICATOR_PHASE: Partial<Record<RunPhase, RunIndicator>> = {
	running: "running",
	awaiting: "input",
	failed: "failed",
	partial: "failed",
	interrupted: "failed",
};

export function runIndicator(
	messages: readonly ChatLogMessage[],
	ctx: { running: boolean; interruptedJobId?: string | null },
): RunIndicator | null {
	const runs = groupChatRuns(messages);
	if (frontierDecision(runs)) return "input";
	const run = runs[runs.length - 1];
	if (!run) return ctx.running ? "running" : null;
	return (
		INDICATOR_PHASE[
			runProgress(run, { active: ctx.running, interruptedJobId: ctx.interruptedJobId }).phase
		] ?? null
	);
}
