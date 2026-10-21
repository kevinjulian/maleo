import { describe, expect, test } from "vite-plus/test";
import {
	canRegroupChapters,
	parseChapters,
	planSectionsOf,
	recoverSectionMembership,
	regroupChapters,
	seedChapters,
} from "./timeline-chapters.ts";
import type { PlanSection } from "./timeline-chapters.ts";
import { readStoryboardDocument, writeStoryboardDocument } from "./storyboard-document.ts";
import type { StoryboardDocument } from "./storyboard-document.ts";
import { EMPTY_PROJECT_MATERIALS } from "./project-materials.ts";
import { EMPTY_PROJECT_SELECTION } from "./project-selection.ts";
import type { Chapter } from "./timeline-doc.ts";
import type { Scene } from "./timeline-model.ts";
import type { StoryBeat } from "./video-style.ts";

const scene = (id: number, over: Partial<Scene> = {}): Scene =>
	({
		id,
		name: `Scene ${id}`,
		dur: 5,
		shot: "",
		move: "",
		vis: "",
		vo: "",
		img: false,
		...over,
	}) as Scene;

const emptyDoc = (over: Partial<StoryboardDocument> = {}): StoryboardDocument => ({
	schemaVersion: 2,
	clips: [],
	markers: [],
	chapters: null,
	bookmarks: null,
	projectReferences: EMPTY_PROJECT_SELECTION,
	materials: EMPTY_PROJECT_MATERIALS,
	captions: null,
	captionSet: null,
	pacingDevices: null,
	infographicStyle: null,
	sceneTextClipMigrationVersion: null,
	trackFlags: null,
	presentation: null,
	unitLifecycle: null,
	artifacts: [],
	...over,
});

describe("parseChapters", () => {
	test("parses valid chapters and drops malformed entries", () => {
		const parsed = parseChapters([
			{ id: "s-a", title: "Intro", brief: "Sets the cost of silence." },
			{ id: 7 }, // non-string id → dropped
			{ id: "" }, // empty id → dropped
			null, // dropped
			{ id: "s-b" }, // sparse → title falls back to the id
		]);
		expect(parsed).toEqual([
			{ id: "s-a", title: "Intro", brief: "Sets the cost of silence." },
			{ id: "s-b", title: "s-b", brief: undefined },
		]);
	});

	test("a non-string brief is dropped rather than carried", () => {
		expect(parseChapters([{ id: "s-a", title: "Intro", brief: 42 }])[0]!.brief).toBeUndefined();
	});

	test("non-array input yields empty", () => {
		expect(parseChapters(undefined)).toEqual([]);
		expect(parseChapters(null)).toEqual([]);
		expect(parseChapters({})).toEqual([]);
	});
});

describe("seeding from section membership", () => {
	test("one chapter per run of scenes sharing a section", () => {
		const seeded = seedChapters(
			[
				scene(1, { sectionId: "s-a" }),
				scene(2, { sectionId: "s-a" }),
				scene(3, { sectionId: "s-b" }),
			],
			null,
		);
		expect(seeded.chapters.map((c) => c.id)).toEqual(["s-a", "s-b"]);
		expect(seeded.scenes.map((s) => s.sectionId)).toEqual(["s-a", "s-a", "s-b"]);
		expect(seeded.seeded).toBe(true);
	});

	test("a section-intro scene names its chapter", () => {
		const seeded = seedChapters(
			[
				scene(1, { sectionId: "s-a", sceneKind: "section_intro", name: "The Unread Log" }),
				scene(2, { sectionId: "s-a", name: "Scene 2" }),
			],
			null,
		);
		expect(seeded.chapters[0]).toMatchObject({ id: "s-a", title: "The Unread Log" });
	});

	test("section membership wins over the beat", () => {
		// `beat` is inferred positionally; a section is what the plan decided.
		const seeded = seedChapters(
			[scene(1, { sectionId: "s-a", beat: "hook" }), scene(2, { sectionId: "s-a", beat: "setup" })],
			null,
		);
		expect(seeded.chapters).toHaveLength(1);
	});
});

