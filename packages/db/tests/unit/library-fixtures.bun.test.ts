/* Fixture bootstrap: the rows shipped defaults become, and the rules that keep an
 * operator's work out of their way.
 *
 * These run against a bare in-memory schema and call `bootstrapLibraryFixtures`
 * directly, because the real trigger is `openMaleoDb`, which wants a file. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openTestDb, type TestDb } from "../../src/db/handle-testing.ts";
import type { Db } from "../../src/db/handle.ts";
import {
	CONTENT_PRESET_DEFAULT_KEY,
	MATERIAL_FIXTURES,
	PRESET_FIXTURES,
	TIMELINE_TEMPLATE_FIXTURES,
	timelineTemplateInputSchema,
	type ContentPresetBundle,
} from "@maleo/shared";
import { bootstrapLibraryFixtures } from "../../src/db/library-fixtures.ts";
import {
	createContentMaterial,
	forkContentMaterial,
	getContentMaterial,
	listContentMaterials,
	updateContentMaterial,
} from "../../src/db/content-materials.ts";
import {
	createContentPreset,
	deleteContentPreset,
	forkContentPreset,
	getContentPreset,
	getDefaultContentPresetId,
	listContentPresets,
	updateContentPreset,
} from "../../src/db/content-presets.ts";
import {
	createContentTimelineTemplate,
	deleteContentTimelineTemplate,
	getContentTimelineTemplate,
	listContentTimelineTemplates,
	templateConfigJson,
	updateContentTimelineTemplate,
} from "../../src/db/timeline-templates.ts";

let db: Db;
let t: TestDb;

async function boot(): Promise<void> {
	await bootstrapLibraryFixtures(db, true);
}

beforeEach(async () => {
	t = await openTestDb("postgres");
	db = t.db;
});
afterEach(() => t.close());

const PRESET_INPUT = { name: "Mine", description: "", bundle: {} as ContentPresetBundle };

describe("fixture bootstrap", () => {
	test("it creates a row per shipped fixture", async () => {
		await boot();
		expect((await listContentPresets(db)).filter((p) => p.source === "fixture")).toHaveLength(
			PRESET_FIXTURES.length,
		);
		expect(
			(await listContentTimelineTemplates(db)).filter((t) => t.source === "fixture"),
		).toHaveLength(TIMELINE_TEMPLATE_FIXTURES.length);
		expect(
			(await listContentMaterials("default", null, db)).filter((m) => m.source === "fixture"),
		).toHaveLength(MATERIAL_FIXTURES.length);
	});

	/* The point of the slug. A second run must find the same rows and leave their ids
	 * alone, because presets, projects and provenance all reference them by id. */
	test("running twice keeps every id", async () => {
		await boot();
		const before = (await listContentPresets(db)).map((p) => p.id);
		const materialsBefore = (await listContentMaterials("default", null, db)).map((m) => m.id);
		await boot();
		expect((await listContentPresets(db)).map((p) => p.id)).toEqual(before);
		expect((await listContentMaterials("default", null, db)).map((m) => m.id)).toEqual(
			materialsBefore,
		);
	});

	test("a fixture whose definition changed is rewritten in place", async () => {
		await boot();
		const before = (await listContentPresets(db)).find((p) => p.source === "fixture")!;
		await db.run("UPDATE content_presets SET name = 'Drifted' WHERE id = ?", [before.id]);

		await boot();
		const after = (await getContentPreset(before.id, db))!;
		expect(after.name).toBe(before.name);
		expect(after.id).toBe(before.id);
	});

	test("bootstrap does not touch an operator's rows", async () => {
		await boot();
		const mine = await createContentPreset(PRESET_INPUT, db);
		const forked = (await forkContentPreset(
			(await listContentPresets(db)).find((p) => p.source === "fixture")!.id,
			db,
		))!;

		await boot();
		expect((await getContentPreset(mine.id, db))?.name).toBe("Mine");
		expect((await getContentPreset(forked.id, db))?.source).toBe("user");
	});

	/* Two processes opening the database at once both run this. The unique index is what
	 * settles the race; a SELECT-then-INSERT would let both find nothing and both write. */
	test("bootstrapping twice over creates exactly one row per slug", async () => {
		await boot();
		await boot();
		await boot();
		const slugs = (await listContentPresets(db))
			.filter((p) => p.source === "fixture")
			.map((p) => p.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		expect(slugs.length).toBe(PRESET_FIXTURES.length);
	});

	test("a fixture preset's bundle names the local ids of its materials and template", async () => {
		await boot();
		const explainer = (await listContentPresets(db)).find(
			(p) => p.slug === "animated-systems-explainer",
		)!;
		const materials = await listContentMaterials("default", null, db);
		const templates = await listContentTimelineTemplates(db);

		expect(explainer.bundle.materials.story).toBe(
			materials.find((m) => m.slug === "animated-systems-explainer-story")!.id,
		);
		expect(explainer.bundle.videoTemplateId).toBe(
			templates.find((t) => t.slug === "timeline-animated-systems-explainer")!.id,
		);
		// The bundle stores ids, never slugs: slugs are for finding fixtures, not joins.
		expect(explainer.bundle.materials.story).not.toBe("animated-systems-explainer-story");
	});
});

