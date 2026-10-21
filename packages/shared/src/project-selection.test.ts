import { describe, expect, it } from "vite-plus/test";
import {
	EMPTY_PROJECT_SELECTION,
	isFlatSelection,
	normalizeProjectSelection,
} from "./project-selection.ts";

/* The shapes below are the ones the storyboard census actually found:
 *   2,586 rows  {prompt, mediaAssetIds, imageIds, noteIds, productIds}
 *   1,970 rows  {prompt, imageIds, noteIds, productIds}   (no mediaAssetIds)
 *      26 rows  {prompt, refIds}                          (pre-buckets)
 *   2,450 rows  present but every bucket empty
 * 103,790 rows  absent entirely */
describe("normalizeProjectSelection", () => {
	it("reads the five-bucket shape, folding the refmedia alias onto its target", () => {
		expect(
			normalizeProjectSelection({
				prompt: "lock",
				mediaAssetIds: ["refmedia:e1", "refmedia:e9"],
				imageIds: ["e1"],
				noteIds: ["n-tone"],
				productIds: ["prod_c03"],
			}),
		).toEqual({ prompt: "lock", entityIds: ["e1", "prod_c03", "e9"] });
	});

	it("reads the four-bucket shape written before mediaAssetIds existed", () => {
		expect(
			normalizeProjectSelection({
				prompt: "p",
				imageIds: ["e1", "e2"],
				noteIds: [],
				productIds: ["prod_c03"],
			}),
		).toEqual({ prompt: "p", entityIds: ["e1", "e2", "prod_c03"] });
	});

	it("migrates the legacy refIds shape", () => {
		expect(normalizeProjectSelection({ prompt: "lock", refIds: ["a", "b"] })).toEqual({
			prompt: "lock",
			entityIds: ["a", "b"],
		});
	});

	it("ignores legacy refIds once imageIds is present", () => {
		expect(
			normalizeProjectSelection({
				prompt: "x",
				refIds: ["legacy"],
				imageIds: ["i"],
				noteIds: ["n"],
				productIds: ["p"],
			}),
		).toEqual({ prompt: "x", entityIds: ["i", "p"] });
	});

	it("drops notes — a note is not a reference entity", () => {
		expect(
			normalizeProjectSelection({ prompt: "", imageIds: [], noteIds: ["n-tone"], productIds: [] })
				.entityIds,
		).toEqual([]);
	});

	it("keeps prod_ ids intact — they are real entity ids, not a kind prefix", () => {
		expect(normalizeProjectSelection({ productIds: ["prod_c03e3685"] }).entityIds).toEqual([
			"prod_c03e3685",
		]);
	});

	it("is idempotent on its own output", () => {
		const once = normalizeProjectSelection({
			prompt: "p",
			mediaAssetIds: ["refmedia:e1"],
			imageIds: ["e1"],
			noteIds: [],
			productIds: [],
		});
		expect(normalizeProjectSelection(once)).toEqual(once);
	});

	it("returns empty for present-but-empty, absent, and junk input", () => {
		expect(
			normalizeProjectSelection({
				prompt: "",
				mediaAssetIds: [],
				imageIds: [],
				noteIds: [],
				productIds: [],
			}),
		).toEqual(EMPTY_PROJECT_SELECTION);
		expect(normalizeProjectSelection(undefined)).toEqual(EMPTY_PROJECT_SELECTION);
		expect(normalizeProjectSelection(null)).toEqual(EMPTY_PROJECT_SELECTION);
		expect(normalizeProjectSelection("nope")).toEqual(EMPTY_PROJECT_SELECTION);
		expect(normalizeProjectSelection({ imageIds: [1, "ok", null] })).toEqual({
			prompt: "",
			entityIds: ["ok"],
		});
	});

	it("dedupes across the old buckets", () => {
		expect(
			normalizeProjectSelection({
				imageIds: ["e1", "e1"],
				productIds: ["e1"],
				mediaAssetIds: ["refmedia:e1"],
			}).entityIds,
		).toEqual(["e1"]);
	});
});

describe("isFlatSelection", () => {
	it("rejects any surviving bucket key", () => {
		expect(isFlatSelection({ prompt: "", imageIds: [] })).toBe(false);
		expect(isFlatSelection({ prompt: "", refIds: [] })).toBe(false);
		expect(isFlatSelection({ prompt: "", noteIds: [] })).toBe(false);
	});
	it("accepts the flat shape and absent selections", () => {
		expect(isFlatSelection({ prompt: "", entityIds: ["e1"] })).toBe(true);
		expect(isFlatSelection(undefined)).toBe(true);
	});
});
