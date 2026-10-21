import { expect, test } from "vite-plus/test";
import { captionReplacements } from "./caption-find.ts";

const cue = (id: string, text: string, track = 1) => ({ id, track, caption: { text } });

test("replaces every literal match and reports matched cues", () => {
	const plan = captionReplacements(
		[cue("a", "Jon said hi to Jon"), cue("b", "nothing here"), cue("c", "jon lowercase")],
		"Jon",
		"John",
		() => false,
	);
	expect(plan.updates).toEqual([{ id: "a", text: "John said hi to John" }]);
	expect(plan.matches).toBe(1);
	expect(plan.skipped).toBe(0);
});

test("locked cues and cues that would become empty are skipped and counted", () => {
	const plan = captionReplacements(
		[cue("a", "um", 1), cue("b", "um yes", 2), cue("c", "um ok", 3)],
		"um",
		"",
		(track) => track === 3,
	);
	expect(plan.updates).toEqual([{ id: "b", text: " yes" }]);
	expect(plan.matches).toBe(3);
	expect(plan.skipped).toBe(2);
});

test("an empty query plans nothing", () => {
	expect(captionReplacements([cue("a", "text")], "", "x", () => false)).toEqual({
		updates: [],
		matches: 0,
		skipped: 0,
	});
});
