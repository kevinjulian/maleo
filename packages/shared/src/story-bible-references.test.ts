import { describe, expect, test } from "vite-plus/test";
import { storyBibleSchema } from "./story-bible.ts";
import {
	bibleWithDirectedReferences,
	type DirectedReferenceEntry,
} from "./story-bible-references.ts";

const bible = storyBibleSchema.parse({
	subjects: [
		{ id: "s-bee", label: "Lebah POV", aliases: ["lebah", "aku"], descriptors: ["bulu emas"] },
		{ id: "s-wind", label: "Angin", aliases: ["angin"], descriptors: ["tak terlihat"] },
	],
	locations: [{ id: "l-hive", label: "Sarang", descriptors: ["lilin heksagon"] }],
	medium: "watercolor",
});

const beeEntry: DirectedReferenceEntry = {
	identity: "entity:e-bee",
	role: "character",
	label: "Lebah pekerja",
	description: "worker bee, golden fuzz",
	aliases: ["lebah", "aku"],
};
const hiveEntry: DirectedReferenceEntry = {
	identity: "planned:hive",
	role: "location",
	label: "Sarang Heksagon",
	description: "golden wax hive",
	aliases: ["sarang"],
};

describe("reference entries derive from direction, not from labels", () => {
	test("one entry per bound identity, linked by that identity", () => {
		const out = bibleWithDirectedReferences(bible, [beeEntry, hiveEntry]);
		const bee = out.subjects.find((subject) => subject.entityId === "e-bee");
		expect(bee).toMatchObject({ label: "Lebah pekerja", entityId: "e-bee" });
		expect(bee?.refKey).toBeUndefined();
		const hive = out.locations.find((location) => location.refKey === "hive");
		expect(hive).toMatchObject({ label: "Sarang Heksagon", refKey: "hive" });
		expect(out.subjects.filter((subject) => subject.entityId === "e-bee")).toHaveLength(1);
		expect(storyBibleSchema.safeParse(out).success).toBe(true);
	});

	test("a location role becomes a location, any other role a subject", () => {
		const out = bibleWithDirectedReferences(bible, [
			{ ...beeEntry, identity: "planned:prop", role: "prop", label: "Serbuk" },
		]);
		expect(out.subjects.some((subject) => subject.refKey === "prop")).toBe(true);
		expect(out.locations.some((location) => location.refKey === "prop")).toBe(false);
	});

	test("two similarly labelled identities never cross-link", () => {
		const out = bibleWithDirectedReferences(bible, [
			{ identity: "entity:e-1", role: "character", label: "Lebah POV", aliases: ["lebah"] },
			{ identity: "entity:e-2", role: "character", label: "Lebah POV", aliases: ["saudari"] },
		]);
		const ids = out.subjects
			.filter((subject) => subject.entityId)
			.map((subject) => subject.entityId);
		expect(ids).toEqual(["e-1", "e-2"]);
		expect(new Set(out.subjects.map((subject) => subject.id)).size).toBe(out.subjects.length);
	});

	test("a descriptive duplicate is absorbed, keeping its descriptors", () => {
		const out = bibleWithDirectedReferences(bible, [beeEntry]);
		expect(out.subjects.some((subject) => subject.id === "s-bee")).toBe(false);
		const bee = out.subjects.find((subject) => subject.entityId === "e-bee");
		expect(bee?.descriptors).toContain("bulu emas");
		expect(bee?.aliases).toContain("aku");
	});

	test("unreferenced descriptive entries survive untouched", () => {
		const out = bibleWithDirectedReferences(bible, [beeEntry]);
		expect(out.subjects.find((subject) => subject.id === "s-wind")).toMatchObject({
			label: "Angin",
			descriptors: ["tak terlihat"],
		});
		expect(out.locations.find((location) => location.id === "l-hive")).toBeDefined();
		expect(out.medium).toBe("watercolor");
	});

	test("no direction means no reference entries and no loss", () => {
		expect(bibleWithDirectedReferences(bible, [])).toEqual(bible);
	});

	test("derivation is idempotent and order-stable", () => {
		const once = bibleWithDirectedReferences(bible, [beeEntry, hiveEntry]);
		expect(bibleWithDirectedReferences(once, [beeEntry, hiveEntry])).toEqual(once);
		expect(bibleWithDirectedReferences(bible, [hiveEntry, beeEntry])).toEqual(once);
	});

	test("a rebound subject drops the stale entry", () => {
		const planned = bibleWithDirectedReferences(bible, [{ ...beeEntry, identity: "planned:bee" }]);
		expect(planned.subjects.some((subject) => subject.refKey === "bee")).toBe(true);
		const rebound = bibleWithDirectedReferences(planned, [beeEntry]);
		expect(rebound.subjects.some((subject) => subject.refKey === "bee")).toBe(false);
		expect(rebound.subjects.filter((subject) => subject.entityId === "e-bee")).toHaveLength(1);
	});
});