describe("seeding from runs of story beats", () => {
	test("consecutive scenes sharing a beat form one chapter", () => {
		const beats: StoryBeat[] = ["hook", "hook", "setup", "setup", "setup", "resolution"];
		const seeded = seedChapters(
			beats.map((b, i) => scene(i + 1, { beat: b })),
			null,
		);
		expect(seeded.chapters).toHaveLength(3);
		expect(seeded.chapters.map((c) => c.title)).toEqual(["Hook", "Setup", "Resolution"]);
		expect(seeded.scenes.map((s) => s.sectionId)).toEqual([
			"ch-1",
			"ch-1",
			"ch-2",
			"ch-2",
			"ch-2",
			"ch-3",
		]);
	});

	test("a beat that recurs starts a new chapter rather than rejoining", () => {
		// Merging non-adjacent scenes would mean reordering the video to satisfy
		// a grouping.
		const seeded = seedChapters(
			[scene(1, { beat: "hook" }), scene(2, { beat: "setup" }), scene(3, { beat: "hook" })],
			null,
		);
		expect(seeded.chapters).toHaveLength(3);
		expect(seeded.scenes[0]!.sectionId).not.toBe(seeded.scenes[2]!.sectionId);
	});

	test("a scene with no beat joins the run before it", () => {
		const seeded = seedChapters(
			[scene(1, { beat: "hook" }), scene(2), scene(3, { beat: "setup" })],
			null,
		);
		expect(seeded.chapters).toHaveLength(2);
		expect(seeded.scenes[1]!.sectionId).toBe(seeded.scenes[0]!.sectionId);
	});

	test("no beats at all yields a single chapter over every scene", () => {
		const seeded = seedChapters([scene(1), scene(2), scene(3)], null);
		expect(seeded.chapters).toEqual([{ id: "ch-1", title: "Chapter 1" }]);
		expect(seeded.scenes.every((s) => s.sectionId === "ch-1")).toBe(true);
	});
});

describe("seeding only happens when a document never had chapters", () => {
	test("existing chapters are used as they are", () => {
		const chapters: Chapter[] = [{ id: "s-a", title: "Intro" }];
		const seeded = seedChapters([scene(1, { beat: "hook" })], chapters);
		expect(seeded.chapters).toBe(chapters);
		expect(seeded.seeded).toBe(false);
	});

	test("chapters the operator deleted down to none do not grow back", () => {
		// Empty is an authored state; absent is "this document predates chapters".
		const seeded = seedChapters([scene(1, { beat: "hook" })], []);
		expect(seeded.chapters).toEqual([]);
		expect(seeded.seeded).toBe(false);
	});

	test("a document with no scenes seeds nothing", () => {
		expect(seedChapters([], null)).toMatchObject({ chapters: [], seeded: false });
	});

	test("seeding does not mutate the scenes it was given", () => {
		const scenes = [scene(1, { beat: "hook" })];
		seedChapters(scenes, null);
		expect(scenes[0]!.sectionId).toBeUndefined();
	});
});

