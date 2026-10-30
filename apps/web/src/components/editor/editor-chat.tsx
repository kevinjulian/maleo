/* Maleo — Content-First Create · the project chat.
 *
 * The chat is the primary authoring surface: it shows the storyboard as a
 * timestamped script and takes natural-language commands that revise the
 * project through the agent. This file is the orchestration — the feed reads
 * as runs (`chat-feed.ts`), each rendered as one card (`chat-run-card.tsx`),
 * with the composer (`chat-composer-box.tsx`) and the pinned decision
 * (`chat-pinned-decision.tsx`) at the foot.
 *
 * Only one project run executes at a time. While it does, the composer stays
 * editable and sending prepares one visible `Send after current` instruction,
 * which launches when the run is terminal — with its context rebuilt then, from
 * the project as it is at launch, not as it was when typed. */
import { storyPlanArtifact } from "@maleo/shared";
import type { MediaPayload } from "@maleo/shared/agent-wire";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Dispatch, SetStateAction, JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { Button } from "@design-system/components/button.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { ChatMarkdown } from "./chat-markdown.tsx";
import { AuditPanel } from "./audit-panel.tsx";
import { RunView, SubmittedContext, phaseLabel, type RunActions } from "./chat-run.tsx";
import { ChatComposerBox } from "./chat-composer-box.tsx";
import { PinnedDecision } from "./chat-pinned-decision.tsx";
import { BlockerBatch } from "./chat-blocker-batch.tsx";
import { useBlockers } from "@hooks/editor/use-blockers.ts";
import { ChatOutput, CreditLimitCard, CreditMeter, creditBlocked } from "./chat-output-cards.tsx";
import { fmtMMSS } from "@models/core/measures.ts";
import {
	EMPTY_CHAT_PROJECT_INDEX,
	type AudioOverlay,
	type ChatEntityRef,
	type Scene,
	type StoryClarificationSubmission,
} from "@maleo/shared";
import type { ChatCritique, ChatLogMessage } from "@models/chat/chat-log.ts";
import {
	chatFrontier,
	frontierDecision,
	groupChatRuns,
	runProgress,
} from "@models/chat/chat-feed.ts";
import {
	commandScopeOf,
	withoutChip,
	EMPTY_DRAFT_SCOPE,
	type ComposerDraftScope,
} from "@models/chat/chat-composer.ts";
import type { ChatEditorBridge } from "@hooks/editor/use-chat-session.ts";
import type { ChatSession } from "@hooks/editor/use-chat-session.ts";
import type { TextSelection } from "@maleo/shared";
import { useChatScroll } from "@hooks/editor/use-chat-scroll.ts";
import {
	GROUND_CLAIMS_INSTRUCTION,
	HOOK_ARCHETYPES,
	WORKSPACE_LENSES,
	SHOT_LIST_INSTRUCTION,
	sceneRegenInstruction,
	styleTransferInstruction,
} from "@models/content/engage-actions.ts";
import { fetchCreditSummary, type CreditSummary } from "@api/credits.ts";
import {
	detectCommandTrigger,
	expandCommandPrompt,
	filterChatCommands,
	insertCommandPrompt,
	type ChatCommandOption,
	type CommandTrigger,
} from "@models/chat/chat-commands.ts";
import { ChatMessage } from "@design-system/patterns/chat.tsx";
import "./chat-workspace.css";
// Re-exported so the panel stays the import site its consumers already use.
export { detectCommandTrigger, expandCommandPrompt, filterChatCommands, insertCommandPrompt };
export type { ChatCommandOption, CommandTrigger };

