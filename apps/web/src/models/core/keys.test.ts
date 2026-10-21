import { describe, expect, test } from "vite-plus/test";
import { isCommitEnter, isComposingKey, isSubmitEnter } from "./keys.ts";

describe("Enter in a composer", () => {
	test("plain Enter submits", () => {
		expect(isSubmitEnter({ key: "Enter" })).toBe(true);
		expect(
			isSubmitEnter({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: false } }),
		).toBe(true);
	});

	test("Shift+Enter is a new line, not a submit", () => {
		expect(isSubmitEnter({ key: "Enter", shiftKey: true })).toBe(false);
	});

	test("Enter that confirms an input-method candidate does not submit", () => {
		expect(isSubmitEnter({ key: "Enter", nativeEvent: { isComposing: true } })).toBe(false);
		expect(isSubmitEnter({ key: "Enter", isComposing: true })).toBe(false);
	});

	test("nor does Safari's, which arrives after composition ended with keyCode 229", () => {
		expect(isSubmitEnter({ key: "Enter", nativeEvent: { isComposing: false, keyCode: 229 } })).toBe(
			false,
		);
		expect(isSubmitEnter({ key: "Enter", keyCode: 229 })).toBe(false);
	});

	test("other keys never submit", () => {
		expect(isSubmitEnter({ key: "a" })).toBe(false);
	});
});

describe("Enter in a single-line field", () => {
	test("commits with or without Shift, but not while composing", () => {
		expect(isCommitEnter({ key: "Enter", shiftKey: true })).toBe(true);
		expect(isCommitEnter({ key: "Enter", nativeEvent: { isComposing: true } })).toBe(false);
	});
});

describe("composition", () => {
	test("is reported for any key the input method owns", () => {
		expect(isComposingKey({ key: "Tab", nativeEvent: { isComposing: true } })).toBe(true);
		expect(isComposingKey({ key: "Tab" })).toBe(false);
	});
});