describe("regrouping repairs a document whose chapters no longer describe it", () => {
	/* The shape project 5edc35d5 froze in: generated before its scenes recorded
	 * their section, collapsed to one chapter, then stuck there — a fixed
	 * generator cannot reach a document already written, and seeding refuses to
	 * touch a non-null chapters array. */
	const sectioned = (): Scene[] => [
		scene(1, { sectionId: "sec-1", name: "Bangun di Lilin", sceneKind: "section_intro" }),
		scene(2, { sectionId: "sec-1" }),
		scene(3, { sectionId: "sec-2", name: "Belajar Menari", sceneKind: "section_intro" }),
		scene(4, { sectionId: "sec-3", name: "Lapangan Bunga", sceneKind: "section_intro" }),
	];

	test("re-derives from what the scenes carry now, discarding the frozen chapter", () => {
		const frozen: Chapter[] = [
			{ id: "ch-1", title: "Bangun di Lilin", brief: "Sehari jadi lebah pekerja." },
		];
		expect(seedChapters(sectioned(), frozen).chapters).toBe(frozen); // read path: untouched

		const regrouped = regroupChapters(sectioned()).chapters;
		expect(regrouped.map((c) => c.id)).toEqual(["sec-1", "sec-2", "sec-3"]);
		expect(regrouped.map((c) => c.title)).toEqual([
			"Bangun di Lilin",
			"Belajar Menari",
			"Lapangan Bunga",
		]);
	});

	test("it is offered only when it would actually change the grouping", () => {
		const frozen: Chapter[] = [{ id: "ch-1", title: "Bangun di Lilin" }];
		expect(canRegroupChapters(sectioned(), frozen)).toBe(true);
		// Already grouped correctly — nothing to offer.
		expect(canRegroupChapters(sectioned(), [...regroupChapters(sectioned()).chapters])).toBe(false);
	});

	test("it is not offered when the scenes carry nothing to group on", () => {
		// It would hand back the single chapter already on screen, so the action
		// would promise a change it cannot make.
		const bare = [scene(1), scene(2), scene(3)];
		expect(canRegroupChapters(bare, [{ id: "ch-1", title: "Chapter 1" }])).toBe(false);
		expect(canRegroupChapters([], null)).toBe(false);
	});

	test("regrouping does not mutate the scenes it read", () => {
		const scenes = sectioned();
		regroupChapters(scenes);
		expect(scenes.map((s) => s.sectionId)).toEqual(["sec-1", "sec-1", "sec-2", "sec-3"]);
	});

	test("the read path still cannot regroup, however degenerate the chapters look", () => {
		// The guard that keeps repair out of load. One chapter over four sections is
		// exactly the case that tempts an automatic fix; a read must still not write.
		const frozen: Chapter[] = [{ id: "ch-1", title: "Bangun di Lilin" }];
		const seeded = seedChapters(sectioned(), frozen);
		expect(seeded.chapters).toBe(frozen);
		expect(seeded.seeded).toBe(false);
	});
});