describe("fixture ordering", () => {
	test("fixtures come first in shipped order, operator rows after", async () => {
		await boot();
		const mine = await createContentPreset(PRESET_INPUT, db);
		const list = await listContentPresets(db);

		expect(list.slice(0, PRESET_FIXTURES.length).map((p) => p.slug)).toEqual(
			PRESET_FIXTURES.map((f) => f.slug),
		);
		expect(list[list.length - 1]!.id).toBe(mine.id);
	});

	/* Bootstrap rewrites every fixture row and stamps a new updated_at. Ordering the list
	 * by that would reshuffle the shipped presets on every boot, which is what the old
	 * `createdAt: 0` on the virtual builtins existed to prevent. */
	test("a bootstrap rewrite does not reorder the list", async () => {
		await boot();
		const before = (await listContentPresets(db)).map((p) => p.slug);
		await boot();
		expect((await listContentPresets(db)).map((p) => p.slug)).toEqual(before);
	});
});

describe("retirement", () => {
	async function retire(slug: string): Promise<void> {
		// Stand in for a slug leaving the shipped definitions.
		await db.run("UPDATE content_presets SET retired = 1 WHERE slug = ?", [slug]);
	}

	test("a retired fixture leaves the list but still resolves by id", async () => {
		await boot();
		const fixture = (await listContentPresets(db)).find((p) => p.source === "fixture")!;
		await retire(fixture.slug!);

		expect((await listContentPresets(db)).map((p) => p.id)).not.toContain(fixture.id);
		// A preset, default pointer or project still naming it has to keep working.
		expect((await getContentPreset(fixture.id, db))?.id).toBe(fixture.id);
	});

	test("bootstrap un-retires a slug that ships again", async () => {
		await boot();
		const fixture = (await listContentPresets(db)).find((p) => p.source === "fixture")!;
		await retire(fixture.slug!);
		await boot();
		expect((await listContentPresets(db)).map((p) => p.id)).toContain(fixture.id);
	});

	test("retirement does not reach a row forked from the fixture", async () => {
		await boot();
		const fixture = (await listContentPresets(db)).find((p) => p.source === "fixture")!;
		const copy = (await forkContentPreset(fixture.id, db))!;
		await retire(fixture.slug!);

		expect((await listContentPresets(db)).map((p) => p.id)).toContain(copy.id);
	});
});

describe("fixtures are read-only", () => {
	test("a fixture preset refuses update and delete", async () => {
		await boot();
		const fixture = (await listContentPresets(db)).find((p) => p.source === "fixture")!;
		expect(
			await updateContentPreset(fixture.id, { ...PRESET_INPUT, name: "Hijacked" }, db),
		).toBeNull();
		expect(await deleteContentPreset(fixture.id, db)).toBe(false);
		expect((await getContentPreset(fixture.id, db))?.name).toBe(fixture.name);
	});

	test("a fixture template refuses update and delete", async () => {
		await boot();
		const fixture = (await listContentTimelineTemplates(db)).find((t) => t.source === "fixture")!;
		const input = timelineTemplateInputSchema.parse({ name: "Hijacked" });
		expect(await updateContentTimelineTemplate(fixture.id, input, db)).toBeNull();
		expect(await deleteContentTimelineTemplate(fixture.id, db)).toBe(false);
		expect((await getContentTimelineTemplate(fixture.id, db))?.name).toBe(fixture.name);
	});

	/* Fixture materials are protected by their SCOPE rather than by a check: they live in
	 * the reserved empty workspace, and an operator's write carries their own workspace in
	 * its WHERE clause, which no fixture row can match. */
	test("a fixture material is readable from a workspace but not writable by it", async () => {
		await boot();
		const fixture = (await listContentMaterials("default", null, db)).find(
			(m) => m.source === "fixture",
		)!;
		expect((await getContentMaterial(fixture.id, "default", db))?.id).toBe(fixture.id);
		expect(
			await updateContentMaterial(
				fixture.id,
				{ name: "Hijacked", description: "", group: fixture.group, body: "x", assetIds: [] },
				"default",
				db,
			),
		).toBeNull();
	});

	test("one fixture material row serves every workspace", async () => {
		await boot();
		const fromDefault = (await listContentMaterials("default", null, db)).filter(
			(m) => m.source === "fixture",
		);
		const fromOther = (await listContentMaterials("other", null, db)).filter(
			(m) => m.source === "fixture",
		);
		expect(fromOther.map((m) => m.id)).toEqual(fromDefault.map((m) => m.id));
		expect(
			(await db.get<{ n: number }>(
				"SELECT COUNT(*) AS n FROM content_materials WHERE source = 'fixture'",
			))!.n,
		).toBe(MATERIAL_FIXTURES.length);
	});
});

