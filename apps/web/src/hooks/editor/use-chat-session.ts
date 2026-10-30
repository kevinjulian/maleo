/* The project's chat log and the agent run that writes to it, as one value.
 *
 * The log and the run were always one thing — `use-content-agent.ts` streams
 * every event straight into `setChatMessages`, so a chat panel that holds the
 * messages without the run (or the reverse) can render a half-state. This hook
 * owns both and hands panels a single `ChatSession`.
 *
 * What a chat panel needs is smaller than what the container needs: panels send
 * text and answers, the container also fires runs that are not chat messages
 * (the brief, the one-time initial run) and re-attaches after a reload. That
 * split is the two interfaces below, not two hooks.
 */
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
	ChatEntityRef,
	ContentType,
	ConversationDecision,
	StoryClarificationSubmission,
	TextSelection,
} from "@maleo/shared";
import type { ChatCommandScope, ChatComposerSource } from "@models/chat/chat-composer.ts";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import type { AgentJobState } from "@models/agent/agent-wire.ts";
import type { StartChatAgentInput } from "@api/chat.ts";
import { useContentAgent, type AgentApply } from "./use-content-agent.ts";
import { decisionFromAnswer, persistAcceptedDecision } from "@models/chat/decision-record.ts";
import { useChatModelSelection, type ChatModelSelection } from "./use-chat-model-selection.ts";

/* What chat can ask of the editor beside it: preview a command's scope, take
 * the user to what a run changed, and undo a run that is still the latest step.
 * Absent where there is no editor to ask (a panel rendered on its own). */
export interface ChatEditorBridge {
	composer: ChatComposerSource;
	/** Open the applicable view and select or seek to these entities. */
	reveal: (refs: ChatEntityRef[]) => void;
	/** The run applied as one ledger step that is still the latest one. */
	canUndo: (jobId: string) => boolean;
	undo: (jobId: string) => void;
	/** Switch to the Storyboard view, where story plans are edited. Absent where
	 *  there is none, or where chat already sits beside it. */
	openStoryboard?: () => void;
}

/** What a chat panel reads and drives. */
export interface ChatSession {
	messages: ChatLogMessage[];
	setMessages: Dispatch<SetStateAction<ChatLogMessage[]>>;
	/** A free-text command from the chat box, with the scope its chips showed. */
	run: (
		text: string,
		scope?: ChatCommandScope,
		selection?: TextSelection,
		onAccepted?: () => void,
	) => Promise<boolean | void>;
	model?: ChatModelSelection;
	/** An explicit answer to a parked ask_user / approval gate. `batchAnswer` is
	 *  the structured submission a pre-research clarification card sends. */
	answer: (
		jobId: string,
		answer: string,
		actionId?: string,
		batchAnswer?: StoryClarificationSubmission,
	) => Promise<boolean>;
	running: boolean;
	/** Resolves when the cancel has landed, so a panel can keep its own busy flag
	 *  up until then. */
	stop: () => Promise<void>;
	/** A run reaped by a server restart, offered for one-click resume. */
	interrupted: { jobId: string } | null;
	resume: () => Promise<void>;
	/** Settled approvals and clarifications, newest last. */
	decisions: ConversationDecision[];
	setDecisions: Dispatch<SetStateAction<ConversationDecision[]>>;
	editor?: ChatEditorBridge;
}

/** The container's view: the panel surface plus the runs it starts itself. */
export interface ContentChat extends ChatSession {
	chatModelSelection?: TextSelection;
	setChatModelSelection: Dispatch<SetStateAction<TextSelection | undefined>>;
	/** Start a run and resolve with its final job, so the caller can decide
	 *  success from the result rather than a racy state read. */
	start: (instruction: string) => Promise<AgentJobState | null>;
	/** Re-attach to a still-running job after a reload (no new generation). */
	reattach: () => Promise<void>;
}

