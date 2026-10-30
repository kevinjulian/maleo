/* Maleo — Content-First Create · Unified chat-agent run loop.
 *
 * One execution path for video, image, and text: the brief (first message) and
 * every later chat command start a server-side agent run, then this hook polls
 * it and streams thinking/tool/patch events into the chat log while applying
 * live storyboard patches. The run lives + persists server-side, so a refresh
 * re-attaches to it instead of starting a second generation. */
import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ContentType, StoryClarificationSubmission } from "@maleo/shared";
import type { ChatLogMessage, ChatRunResult, ChatToolCall } from "@models/chat/chat-log.ts";
import type { ChatCommandScope } from "@models/chat/chat-composer.ts";
import { type AgentJobState } from "@models/agent/agent-wire.ts";
import {
	answerChatAgent,
	cancelChatRun,
	getCurrentChatJob,
	pollChatAgent,
	resumeChatRun,
	startChatAgent,
	type StartChatAgentInput,
} from "@api/chat.ts";
import { classifyAgentError } from "@maleo/shared/agent-errors";

/* What a settled pass did to the editor. `step` is the ledger step it ran as,
 * when it ran as one — kept in memory for Undo, never written to the log. */
export type AgentSettleOutcome = ChatRunResult & { step?: string };

// Per-type apply callbacks. The hook owns event streaming + chat log; the
// workspace owns how a patched storyboard maps back into its editor state.
// The settled (running: false) pass reports what it applied or held.
export interface AgentApply {
	/** Restore captured fingerprints before a reattached job emits patches. */
	onContext?: (context: AgentJobState["context"]) => void;
	// Video: live scene patch while running, then a final pass with overlays.
	onScenes?: (job: AgentJobState, opts: { running: boolean }) => AgentSettleOutcome | void;
}

