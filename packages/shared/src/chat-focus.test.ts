import { describe, expect, test } from "vite-plus/test";
import { resolveChatFocus, isWholeProjectFocus, type ChatFocusInput } from "./chat-focus.ts";
import type { ChatEntityRef, ChatProjectIndex } from "./chat-context-envelope.ts";
import { EMPTY_CHAT_PROJECT_INDEX } from "./chat-context-envelope.ts";

const clipA: ChatEntityRef = { kind: "clip", id: "scene:1" };
const clipB: ChatEntityRef = { kind: "clip", id: "scene:2" };
const sectionA: ChatEntityRef = { kind: "section", id: "ch1" };
const sectionB: ChatEntityRef = { kind: "section", id: "ch2" };
const ghost: ChatEntityRef = { kind: "clip", id: "scene:99" };

const index: ChatProjectIndex = {
	...EMPTY_CHAT_PROJECT_INDEX,
	story: [
		{ kind: "section", id: "ch1", label: "Intro" },
		{ kind: "section", id: "ch2", label: "Intro" },
	],
	timeline: [
		{ kind: "clip", id: "scene:1", label: "A" },
		{ kind: "clip", id: "scene:2", label: "B" },
	],
};

function resolve(input: ChatFocusInput) {
	return resolveChatFocus({ index, ...input });
}

describe("resolveChatFocus precedence", () => {
	const cases: Array<{ name: string; input: ChatFocusInput; source: string; ids: string[] }> = [
		{
			name: "mention beats selection, playhead and named",
			input: {
				mentions: [clipB],
				selection: [clipA],
				playhead: clipA,
				named: [{ phrase: "A", candidates: [clipA] }],
			},
			source: "mention",
			ids: ["scene:2"],
		},
		{
			name: "selection beats playhead and named",
			input: { selection: [clipA], playhead: clipB, named: [{ phrase: "B", candidates: [clipB] }] },
			source: "selection",
			ids: ["scene:1"],
		},
		{
			name: "playhead beats named",
			input: { playhead: clipB, named: [{ phrase: "A", candidates: [clipA] }] },
			source: "playhead",
			ids: ["scene:2"],
		},
		{
			name: "named wins when nothing more explicit exists",
			input: { named: [{ phrase: "A", candidates: [clipA] }] },
			source: "named",
			ids: ["scene:1"],
		},
		{
			name: "whole project when nothing resolves",
			input: {},
			source: "project",
			ids: ["project"],
		},
	];

	for (const c of cases) {
		test(c.name, () => {
			const result = resolve(c.input);
			expect(result.status).toBe("resolved");
			if (result.status !== "resolved") return;
			expect(result.focus.source).toBe(c.source as never);
			expect(result.focus.entities.map((e) => e.id)).toEqual(c.ids);
		});
	}
});

describe("multi-selection", () => {
	test("several explicit mentions stay several targets", () => {
		const result = resolve({ mentions: [clipA, clipB] });
		expect(result.status === "resolved" && result.focus.entities).toHaveLength(2);
	});

	test("a duplicated target collapses to one", () => {
		const result = resolve({ selection: [clipA, { ...clipA }] });
		expect(result.status === "resolved" && result.focus.entities).toHaveLength(1);
	});
});

describe("removed chips", () => {
	test("removing the only chip falls through to selection", () => {
		const withChip = resolve({ mentions: [clipB], selection: [clipA] });
		expect(withChip.status === "resolved" && withChip.focus.source).toBe("mention");

		const chipRemoved = resolve({ mentions: [], selection: [clipA] });
		expect(chipRemoved.status).toBe("resolved");
		if (chipRemoved.status !== "resolved") return;
		expect(chipRemoved.focus.source).toBe("selection");
		expect(chipRemoved.focus.entities).toEqual([clipA]);
	});

	test("removing every source reaches the whole project, not an empty scope", () => {
		const result = resolve({ mentions: [], selection: [], playhead: null, named: [] });
		expect(result.status === "resolved" && isWholeProjectFocus(result.focus)).toBe(true);
	});
});

describe("stale ids", () => {
	test("a deleted mention is dropped and resolution falls through", () => {
		const result = resolve({ mentions: [ghost], selection: [clipA] });
		expect(result.status).toBe("resolved");
		if (result.status !== "resolved") return;
		expect(result.focus.source).toBe("selection");
	});

	test("a stale selection never becomes whole-project by silently resolving to nothing", () => {
		const result = resolve({ selection: [ghost], playhead: clipB });
		expect(result.status === "resolved" && result.focus.entities).toEqual([clipB]);
	});

	test("without an index nothing is treated as stale", () => {
		const result = resolveChatFocus({ mentions: [ghost] });
		expect(result.status === "resolved" && result.focus.entities).toEqual([ghost]);
	});
});

describe("ambiguous named targets", () => {
	test("a phrase matching two entities is reported rather than guessed", () => {
		const result = resolve({ named: [{ phrase: "Intro", candidates: [sectionA, sectionB] }] });
		expect(result.status).toBe("ambiguous");
		if (result.status !== "ambiguous") return;
		expect(result.phrase).toBe("Intro");
		expect(result.candidates).toHaveLength(2);
	});

	test("ambiguity wins even when another phrase resolved cleanly", () => {
		const result = resolve({
			named: [
				{ phrase: "A", candidates: [clipA] },
				{ phrase: "Intro", candidates: [sectionA, sectionB] },
			],
		});
		expect(result.status).toBe("ambiguous");
	});

	test("a phrase whose duplicates are stale resolves instead of asking", () => {
		const result = resolve({ named: [{ phrase: "Intro", candidates: [sectionA, ghost] }] });
		expect(result.status).toBe("resolved");
		if (result.status !== "resolved") return;
		expect(result.focus.entities).toEqual([sectionA]);
	});

	test("explicit mentions outrank an ambiguous phrase", () => {
		const result = resolve({
			mentions: [clipA],
			named: [{ phrase: "Intro", candidates: [sectionA, sectionB] }],
		});
		expect(result.status).toBe("resolved");
	});
});