interface ChatPanelProps {
	scenes: Scene[];
	audioOverlays?: AudioOverlay[];
	// Chat log is owned by CreateContent so it persists with the storyboard.
	messages: ChatLogMessage[];
	setMessages: Dispatch<SetStateAction<ChatLogMessage[]>>;
	// Run a natural-language command against the project, with the scope its
	// chips showed. The agent streams its own cards into the log.
	onRunCommand: ChatSession["run"];
	model?: ChatSession["model"];
	// Answer a parked ask_user / approval gate. Only explicit controls call this.
	// Resolves false when the server refused the answer.
	onAnswerQuestion?: (
		jobId: string,
		answer: string,
		actionId?: string,
		batchAnswer?: StoryClarificationSubmission,
	) => Promise<boolean | void>;
	onStop?: () => void | Promise<void>;
	// True while the agent run is active.
	busy?: boolean;
	// Optional content-type-specific quick prompts (defaults to the video set).
	quickCommands?: string[];
	onJump?: (ref: NonNullable<ChatLogMessage["ref"]>) => void;
	onAddArtifact?: (media: MediaPayload) => void;
	onSeek?: (sec: number) => void;
	// Deterministic client-side pacing critique — returns the artifact to post.
	onCritique?: () => ChatCritique;
	onClose: () => void;
	// When set, a Trace toggle opens the durable agent audit trail.
	projectId?: string | null;
	// A run interrupted by a server/Inngest restart, offered for resume.
	interrupted?: { jobId: string } | null;
	onResume?: () => void;
	/** The editor beside the chat: scope preview, reveal, and per-run Undo. */
	editor?: ChatEditorBridge;
	/** Overrides the editor's reveal — the timeline selects clips itself. */
	onReveal?: (refs: ChatEntityRef[]) => void;
}

const nextId = (msgs: ChatLogMessage[]): number => msgs.reduce((m, x) => Math.max(m, x.id), 0) + 1;

const QUICK_COMMANDS = [
	"Continue the story with dialogue",
	"Add a new character scene",
	"Make it punchier and shorter",
];

interface QueuedInstruction {
	textSelection?: TextSelection;
	text: string;
	draft: ComposerDraftScope;
}

