import { afterEach, describe, expect, test } from "bun:test";
import {
	EMPTY_CHAT_COMMAND_INPUTS,
	EMPTY_CHAT_PROJECT_INDEX,
	EMPTY_CONVERSATION_MEMORY,
	WHOLE_PROJECT_FOCUS,
} from "@maleo/shared";
import { setTextRunnerForTests } from "../../../lib/text-runner.ts";
import { briefWithChatContext, chatContextPrompt } from "./context-prompt.ts";
import type { ChatContextEnvelope } from "@maleo/shared";

afterEach(() => setTextRunnerForTests(null));

const base = {
	projectId: "project-1",
	capturedAt: 1,
	index: EMPTY_CHAT_PROJECT_INDEX,
	detail: [],
	fingerprints: [],
	memory: EMPTY_CONVERSATION_MEMORY,
	inputs: EMPTY_CHAT_COMMAND_INPUTS,
};

describe("chatContextPrompt", () => {
	test("focused clip changes planner context from whole-project scope", () => {
		const project = chatContextPrompt({ ...base, focus: WHOLE_PROJECT_FOCUS });
		const clip = chatContextPrompt({
			...base,
			focus: { source: "selection", entities: [{ kind: "clip", id: "scene:1" }] },
			detail: [{ id: "scene:1", voiceover: "Keep this sentence quiet." }],
			memory: {
				...EMPTY_CONVERSATION_MEMORY,
				decisions: [
					{
						kind: "clarification",
						question: "Delivery?",
						answer: "quiet",
						recordedAt: 1,
						provenance: { messageId: 2, runId: "run-1" },
					},
				],
			},
		});

		expect(clip).not.toBe(project);
		expect(clip).toContain("Focus source: selection");
		expect(clip).toContain("clip:scene:1");
		expect(clip).toContain('"answer":"quiet"');
		expect(project).toContain("project:project");
	});

	test("deterministic build brief receives the same frozen context", () => {
		const context = {
			...base,
			focus: { source: "selection" as const, entities: [{ kind: "clip" as const, id: "scene:1" }] },
		};
		expect(briefWithChatContext("Build it", context)).toContain("clip:scene:1");
	});
});

/* The property the index exists for: prompt size tracks the task, not the
 * project — and not the workspace the project sits in.
 *
 * This is pinned as a test because it was violated in exactly the way a test
 * would have caught and review nearly did not: the authoritative substitution
 * added for trust replaced the project's reference selection with the entire
 * workspace library, and a project holding nothing sent 91 entries and ~2.1k
 * tokens into the decider prompt on every step. Nothing failed. It was only
 * visible by measuring a rendered prompt. */
describe("context prompt stays proportional", () => {
	function envelopeWith(entries: number): ChatContextEnvelope {
		return {
			projectId: "p1",
			capturedAt: 0,
			index: {
				...EMPTY_CHAT_PROJECT_INDEX,
				timeline: Array.from({ length: entries }, (_, i) => ({
					kind: "clip" as const,
					id: `scene:${i}`,
					label: `Scene ${i}`,
				})),
			},
			detail: [],
			fingerprints: [],
			focus: WHOLE_PROJECT_FOCUS,
			memory: EMPTY_CONVERSATION_MEMORY,
			inputs: EMPTY_CHAT_COMMAND_INPUTS,
		};
	}

	test("a large index is bounded, not sent whole", () => {
		const small = chatContextPrompt(envelopeWith(5)).length;
		const huge = chatContextPrompt(envelopeWith(500)).length;
		// Bounded, not merely "smaller than everything": 500 entries must not cost
		// anything like 100x the prompt of 5.
		expect(huge).toBeLessThan(small * 4);
	});

	test("truncation states what it omitted rather than hiding it", () => {
		const prompt = chatContextPrompt(envelopeWith(500));
		expect(prompt).toContain("+475 more not shown");
	});

	test("an index within the bound is rendered whole, with no truncation note", () => {
		const prompt = chatContextPrompt(envelopeWith(5));
		expect(prompt).toContain("scene:4");
		expect(prompt).not.toContain("not shown");
	});

	test("empty groups are omitted so an empty project costs almost nothing", () => {
		const prompt = chatContextPrompt(envelopeWith(0));
		expect(prompt).toContain("(empty)");
		expect(prompt).not.toContain("references");
	});
});