describe("recovering membership a document never recorded", () => {
	/* Project 5edc35d5 exactly: 22 scenes, no sectionId, no beat, and four
	 * sections still named in `unit_lifecycle`. The generator that dropped the
	 * provenance is fixed, but a fixed generator cannot reach a document already
	 * written, so the membership is recovered from the plan's own section titles —
	 * ONCE, on request, writing the real field down.
	 *
	 * This is a repair, not a grouping rule. Nothing derives from names on read. */
	const SECTIONS: PlanSection[] = [
		{ id: "sec-1", title: "Bangun di Lilin" },
		{ id: "sec-2", title: "Belajar Menari" },
		{ id: "sec-3", title: "Lapangan Bunga" },
	];
	const named = (...names: string[]): Scene[] => names.map((name, i) => scene(i + 1, { name }));
	const real = (): Scene[] =>
		named(
			"Bangun di Lilin",
			"Bangun di Lilin · shot 2",
			"Bangun di Lilin · shot 3",
			"Belajar Menari",
			"Belajar Menari · shot 2",
			"Lapangan Bunga",
		);

	test("reads the sections off a document's unit lifecycle", () => {
		expect(
			planSectionsOf({
				schemaVersion: 1,
				units: [
					{
						id: "section:sec-1",
						sourceId: "sec-1",
						granularity: "section",
						status: "ready",
						title: "Bangun di Lilin",
					},
					{ id: "scene:9", granularity: "scene", title: "not a section" },
				],
			}),
		).toEqual([{ id: "sec-1", title: "Bangun di Lilin" }]);
	});

	test("a namespaced id falls back to the bare one", () => {
		expect(
			planSectionsOf({
				units: [{ id: "section:sec-4", granularity: "section", title: "Harapan Madu" }],
			}),
		).toEqual([{ id: "sec-4", title: "Harapan Madu" }]);
	});

	test("a malformed lifecycle yields nothing rather than throwing", () => {
		for (const bad of [null, undefined, 42, {}, { units: "no" }, { units: [null, 7] }]) {
			expect(planSectionsOf(bad)).toEqual([]);
		}
	});

	test("membership is recovered, and each section's first scene introduces it", () => {
		const recovered = recoverSectionMembership(real(), SECTIONS)!;
		expect(recovered.map((s) => s.sectionId)).toEqual([
			"sec-1",
			"sec-1",
			"sec-1",
			"sec-2",
			"sec-2",
			"sec-3",
		]);
		expect(recovered.map((s) => s.sceneKind)).toEqual([
			"section_intro",
			undefined,
			undefined,
			"section_intro",
			undefined,
			"section_intro",
		]);
	});

	test("the recovered document groups and names itself from the plan", () => {
		const chapters = regroupChapters(real(), SECTIONS).chapters;
		expect(chapters.map((c) => c.id)).toEqual(["sec-1", "sec-2", "sec-3"]);
		expect(chapters.map((c) => c.title)).toEqual([
			"Bangun di Lilin",
			"Belajar Menari",
			"Lapangan Bunga",
		]);
	});

	test("it refuses when a scene matches no section", () => {
		// Partial recovery would invent a grouping the plan never described.
		expect(
			recoverSectionMembership([...real(), scene(99, { name: "Something Else" })], SECTIONS),
		).toBeNull();
	});

	test("it refuses when a section's scenes are interleaved with another's", () => {
		// Not contiguous is not a chapter; the next derivation would split it anyway.
		expect(
			recoverSectionMembership(
				named("Bangun di Lilin", "Belajar Menari", "Bangun di Lilin · shot 2"),
				SECTIONS,
			),
		).toBeNull();
	});

	test("it refuses when two sections claim a scene equally", () => {
		const ambiguous: PlanSection[] = [
			{ id: "a", title: "Wake" },
			{ id: "b", title: "Wake" },
		];
		expect(recoverSectionMembership(named("Wake"), ambiguous)).toBeNull();
	});

	test("a longer title wins over a shorter one that also prefixes the name", () => {
		const overlapping: PlanSection[] = [
			{ id: "short", title: "Bangun" },
			{ id: "long", title: "Bangun di Lilin" },
		];
		expect(
			recoverSectionMembership(named("Bangun di Lilin · shot 2"), overlapping)![0]!.sectionId,
		).toBe("long");
	});

	test("a title prefix that is not a word boundary does not match", () => {
		// "Bangun di Lilinnya" is a different section, not shot 2 of this one.
		expect(recoverSectionMembership(named("Bangun di Lilinnya"), SECTIONS)).toBeNull();
	});

	test("scenes that already carry provenance are never name-matched", () => {
		// The real field wins. Recovery is only for documents that have nothing.
		const carrying = [
			scene(1, { name: "Bangun di Lilin", beat: "hook" }),
			scene(2, { name: "Belajar Menari", beat: "hook" }),
		];
		expect(regroupChapters(carrying, SECTIONS).chapters).toHaveLength(1);
	});

	test("the action is offered for a recoverable document and not for an unrecoverable one", () => {
		const frozen: Chapter[] = [{ id: "ch-1", title: "Bangun di Lilin" }];
		expect(canRegroupChapters(real(), frozen, SECTIONS)).toBe(true);
		// No sections to recover from — the derivation would return the same one chapter.
		expect(canRegroupChapters(real(), frozen, [])).toBe(false);
		expect(canRegroupChapters(named("A", "B"), frozen, SECTIONS)).toBe(false);
	});

	test("recovery does not mutate the scenes it read", () => {
		const scenes = real();
		recoverSectionMembership(scenes, SECTIONS);
		expect(scenes.every((s) => s.sectionId === undefined)).toBe(true);
	});
});