export function ChatPanel({
	scenes,
	messages,
	setMessages,
	onRunCommand,
	onAnswerQuestion,
	onStop,
	busy: externalBusy,
	quickCommands,
	onJump,
	onAddArtifact,
	onSeek,
	onCritique,
	onClose,
	projectId,
	interrupted,
	onResume,
	editor,
	onReveal,
	model,
}: ChatPanelProps): JSX.Element {
	const quick = quickCommands ?? QUICK_COMMANDS;
	const [input, setInput] = useState("");
	const [draft, setDraft] = useState<ComposerDraftScope>(EMPTY_DRAFT_SCOPE);
	const [queued, setQueued] = useState<QueuedInstruction | null>(null);
	const [replyTo, setReplyTo] = useState<string | null>(null);
	const inputRef = useRef<HTMLTextAreaElement | null>(null);
	const [showAudit, setShowAudit] = useState(false);
	const [creditSummary, setCreditSummary] = useState<CreditSummary | null>(null);
	const [localBusy, setLocalBusy] = useState(false);
	// The editor's selection moved: re-read the chips.
	const [, bumpFocus] = useReducer((n: number) => n + 1, 0);
	const busy = localBusy || Boolean(externalBusy);
	const blockedByCredit = creditBlocked(creditSummary);
	const logRef = useRef<HTMLDivElement | null>(null);
	const scroll = useChatScroll(logRef, messages);
	const reveal = onReveal ?? editor?.reveal;

	const slugCommand = (prompt: string): string =>
		`/${prompt
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/(^-|-$)/g, "")}`;
	const commandOptions = useMemo<ChatCommandOption[]>(
		() => [
			...(onCritique
				? ([
						{
							id: "storyboard",
							command: "/generate-storyboard",
							intent: "Generate storyboard from saved brief",
							group: "story",
							prompt: "Generate a storyboard from the saved brief.",
						},
						{
							id: "critique",
							command: "/critique-pacing",
							intent: "Review pacing with timestamped notes",
							group: "review",
							prompt:
								"Critique pacing with timestamped notes. Flag slow hooks, static sections, dead zones, weak transitions, caption gaps, and unsupported claims.",
						},
						{
							id: "hook",
							command: "/write-hook",
							intent: "Rewrite first-scene hook",
							group: "rewrite",
							prompt: HOOK_ARCHETYPES[0]!.instruction,
						},
						{
							id: "workspace",
							command: "/workspace-review",
							intent: "Review through viewer workspace",
							group: "review",
							prompt: WORKSPACE_LENSES[0]!.instruction,
						},
						{
							id: "style",
							command: "/extract-style",
							intent: "Extract transferable craft traits",
							group: "style",
							prompt: styleTransferInstruction("<describe or paste what the reference does>"),
						},
						{
							id: "scene",
							command: "/punch-up-scene",
							intent: "Improve one scene only",
							group: "rewrite",
							prompt: sceneRegenInstruction(Math.min(2, Math.max(1, scenes.length)), ""),
						},
						{
							id: "claims",
							command: "/ground-claims",
							intent: "Ground unsupported claims with proof",
							group: "proof",
							prompt: GROUND_CLAIMS_INSTRUCTION,
						},
						{
							id: "shots",
							command: "/rank-shots",
							intent: "Rank refs and assign scene visuals",
							group: "references",
							prompt: SHOT_LIST_INSTRUCTION,
						},
					] satisfies ChatCommandOption[])
				: []),
			...quick.map((prompt, i) => ({
				id: `quick-${i}`,
				command: slugCommand(prompt),
				intent: prompt,
				group: "quick",
				prompt,
			})),
		],
		[onCritique, quick, scenes.length],
	);

	/* Blockers are project state, not transcript: they are read from the project
	 * and stay actionable however many runs have happened since one appeared. */
	const blockers = useBlockers(projectId ?? null, busy);
	// Only the newest run's decision is pending; a newer instruction supersedes it.
	const pending = useMemo(() => frontierDecision(groupChatRuns(messages)), [messages]);
	const pendingQuestion = pending?.question ?? null;
	// Reply mode belongs to one question; when that question resolves or is
	// superseded, the mode ends with it.
	const replying =
		replyTo != null && pendingQuestion?.actionId === replyTo && Boolean(pendingQuestion?.freeText);
	useEffect(() => {
		if (replyTo != null && !replying) setReplyTo(null);
	}, [replyTo, replying]);

	const composer = editor?.composer;
	useEffect(() => composer?.subscribe(bumpFocus), [composer]);
	const preview = composer?.preview(input, commandScopeOf(input, draft));

	useEffect(() => {
		let alive = true;
		const load = async () => {
			try {
				const next = await fetchCreditSummary();
				if (alive) setCreditSummary(next);
			} catch {
				if (alive) setCreditSummary(null);
			}
		};
		void load();
		const timer = window.setInterval(() => void load(), busy ? 5000 : 15000);
		return () => {
			alive = false;
			window.clearInterval(timer);
		};
	}, [busy]);

	const focusComposer = (): void => {
		requestAnimationFrame(() => inputRef.current?.focus());
	};

	/* Start one run. The chips are resolved now, at launch — for a queued
	 * instruction that is when the previous run finished, so its scope reflects
	 * the project as it now is — and frozen onto the instruction. */
	const launch = async (item: QueuedInstruction, onAccepted?: () => void): Promise<void> => {
		const scope = commandScopeOf(item.text, item.draft);
		const chips = composer?.preview(item.text, scope).chips ?? [];
		setMessages((m) => [
			...m,
			{ id: nextId(m), role: "user", text: item.text, ...(chips.length ? { scope: chips } : {}) },
		]);
		setLocalBusy(true);
		try {
			const accepted = model
				? await onRunCommand(item.text, scope, item.textSelection, onAccepted)
				: await onRunCommand(item.text, scope);
			if (accepted !== false) onAccepted?.();
		} catch (err) {
			setMessages((m) => [
				...m,
				{
					id: nextId(m),
					role: "assistant",
					text: `Couldn't apply that: ${err instanceof Error ? err.message : String(err)}`,
				},
			]);
		} finally {
			setLocalBusy(false);
		}
	};

	// The queued instruction launches once the current run is terminal: not
	// running, and not parked on a question.
	useEffect(() => {
		if (!queued || busy || pending) return;
		const item = queued;
		setQueued(null);
		void launch(item);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [queued, busy, pending]);

	const answer = (
		value: string,
		submission?: StoryClarificationSubmission,
		readable?: string,
	): void => {
		if (!pending?.question || !onAnswerQuestion) return;
		const { jobId, actionId } = pending.question;
		const msgId = pending.id;
		setMessages((m) => [
			...m.map((x) =>
				x.id === msgId && x.question ? { ...x, question: { ...x.question, answered: true } } : x,
			),
			{ id: nextId(m), role: "user", text: readable ?? value, reply: true },
		]);
		setReplyTo(null);
		setLocalBusy(true);
		void onAnswerQuestion(jobId, value, actionId, submission)
			.then((accepted) => {
				// Refused: the run did not move on, so neither does its decision.
				if (accepted === false)
					setMessages((m) =>
						m.map((x) =>
							x.id === msgId && x.question
								? { ...x, question: { ...x.question, answered: false } }
								: x,
						),
					);
			})
			.finally(() => setLocalBusy(false));
		focusComposer();
	};
	/* A clarification batch is one structured submission for the whole card; the
	 * transcript records what the user decided, not the wire payload. */
	const answerBatch = (submission: StoryClarificationSubmission): void => {
		const batch = pending?.question?.batch;
		if (!batch) return;
		const readable = batch.questions
			.map((question) => {
				const picked = submission.answers?.find(
					(candidate) => candidate.questionId === question.id,
				);
				const option = picked?.optionId
					? question.options.find((candidate) => candidate.id === picked.optionId)
					: undefined;
				return `${question.header}: ${option?.label ?? picked?.otherText ?? "your best judgment"}`;
			})
			.join(" · ");
		answer(readable, submission, readable);
	};

	const send = (text: string): void => {
		const expanded = expandCommandPrompt(text, commandOptions);
		if (!expanded) return;
		if (replying) {
			setInput("");
			answer(expanded);
			return;
		}
		if (model && (!model.valid || model.saving || model.saveError)) return;
		const item: QueuedInstruction = { text: expanded, draft, textSelection: model?.choice };
		/* One project run at a time: while one executes, this becomes (or replaces)
		 * the single visible queued instruction.
		 *
		 * A parked decision queues for the same reason, though the run is not busy.
		 * Sending used to launch immediately, which abandoned the gate the user was
		 * reading — a plan approval could vanish mid-thought because they typed. The
		 * drain below already waits for the decision to clear, so this only makes the
		 * two paths agree, and the status line's "Waiting for your decision" true. */
		if (busy || queued || pending) {
			setQueued(item);
			setInput("");
			setDraft(EMPTY_DRAFT_SCOPE);
			return;
		}
		void launch(item, () => {
			if (inputRef.current?.value === text) {
				setInput("");
				setDraft(EMPTY_DRAFT_SCOPE);
			}
		});
	};
	const editQueued = (): void => {
		if (!queued) return;
		setInput(queued.text);
		setDraft(queued.draft);
		setQueued(null);
		focusComposer();
	};
	const stopRun = (): void => {
		setReplyTo(null);
		setLocalBusy(true);
		void Promise.resolve(onStop?.()).finally(() => setLocalBusy(false));
		focusComposer();
	};

	if (showAudit && projectId) {
		return (
			<AuditPanel
				projectId={projectId}
				onRun={(text) => send(text)}
				busy={busy}
				onClose={() => setShowAudit(false)}
			/>
		);
	}

	// Build a running timestamp from scene durations so the script reads like a
	// shot list.
	let cursor = 0;
	const script = scenes.map((s) => {
		const start = cursor;
		cursor += Math.max(1, s.dur);
		return {
			id: s.id,
			range: `${fmtMMSS(start)}–${fmtMMSS(cursor)}`,
			name: s.name,
			vo: s.vo,
			vis: s.vis,
		};
	});

	const runs = groupChatRuns(messages);
	const index = preview?.index ?? EMPTY_CHAT_PROJECT_INDEX;
	const lastRun = runs[runs.length - 1];
	const lastProgress = lastRun
		? runProgress(lastRun, {
				active: busy,
				interruptedJobId: interrupted?.jobId,
				creditBlocked: Boolean(blockedByCredit),
			})
		: null;
	const status =
		busy && lastProgress
			? phaseLabel(lastProgress)
			: pendingQuestion
				? "Waiting for your decision"
				: lastProgress
					? phaseLabel(lastProgress)
					: "";
	/* Only the newest run may act, and only in the way its state calls for.
	 * Every other run is history and is handed no callbacks at all. */
	const frontier = chatFrontier(runs, lastProgress);
	const frontierActions = (run: (typeof runs)[number]): RunActions => ({
		stop: onStop ? stopRun : undefined,
		resume: onResume,
		retry: send,
		result: {
			reveal,
			canUndo: Boolean(run.jobId && editor?.canUndo(run.jobId)),
			undo: run.jobId && editor ? () => editor.undo(run.jobId!) : undefined,
		},
		// Outputs act only when the run settled with nothing pending; every other
		// state offers its own action set and nothing else.
		output: frontier?.outputs
			? {
					busy,
					onSend: send,
					onSeek,
					onJump,
					onAddArtifact,
					onOpenStoryboard: editor?.openStoryboard,
				}
			: undefined,
	});

	return (
		<>
			<PanelHeader
				density="tool"
				title="Chat"
				actions={
					projectId ? (
						<IconButton size="xs" onClick={() => setShowAudit(true)} title="Changes + assets audit">
							{Ic.layers(ICON.md)}
						</IconButton>
					) : undefined
				}
				onClose={onClose}
				closeLabel="Hide panel"
			/>
			<div className="fc-chat">
				<div className="fc-sr-only" role="status" aria-live="polite" aria-atomic="true">
					{status}
				</div>
				<div
					className="fc-chat-log"
					ref={logRef}
					onScroll={scroll.onScroll}
					role="log"
					aria-label="Chat history"
				>
					{script.length > 0 && (
						<div className="fc-script">
							<div className="fc-script-head">
								<span>Timestamp</span>
								<span>Content</span>
							</div>
							{script.map((row) => (
								<div key={row.id} className="fc-script-row">
									<span className="fc-script-ts">{row.range}</span>
									<span className="fc-script-content">
										<b>{row.name}</b>
										{row.vo ? <em>“{row.vo}”</em> : row.vis ? <span>{row.vis}</span> : null}
									</span>
								</div>
							))}
						</div>
					)}

					{messages.length === 0 && !busy && (
						<div className="fc-empty">
							<div className="fc-empty-icon">{Ic.spark(ICON.lg)}</div>
							<div className="fc-empty-title">Direct your story in plain language</div>
							<div className="fc-empty-sub">
								Describe a change, ask for a critique, or pick a starting point. Type <b>/</b> for
								commands, <b>@</b> for project items.
							</div>
							<div className="fc-empty-chips">
								{quick.slice(0, 3).map((q, i) => (
									<Button variant="secondary" size="sm" key={i} onClick={() => send(q)}>
										{Ic.spark(ICON.xs)} {q}
									</Button>
								))}
							</div>
						</div>
					)}
					{runs.map((run, ri) => {
						const live = ri === runs.length - 1;
						const progress =
							live && lastProgress
								? lastProgress
								: runProgress(run, { active: false, interruptedJobId: interrupted?.jobId });
						const isFrontier = frontier?.runKey === run.key;
						const actions = isFrontier ? frontierActions(run) : undefined;
						// Output with no run behind it — a client-side critique, a local
						// error — reads as itself, without a status line.
						const hasRun = Boolean(
							run.jobId ||
							run.activity.length ||
							run.result ||
							run.decisions.length ||
							(live && busy),
						);
						const held = run.result?.status === "held";
						return (
							<section
								key={run.key}
								className="fc-turn"
								aria-label={run.user?.text ? `Run: ${run.user.text.slice(0, 80)}` : "Run"}
							>
								{run.user && <ChatMessage speaker="user">{run.user.text}</ChatMessage>}
								{run.user?.scope && <SubmittedContext chips={run.user.scope} />}
								{hasRun ? (
									<RunView
										run={run}
										progress={progress}
										index={index}
										frontier={
											isFrontier && frontier
												? { action: frontier.action, actions: actions! }
												: undefined
										}
										pinnedId={pending?.id}
									/>
								) : (
									run.outputs.map((m) => (
										<ChatOutput key={m.id} message={m} actions={actions?.output} />
									))
								)}
								{/* A held run's prose describes an edit that never landed, so it
								    reads as a proposal rather than as what happened. */}
								{run.answers.map((m) => (
									<ChatMessage
										key={m.id}
										speaker="assistant"
										held={held ? "Proposed, not applied" : undefined}
									>
										<ChatMarkdown text={m.text ?? ""} />
									</ChatMessage>
								))}
							</section>
						);
					})}
					{scroll.unread && (
						<button type="button" className="fc-jump" onClick={scroll.jumpToLatest}>
							New activity · Jump to latest
						</button>
					)}
				</div>

				<div className="fc-chat-foot">
					<CreditMeter summary={creditSummary} />
					{pending && (
						<PinnedDecision
							message={pending}
							busy={busy}
							replying={replying}
							onChoose={(value) => answer(value)}
							onSubmitBatch={answerBatch}
							onReply={() => {
								setReplyTo(pendingQuestion?.actionId ?? null);
								focusComposer();
							}}
							onStop={onStop ? stopRun : undefined}
							// Editing the plan before approving it is part of this decision.
							onOpenStoryboard={
								lastRun?.outputs.some((m) => m.artifact?.kind === storyPlanArtifact.kind)
									? editor?.openStoryboard
									: undefined
							}
						/>
					)}
					{(blockers.batch || blockers.acknowledged.length > 0) && (
						<BlockerBatch
							batch={blockers.batch}
							blockers={blockers.blockers}
							acknowledged={blockers.acknowledged}
							busy={busy}
							onResolve={blockers.resolve}
							onRun={send}
						/>
					)}
					{blockedByCredit && creditSummary ? (
						<CreditLimitCard summary={creditSummary} onCommand={send} />
					) : (
						<ChatComposerBox
							model={model}
							value={input}
							onChange={setInput}
							inputRef={inputRef}
							commands={commandOptions}
							preview={preview}
							onRemoveChip={(chip) => setDraft((d) => withoutChip(d, chip))}
							onMention={(mention) =>
								setDraft((d) => ({ ...d, mentions: [...d.mentions, mention] }))
							}
							running={busy}
							queued={queued?.text ?? null}
							onEditQueued={editQueued}
							onRemoveQueued={() => setQueued(null)}
							replyingTo={replying ? (pendingQuestion?.question ?? null) : null}
							onCancelReply={() => {
								setReplyTo(null);
								focusComposer();
							}}
							onSubmit={send}
						/>
					)}
				</div>
			</div>
		</>
	);
}

export default ChatPanel;
