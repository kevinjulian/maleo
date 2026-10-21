/* Fixture bootstrap — turning the shipped definitions into rows.
 *
 * Runs ONCE per process (see `bootstrapLibraryFixtures`), not per read. Shipped
 * timeline templates used to be seeded lazily inside every list and get; doing that
 * for three families would put a dozen upserts behind every library page load.
 *
 * The order matters and is not arrangeable:
 *
 *   1. adopt-or-fork the shipped template rows that predate fixtures
 *   2. upsert fixture Materials      (no dependencies)
 *   3. upsert fixture Video Templates (no dependencies)
 *   4. resolve their slugs to local ids
 *   5. upsert fixture Project Presets, whose bundles hold those ids
 *   6. retire fixture rows whose slug no longer ships
 *   7. repoint the default preset from its virtual `builtin:` id to the fixture row
 *
 * A preset upserted before its materials would have to store ids that do not exist
 * yet, which is the one way a bundle can end up naming nothing.
 *
 * Every upsert is a single `INSERT ... ON CONFLICT(slug) DO UPDATE`. Two processes
 * starting together race on that statement and the unique index settles it; a
 * SELECT-then-INSERT would let both find nothing and both insert.
 *
 * The conflict targets repeat `WHERE slug IS NOT NULL` because the indexes they name
 * are partial, and SQLite matches a partial index only when the predicate is restated.
 */
import { randomUUID } from "node:crypto";
import {
	CONTENT_PRESET_DEFAULT_KEY,
	FIXTURE_WORKSPACE,
	fixtureSlugForLegacyBuiltinId,
	forkCopyName,
	generateUserSlug,
	MATERIAL_FIXTURES,
	PRESET_FIXTURES,
	TIMELINE_TEMPLATE_FIXTURES,
	MATERIAL_GROUPS,
	LEGACY_FIXTURE_SLUG_RENAMES,
	timelineTemplateInputSchema,
	type PresetFixture,
	type PresetMaterialSelection,
} from "@maleo/shared";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";
import { templateConfigJson } from "./timeline-templates.ts";

/* Step 1. Shipped templates existed as rows BEFORE they were fixtures, inserted with
 * a hardcoded id and — this is the part that matters — editable in place. Bootstrap
 * now rewrites fixture rows from code, so an operator's in-place edit would be
 * overwritten by the first boot after this ships.
 *
 * So each legacy row is compared against the definition it was seeded from. Identical
 * means untouched: adopt it as the fixture, keeping the id every preset and project
 * already references. Different means the operator changed it: copy their version to a
 * user-owned row first, under the same `(copy)` name a fork would give it, and let the
 * fixture rewrite proceed.
 *
 * This is a one-time reconciliation. Once a row carries a slug it is a fixture and
 * this step skips it. */
/** A stored blob re-serialized through the current schema, so it can be compared with a
 *  shipped definition on equal terms. Returns null when the blob will not parse, which
 *  counts as "not the shipped one" and so is preserved rather than overwritten. */
function storedTemplateJson(name: string, description: string, blob: string): string | null {
	try {
		// SAFETY: the spread only needs `blob` to parse to an object, and the schema
		// rejects anything whose fields are wrong — including a JSON array or scalar,
		// which spreads to no usable keys and then fails `.parse`. Both paths land in the
		// catch, which is the same answer as a blob that would not parse at all.
		const stored = JSON.parse(blob) as object;
		return templateConfigJson(timelineTemplateInputSchema.parse({ ...stored, name, description }));
	} catch {
		return null;
	}
}

async function adoptOrForkLegacyTemplates(db: Db): Promise<void> {
	for (const fixture of TIMELINE_TEMPLATE_FIXTURES) {
		const row = await db.get<{
			id: string;
			name: string;
			description: string;
			template_json: string;
			slug: string | null;
		}>(
			"SELECT id, name, description, template_json, slug FROM content_timeline_templates WHERE id = ?",
			[fixture.legacyId],
		);
		if (!row || row.slug) continue; // absent, or already reconciled

		const shipped = timelineTemplateInputSchema.parse(fixture.template);
		/* Compare the PARSED templates, not the raw blobs.
		 *
		 * A blob written by an older build holds its keys in that build's order, and may
		 * carry retired or renamed ones the schema reconciles on read. Comparing the
		 * stored JSON text against a freshly serialized definition therefore reports
		 * "edited" for rows nobody touched — which would fork a redundant copy of every
		 * shipped template on the first boot of every existing install, and tell the
		 * operator they had edited something they had not. Round-tripping both sides
		 * through the schema compares what the template MEANS. */
		const untouched =
			row.name === shipped.name &&
			row.description === shipped.description &&
			storedTemplateJson(row.name, row.description, row.template_json) ===
				templateConfigJson(shipped);

		if (!untouched) {
			const now = Date.now();
			const takenNames = (
				await db.all<{ name: string }>("SELECT name FROM content_timeline_templates")
			).map((r) => r.name);
			const takenSlugs = (
				await db.all<{ slug: string }>(
					"SELECT slug FROM content_timeline_templates WHERE slug IS NOT NULL",
				)
			).map((r) => r.slug);
			const name = forkCopyName(row.name, takenNames);
			await db.run(
				`INSERT INTO content_timeline_templates (id, name, description, template_json, slug, source, retired, fixture_rank, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, 'user', 0, 0, ?, ?)`,
				[
					randomUUID(),
					name,
					row.description,
					row.template_json,
					generateUserSlug(name, takenSlugs, "template"),
					now,
					now,
				],
			);
		}
		// Claim the legacy row as the fixture. Its id survives, so every reference to it
		// does too; the upsert below rewrites its contents from the definition.
		await db.run(
			"UPDATE content_timeline_templates SET slug = ?, source = 'fixture' WHERE id = ?",
			[fixture.slug, row.id],
		);
	}
}

