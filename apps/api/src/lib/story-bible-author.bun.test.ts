/* Authoring the story's visual constants.
 *
 * The two things this must guarantee, because generation depends on them and
 * neither is the model's to decide: a bible always has at least one subject (beat
 * authoring picks from a closed list, and an empty list closes generation), and a
 * planned reference always reaches a subject carrying its key (that key is what
 * makes the resolved reference description the locked identity later). */
import { afterEach, describe, expect, test } from "bun:test";
import { authorStoryBible, setStoryBibleAuthorForTests } from "./content-generator.ts";
import type { StoryPlannedReference } from "@maleo/shared";
import { setTextRunnerForTests } from "./text-runner.ts";

afterEach(() => {
	setStoryBibleAuthorForTests(null);
	setTextRunnerForTests(null);
});

const LOOK = {
	medium: "hand-drawn sketch with watercolor",
	lighting: "clear morning light",
	palette: "honey-yellow and soft black on white",
	negatives: ["human presence", "modern objects"],
};

describe("authorStoryBible", () => {
	test("tells the descriptive model not to author direction-owned labels", async () => {
		let prompt = "";
		setTextRunnerForTests(async (value) => {
			prompt = value;
			return {
				stdout: JSON.stringify({
					...LOOK,
					subjects: [{ id: "wind", label: "wind" }],
					locations: [],
				}),
				stderr: "",
			};
		});
		const bible = await authorStoryBible("a hive", { boundLabels: ["Queen bee", "Golden hive"] });
		expect(prompt).toContain("Do NOT author subjects or locations for them");
		expect(prompt).toContain("Queen bee, Golden hive");
		expect(bible.subjects.some((subject) => subject.refKey || subject.entityId)).toBe(false);
	});
	test("keeps the authored look and records the prose summary", async () => {
		setStoryBibleAuthorForTests(async () => ({
			...LOOK,
			subjects: [
				{
					id: "worker-bee",
					label: "worker bee",
					aliases: ["lebah pekerja"],
					descriptors: ["fuzzy thorax"],
				},
			],
			locations: [{ id: "hive", label: "honeycomb interior" }],
		}));
		const bible = await authorStoryBible("a worker bee's life", {
			summary: "sketsa tangan sederhana dengan cat air",
		});
		expect(bible.medium).toBe("hand-drawn sketch with watercolor");
		expect(bible.palette).toBe("honey-yellow and soft black on white");
		expect(bible.negatives).toEqual(["human presence", "modern objects"]);
		expect(bible.summary).toBe("sketsa tangan sederhana dengan cat air");
		expect(bible.subjects[0]!.aliases).toEqual(["lebah pekerja"]);
		expect(bible.locations[0]!.descriptors).toEqual([]);
	});

	test("a plan with zero planned references still yields at least one subject", async () => {
		setStoryBibleAuthorForTests(async () => ({ ...LOOK, subjects: [], locations: [] }));
		const bible = await authorStoryBible("How compound interest works. It is misunderstood.", {});
		expect(bible.subjects.length).toBeGreaterThanOrEqual(1);
		expect(bible.subjects[0]!.label).toBe("How compound interest works");
		expect(bible.subjects[0]!.id).toBe("how-compound-interest-works");
	});

	test("falls back to the POV viewer as the subject when there is no cast", async () => {
		setStoryBibleAuthorForTests(async () => ({ ...LOOK, subjects: [] }));
		const bible = await authorStoryBible("hidup sebagai lebah pekerja", {
			povLifecycle: {
				viewerRole: "lebah pekerja betina",
				bodyConstraints: "tubuh kecil, sayap tipis",
			},
		});
		expect(bible.subjects).toHaveLength(1);
		expect(bible.subjects[0]!.label).toBe("lebah pekerja betina");
		expect(bible.subjects[0]!.descriptors).toEqual(["tubuh kecil, sayap tipis"]);
	});

	test("a planned character reference becomes a subject carrying its key", async () => {
		setStoryBibleAuthorForTests(async () => ({ ...LOOK, subjects: [], locations: [] }));
		const refs: StoryPlannedReference[] = [
			{
				key: "ref-queen",
				role: "character",
				label: "Queen bee",
				description: "elongated abdomen, attended by workers",
				status: "planned",
			},
		];
		const bible = await authorStoryBible("a hive", { plannedReferences: refs });
		const queen = bible.subjects.find((subject) => subject.label === "Queen bee");
		expect(queen).toBeDefined();
		expect(queen!.refKey).toBe("ref-queen");
		expect(queen!.descriptors).toEqual(["elongated abdomen, attended by workers"]);
	});

	test("merges a planned reference into the authored subject of the same label", async () => {
		setStoryBibleAuthorForTests(async () => ({
			...LOOK,
			subjects: [
				{ id: "worker-bee", label: "worker bee", aliases: ["aku"], descriptors: ["fuzzy thorax"] },
			],
		}));
		const refs: StoryPlannedReference[] = [
			{
				key: "ref-worker",
				role: "character",
				label: "Worker Bee",
				description: "translucent wings",
				status: "planned",
			},
		];
		const bible = await authorStoryBible("a hive", { plannedReferences: refs });
		expect(bible.subjects).toHaveLength(1);
		expect(bible.subjects[0]!.refKey).toBe("ref-worker");
		expect(bible.subjects[0]!.aliases).toEqual(["aku"]);
		// The reference's own sentence is NOT appended beside descriptors that
		// already say the same thing; `refKey` carries the locked identity instead.
		expect(bible.subjects[0]!.descriptors).toEqual(["fuzzy thorax"]);
	});

	test("uses the reference description when the authored entry has no descriptors", async () => {
		setStoryBibleAuthorForTests(async () => ({
			...LOOK,
			subjects: [{ id: "worker-bee", label: "worker bee" }],
			locations: [{ id: "hive", label: "Hive" }],
		}));
		const refs: StoryPlannedReference[] = [
			{
				key: "ref-worker",
				role: "character",
				label: "worker bee",
				description: "translucent wings",
				status: "planned",
			},
			{
				key: "ref-hive",
				role: "location",
				label: "Hive",
				description: "golden wax cells",
				status: "planned",
			},
		];
		const bible = await authorStoryBible("a hive", { plannedReferences: refs });
		expect(bible.subjects[0]!.descriptors).toEqual(["translucent wings"]);
		expect(bible.locations[0]!.descriptors).toEqual(["golden wax cells"]);
	});

	test("a planned location reference becomes a location, not a subject", async () => {
		setStoryBibleAuthorForTests(async () => ({
			...LOOK,
			subjects: [{ id: "bee", label: "bee" }],
			locations: [],
		}));
		const refs: StoryPlannedReference[] = [
			{
				key: "ref-field",
				role: "location",
				label: "Flower field",
				description: "wild meadow in morning light",
				status: "planned",
			},
		];
		const bible = await authorStoryBible("a hive", { plannedReferences: refs });
		expect(bible.subjects.map((subject) => subject.label)).toEqual(["bee"]);
		expect(bible.locations).toHaveLength(1);
		expect(bible.locations[0]!.label).toBe("Flower field");
		expect(bible.locations[0]!.descriptors).toEqual(["wild meadow in morning light"]);
	});

	test("rejects a draft whose subject has no label", async () => {
		setStoryBibleAuthorForTests(async () => ({ ...LOOK, subjects: [{ id: "x" }] }));
		await expect(authorStoryBible("a hive", {})).rejects.toThrow();
	});
});
