import { describe, expect, test } from "vite-plus/test";
import {
	addMentionRefId,
	detectMentionTrigger,
	filterMentionRefs,
	insertMentionText,
	pruneMentionRefIds,
} from "./mention-matching.ts";
import type { RefImage } from "@maleo/shared";

const refs: RefImage[] = [
	{
		id: "style-1",
		label: "Warm Kitchen",
		role: "location",
		seed: 1,
		description: "home meal table",
	},
	{ id: "mom", label: "Mother", role: "character", seed: 2, description: "smiling woman" },
	{ id: "product-1", label: "Secret Spice", role: "product", seed: 3 },
	{ id: "mom", label: "Mother duplicate", role: "character", seed: 4 },
];

describe("reference mention helpers", () => {
	test("detects @ mention trigger and supports multi-word query", () => {
		expect(detectMentionTrigger("make it @Warm Kit", "make it @Warm Kit".length)).toEqual({
			atIdx: 8,
			query: "Warm Kit",
		});
	});

	test("does not treat emails or old comma-separated text as active mentions", () => {
		expect(detectMentionTrigger("send a@b", "send a@b".length)).toBeNull();
		expect(
			detectMentionTrigger("use @Mother, then close", "use @Mother, then close".length),
		).toBeNull();
	});

	test("filters by label or note, dedupes ids, and sorts useful ref kinds first", () => {
		expect(filterMentionRefs(refs, "woman").map((r) => r.id)).toEqual(["mom"]);
		expect(filterMentionRefs(refs, "").map((r) => r.id)).toEqual(["mom", "style-1", "product-1"]);
	});

	test("insertMentionText replaces the active query and returns the next cursor", () => {
		const trigger = detectMentionTrigger("shot @Warm", "shot @Warm".length)!;
		const next = insertMentionText("shot @Warm", trigger, refs[0]!);
		expect(next.value).toBe("shot @Warm Kitchen ");
		expect(next.cursor).toBe(next.value.length);
	});

	test("addMentionRefId appends without wiping or duplicating existing refs", () => {
		expect(addMentionRefId(["mom"], "style-1")).toEqual(["mom", "style-1"]);
		expect(addMentionRefId(["mom"], "mom")).toEqual(["mom"]);
	});

	test("pruneMentionRefIds removes selected refs when their mention is deleted", () => {
		expect(
			pruneMentionRefIds(["mom", "style-1"], "shot with @Mother in @Warm Kitchen ", refs),
		).toEqual(["mom", "style-1"]);
		expect(pruneMentionRefIds(["mom", "style-1"], "shot with @Warm Kitchen ", refs)).toEqual([
			"style-1",
		]);
		expect(pruneMentionRefIds(["mom"], "shot with Mother text but no mention", refs)).toEqual([]);
	});
});
