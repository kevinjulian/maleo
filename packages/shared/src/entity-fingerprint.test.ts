import { describe, expect, test } from "vite-plus/test";
import {
	fingerprintEntity,
	fingerprintIndex,
	fingerprintValue,
	hasEntityChanged,
	hashString,
	stableStringify,
} from "./entity-fingerprint.ts";
import type { ChatEntityRef } from "./chat-context-envelope.ts";

const clip: ChatEntityRef = { kind: "clip", id: "scene:1" };

describe("stableStringify", () => {
	test("key order does not change the output", () => {
		expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
	});

	test("nested key order does not change the output", () => {
		expect(stableStringify({ o: { x: 1, y: [{ p: 1, q: 2 }] } })).toBe(
			stableStringify({ o: { y: [{ q: 2, p: 1 }], x: 1 } }),
		);
	});

	test("array order does change the output, because order is content", () => {
		expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
	});

	test("an undefined field reads the same as an absent one", () => {
		expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
	});

	test("null is preserved and is not the same as absent", () => {
		expect(stableStringify({ a: null })).not.toBe(stableStringify({}));
	});
});

describe("hashString", () => {
	test("is deterministic and fixed width", () => {
		expect(hashString("abc")).toBe(hashString("abc"));
		expect(hashString("abc")).toHaveLength(16);
	});

	test("differs for different input", () => {
		expect(hashString("abc")).not.toBe(hashString("abd"));
	});
});

describe("fingerprintValue", () => {
	test("detects a changed field", () => {
		expect(fingerprintValue({ name: "Opening" })).not.toBe(fingerprintValue({ name: "Opening!" }));
	});

	test("ignores key reordering", () => {
		expect(fingerprintValue({ name: "A", dur: 4 })).toBe(fingerprintValue({ dur: 4, name: "A" }));
	});
});

describe("hasEntityChanged", () => {
	const captured = fingerprintIndex([fingerprintEntity(clip, { name: "Opening", dur: 4 })]);

	test("unchanged entity is unchanged", () => {
		expect(hasEntityChanged(captured, clip, { name: "Opening", dur: 4 })).toBe(false);
	});

	test("edited entity is changed", () => {
		expect(hasEntityChanged(captured, clip, { name: "Opening", dur: 5 })).toBe(true);
	});

	test("edit-and-revert does not report a conflict", () => {
		expect(hasEntityChanged(captured, clip, { name: "Edited", dur: 4 })).toBe(true);
		expect(hasEntityChanged(captured, clip, { name: "Opening", dur: 4 })).toBe(false);
	});

	test("an entity that was never captured is treated as changed", () => {
		expect(
			hasEntityChanged(captured, { kind: "clip", id: "scene:9" }, { name: "Opening", dur: 4 }),
		).toBe(true);
	});

	test("same id under a different kind is a different entity", () => {
		expect(
			hasEntityChanged(captured, { kind: "slide", id: "scene:1" }, { name: "Opening", dur: 4 }),
		).toBe(true);
	});
});
