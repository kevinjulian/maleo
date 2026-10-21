import { describe, expect, test } from "vite-plus/test";
import {
	normalizeConversationMemory,
	withoutConflictingDecisions,
	conversationMemorySchema,
	DEFAULT_MEMORY_LIMITS,
	type ConversationDecision,
	type MemorySourceMessage,
} from "./conversation-memory.ts";

function decision(question: string, answer: string, messageId: number): ConversationDecision {
	return { kind: "approval", question, answer, recordedAt: messageId, provenance: { messageId } };
}

const limits = { decisions: 2, unresolved: 2, recentTurns: 3 };

describe("normalizeConversationMemory filtering", () => {
	test("keeps conversation and drops every kind of machinery", () => {
		const messages: MemorySourceMessage[] = [
			{ id: 1, role: "user", text: "make the intro punchier" },
			{ id: 2, role: "assistant", text: "on it" },
			{ id: 3, role: "assistant", tool: { name: "render" } },
			{ id: 4, role: "assistant", workflow: { id: "w1" } },
			{ id: 5, role: "assistant", note: { title: "thinking", body: "..." } },
			{ id: 6, role: "assistant", artifact: { kind: "knowledge" } },
			{ id: 7, role: "assistant", outcome: { status: "passed" } },
			{ id: 8, role: "assistant", error: { code: "x" } },
		];
		const memory = normalizeConversationMemory(messages, []);
		expect(memory.recentTurns.map((t) => t.text)).toEqual(["make the intro punchier", "on it"]);
	});

	test("a message carrying both text and a tool call is machinery, not a turn", () => {
		const memory = normalizeConversationMemory(
			[{ id: 1, role: "assistant", text: "calling a tool", tool: {} }],
			[],
		);
		expect(memory.recentTurns).toHaveLength(0);
	});

	test("empty and whitespace-only text never becomes a turn", () => {
		const memory = normalizeConversationMemory(
			[
				{ id: 1, role: "user", text: "   " },
				{ id: 2, role: "user" },
			],
			[],
		);
		expect(memory.recentTurns).toHaveLength(0);
	});

	test("an unanswered question is unresolved; an answered one is not", () => {
		const memory = normalizeConversationMemory(
			[
				{ id: 1, role: "assistant", question: { question: "Which ending?" } },
				{ id: 2, role: "assistant", question: { question: "Which voice?", answered: true } },
			],
			[],
		);
		expect(memory.unresolved.map((q) => q.question)).toEqual(["Which ending?"]);
	});

	test("decisions pass through untouched rather than being re-derived from prose", () => {
		const recorded = [decision("Which ending?", "the quiet one", 9)];
		const memory = normalizeConversationMemory(
			[{ id: 1, role: "user", text: "the quiet one" }],
			recorded,
		);
		expect(memory.decisions).toEqual(recorded);
	});
});

describe("normalizeConversationMemory bounds", () => {
	test("keeps the most recent entries within each limit, in order", () => {
		const messages: MemorySourceMessage[] = [1, 2, 3, 4, 5].map((id) => ({
			id,
			role: "user",
			text: `turn ${id}`,
		}));
		const memory = normalizeConversationMemory(
			messages,
			[decision("a", "1", 1), decision("b", "2", 2), decision("c", "3", 3)],
			limits,
		);
		expect(memory.recentTurns.map((t) => t.text)).toEqual(["turn 3", "turn 4", "turn 5"]);
		expect(memory.decisions.map((d) => d.question)).toEqual(["b", "c"]);
	});

	test("bounds unresolved questions too, so an abandoned run cannot flood memory", () => {
		const messages: MemorySourceMessage[] = [1, 2, 3, 4].map((id) => ({
			id,
			role: "assistant",
			question: { question: `q${id}` },
		}));
		const memory = normalizeConversationMemory(messages, [], limits);
		expect(memory.unresolved.map((q) => q.question)).toEqual(["q3", "q4"]);
	});

	test("a large activity log costs nothing because none of it is conversation", () => {
		const noise: MemorySourceMessage[] = Array.from({ length: 500 }, (_, i) => ({
			id: i + 10,
			role: "assistant",
			tool: { name: "t" },
		}));
		const memory = normalizeConversationMemory([{ id: 1, role: "user", text: "hi" }, ...noise], []);
		expect(memory.recentTurns).toHaveLength(1);
		expect(memory.recentTurns.length).toBeLessThanOrEqual(DEFAULT_MEMORY_LIMITS.recentTurns);
	});
});

describe("normalizeConversationMemory provenance", () => {
	test("every entry traces back to its source message, and to its run when one asked", () => {
		const memory = normalizeConversationMemory(
			[
				{ id: 7, role: "user", text: "keep it under a minute" },
				{ id: 8, role: "assistant", jobId: "run_1", question: { question: "Which cut?" } },
			],
			[],
		);
		expect(memory.recentTurns[0]?.provenance).toEqual({ messageId: 7 });
		expect(memory.unresolved[0]?.provenance).toEqual({ messageId: 8, runId: "run_1" });
	});

	test("output validates against the shared schema", () => {
		const memory = normalizeConversationMemory(
			[{ id: 1, role: "user", text: "hi" }],
			[decision("q", "a", 1)],
		);
		expect(conversationMemorySchema.safeParse(memory).success).toBe(true);
	});
});

describe("withoutConflictingDecisions", () => {
	test("current project state wins: a contradicted decision stops being a constraint", () => {
		const memory = normalizeConversationMemory(
			[],
			[decision("Aspect?", "16:9", 1), decision("Voice?", "calm", 2)],
		);
		const pruned = withoutConflictingDecisions(memory, (d) => d.question === "Aspect?");
		expect(pruned.decisions.map((d) => d.question)).toEqual(["Voice?"]);
	});

	test("leaves turns and unresolved questions alone", () => {
		const memory = normalizeConversationMemory(
			[
				{ id: 1, role: "user", text: "hi" },
				{ id: 2, role: "assistant", question: { question: "q" } },
			],
			[decision("Aspect?", "16:9", 1)],
		);
		const pruned = withoutConflictingDecisions(memory, () => true);
		expect(pruned.decisions).toEqual([]);
		expect(pruned.recentTurns).toHaveLength(1);
		expect(pruned.unresolved).toHaveLength(1);
	});
});
