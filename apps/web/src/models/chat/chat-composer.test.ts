import { describe, expect, test } from "vite-plus/test";
import type { ChatProjectIndex } from "@maleo/shared";
import {
	chipsForFocus,
	commandScopeOf,
	detectEntityMention,
	entityMentionCandidates,
	insertEntityMention,
	labelFor,
	liveMentions,
	withoutChip,
	EMPTY_DRAFT_SCOPE,
	type ChatMention,
} from "./chat-composer.ts";

const index: ChatProjectIndex = {
	story: [
		{ kind: "section", id: "sec-a", label: "Opening hook" },
		{ kind: "section", id: "sec-b", label: "The turn" },
	],
	timeline: [{ kind: "clip", id: "scene:1", label: "Harbour at dawn" }],
	materials: [{ kind: "material", id: "brief", label: "Brief" }],
	references: [{ kind: "reference", id: "ref-1", label: "Captain" }],
	assets: [{ kind: "asset", id: "a1", label: "music.mp3" }],
};

describe("chips", () => {
	test("label resolved focus from the index", () => {
		const chips = chipsForFocus(
			{
				source: "selection",
				entities: [
					{ kind: "clip", id: "scene:1" },
					{ kind: "section", id: "sec-b" },
				],
			},
			index,
		);
		expect(chips).toEqual([
			{ kind: "clip", id: "scene:1", label: "Harbour at dawn", source: "selection" },
			{ kind: "section", id: "sec-b", label: "The turn", source: "selection" },
		]);
		expect(labelFor({ kind: "project", id: "project" }, index)).toBe("Whole project");
		expect(labelFor({ kind: "clip", id: "gone" }, index)).toBe("gone");
	});

	test("removing a source chip excludes the source so resolution falls through", () => {
		const draft = withoutChip(EMPTY_DRAFT_SCOPE, {
			kind: "clip",
			id: "scene:1",
			label: "x",
			source: "selection",
		});
		expect(draft.excludedSources).toEqual(["selection"]);
		expect(
			withoutChip(draft, { kind: "clip", id: "scene:1", label: "x", source: "selection" }),
		).toBe(draft);
		expect(
			withoutChip(draft, {
				kind: "project",
				id: "project",
				label: "Whole project",
				source: "project",
			}),
		).toBe(draft);
	});

	test("removing a mention chip drops only that mention", () => {
		const mentions: ChatMention[] = [
			{ ref: { kind: "section", id: "sec-a" }, label: "Opening hook" },
			{ ref: { kind: "reference", id: "ref-1" }, label: "Captain" },
		];
		const draft = withoutChip(
			{ mentions, excludedSources: [] },
			{ kind: "section", id: "sec-a", label: "Opening hook", source: "mention" },
		);
		expect(draft.mentions.map((m) => m.ref.id)).toEqual(["ref-1"]);
		expect(draft.excludedSources).toEqual([]);
	});
});

describe("@ mentions", () => {
	test("trigger needs a word boundary and stops at a newline", () => {
		expect(detectEntityMention("fix @hoo", 8)).toEqual({ atIdx: 4, query: "hoo" });
		expect(detectEntityMention("mail@hoo", 8)).toBeNull();
		expect(detectEntityMention("@a\nb", 4)).toBeNull();
		expect(detectEntityMention("/cmd", 4)).toBeNull();
	});

	test("filters sections, clips, materials and references, never assets", () => {
		expect(entityMentionCandidates(index, "").map((e) => e.id)).toEqual([
			"sec-a",
			"sec-b",
			"scene:1",
			"brief",
			"ref-1",
		]);
		expect(entityMentionCandidates(index, "hook").map((e) => e.id)).toEqual(["sec-a"]);
		expect(entityMentionCandidates(index, "music")).toEqual([]);
	});

	test("inserts a mention bound to the stable id", () => {
		const text = "tighten @op please";
		const trigger = detectEntityMention(text, 11)!;
		const out = insertEntityMention(text, trigger, index.story[0]!);
		expect(out.value).toBe("tighten @Opening hook  please");
		expect(out.cursor).toBe("tighten @Opening hook ".length);
		expect(out.mention).toEqual({ ref: { kind: "section", id: "sec-a" }, label: "Opening hook" });
	});

	test("a renamed entity still resolves: the id travels, not the label", () => {
		const mention: ChatMention = { ref: { kind: "section", id: "sec-a" }, label: "Opening hook" };
		const renamed: ChatProjectIndex = {
			...index,
			story: [{ kind: "section", id: "sec-a", label: "Cold open" }],
		};
		const scope = commandScopeOf("tighten @Opening hook", {
			mentions: [mention],
			excludedSources: [],
		});
		expect(scope.mentions).toEqual([{ kind: "section", id: "sec-a" }]);
		expect(labelFor(scope.mentions[0]!, renamed)).toBe("Cold open");
	});

	test("deleting the mention text drops the mention", () => {
		const mention: ChatMention = { ref: { kind: "section", id: "sec-a" }, label: "Opening hook" };
		expect(liveMentions("tighten it", [mention])).toEqual([]);
		expect(liveMentions("@Opening hook and @Opening hook", [mention, mention])).toHaveLength(1);
	});
});