/** Rename shipped fixture identities in place so existing ids and references survive. */
async function migrateLegacyFixtureSlugs(db: Db): Promise<void> {
	for (const [legacy, current] of Object.entries(LEGACY_FIXTURE_SLUG_RENAMES)) {
		/* Was UPDATE OR IGNORE: a row whose new slug is already taken keeps its old
		 * one. Postgres has no such clause, so the guard says it outright. */
		await db.run(
			`UPDATE content_presets SET slug = ?1 WHERE slug = ?2 AND source = 'fixture'
			 AND NOT EXISTS (SELECT 1 FROM content_presets taken WHERE taken.slug = ?1)`,
			[current, legacy],
		);
		for (const group of MATERIAL_GROUPS) {
			await db.run(
				`UPDATE content_materials SET slug = ?1 WHERE slug = ?2 AND source = 'fixture'
				 AND NOT EXISTS (SELECT 1 FROM content_materials taken
				                 WHERE taken.workspace = content_materials.workspace AND taken.slug = ?1)`,
				[`${current}-${group}`, `${legacy}-${group}`],
			);
		}
	}
}

async function upsertMaterialFixtures(db: Db): Promise<void> {
	const now = Date.now();
	for (const [index, fixture] of MATERIAL_FIXTURES.entries()) {
		await db.run(
			`INSERT INTO content_materials (id, workspace, name, description, material_group, body, asset_ids_json, slug, source, retired, fixture_rank, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 'fixture', 0, ?, ?, ?)
			 ON CONFLICT(workspace, slug) WHERE slug IS NOT NULL DO UPDATE SET
			   name = excluded.name,
			   description = excluded.description,
			   material_group = excluded.material_group,
			   body = excluded.body,
			   source = 'fixture',
			   retired = 0,
			   fixture_rank = excluded.fixture_rank,
			   updated_at = excluded.updated_at`,
			[
				randomUUID(),
				FIXTURE_WORKSPACE,
				fixture.name,
				fixture.description,
				fixture.group,
				fixture.body,
				fixture.slug,
				index,
				now,
				now,
			],
		);
	}
}

async function upsertTemplateFixtures(db: Db): Promise<void> {
	const now = Date.now();
	for (const [index, fixture] of TIMELINE_TEMPLATE_FIXTURES.entries()) {
		const template = timelineTemplateInputSchema.parse(fixture.template);
		await db.run(
			`INSERT INTO content_timeline_templates (id, name, description, template_json, slug, source, retired, fixture_rank, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'fixture', 0, ?, ?, ?)
			 ON CONFLICT(slug) WHERE slug IS NOT NULL DO UPDATE SET
			   name = excluded.name,
			   description = excluded.description,
			   template_json = excluded.template_json,
			   source = 'fixture',
			   retired = 0,
			   fixture_rank = excluded.fixture_rank,
			   updated_at = excluded.updated_at`,
			[
				randomUUID(),
				template.name,
				template.description,
				templateConfigJson(template),
				fixture.slug,
				index,
				now,
				now,
			],
		);
	}
}

/** Slug -> local id, for the fixture families a preset bundle has to name. */
interface FixtureIds {
	materials: Map<string, string>;
	templates: Map<string, string>;
}

async function fixtureIdsBySlug(db: Db): Promise<FixtureIds> {
	const materials = new Map(
		(
			await db.all<{ slug: string; id: string }>(
				"SELECT slug, id FROM content_materials WHERE workspace = ? AND slug IS NOT NULL",
				[FIXTURE_WORKSPACE],
			)
		).map((row) => [row.slug, row.id] as const),
	);
	const templates = new Map(
		(
			await db.all<{ slug: string; id: string }>(
				"SELECT slug, id FROM content_timeline_templates WHERE source = 'fixture' AND slug IS NOT NULL",
			)
		).map((row) => [row.slug, row.id] as const),
	);
	return { materials, templates };
}