describe("forking", () => {
	test("a fork copies the row and leaves the fixture alone", async () => {
		await boot();
		const fixture = (await listContentPresets(db)).find((p) => p.source === "fixture")!;
		const copy = (await forkContentPreset(fixture.id, db))!;

		expect(copy.id).not.toBe(fixture.id);
		expect(copy.source).toBe("user");
		expect(copy.name).toBe(`${fixture.name} (copy)`);
		expect(copy.slug).not.toBe(fixture.slug);
		expect((await getContentPreset(fixture.id, db))?.name).toBe(fixture.name);
	});

	test("a forked preset keeps pointing at the fixture's materials", async () => {
		await boot();
		const fixture = (await listContentPresets(db)).find(
			(p) => p.slug === "animated-systems-explainer",
		)!;
		const copy = (await forkContentPreset(fixture.id, db))!;
		// Renaming a preset must not clone the four materials behind it.
		expect(copy.bundle.materials).toEqual(fixture.bundle.materials);
		expect(
			(await listContentMaterials("default", null, db)).filter((m) => m.source === "fixture"),
		).toHaveLength(MATERIAL_FIXTURES.length);
	});

	test("a second fork takes the next free name", async () => {
		await boot();
		const fixture = (await listContentPresets(db)).find((p) => p.source === "fixture")!;
		await forkContentPreset(fixture.id, db);
		expect((await forkContentPreset(fixture.id, db))?.name).toBe(`${fixture.name} (copy 2)`);
	});

	test("the copy is editable", async () => {
		await boot();
		const fixture = (await listContentPresets(db)).find((p) => p.source === "fixture")!;
		const copy = (await forkContentPreset(fixture.id, db))!;
		expect(
			(await updateContentPreset(copy.id, { ...PRESET_INPUT, name: "Mine now" }, db))?.name,
		).toBe("Mine now");
	});

	test("forking a fixture material lands it in the caller's workspace", async () => {
		await boot();
		const fixture = (await listContentMaterials("default", null, db)).find(
			(m) => m.source === "fixture",
		)!;
		const copy = (await forkContentMaterial(fixture.id, "default", db))!;

		expect(copy.workspace).toBe("default");
		expect(copy.source).toBe("user");
		expect(copy.body).toBe(fixture.body);
		// And the copy IS writable, unlike what it came from.
		expect(
			(
				await updateContentMaterial(
					copy.id,
					{ name: "Edited", description: "", group: copy.group, body: "new", assetIds: [] },
					"default",
					db,
				)
			)?.body,
		).toBe("new");
	});
});

