import { describe, expect, test, beforeEach } from "vite-plus/test";
import {
	defaultGutterVisible,
	gutterVisibleFor,
	pointerKind,
	storeGutterVisible,
} from "./gutter-visibility.ts";

const store = new Map<string, string>();
// A minimal localStorage; the module only ever calls these three.
(globalThis as unknown as { window: unknown }).window = {
	localStorage: {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => {
			store.set(k, v);
		},
	},
};

describe("gutter visibility", () => {
	beforeEach(() => store.clear());

	test("pointer type, not width, chooses the default", () => {
		expect(pointerKind(true)).toBe("coarse");
		expect(pointerKind(false)).toBe("fine");
		expect(defaultGutterVisible("coarse")).toBe(false);
		expect(defaultGutterVisible("fine")).toBe(true);
	});

	test("with nothing stored, each pointer takes its default", () => {
		expect(gutterVisibleFor("coarse")).toBe(false);
		expect(gutterVisibleFor("fine")).toBe(true);
	});

	test("a stored preference survives and outranks the default", () => {
		storeGutterVisible("coarse", true);
		expect(gutterVisibleFor("coarse")).toBe(true);
	});

	test("the two pointers are stored separately", () => {
		// Showing the gutter on a phone must not hide it on the desktop.
		storeGutterVisible("coarse", true);
		storeGutterVisible("fine", false);
		expect(gutterVisibleFor("coarse")).toBe(true);
		expect(gutterVisibleFor("fine")).toBe(false);
	});

	test("unparseable leftovers fall back to the defaults rather than throwing", () => {
		store.set("maleo.timeline.gutter", "not json");
		expect(gutterVisibleFor("fine")).toBe(true);
	});
});
