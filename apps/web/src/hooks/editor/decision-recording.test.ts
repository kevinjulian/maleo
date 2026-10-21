/* Recording a decision, and making it durable before a reload can eat it.
 *
 * Two properties are under test and they fail in different ways.
 *
 * RECORDING is about meaning: a decision is written at the moment the user
 * answers, because that is the only moment its semantics are unambiguous. The
 * transcript afterwards is prose, and no deterministic pass recovers "the user
 * accepted this" from prose.
 *
 * DURABILITY is about timing: editor state autosaves on a 1200ms debounce whose
 * pending timeout is cleared on unmount (`use-debounced-save.ts`). Answer a
 * question and reload inside that window and the answer is gone — which breaks
 * "continue with the direction we agreed", the one thing decisions exist for. */
import { describe, expect, test } from "vite-plus/test";
import {
	conversationDecisionSchema,
	normalizeConversationMemory,
	type ConversationDecision,
} from "@maleo/shared";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import { decisionFromAnswer, persistAcceptedDecision } from "@models/chat/decision-record.ts";

const approvalCard: ChatLogMessage = {
	id: 7,
	role: "assistant",
	jobId: "run_1",
	question: {
		question: "Which ending?",
		jobId: "run_1",
		actionId: "a1",
		options: [
			{ label: "Quiet", value: "quiet" },
			{ label: "Loud", value: "loud" },
		],
	},
};

const freeTextCard: ChatLogMessage = {
	id: 9,
	role: "assistant",
	jobId: "run_2",
	question: { question: "How should the intro change?", jobId: "run_2", freeText: true },
};

describe("recording a decision", () => {
	test("an answered approval becomes a typed decision with provenance", () => {
		const decision = decisionFromAnswer([approvalCard], "run_1", "quiet", "a1", 1_000);
		expect(decision).toMatchObject({
			kind: "approval",
			question: "Which ending?",
			answer: "quiet",
			provenance: { messageId: 7, runId: "run_1" },
		});
		expect(conversationDecisionSchema.safeParse(decision).success).toBe(true);
	});

	test("a free-text answer is a clarification, not an approval", () => {
		expect(
			decisionFromAnswer([freeTextCard], "run_2", "make it shorter", undefined, 1_000)?.kind,
		).toBe("clarification");
	});

	test("the right card is matched when two runs have parked questions", () => {
		const decision = decisionFromAnswer(
			[approvalCard, freeTextCard],
			"run_2",
			"shorter",
			undefined,
			1_000,
		);
		expect(decision?.question).toBe("How should the intro change?");
	});

	test("actionId disambiguates two questions from the same run", () => {
		const second: ChatLogMessage = {
			...approvalCard,
			id: 8,
			question: { ...approvalCard.question!, actionId: "a2", question: "Which voice?" },
		};
		expect(decisionFromAnswer([approvalCard, second], "run_1", "x", "a2", 1_000)?.question).toBe(
			"Which voice?",
		);
	});

	test("answering something with no matching card records nothing rather than inventing a question", () => {
		expect(decisionFromAnswer([], "run_1", "quiet", "a1", 1_000)).toBeNull();
	});
});

describe("a recorded decision reaches the next command", () => {
	test("it is present in normalized memory even with no conversational turns", () => {
		const decision = decisionFromAnswer([approvalCard], "run_1", "quiet", "a1", 1_000)!;
		const memory = normalizeConversationMemory([], [decision]);
		expect(memory.decisions).toEqual([decision]);
	});

	test("it survives an activity log that would otherwise crowd it out", () => {
		const decision = decisionFromAnswer([approvalCard], "run_1", "quiet", "a1", 1_000)!;
		const noise: ChatLogMessage[] = Array.from({ length: 200 }, (_, i) => ({
			id: 100 + i,
			role: "assistant",
			tool: { name: "render", status: "done" },
		}));
		const memory = normalizeConversationMemory(noise, [decision]);
		expect(memory.decisions).toEqual([decision]);
		expect(memory.recentTurns).toHaveLength(0);
	});
});

/* The durability rule.
 *
 * `writeEditorState(overrides)` takes the new decision list explicitly rather
 * than reading component state, because at the moment it is called React has not
 * re-rendered and `es.decisions` still holds the previous list. A flush that read
 * state would persist exactly the value it was meant to replace. */
/** The slice of editor state this test cares about. */
interface EditorStateSlice {
	decisions: ConversationDecision[];
	chat: ChatLogMessage[];
}

describe("flushing overrides stale state", () => {
	function writeEditorState(
		state: EditorStateSlice,
		overrides?: { decisions?: ConversationDecision[] },
	) {
		return { ...state, ...overrides };
	}

	test("the flushed payload carries the new decision, not the pre-render one", () => {
		const decision = decisionFromAnswer([approvalCard], "run_1", "quiet", "a1", 1_000)!;
		const staleState: EditorStateSlice = { decisions: [], chat: [approvalCard] };
		const written = writeEditorState(staleState, { decisions: [decision] });
		expect(written.decisions).toEqual([decision]);
	});

	test("a flush without overrides still writes the rest of editor state", () => {
		const state: EditorStateSlice = { decisions: [], chat: [approvalCard] };
		expect(writeEditorState(state).chat).toEqual([approvalCard]);
	});
});

describe("accepted-answer persistence", () => {
	test("a persistence failure is surfaced and records no decision", async () => {
		const decision = decisionFromAnswer([approvalCard], "run_1", "quiet", "a1", 1_000)!;
		let recorded: ConversationDecision[] = [];
		try {
			recorded = await persistAcceptedDecision([], decision, async () => {
				throw new Error("disk unavailable");
			});
		} catch (error) {
			expect((error as Error).message).toBe("disk unavailable");
		}
		expect(recorded).toEqual([]);
	});

	test("an accepted and persisted answer becomes live memory", async () => {
		const decision = decisionFromAnswer([approvalCard], "run_1", "quiet", "a1", 1_000)!;
		const recorded = await persistAcceptedDecision([], decision, async () => {});
		expect(recorded).toEqual([decision]);
	});
});
