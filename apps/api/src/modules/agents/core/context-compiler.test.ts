import { describe, expect, test } from "vite-plus/test";
import { chatContextProjectMismatch, compileChatContext } from "./context-compiler.ts";
import {
	EMPTY_CHAT_PROJECT_INDEX,
	EMPTY_CONVERSATION_MEMORY,
	EMPTY_PROJECT_MATERIALS,
	WHOLE_PROJECT_FOCUS,
} from "@maleo/shared";

const NOW = 1_700_000_000_000;

function envelope(overrides: Record<string, unknown> = {}) {
	return {
		projectId: "p1",
		capturedAt: NOW,
		index: EMPTY_CHAT_PROJECT_INDEX,
		focus: { source: "selection", entities: [{ kind: "clip", id: "scene:1" }] },
		memory: EMPTY_CONVERSATION_MEMORY,
		...overrides,
	};
}

function decision(messageId: number, runId?: string) {
	return {
		kind: "approval",
		question: "Which ending?",
		answer: "quiet",
		recordedAt: NOW,
		provenance: runId ? { messageId, runId } : { messageId },
	};
}

function compile(raw: unknown, isOwnRun?: (runId: string) => boolean) {
	return compileChatContext({ projectId: "p1", raw, now: NOW, isOwnRun });
}

describe("envelope requests", () => {
	test("a valid envelope compiles and keeps its focus", () => {
		const compiled = compile(envelope());
		expect(compiled.legacy).toBe(false);
		expect(compiled.rejected).toEqual([]);
		expect(compiled.envelope.focus.source).toBe("selection");
		expect(compiled.envelope.focus.entities).toEqual([{ kind: "clip", id: "scene:1" }]);
	});

	test("the server's project id always wins", () => {
		// The route rejects an outright mismatch; this pins that nothing else can
		// slip a different id through into the frozen context.
		const compiled = compileChatContext({
			projectId: "p1",
			raw: envelope({ projectId: "p1" }),
			now: NOW,
		});
		expect(compiled.envelope.projectId).toBe("p1");
	});

	test("authoritative project records replace client materials and references", () => {
		const compiled = compileChatContext({
			projectId: "p1",
			now: NOW,
			raw: envelope({
				inputs: {
					referenceIds: ["foreign"],
					styleImageUrl: "https://evil.example/style.png",
					materials: { story: { body: "client claim" } },
				},
			}),
			resolveProjectContext: () => ({
				materials: {
					...EMPTY_PROJECT_MATERIALS,
					story: { ...EMPTY_PROJECT_MATERIALS.story, body: "saved story" },
				},
				referenceIds: ["owned"],
				references: [{ id: "owned", label: "Owned", imageUrl: "https://cdn.example/owned.png" }],
			}),
		});

		expect(compiled.envelope.inputs.referenceIds).toEqual(["owned"]);
		expect(compiled.envelope.inputs.materials?.story?.body).toBe("saved story");
		expect(compiled.envelope.inputs.styleImageUrl).toBeUndefined();
		expect(compiled.rejected).toContain("reference_unowned");
		expect(compiled.rejected).toContain("style_image_unowned");
	});

	test("an owned style image resolves to the canonical project entity url", () => {
		const compiled = compileChatContext({
			projectId: "p1",
			now: NOW,
			raw: envelope(),
			claimedStyleImageUrl: "https://cdn.example/owned.png",
			resolveProjectContext: () => ({
				materials: EMPTY_PROJECT_MATERIALS,
				referenceIds: ["owned"],
				references: [{ id: "owned", label: "Owned", imageUrl: "https://cdn.example/owned.png" }],
			}),
		});
		expect(compiled.envelope.inputs.styleImageUrl).toBe("https://cdn.example/owned.png");
	});
});

describe("legacy requests", () => {
	test("no envelope compiles to whole-project context rather than failing", () => {
		const compiled = compile(undefined);
		expect(compiled.legacy).toBe(true);
		expect(compiled.envelope.focus).toEqual(WHOLE_PROJECT_FOCUS);
		expect(compiled.envelope.memory).toEqual(EMPTY_CONVERSATION_MEMORY);
		expect(compiled.envelope.projectId).toBe("p1");
	});

	test("null is treated the same as absent", () => {
		expect(compile(null).legacy).toBe(true);
	});
});

describe("malformed envelopes", () => {
	test("an invalid focus falls back to whole-project and is reported", () => {
		const compiled = compile(envelope({ focus: { source: "guess", entities: [] } }));
		expect(compiled.envelope.focus).toEqual(WHOLE_PROJECT_FOCUS);
		expect(compiled.rejected).toContain("envelope_invalid");
		// Not the legacy path: the client did send something, it was just unusable.
		expect(compiled.legacy).toBe(false);
	});

	test("a non-object envelope does not throw", () => {
		expect(compile("nonsense").envelope.focus).toEqual(WHOLE_PROJECT_FOCUS);
	});
});

