import { expect, test } from "vite-plus/test";
import { parseBookmarks } from "./timeline-bookmarks.ts";

test("a bookmark with a blank or overlong label is repaired, not lost on the next save", () => {
	expect(
		parseBookmarks([
			{ id: "a", timeSec: 1, label: "   " },
			{ id: "b", timeSec: 2, label: "x".repeat(200) },
		]),
	).toEqual([
		{ id: "a", timeSec: 1, label: "Bookmark" },
		{ id: "b", timeSec: 2, label: "x".repeat(160) },
	]);
});

test("records without a usable identity or time, and duplicates, are still refused", () => {
	expect(
		parseBookmarks([
			{ id: "", timeSec: 1, label: "A" },
			{ id: "c", timeSec: -1, label: "B" },
			{ id: "d", timeSec: 1, label: "C" },
			{ id: "d", timeSec: 2, label: "D" },
		]),
	).toEqual([{ id: "d", timeSec: 1, label: "C" }]);
	expect(parseBookmarks(undefined)).toBeUndefined();
});