describe("chapters round-trip through the persisted document", () => {
	test("opaque section identity survives reorder from lifecycle through chapters", () => {
		const first = "019f-section-first";
		const second = "019f-section-second";
		const lifecycle = {
			units: [
				{ id: `section:${first}`, sourceId: first, granularity: "section", title: "First" },
				{ id: `section:${second}`, sourceId: second, granularity: "section", title: "Second" },
			],
		};
		expect(planSectionsOf(lifecycle).map((section) => section.id)).toEqual([first, second]);
		const reordered = seedChapters(
			[
				scene(2, { sectionId: second, sceneKind: "section_intro", name: "Second" }),
				scene(1, { sectionId: first, sceneKind: "section_intro", name: "First" }),
			],
			null,
		);
		expect(reordered.chapters.map((chapter) => chapter.id)).toEqual([second, first]);
		const written = writeStoryboardDocument(
			emptyDoc({ chapters: [...reordered.chapters], unitLifecycle: lifecycle }),
		);
		const reread = readStoryboardDocument(written).doc;
		expect(reread.chapters?.map((chapter) => chapter.id)).toEqual([second, first]);
		expect(planSectionsOf(reread.unitLifecycle).map((section) => section.id)).toEqual([
			first,
			second,
		]);
	});

	test("chapters are written and read back unchanged", () => {
		const chapters: Chapter[] = [
			{ id: "s-a", title: "Intro", brief: "Sets the cost of silence." },
			{ id: "s-b", title: "The Turn" },
		];
		const written = writeStoryboardDocument(emptyDoc({ chapters }));
		expect(readStoryboardDocument(written).doc.chapters).toEqual(chapters);
	});

	test("a document that never had chapters reads back as null, not as empty", () => {
		// The two are what tell the reader whether to seed, so collapsing them
		// would make an operator's deletion indistinguishable from a legacy doc.
		const written = writeStoryboardDocument(emptyDoc({ chapters: null }));
		expect("chapters" in written).toBe(false);
		expect(readStoryboardDocument(written).doc.chapters).toBeNull();
	});

	test("chapters the operator emptied stay empty across a round trip", () => {
		const written = writeStoryboardDocument(emptyDoc({ chapters: [] }));
		expect(readStoryboardDocument(written).doc.chapters).toEqual([]);
	});

	test("a chapter with no brief reads back without one", () => {
		const written = writeStoryboardDocument(
			emptyDoc({ chapters: [{ id: "s-a", title: "Intro" }] }),
		);
		expect(readStoryboardDocument(written).doc.chapters![0]!.brief).toBeUndefined();
	});

	test("neither chapter order nor computed totals are ever emitted", () => {
		// Order is the position of the earliest scene and the totals are computed
		// on render; a persisted copy of either could outlive what it summarised.
		const written = JSON.stringify(
			writeStoryboardDocument(emptyDoc({ chapters: [{ id: "s-a", title: "Intro" }] })),
		);
		for (const key of [
			"order",
			"segmentRt",
			"segmentWords",
			"totalRt",
			"totalWords",
			"wordCount",
			"runningTime",
		]) {
			expect(written).not.toContain(key);
		}
	});

	test("an absent chapters list is not reported as a defaulted field", () => {
		// Absence is meaningful, not a field the writer forgot — reporting it would
		// make every pre-chapters document read as incomplete.
		const read = readStoryboardDocument(writeStoryboardDocument(emptyDoc({ chapters: null })));
		expect(read.diagnostic.defaulted).not.toContain("chapters");
		expect(read.diagnostic.unknownKeys).not.toContain("chapters");
	});
});