export interface UseContentAgentArgs {
	projectId: string | null;
	contentType: ContentType;
	setChatMessages: Dispatch<SetStateAction<ChatLogMessage[]>>;
	apply: AgentApply;
	// Build the start payload from current workspace state (scenes/slides/posts,
	// brief, structured context, aspect, live clips, style ref).
	buildStart: (
		instruction: string,
		scope?: ChatCommandScope,
	) => Omit<StartChatAgentInput, "projectId" | "instruction" | "contentType">;
	/** The ledger step a settled run applied as, for Undo. */
	onSettled?: (jobId: string, step: string) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const nextMsgId = (m: ChatLogMessage[]): number => m.reduce((a, x) => Math.max(a, x.id), 0) + 1;

export interface ContentAgent {
	// Resolves with the final job state (or null if it errored / never started), so
	// callers can decide success/failure from the result, not a racy state read.
	run: (
		instruction: string,
		scope?: ChatCommandScope,
		selection?: import("@maleo/shared").TextSelection,
		onAccepted?: () => void,
	) => Promise<AgentJobState | null>;
	// Explicit answer to a parked ask_user / approval gate. Free-text commands use
	// run(); only question/approval controls call this.
	answer: (
		jobId: string,
		answer: string,
		actionId?: string,
		batchAnswer?: StoryClarificationSubmission,
		onAccepted?: () => Promise<void>,
	) => Promise<AgentJobState | null>;
	stop: () => Promise<void>;
	resume: () => Promise<void>;
	// A run interrupted by a server/Inngest restart, offered for one-click resume.
	interrupted: { jobId: string } | null;
	// Re-drive the interrupted run from its persisted cursor.
	resumeInterrupted: () => Promise<void>;
	running: boolean;
}

/** Failed/cancelled runs must not replace newer editor state with stale snapshots. */
/* The chat log with a run's own cards removed, ready for that run to be replayed.
 *
 * A reload re-streams a still-running job from its first event, so every card it
 * already contributed would appear twice. This used to cut the log at the last user
 * message, which is wrong in the one case it most needed to be right: answering a
 * question writes a user message, so the question card sitting in front of it
 * survived the cut and the replay added a second copy — two identical cards, both
 * showing "Answered."
 *
 * User messages are kept, since the replay does not re-emit them, and so are cards
 * from any other run. */
export function logWithoutReplayedRun<T extends { jobId?: string }>(
	messages: readonly T[],
	jobId: string,
): T[] {
	return messages.filter((message) => message.jobId !== jobId);
}

export function shouldApplySettledAgentJob(status: AgentJobState["status"]): boolean {
	return status !== "error";
}

export function useContentAgent(args: UseContentAgentArgs): ContentAgent {
	const { projectId, contentType, setChatMessages, apply, buildStart, onSettled } = args;
	const [running, setRunning] = useState(false);
	const [interrupted, setInterrupted] = useState<{ jobId: string } | null>(null);
	const [currentJobId, setCurrentJobId] = useState<string | null>(null);
	const activeJob = useRef<string | null>(null);
	// Events already rendered per job, so resuming a suspended run streams only new
	// events instead of replaying the whole log.
	const seenRef = useRef<Record<string, number>>({});
	const stoppedRef = useRef<Record<string, boolean>>({});
	// A run suspended by ask_user. Free-text chat must not auto-answer it, or new
	// commands become answers to the parked run instead of new runs.
	const awaitingRef = useRef<{ jobId: string } | null>(null);
	/* Jobs this mount has already re-attached to.
	 *
	 * `resume` releases its slot as soon as the job reports `awaiting_input`, which
	 * is immediately for a parked run — so a second call passes the `activeJob`
	 * guard and replays the same events again. Every appended card is then written
	 * twice: one project reached 110 thinking notes and 79 tool cards for a run that
	 * produced a fraction of that. Answering or starting a run clears the mark,
	 * because those legitimately stream the job again. */
	const reattachedRef = useRef<Record<string, boolean>>({});
	/* Runs whose settled result this mount has applied. A settled run's result is
	 * applied once: re-applying a run's commands would edit twice, or be held as a
	 * conflict with its own first application. (A reload re-attaches only active
	 * runs, and the server refuses an answer to a settled one, so no path is known
	 * to reach this twice; the guard keeps it that way.) */
	const settledRef = useRef<Record<string, boolean>>({});

	// Apply a patched job to the editor (live while running, full on completion).
	const applyJob = (job: AgentJobState, opts: { running: boolean }): AgentSettleOutcome | void => {
		apply.onContext?.(job.context);
		// Only video runs exist; image and text projects are retired.
		if (contentType === "video") return apply.onScenes?.(job, opts);
	};

	// Stream an existing job's events into the chat log + apply patches until it
	// settles. Shared by run() (after start) and resume() (after reload).
	const streamJob = async (jobId: string): Promise<AgentJobState | null> => {
		activeJob.current = jobId;
		setCurrentJobId(jobId);
		let seen = seenRef.current[jobId] ?? 0;
		/* Replaying from the first event means the log must not already hold this
		 * run's cards, or every one of them is written twice.
		 *
		 * The drop lives here rather than in the callers because there are several —
		 * a reload re-attaching, an interrupted run being re-driven — and only one of
		 * them used to do it. Cards a replay re-emits are dropped; the user's own
		 * messages and every other run's cards stay. */
		if (seen === 0) setChatMessages((m) => logWithoutReplayedRun(m, jobId));
		// Long runs (many scenes × slow steps) can take minutes; poll well past that.
		for (let guard = 0; guard < 1400; guard++) {
			await sleep(1300);
			if (stoppedRef.current[jobId]) return null;
			let job: AgentJobState;
			try {
				job = await pollChatAgent(projectId!, jobId);
			} catch {
				continue;
			}
			let patched = false;
			for (const ev of job.events.slice(seen)) {
				if (ev.kind === "thinking_started")
					setChatMessages((m) => [
						...m,
						{
							id: nextMsgId(m),
							role: "assistant",
							jobId,
							note: {
								title: ev.title,
								body: "",
								elapsedSec: 0,
								running: true,
								startedAt: Date.now(),
							},
						},
					]);
				else if (ev.kind === "thinking_note")
					setChatMessages((m) => {
						const idx = [...m].reverse().findIndex((x) => x.note?.running);
						if (idx === -1)
							return [
								...m,
								{
									id: nextMsgId(m),
									role: "assistant",
									jobId,
									note: { title: ev.title, body: ev.body, elapsedSec: ev.elapsedSec },
								},
							];
						const real = m.length - 1 - idx;
						return m.map((x, i) =>
							i === real
								? {
										...x,
										note: {
											title: ev.title,
											body: ev.body,
											elapsedSec: ev.elapsedSec,
											running: false,
										},
									}
								: x,
						);
					});
				else if (ev.kind === "tool_call_started")
					setChatMessages((m) => [
						...m,
						{
							id: nextMsgId(m),
							role: "assistant",
							jobId,
							tool: { name: ev.tool, status: "running" },
						},
					]);
				else if (ev.kind === "tool_call_completed") {
					// A failed call carries its classified error; the note is just the message.
					const isErr = Boolean(ev.errorInfo);
					setChatMessages((m) => {
						// Annotated rather than inferred: a ternary of two string literals
						// widens to `string` here, which is the only reason the status
						// needed a cast. Naming the type the object becomes also checks
						// `effect` and `errorInfo`, which nothing was checking before.
						const tool: ChatToolCall = {
							name: ev.tool,
							status: isErr ? "error" : "done",
							note: ev.note,
							thumbs: ev.thumbs,
							effect: ev.effect,
							errorInfo: ev.errorInfo,
						};
						const idx = [...m]
							.reverse()
							.findIndex((x) => x.tool?.name === ev.tool && x.tool?.status === "running");
						if (idx === -1) return [...m, { id: nextMsgId(m), role: "assistant", jobId, tool }];
						const real = m.length - 1 - idx;
						return m.map((x, i) => (i === real ? { ...x, tool } : x));
					});
				} else if (ev.kind === "storyboard_patch") patched = true;
				else if (ev.kind === "workflow_progress")
					setChatMessages((m) => {
						const idx = [...m].reverse().findIndex((x) => x.workflow?.id === ev.plan.id);
						const next =
							idx !== -1
								? m.map((x, i) => (i === m.length - 1 - idx ? { ...x, workflow: ev.plan } : x))
								: [
										...m,
										{ id: nextMsgId(m), role: "assistant" as const, jobId, workflow: ev.plan },
									];
						const passedInput = ev.plan.items.some(
							(item) =>
								(item.id === "approval" && (item.status === "done" || item.status === "skipped")) ||
								((item.id === "generate" || item.id === "apply") &&
									(item.status === "running" ||
										item.status === "done" ||
										item.status === "failed")),
						);
						return passedInput
							? next.map((x) =>
									x.question?.jobId === jobId
										? { ...x, question: { ...x.question, answered: true } }
										: x,
								)
							: next;
					});
				else if (ev.kind === "outcome_evaluation")
					setChatMessages((m) => {
						// This run's check only; an earlier run's stays as it was.
						const idx = [...m]
							.reverse()
							.findIndex((message) => message.outcome && message.jobId === jobId);
						const outcome = ev.evaluation;
						if (idx === -1) return [...m, { id: nextMsgId(m), role: "assistant", jobId, outcome }];
						const real = m.length - 1 - idx;
						return m.map((message, index) => (index === real ? { ...message, outcome } : message));
					});
				else if (ev.kind === "artifact")
					setChatMessages((m) => {
						const artifact = ev.artifact;
						// Bookkeeping the chat does not render: acknowledged blockers are
						// project state read from the document, never a card in the log.
						if (artifact.kind === "blocker_acknowledgements") return m;
						// The longform plan is a single living card — replace the previous one
						// in place so the log doesn't fill with stale, interactable versions.
						// Both the longform plan and the research bundle are single living cards
						// — replace the previous one in place so the log doesn't fill with stale
						// versions.
						/* Only within this run. Replacing the newest plan anywhere in the log
						 * moved a new run's plan into an older run's turn — the newest run
						 * then showed no plan, and the older one showed a plan it never made.
						 * An earlier run's plan is history and stays as it was. */
						if (artifact.kind === "story_plan" || artifact.kind === "research_bundle") {
							const kind = artifact.kind;
							const idx = [...m]
								.reverse()
								.findIndex((x) => x.artifact?.kind === kind && x.jobId === jobId);
							if (idx !== -1) {
								const real = m.length - 1 - idx;
								return m.map((x, i) => (i === real ? { ...x, artifact } : x));
							}
						}
						return [...m, { id: nextMsgId(m), role: "assistant", jobId, artifact }];
					});
				else if (ev.kind === "assistant_text")
					setChatMessages((m) => [
						...m,
						{ id: nextMsgId(m), role: "assistant", jobId, text: ev.text },
					]);
				else if (ev.kind === "question")
					setChatMessages((m) => {
						const question = {
							question: ev.question,
							options: ev.options,
							jobId,
							actionId: ev.actionId,
							freeText: ev.freeText,
							batch: ev.batch,
						};
						/* A question is asked once, so its card is replaced rather than
						 * appended — the same living-card rule the plan and workflow cards
						 * already follow. A reload replays the run from its first event, and
						 * the replay can start more than once: `resume` releases its slot as
						 * soon as a job reports `awaiting_input`, so a second call passes the
						 * guard and streams the same events again. Appending made every one of
						 * those a fresh copy; one project accumulated thirteen. */
						const existing = ev.actionId
							? m.findIndex((x) => x.question?.actionId === ev.actionId)
							: -1;
						if (existing !== -1)
							return m.map((x, i) =>
								i === existing ? { ...x, jobId, question: { ...x.question, ...question } } : x,
							);
						return [...m, { id: nextMsgId(m), role: "assistant", jobId, question }];
					});
				else if (ev.kind === "error")
					setChatMessages((m) => [
						...m,
						{
							id: nextMsgId(m),
							role: "assistant",
							jobId,
							error: ev.errorInfo ?? classifyAgentError(ev.message),
						},
					]);
			}
			seen = job.events.length;
			seenRef.current[jobId] = seen;
			if (patched && job.status === "running") applyJob(job, { running: true });
			// Suspended by ask_user: the question card is already rendered. Stop polling
			// and remember the job so the user's next message resumes it (Design B).
			if (job.status === "awaiting_input") {
				awaitingRef.current = { jobId };
				activeJob.current = null;
				setCurrentJobId(jobId);
				return job;
			}
			if (job.status !== "running") {
				// An errored run is not marked: resuming it later settles it for the first time.
				const applies = !settledRef.current[jobId] && shouldApplySettledAgentJob(job.status);
				if (applies) settledRef.current[jobId] = true;
				const outcome = applies ? applyJob(job, { running: false }) : undefined;
				if (outcome) {
					const { step, ...result } = outcome;
					setChatMessages((m) => [...m, { id: nextMsgId(m), role: "assistant", jobId, result }]);
					if (step) onSettled?.(jobId, step);
				}
				const fin = job.events.find((e) => e.kind === "final");
				if (fin && fin.kind === "final") {
					setChatMessages((m) => [
						...m,
						{ id: nextMsgId(m), role: "assistant", jobId, text: fin.text },
					]);
				} else if (job.error && !job.events.some((event) => event.kind === "error")) {
					const errorMessage = job.error;
					setChatMessages((m) => [
						...m,
						{ id: nextMsgId(m), role: "assistant", jobId, error: classifyAgentError(errorMessage) },
					]);
				} else if (job.status !== "needs_attention") {
					setChatMessages((m) => [
						...m,
						{ id: nextMsgId(m), role: "assistant", jobId, text: "Done." },
					]);
				}
				// A run reaped after a server/Inngest restart carries an "interrupted"
				// error — offer a one-click resume from the persisted cursor.
				if (
					job.status === "error" &&
					typeof job.error === "string" &&
					job.error.toLowerCase().includes("interrupted")
				) {
					setInterrupted({ jobId });
				}
				activeJob.current = null;
				setCurrentJobId(null);
				return job;
			}
		}
		// Gave up polling — settle any live card so it stops ticking.
		setChatMessages((m) =>
			m.map((x) =>
				x.note?.running
					? {
							...x,
							note: {
								...x.note,
								running: false,
								body: x.note.body || "(still running on the server)",
							},
						}
					: x.tool?.status === "running"
						? {
								...x,
								tool: { ...x.tool, status: "error" as const, note: "still running on the server" },
							}
						: x,
			),
		);
		activeJob.current = null;
		setCurrentJobId(jobId);
		return null;
	};

	const run = async (
		instruction: string,
		scope?: ChatCommandScope,
		selection?: import("@maleo/shared").TextSelection,
		onAccepted?: () => void,
	): Promise<AgentJobState | null> => {
		if (!projectId || activeJob.current) return null;
		// Claim the in-flight slot BEFORE any await so a double-submit (two clicks
		// before startChatAgent resolves) can't open two poll loops for one job.
		activeJob.current = "pending";
		setRunning(true);
		setInterrupted(null);
		try {
			const { jobId } = await startChatAgent({
				projectId,
				instruction,
				contentType,
				...buildStart(instruction, scope),
				textSelection: selection,
			});
			onAccepted?.();
			stoppedRef.current[jobId] = false;
			return await streamJob(jobId);
		} catch (err) {
			setChatMessages((m) => [
				...m,
				{
					id: nextMsgId(m),
					role: "assistant",
					text: `Couldn't run that: ${err instanceof Error ? err.message : String(err)}`,
				},
			]);
			return null;
		} finally {
			// Always release the slot — if streamJob threw after setting the job id,
			// leaving it set would lock the chat forever.
			activeJob.current = null;
			setRunning(false);
		}
	};

	const answer = async (
		jobId: string,
		value: string,
		actionId?: string,
		batchAnswer?: StoryClarificationSubmission,
		onAccepted?: () => Promise<void>,
	): Promise<AgentJobState | null> => {
		if (!projectId || activeJob.current) return null;
		activeJob.current = "pending";
		setCurrentJobId(jobId);
		setRunning(true);
		setInterrupted(null);
		try {
			await answerChatAgent(projectId, jobId, value, actionId, batchAnswer);
			/* Only this acknowledgement makes an answer a decision. A stale action,
			 * not-awaiting run, or network failure never reaches this callback. */
			await onAccepted?.();
			awaitingRef.current = null;
			// Answering legitimately streams this job again.
			delete reattachedRef.current[jobId];
			stoppedRef.current[jobId] = false;
			return await streamJob(jobId);
		} catch (err) {
			delete seenRef.current[jobId];
			setChatMessages((m) => [
				...m,
				{
					id: nextMsgId(m),
					role: "assistant",
					text: `Couldn't answer that: ${err instanceof Error ? err.message : String(err)}`,
				},
			]);
			return null;
		} finally {
			activeJob.current = null;
			setRunning(false);
		}
	};

	const stop = async (): Promise<void> => {
		if (!projectId) return;
		const target =
			activeJob.current && activeJob.current !== "pending"
				? activeJob.current
				: (currentJobId ?? awaitingRef.current?.jobId ?? interrupted?.jobId ?? null);
		if (!target) return;
		try {
			await cancelChatRun(projectId, target);
			stoppedRef.current[target] = true;
			delete seenRef.current[target];
			awaitingRef.current = null;
			activeJob.current = null;
			setCurrentJobId(null);
			setInterrupted(null);
			setRunning(false);
			setChatMessages((m) => [
				...m.map((x) =>
					x.note?.running
						? { ...x, note: { ...x.note, running: false, body: x.note.body || "Stopped." } }
						: x.tool?.status === "running"
							? { ...x, tool: { ...x.tool, status: "error" as const, note: "Stopped." } }
							: x.question && !x.question.answered
								? { ...x, question: { ...x.question, answered: true } }
								: x,
				),
				{ id: nextMsgId(m), role: "assistant", text: "Stopped.", stopped: true },
			]);
		} catch (err) {
			setChatMessages((m) => [
				...m,
				{
					id: nextMsgId(m),
					role: "assistant",
					text: `Couldn't stop: ${err instanceof Error ? err.message : String(err)}`,
				},
			]);
		}
	};

	/* Re-attach to a still-running job after a reload (no new generation).
	 *
	 * The persisted chat already shows that run's cards up to the last save, and the
	 * replay below starts from the job's first event, so everything the run already
	 * wrote has to go first. Dropping to the last user message is not enough: the
	 * user's answer to a question is itself a user message, so the question card
	 * ahead of it survived the cut and the replay added it a second time. Every card
	 * streamed from a job carries its id, so the run's own output can be dropped
	 * exactly, leaving the user's messages and any other run's cards in place. */
	const resume = async (): Promise<void> => {
		if (!projectId || activeJob.current || running) return;
		activeJob.current = "pending"; // claim before await to avoid a double resume
		setRunning(true);
		try {
			const current = await getCurrentChatJob(projectId).catch(() => null);
			if (!current || (current.status !== "running" && current.status !== "awaiting_input")) return;
			if (reattachedRef.current[current.jobId]) return;
			reattachedRef.current[current.jobId] = true;
			setCurrentJobId(current.jobId);
			await streamJob(current.jobId);
		} finally {
			// Always release the slot, even if getCurrentChatJob/streamJob threw.
			activeJob.current = null;
			setRunning(false);
		}
	};

	// Resume an interrupted run (the API starts it again on the agent runtime from
	// the project as it was left); then stream it like any other run.
	const resumeInterrupted = async (): Promise<void> => {
		const target = interrupted;
		if (!projectId || !target || activeJob.current || running) return;
		activeJob.current = "pending";
		setRunning(true);
		setInterrupted(null);
		try {
			await resumeChatRun(projectId, target.jobId);
			delete seenRef.current[target.jobId]; // replay from the current server state
			await streamJob(target.jobId);
		} catch (err) {
			setChatMessages((m) => [
				...m,
				{
					id: nextMsgId(m),
					role: "assistant",
					text: `Couldn't resume: ${err instanceof Error ? err.message : String(err)}`,
				},
			]);
		} finally {
			activeJob.current = null;
			setRunning(false);
		}
	};

	return { run, answer, stop, resume, running, interrupted, resumeInterrupted };
}
