import { describe, expect, it } from "vite-plus/test";
import {
	bibleLocationIds,
	bibleSubjectIds,
	bibleSubjectsNamedIn,
	storyBibleSchema,
	type StoryBible,
} from "./story-bible.ts";

const BEE: StoryBible = storyBibleSchema.parse({
	subjects: [
		{
			id: "worker-bee",
			label: "worker bee",
			aliases: ["lebah pekerja", "aku"],
			descriptors: ["fuzzy black-yellow thorax"],
			mustAvoid: ["human hands"],
		},
		{ id: "queen", label: "queen bee", aliases: ["ratu"] },
	],
	locations: [{ id: "hive", label: "honeycomb interior", descriptors: ["golden wax cells"] }],
	medium: "hand-drawn sketch with watercolor",
	lighting: "clear morning light",
	palette: "honey-yellow and soft black on white",
	negatives: ["human presence", "modern objects"],
	summary: "sketsa tangan sederhana dengan cat air",
});

describe("storyBibleSchema", () => {
	it("parses a full bible and applies array defaults", () => {
		expect(BEE.subjects).toHaveLength(2);
		expect(BEE.subjects[1]!.descriptors).toEqual([]);
		expect(BEE.subjects[1]!.mustAvoid).toEqual([]);
		expect(BEE.locations[0]!.descriptors).toEqual(["golden wax cells"]);
		expect(BEE.negatives).toEqual(["human presence", "modern objects"]);
	});

	it("defaults to an empty bible", () => {
		const empty = storyBibleSchema.parse({});
		expect(empty.subjects).toEqual([]);
		expect(empty.locations).toEqual([]);
		expect(empty.negatives).toEqual([]);
		expect(empty.medium).toBeUndefined();
	});

	it("rejects an unknown key", () => {
		expect(() => storyBibleSchema.parse({ ...BEE, cameraAngle: "low" })).toThrow();
	});

	it("rejects an unknown key on a subject", () => {
		expect(() =>
			storyBibleSchema.parse({ subjects: [{ id: "a", label: "a", pose: "sitting" }] }),
		).toThrow();
	});

	it("treats blank optional text as absent", () => {
		expect(storyBibleSchema.parse({ medium: "   " }).medium).toBeUndefined();
	});
});

describe("closed id lists", () => {
	it("lists subject and location ids", () => {
		expect(bibleSubjectIds(BEE)).toEqual(["worker-bee", "queen"]);
		expect(bibleLocationIds(BEE)).toEqual(["hive"]);
	});

	it("is empty for an absent bible", () => {
		expect(bibleSubjectIds(undefined)).toEqual([]);
		expect(bibleLocationIds(undefined)).toEqual([]);
	});
});

describe("bibleSubjectsNamedIn", () => {
	it("finds a subject by a narration alias", () => {
		expect(bibleSubjectsNamedIn(BEE, "Aku lahir bukan dari langit.")).toEqual(["worker-bee"]);
	});

	it("finds a subject by its label regardless of case or punctuation", () => {
		expect(bibleSubjectsNamedIn(BEE, "The WORKER BEE, alone.")).toEqual(["worker-bee"]);
	});

	it("finds several subjects in one beat", () => {
		expect(bibleSubjectsNamedIn(BEE, "lebah pekerja menghadap ratu")).toEqual([
			"worker-bee",
			"queen",
		]);
	});

	it("does not match an alias inside a longer word", () => {
		const bible = storyBibleSchema.parse({ subjects: [{ id: "bee", label: "bee" }] });
		expect(bibleSubjectsNamedIn(bible, "it has been raining")).toEqual([]);
	});

	it("returns nothing when the narration names no subject", () => {
		expect(bibleSubjectsNamedIn(BEE, "Cahaya pagi masuk perlahan.")).toEqual([]);
	});
});