/* The bundle a fixture preset stores: the shipped values, plus the LOCAL ids its
 * material and template slugs resolved to. This is the whole point of the two
 * identities — the definition travels as slugs, the row references ids. */
function resolvedBundle(fixture: PresetFixture, ids: FixtureIds): string {
	const materials: PresetMaterialSelection = {
		story: null,
		visual: null,
		voice: null,
		rules: null,
	};
	for (const group of MATERIAL_GROUPS) {
		const slug = fixture.materialSlugs[group];
		materials[group] = slug ? (ids.materials.get(slug) ?? null) : null;
	}
	return JSON.stringify({
		...fixture.bundle,
		materials,
		videoTemplateId: ids.templates.get(fixture.videoTemplateSlug) ?? null,
	});
}

async function upsertPresetFixtures(db: Db): Promise<void> {
	const now = Date.now();
	const ids = await fixtureIdsBySlug(db);
	for (const [index, fixture] of PRESET_FIXTURES.entries()) {
		await db.run(
			`INSERT INTO content_presets (id, name, description, preset_json, slug, source, retired, fixture_rank, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'fixture', 0, ?, ?, ?)
			 ON CONFLICT(slug) WHERE slug IS NOT NULL DO UPDATE SET
			   name = excluded.name,
			   description = excluded.description,
			   preset_json = excluded.preset_json,
			   source = 'fixture',
			   retired = 0,
			   fixture_rank = excluded.fixture_rank,
			   updated_at = excluded.updated_at`,
			[
				randomUUID(),
				fixture.name,
				fixture.description,
				resolvedBundle(fixture, ids),
				fixture.slug,
				index,
				now,
				now,
			],
		);
	}
}

/* Step 6. A fixture whose slug stopped shipping is marked, never deleted: presets,
 * default pointers and provenance may still name it, and deleting the row would break
 * reads that are supposed to keep working. Retired rows leave every list and still
 * resolve by id.
 *
 * Only fixture rows are touched. A row forked from a retired fixture is the operator's
 * and stays exactly where it is. */
async function retireUnshippedFixtures(db: Db): Promise<void> {
	const shipped: Array<[string, readonly string[]]> = [
		["content_materials", MATERIAL_FIXTURES.map((f) => f.slug)],
		["content_timeline_templates", TIMELINE_TEMPLATE_FIXTURES.map((f) => f.slug)],
		["content_presets", PRESET_FIXTURES.map((f) => f.slug)],
	];
	for (const [table, slugs] of shipped) {
		const placeholders = slugs.map(() => "?").join(", ");
		await db.run(
			`UPDATE ${table} SET retired = 1 WHERE source = 'fixture' AND retired IS DISTINCT FROM 1${slugs.length ? ` AND slug NOT IN (${placeholders})` : ""}`,
			[...slugs],
		);
	}
}

/* Step 7. The default preset pointer may still name a virtual `builtin:` id, which no
 * longer resolves to anything. It is one row in `global_settings`, so unlike the
 * provenance buried in every project's editor state it is migrated for real rather than
 * translated on read.
 *
 * The pointer is global, not per-workspace, despite what the header on
 * `content-presets.ts` used to claim. Making it per-workspace is a separate change. */
async function migrateDefaultPresetPointer(db: Db): Promise<void> {
	const row = await db.get<{ value: string }>("SELECT value FROM global_settings WHERE key = ?", [
		CONTENT_PRESET_DEFAULT_KEY,
	]);
	const slug = row?.value ? fixtureSlugForLegacyBuiltinId(row.value) : null;
	if (!slug) return;
	const fixture = await db.get<{ id: string }>(
		"SELECT id FROM content_presets WHERE slug = ? AND source = 'fixture'",
		[slug],
	);
	if (!fixture) return;
	await db.run("UPDATE global_settings SET value = ?, updated_at = ? WHERE key = ?", [
		fixture.id,
		Date.now(),
		CONTENT_PRESET_DEFAULT_KEY,
	]);
}

/* Once per process. The flag is keyed on the handle rather than a module boolean
 * because tests open their own databases, and a module-level flag would make the
 * first test the only one that ever bootstraps. */
const bootstrapped = new WeakSet<Db>();

export function bootstrapLibraryFixtures(db: Db = openDb(), force = false): Promise<void> {
	if (!force && bootstrapped.has(db)) return Promise.resolve();
	bootstrapped.add(db);
	return db.transaction(async (tx) => {
		await adoptOrForkLegacyTemplates(tx);
		await migrateLegacyFixtureSlugs(tx);
		await upsertMaterialFixtures(tx);
		await upsertTemplateFixtures(tx);
		await upsertPresetFixtures(tx);
		await retireUnshippedFixtures(tx);
		await migrateDefaultPresetPointer(tx);
	});
}
