import { describe, expect, it } from "vite-plus/test";
import {
	buildReferenceMap,
	filterKnownCastIds,
	selectCast,
	type CastEntity,
} from "./generation-cast.ts";

const man: CastEntity = {
	id: "man",
	role: "character",
	imageUrl: "u/man",
	description: "navy suit",
};
const woman: CastEntity = {
	id: "woman",
	role: "character",
	imageUrl: "u/woman",
	description: "red dress",
	primary: true,
};
const cafe: CastEntity = {
	id: "cafe",
	role: "location",
	imageUrl: "u/cafe",
	description: "warm wood",
};

describe("selectCast", () => {
	it("returns empty for an empty roster", () => {
		expect(selectCast(["man"], [])).toEqual([]);
	});

	it("auto-casts the single entity regardless of declared", () => {
		expect(selectCast([], [man])).toEqual(["man"]);
		expect(selectCast(["ghost"], [man])).toEqual(["man"]);
	});

	it("validates declared ids against a ≥2 roster and drops unknowns", () => {
		expect(selectCast(["man", "ghost", "cafe"], [man, woman, cafe])).toEqual(["man", "cafe"]);
	});

	it("de-duplicates while preserving order", () => {
		expect(selectCast(["man", "man", "cafe"], [man, woman, cafe])).toEqual(["man", "cafe"]);
	});

	it("backfills the primary entity when nothing valid remains", () => {
		expect(selectCast(["ghost"], [man, woman, cafe])).toEqual(["woman"]);
	});

	it("returns empty when ≥2 roster has no valid ids and no primary", () => {
		expect(selectCast(["ghost"], [man, cafe])).toEqual([]);
	});
});

describe("filterKnownCastIds", () => {
	it("keeps only ids present in the roster, order-preserving and deduped", () => {
		expect(filterKnownCastIds(["man", "ghost", "cafe", "man"], [man, woman, cafe])).toEqual([
			"man",
			"cafe",
		]);
	});

	it("does not auto-cast or backfill (unlike selectCast)", () => {
		expect(filterKnownCastIds([], [man])).toEqual([]);
		expect(filterKnownCastIds(["ghost"], [man, woman])).toEqual([]);
	});
});

describe("buildReferenceMap", () => {
	it("returns empty string for no entities", () => {
		expect(buildReferenceMap([])).toBe("");
	});

	it("falls back to id when description is blank", () => {
		const blank: CastEntity = { id: "x", role: "prop", imageUrl: "u/x", description: "  " };
		expect(buildReferenceMap([blank])).toContain("Image 1 = x: x.");
	});
});