describe("memory validation", () => {
	test("a malformed decision is dropped and the rest of memory survives", () => {
		const compiled = compile(
			envelope({
				memory: {
					decisions: [decision(1), { kind: "approval", question: "x" }],
					unresolved: [],
					recentTurns: [{ role: "user", text: "hello", provenance: { messageId: 2 } }],
				},
			}),
		);
		expect(compiled.envelope.memory.decisions).toHaveLength(1);
		expect(compiled.envelope.memory.recentTurns).toHaveLength(1);
		expect(compiled.rejected).toContain("memory_decision_invalid");
		// One bad entry must not cost the focus.
		expect(compiled.envelope.focus.source).toBe("selection");
	});

	test("an entry citing another project's run is dropped", () => {
		const compiled = compile(
			envelope({
				memory: {
					decisions: [decision(1, "run_theirs"), decision(2, "run_ours")],
					unresolved: [],
					recentTurns: [],
				},
			}),
			(runId) => runId === "run_ours",
		);
		expect(compiled.envelope.memory.decisions).toHaveLength(1);
		expect(compiled.envelope.memory.decisions[0]?.provenance.runId).toBe("run_ours");
		expect(compiled.rejected).toContain("memory_provenance_foreign_run");
	});

	test("an entry with no run id is kept — nothing to verify is not a failure", () => {
		const compiled = compile(
			envelope({ memory: { decisions: [decision(1)], unresolved: [], recentTurns: [] } }),
			() => false,
		);
		expect(compiled.envelope.memory.decisions).toHaveLength(1);
	});

	test("malformed turns and questions are dropped independently", () => {
		const compiled = compile(
			envelope({
				memory: {
					decisions: [],
					unresolved: [{ question: "still open", provenance: { messageId: 3 } }, { question: 42 }],
					recentTurns: [{ role: "narrator", text: "x", provenance: { messageId: 4 } }],
				},
			}),
		);
		expect(compiled.envelope.memory.unresolved).toHaveLength(1);
		expect(compiled.envelope.memory.recentTurns).toHaveLength(0);
		expect(compiled.rejected).toContain("memory_question_invalid");
		expect(compiled.rejected).toContain("memory_turn_invalid");
	});

	test("memory that is not an object compiles to empty memory", () => {
		expect(compile(envelope({ memory: "nope" })).envelope.memory).toEqual(
			EMPTY_CONVERSATION_MEMORY,
		);
	});
});

describe("pending action", () => {
	test("is carried through so a new command knows the conversation is mid-decision", () => {
		const compiled = compile(
			envelope({
				pendingAction: { actionId: "a1", kind: "clarification", question: "Which cut?" },
			}),
		);
		expect(compiled.envelope.pendingAction?.actionId).toBe("a1");
	});
});

describe("chatContextProjectMismatch", () => {
	test("true when the envelope names a different project", () => {
		expect(chatContextProjectMismatch({ projectId: "other" }, "p1")).toBe(true);
	});

	test("false when it matches, is absent, or is not an object", () => {
		expect(chatContextProjectMismatch({ projectId: "p1" }, "p1")).toBe(false);
		expect(chatContextProjectMismatch({}, "p1")).toBe(false);
		expect(chatContextProjectMismatch(undefined, "p1")).toBe(false);
		expect(chatContextProjectMismatch("x", "p1")).toBe(false);
	});
});

/* Ownership and scope are different questions.
 *
 * The trusted lookup holds the whole workspace library because that is what
 * answers "does the caller own this id". The index answers a different question —
 * what is this project made of — and answering it with the library is what put
 * the user's entire reference collection into every decider prompt. */
describe("authoritative substitution is scoped, not just trusted", () => {
	const library = Array.from({ length: 50 }, (_, i) => ({
		id: `ref_${i}`,
		label: `Reference ${i}`,
	}));

	function compileWithLibrary(selected: string[], claimed: string[] = []) {
		return compileChatContext({
			projectId: "p1",
			raw: envelope({ inputs: { referenceIds: claimed } }),
			now: NOW,
			resolveProjectContext: () => ({
				materials: EMPTY_PROJECT_MATERIALS as never,
				referenceIds: selected,
				references: library,
			}),
		});
	}

	test("the index lists the project's selection, not the workspace library", () => {
		const compiled = compileWithLibrary(["ref_3", "ref_7"]);
		expect(compiled.envelope.index.references.map((r) => r.id)).toEqual(["ref_3", "ref_7"]);
	});

	test("a project selecting nothing indexes nothing, however large the library", () => {
		expect(compileWithLibrary([]).envelope.index.references).toEqual([]);
	});

	test("ownership still uses the whole library, so a selected id is not rejected", () => {
		const compiled = compileWithLibrary(["ref_3"], ["ref_3"]);
		expect(compiled.rejected).not.toContain("reference_unowned");
		expect(compiled.envelope.inputs.referenceIds).toEqual(["ref_3"]);
	});

	test("a reference the project did not select is still rejected as unowned input", () => {
		const compiled = compileWithLibrary(["ref_3"], ["ref_9"]);
		expect(compiled.rejected).toContain("reference_unowned");
	});
});
