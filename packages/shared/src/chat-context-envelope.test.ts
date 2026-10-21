import { describe, expect, test } from "vite-plus/test";
import {
	chatContextEnvelopeSchema,
	chatEntityRefSchema,
	entityFingerprintSchema,
	entityKey,
	resolvedChatFocusSchema,
	sameEntity,
	touchedResultScopeSchema,
	WHOLE_PROJECT_FOCUS,
	WHOLE_PROJECT_REF,
	EMPTY_CHAT_PROJECT_INDEX,
} from "./chat-context-envelope.ts";
import { EMPTY_CONVERSATION_MEMORY } from "./conversation-memory.ts";

const envelope = {
	projectId: "p1",
	capturedAt: 1_700_000_000_000,
	index: EMPTY_CHAT_PROJECT_INDEX,
	focus: WHOLE_PROJECT_FOCUS,
	memory: EMPTY_CONVERSATION_MEMORY,
};

describe("chatContextEnvelopeSchema", () => {
	test("accepts a minimal valid envelope and defaults the optional collections", () => {
		const parsed = chatContextEnvelopeSchema.parse(envelope);
		expect(parsed.detail).toEqual([]);
		expect(parsed.fingerprints).toEqual([]);
		expect(parsed.pendingAction).toBeUndefined();
	});

	test("rejects a missing project identity", () => {
		expect(chatContextEnvelopeSchema.safeParse({ ...envelope, projectId: "" }).success).toBe(false);
		const { projectId: _omitted, ...withoutProject } = envelope;
		expect(chatContextEnvelopeSchema.safeParse(withoutProject).success).toBe(false);
	});

	test("rejects an invalid focus source", () => {
		const bad = { ...envelope, focus: { source: "guess", entities: [] } };
		expect(chatContextEnvelopeSchema.safeParse(bad).success).toBe(false);
	});

	test("rejects malformed memory provenance", () => {
		const bad = {
			...envelope,
			memory: {
				decisions: [
					{
						kind: "approval",
						question: "q",
						answer: "a",
						recordedAt: 1,
						provenance: { messageId: "not-a-number" },
					},
				],
				unresolved: [],
				recentTurns: [],
			},
		};
		expect(chatContextEnvelopeSchema.safeParse(bad).success).toBe(false);
	});

	test("carries a pending action when the run is parked", () => {
		const parsed = chatContextEnvelopeSchema.parse({
			...envelope,
			pendingAction: { actionId: "a1", kind: "clarification", question: "Which ending?" },
		});
		expect(parsed.pendingAction?.actionId).toBe("a1");
	});
});

describe("chatEntityRefSchema", () => {
	test("rejects an empty id", () => {
		expect(chatEntityRefSchema.safeParse({ kind: "clip", id: "" }).success).toBe(false);
	});

	test("rejects an unknown kind", () => {
		expect(chatEntityRefSchema.safeParse({ kind: "paragraph", id: "1" }).success).toBe(false);
	});

	test("accepts the stable clip id form", () => {
		expect(chatEntityRefSchema.parse({ kind: "clip", id: "scene:3" }).id).toBe("scene:3");
	});
});

describe("entityFingerprintSchema", () => {
	test("requires a non-empty hash", () => {
		expect(entityFingerprintSchema.safeParse({ kind: "slide", id: "s1", hash: "" }).success).toBe(
			false,
		);
		expect(
			entityFingerprintSchema.safeParse({ kind: "slide", id: "s1", hash: "abc" }).success,
		).toBe(true);
	});
});

describe("resolvedChatFocusSchema", () => {
	test("keeps several explicit targets as several targets", () => {
		const focus = resolvedChatFocusSchema.parse({
			source: "mention",
			entities: [
				{ kind: "clip", id: "scene:1" },
				{ kind: "clip", id: "scene:2" },
			],
		});
		expect(focus.entities).toHaveLength(2);
	});
});

describe("touchedResultScopeSchema", () => {
	test("defaults fingerprints so a declaration-only result parses", () => {
		const scope = touchedResultScopeSchema.parse({ touched: [{ kind: "post", id: "p3" }] });
		expect(scope.fingerprints).toEqual([]);
	});
});

describe("entityKey / sameEntity", () => {
	test("distinguishes the same id under different kinds", () => {
		expect(entityKey({ kind: "slide", id: "1" })).not.toBe(entityKey({ kind: "post", id: "1" }));
		expect(sameEntity({ kind: "slide", id: "1" }, { kind: "post", id: "1" })).toBe(false);
	});

	test("matches identical refs", () => {
		expect(sameEntity(WHOLE_PROJECT_REF, { kind: "project", id: "project" })).toBe(true);
	});
});