describe("slugs", () => {
	test("a created row gets a slug, and an update cannot change it", async () => {
		const created = await createContentPreset(PRESET_INPUT, db);
		expect(created.slug).toBe("mine");
		expect(
			(await updateContentPreset(created.id, { ...PRESET_INPUT, name: "Renamed" }, db))?.slug,
		).toBe("mine");
	});

	test("a colliding name takes the next free slug", async () => {
		expect((await createContentPreset(PRESET_INPUT, db)).slug).toBe("mine");
		expect((await createContentPreset(PRESET_INPUT, db)).slug).toBe("mine-2");
	});

	/* User slugs are unique per WORKSPACE, fixture slugs database-wide. Two workspaces
	 * naming a material the same thing is not a collision. */
	test("two workspaces may hold the same material slug", async () => {
		const input = {
			name: "House brief",
			description: "",
			group: "story" as const,
			body: "x",
			assetIds: [],
		};
		expect((await createContentMaterial(input, "default", db)).slug).toBe("house-brief");
		expect((await createContentMaterial(input, "other", db)).slug).toBe("house-brief");
	});

	/* Rows written before slugs existed carry none. The partial unique index is what
	 * lets all of them coexist, and nothing invents a slug for them on read. */
	test("rows without a slug are left alone", async () => {
		await db.run(
			`INSERT INTO content_presets (id, name, description, preset_json, slug, source, retired, fixture_rank, created_at, updated_at)
			 VALUES ('legacy-1', 'Old', '', '{}', NULL, 'user', 0, 0, 0, 0), ('legacy-2', 'Older', '', '{}', NULL, 'user', 0, 0, 0, 0)`,
		);
		const legacy = (await listContentPresets(db)).filter((p) => p.id.startsWith("legacy-"));
		expect(legacy).toHaveLength(2);
		expect(legacy.every((p) => p.slug === null)).toBe(true);
	});

	test("the same fixture may hold different ids in two databases", async () => {
		await boot();
		const other = await openTestDb("postgres");
		try {
			await bootstrapLibraryFixtures(other.db, true);
			const here = (await listContentPresets(db)).find((p) => p.slug === "high-energy-challenge")!;
			const there = (await listContentPresets(other.db)).find(
				(p) => p.slug === "high-energy-challenge",
			)!;
			expect(there.slug).toBe(here.slug);
			expect(there.id).not.toBe(here.id);
		} finally {
			await other.close();
		}
	});
});

describe("migrating away from virtual builtins", () => {
	test("legacy branded fixture slugs migrate in place without duplicate rows", async () => {
		await db.run(
			`INSERT INTO content_presets (id, name, description, preset_json, slug, source, retired, fixture_rank, created_at, updated_at)
			 VALUES ('legacy-preset', 'Legacy', '', '{}', 'mrbeast', 'fixture', 0, 0, 1, 1)`,
		);
		await boot();
		const migrated = (await listContentPresets(db)).filter(
			(p) => p.slug === "high-energy-challenge",
		);
		expect(migrated).toHaveLength(1);
		expect(migrated[0]?.id).toBe("legacy-preset");
		expect(migrated[0]?.name).toBe("High-Energy Challenge");
	});

	/* Shipped templates predate fixtures: they were inserted under a hardcoded id and
	 * were editable in place. Bootstrap rewrites fixture rows from code, so an edit made
	 * before this shipped would be overwritten unless it is rescued first. */
	async function seedLegacyTemplate(overrides: { name?: string } = {}): Promise<string> {
		const fixture = TIMELINE_TEMPLATE_FIXTURES[0]!;
		const shipped = timelineTemplateInputSchema.parse(fixture.template);
		await db.run(
			`INSERT INTO content_timeline_templates (id, name, description, template_json, slug, source, retired, fixture_rank, created_at, updated_at)
			 VALUES (?, ?, ?, ?, NULL, 'user', 0, 0, 1, 1)`,
			[
				fixture.legacyId,
				overrides.name ?? shipped.name,
				shipped.description,
				templateConfigJson(shipped),
			],
		);
		return fixture.legacyId;
	}

	test("an untouched shipped template is adopted, keeping its id", async () => {
		const legacyId = await seedLegacyTemplate();
		await boot();

		const adopted = (await getContentTimelineTemplate(legacyId, db))!;
		expect(adopted.id).toBe(legacyId);
		expect(adopted.source).toBe("fixture");
		expect(adopted.slug).toBe(TIMELINE_TEMPLATE_FIXTURES[0]!.slug);
		// No second copy was made for a row nobody had edited.
		expect(
			(await listContentTimelineTemplates(db)).filter((t) => t.source === "user"),
		).toHaveLength(0);
	});

	/* Caught against a real database: the row had never been edited, but its blob was
	 * written by an older build — different key order, and a key the schema since
	 * renamed — so a raw string comparison called it edited and forked a redundant copy.
	 * On an existing install that meant a spurious "(copy)" of every shipped template,
	 * telling the operator they had changed something they had not. */
	test("a stored blob written by an older build is still recognised as untouched", async () => {
		const fixture = TIMELINE_TEMPLATE_FIXTURES[0]!;
		const shipped = timelineTemplateInputSchema.parse(fixture.template);
		const parsed = JSON.parse(templateConfigJson(shipped)) as Record<string, unknown>;

		// The same template as an older build would have stored it: keys reversed, the
		// pre-rename name for the intro text preset, and a key that has since retired.
		const legacyBlob: Record<string, unknown> = {};
		for (const key of Object.keys(parsed).reverse()) legacyBlob[key] = parsed[key];
		legacyBlob.introMotionPreset = legacyBlob.introTextPreset;
		delete legacyBlob.introTextPreset;
		legacyBlob.backgroundFill = "#000000";

		await db.run(
			`INSERT INTO content_timeline_templates (id, name, description, template_json, slug, source, retired, fixture_rank, created_at, updated_at)
			 VALUES (?, ?, ?, ?, NULL, 'user', 0, 0, 1, 1)`,
			[fixture.legacyId, shipped.name, shipped.description, JSON.stringify(legacyBlob)],
		);
		await boot();

		expect(
			(await listContentTimelineTemplates(db)).filter((t) => t.source === "user"),
		).toHaveLength(0);
		expect((await getContentTimelineTemplate(fixture.legacyId, db))?.source).toBe("fixture");
	});

	test("an edited shipped template survives as an operator's row", async () => {
		const legacyId = await seedLegacyTemplate({ name: "My tuned documentary" });
		await boot();

		const preserved = (await listContentTimelineTemplates(db)).find((t) => t.source === "user");
		expect(preserved?.name).toBe("My tuned documentary (copy)");
		// The rescued row is a normal operator row, slug and all.
		expect(preserved?.slug).toBe("my-tuned-documentary-copy");
		// The fixture row is rewritten from the shipped definition, on the same id.
		const fixture = (await getContentTimelineTemplate(legacyId, db))!;
		expect(fixture.source).toBe("fixture");
		expect(fixture.name).toBe(
			timelineTemplateInputSchema.parse(TIMELINE_TEMPLATE_FIXTURES[0]!.template).name,
		);
	});

	test("the default pointer moves from its builtin id to the fixture row", async () => {
		await db.run("INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, 0)", [
			CONTENT_PRESET_DEFAULT_KEY,
			"builtin:mrbeast",
		]);
		await boot();

		const fixture = (await listContentPresets(db)).find((p) => p.slug === "high-energy-challenge")!;
		expect(await getDefaultContentPresetId(db)).toBe(fixture.id);
	});

	test("a default pointer at an operator's preset is left alone", async () => {
		await boot();
		const mine = await createContentPreset(PRESET_INPUT, db);
		await db.run("UPDATE global_settings SET value = ? WHERE key = ?", [
			mine.id,
			CONTENT_PRESET_DEFAULT_KEY,
		]);
		await db.run(
			"INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, 0) ON CONFLICT(key) DO NOTHING",
			[CONTENT_PRESET_DEFAULT_KEY, mine.id],
		);
		await boot();
		expect(await getDefaultContentPresetId(db)).toBe(mine.id);
	});
});