export function useChatSession(args: {
	projectId: string | null;
	contentType: ContentType;
	apply: AgentApply;
	buildStart: (
		instruction: string,
		scope?: ChatCommandScope,
	) => Omit<StartChatAgentInput, "projectId" | "instruction" | "contentType">;
	/** The editor side of the bridge; undo is keyed to the ledger step a run settled as. */
	editor?: {
		composer: ChatComposerSource;
		reveal: (refs: ChatEntityRef[]) => void;
		isLatest: (step: string) => boolean;
		undo: () => void;
		openStoryboard?: () => void;
	};
	/** Called before every run this session starts — the container clears its
	 *  "last run failed" flag here. */
	onRunStart: () => void;
	/* Called with the new decision list the moment one is recorded.
	 *
	 * The container makes it durable immediately. It cannot wait for the ordinary
	 * autosave: that debounce is cancelled outright on unmount, so answering a
	 * question and reloading within 1200ms would lose the answer — and "continue
	 * with what we agreed" after a reload is exactly what a recorded decision
	 * exists to serve. */
	onDecisionRecorded?: (decisions: ConversationDecision[]) => Promise<void>;
	onModelSelectionChanged?: (choice: TextSelection) => Promise<void>;
}): ContentChat {
	const { projectId, contentType, apply, buildStart, onRunStart, onDecisionRecorded, editor } =
		args;
	const [messages, setMessages] = useState<ChatLogMessage[]>([]);
	const [decisions, setDecisions] = useState<ConversationDecision[]>([]);
	const [chatModelSelection, setChatModelSelection] = useState<TextSelection>();
	useEffect(() => setChatModelSelection(undefined), [projectId]);
	const model = useChatModelSelection({
		projectId,
		preference: chatModelSelection,
		onSelect: async (choice) => {
			setChatModelSelection(choice);
			if (!args.onModelSelectionChanged) throw new Error("Editor persistence is not ready");
			await args.onModelSelectionChanged(choice);
		},
	});
	/* The ledger step each run settled as. Memory only: after a reload the
	 * ledger is empty too, so there is nothing a stored step could undo. */
	const settledRef = useRef(new Map<string, string>());
	const agent = useContentAgent({
		projectId,
		contentType,
		setChatMessages: setMessages,
		apply,
		buildStart,
		onSettled: (jobId, step) => {
			settledRef.current.set(jobId, step);
		},
	});
	const canUndo = (jobId: string): boolean => {
		const step = settledRef.current.get(jobId);
		return Boolean(step && editor?.isLatest(step));
	};

	return {
		chatModelSelection,
		model,
		setChatModelSelection,
		messages,
		setMessages,
		running: agent.running,
		interrupted: agent.interrupted,
		run: async (text, scope, selection, onAccepted) => {
			onRunStart();
			return Boolean(await agent.run(text, scope, selection ?? model.choice, onAccepted));
		},
		/* Resolves true once the server accepted the answer. A refusal — a stale
		 * action, a run no longer waiting — resolves false, so the panel can put
		 * the decision back instead of showing a question that was never answered. */
		answer: async (
			jobId: string,
			value: string,
			actionId?: string,
			batchAnswer?: StoryClarificationSubmission,
		): Promise<boolean> => {
			onRunStart();
			const decision = decisionFromAnswer(messages, jobId, value, actionId);
			let accepted = false;
			await agent.answer(jobId, value, actionId, batchAnswer, async () => {
				accepted = true;
				if (!decision) return;
				try {
					const next = await persistAcceptedDecision(decisions, decision, onDecisionRecorded);
					setDecisions(next);
				} catch (error) {
					setMessages((current) => [
						...current,
						{
							id: current.reduce((max, message) => Math.max(max, message.id), 0) + 1,
							role: "assistant",
							text: `Answer accepted, but the decision could not be saved: ${error instanceof Error ? error.message : String(error)}`,
						},
					]);
				}
			});
			return accepted;
		},
		stop: agent.stop,
		resume: agent.resumeInterrupted,
		decisions,
		setDecisions,
		editor: editor && {
			composer: editor.composer,
			reveal: editor.reveal,
			openStoryboard: editor.openStoryboard,
			canUndo,
			undo: (jobId: string): void => {
				if (!canUndo(jobId)) return;
				editor.undo();
				settledRef.current.delete(jobId);
			},
		},
		start: async (instruction: string): Promise<AgentJobState | null> => {
			onRunStart();
			return await agent.run(instruction, undefined, model.choice);
		},
		reattach: agent.resume,
	};
}
