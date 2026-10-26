/* Presets, motion presets, clip templates and timeline templates.
 *
 * Twenty exported functions with no direct test — the route suites covered two of
 * the four families through HTTP and the other two not at all. Each family is 1:1
 * with a route module, so these assert the storage contract those routes rely on. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Db } from "../../src/db/handle.ts";
import { ENGINES, openTestDb, type TestDb } from "../../src/db/handle-testing.ts";
import { bootstrapLibraryFixtures } from "../../src/db/library-fixtures.ts";
import {
	createContentPreset,
	deleteContentPreset,
	getContentPreset,
	getDefaultContentPresetId,
	listContentPresets,
	setDefaultContentPresetId,
	updateContentPreset,
} from "../../src/db/content-presets.ts";
import {
	createContentMotionPreset,
	deleteContentMotionPreset,
	getContentMotionPreset,
	listContentMotionPresets,
	updateContentMotionPreset,
} from "../../src/db/motion-presets.ts";
import {
	createContentClipTemplate,
	deleteContentClipTemplate,
	getContentClipTemplate,
	listContentClipTemplates,
	updateContentClipTemplate,
} from "../../src/db/clip-templates.ts";
import {
	createContentTimelineTemplate,
	deleteContentTimelineTemplate,
	getContentTimelineTemplate,
	listContentTimelineTemplates,
	updateContentTimelineTemplate,
} from "../../src/db/timeline-templates.ts";
import {
	clipTemplateInputSchema,
	contentPresetInputSchema,
	motionPresetInputSchema,
	timelineTemplateInputSchema,
} from "@maleo/shared";

let db: Db;
let t: TestDb;

beforeEach(async () => {
	t = await openTestDb("postgres");
	db = t.db;
});
afterEach(() => t.close());

describe("content presets", () => {
	// Same reason as the timeline fixture: the input type is the schema's output.
	const input = contentPresetInputSchema.parse({
		name: "Cinematic",
		bundle: { style: null, settings: { aspectRatio: "16:9" } },
	});

	test("a preset round-trips through create and read", async () => {
		const created = await createContentPreset(input, db);
		expect((await getContentPreset(created.id, db))?.name).toBe("Cinematic");
		expect((await listContentPresets(db)).map((p) => p.id)).toEqual([created.id]);
	});

	test("an update keeps the id and replaces the fields", async () => {
		const created = await createContentPreset(input, db);
		const updated = await updateContentPreset(created.id, { ...input, name: "Muted" }, db);

		expect(updated?.id).toBe(created.id);
		expect(updated?.name).toBe("Muted");
	});

	test("updating an unknown preset yields nothing", async () => {
		expect(await updateContentPreset("nope", input, db)).toBeNull();
	});

	test("a deleted preset is gone and reports it", async () => {
		const created = await createContentPreset(input, db);
		expect(await deleteContentPreset(created.id, db)).toBe(true);
		expect(await getContentPreset(created.id, db)).toBeNull();
		expect(await deleteContentPreset(created.id, db)).toBe(false);
	});

	test("the default is a workspace setting, and deleting the default clears it", async () => {
		const created = await createContentPreset(input, db);
		await setDefaultContentPresetId(created.id, db);
		expect(await getDefaultContentPresetId(db)).toBe(created.id);

		await deleteContentPreset(created.id, db);
		expect(await getDefaultContentPresetId(db)).toBeNull();
	});
});

describe.each([...ENGINES])("motion presets on %s", (engine) => {
	// Two keyframes is the schema's minimum: a motion needs a start and an end.
	const input = motionPresetInputSchema.parse({
		name: "Drift",
		keyframes: [
			{ t: 0, scale: 1, x: 0, y: 0 },
			{ t: 1, scale: 1.1, x: 20, y: 0 },
		],
	});
	let t: TestDb;
	beforeEach(async () => {
		t = await openTestDb(engine);
	});
	afterEach(() => t.close());

	test("create, read and list", async () => {
		const created = await createContentMotionPreset(input, t.db);
		expect((await getContentMotionPreset(created.id, t.db))?.name).toBe("Drift");
		expect(await listContentMotionPresets(t.db)).toHaveLength(1);
	});

	test("update keeps the id; delete removes it", async () => {
		const created = await createContentMotionPreset(input, t.db);
		expect(
			(await updateContentMotionPreset(created.id, { ...input, name: "Slide" }, t.db))?.id,
		).toBe(created.id);
		expect(await deleteContentMotionPreset(created.id, t.db)).toBe(true);
		expect(await getContentMotionPreset(created.id, t.db)).toBeNull();
	});

	test("an unknown id updates and deletes nothing", async () => {
		expect(await updateContentMotionPreset("nope", input, t.db)).toBeNull();
		expect(await deleteContentMotionPreset("nope", t.db)).toBe(false);
	});
});

describe("clip templates", () => {
	const input = clipTemplateInputSchema.parse({
		kind: "text",
		label: "Lower third",
		category: "text",
		base: "plain",
	});

	test("create, read and list", async () => {
		const created = await createContentClipTemplate(input, db);
		expect((await getContentClipTemplate(created.id, db))?.label).toBe("Lower third");
		expect(await listContentClipTemplates(db)).toHaveLength(1);
	});

	test("update keeps the id; delete removes it", async () => {
		const created = await createContentClipTemplate(input, db);
		expect(
			(await updateContentClipTemplate(created.id, { ...input, label: "Title card" }, db))?.id,
		).toBe(created.id);
		expect(await deleteContentClipTemplate(created.id, db)).toBe(true);
		expect(await getContentClipTemplate(created.id, db)).toBeNull();
	});
});

// `TimelineTemplateInput` is the schema's OUTPUT type — every field is required
// once zod has applied its defaults — so build the fixture through the schema
// rather than casting a partial object.
const TEMPLATE_INPUT = timelineTemplateInputSchema.parse({ name: "Explainer" });

describe("timeline templates", () => {
	/* Shipped templates used to seed themselves inside every list and get. They are
	 * fixtures now, bootstrapped once when the database is opened — so a test that
	 * builds a bare schema has to ask for them, and the tests below that count rows
	 * deliberately do not, to keep their arithmetic about their own rows. */
	test("the shipped templates exist without anyone creating them", async () => {
		await bootstrapLibraryFixtures(db, true);
		// A blank workspace still needs a framework to start a video from.
		expect((await listContentTimelineTemplates(db)).length).toBeGreaterThan(0);
	});

	test("a created template is readable and listed alongside the default", async () => {
		const before = (await listContentTimelineTemplates(db)).length;
		const created = await createContentTimelineTemplate(TEMPLATE_INPUT, db);

		expect((await getContentTimelineTemplate(created.id, db))?.name).toBe("Explainer");
		expect(await listContentTimelineTemplates(db)).toHaveLength(before + 1);
	});

	test("update keeps the id; delete removes it", async () => {
		const created = await createContentTimelineTemplate(TEMPLATE_INPUT, db);
		expect(
			(
				await updateContentTimelineTemplate(
					created.id,
					{ ...TEMPLATE_INPUT, name: "Explainer v2" },
					db,
				)
			)?.id,
		).toBe(created.id);
		expect(await deleteContentTimelineTemplate(created.id, db)).toBe(true);
		expect(await getContentTimelineTemplate(created.id, db)).toBeNull();
	});
});