describe("fixture bundles match the builtins they replaced", () => {
	/* Divergence is derived by comparing a project's values against the preset's, so a
	 * fixture bundle that drifted from the builtin it replaced would report every
	 * existing project as diverged from a preset it still agrees with. */
	test("every compared bundle field is carried through unchanged", async () => {
		await boot();
		for (const fixture of PRESET_FIXTURES) {
			const row = (await listContentPresets(db)).find((p) => p.slug === fixture.slug)!;
			expect(row.bundle.style, fixture.slug).toEqual(fixture.bundle.style);
			expect(row.bundle.settings, fixture.slug).toEqual(fixture.bundle.settings);
			expect(row.bundle.projectRefs, fixture.slug).toEqual(fixture.bundle.projectRefs);
			expect(row.bundle.pacingDevices, fixture.slug).toEqual(fixture.bundle.pacingDevices);
			expect(row.bundle.infographicStyle, fixture.slug).toEqual(fixture.bundle.infographicStyle);
			expect(row.bundle.direction, fixture.slug).toEqual(fixture.bundle.direction);
		}
	});

	test("every fixture material body reaches its row", async () => {
		await boot();
		const rows = await listContentMaterials("default", null, db);
		for (const material of MATERIAL_FIXTURES) {
			expect(rows.find((row) => row.slug === material.slug)?.body, material.slug).toBe(
				material.body,
			);
		}
	});
});

describe("timeline template fork", () => {
	test("a created template is editable and a fixture is not", async () => {
		await boot();
		const mine = await createContentTimelineTemplate(
			timelineTemplateInputSchema.parse({ name: "Mine" }),
			db,
		);
		expect(
			(
				await updateContentTimelineTemplate(
					mine.id,
					timelineTemplateInputSchema.parse({ name: "Mine v2" }),
					db,
				)
			)?.name,
		).toBe("Mine v2");
		expect(await deleteContentTimelineTemplate(mine.id, db)).toBe(true);
	});
});
