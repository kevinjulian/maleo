/* Timeline templates — the reusable framework a video project starts from.
 *
 * One table, one route module. Split out of the 2,437-line `maleo-db.ts`, where
 * thirteen unrelated schema domains shared a file. */
import { randomUUID } from "node:crypto";
import {
	DEFAULT_TIMELINE_TEMPLATE_SLUG,
	forkCopyName,
	generateUserSlug,
	timelineTemplateInputSchema,
	type TimelineTemplate,
	type TimelineTemplateInput,
} from "@maleo/shared";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

interface TimelineTemplateDbRow {
	id: string;
	name: string;
	description: string;
	template_json: string;
	slug: string | null;
	source: string | null;
	retired: number | null;
	created_at: number;
	updated_at: number;
}

function mapTimelineTemplateRow(row: TimelineTemplateDbRow): TimelineTemplate {
	const config = timelineTemplateInputSchema.parse({
		...(JSON.parse(row.template_json) as Omit<TimelineTemplateInput, "name" | "description">),
		name: row.name,
		description: row.description,
	});
	return {
		id: row.id,
		...config,
		/* Coerced, not parsed: rows written before these columns existed read NULL,
		 * and a NULL source is an operator's row — only bootstrap writes "fixture". */
		slug: row.slug ?? null,
		source: row.source === "fixture" ? "fixture" : "user",
		retired: row.retired === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function takenTemplateSlugs(db: Db): Promise<string[]> {
	return (
		await db.all<{ slug: string }>(
			"SELECT slug FROM content_timeline_templates WHERE slug IS NOT NULL",
		)
	).map((row) => row.slug);
}

/** The template's config blob. Exported for fixture bootstrap, which compares a
 *  stored blob against a shipped definition to tell an untouched row from an edited
 *  one. */
export function templateConfigJson(input: TimelineTemplateInput): string {
	return JSON.stringify({
		introTextPreset: input.introTextPreset,
		introEntrySfx: input.introEntrySfx,
		introEntrySfxUrl: input.introEntrySfxUrl,
		introLeadInSec: input.introLeadInSec,
		introTitleDurationSec: input.introTitleDurationSec,
		introEntrySfxVolume: input.introEntrySfxVolume,
		introEntrySfxOffsetSec: input.introEntrySfxOffsetSec,
		sectionGapSec: input.sectionGapSec,
		sectionTitlePolicy: input.sectionTitlePolicy,
		sectionTextPreset: input.sectionTextPreset,
		sceneEntrySfx: input.sceneEntrySfx,
		sceneEntrySfxUrl: input.sceneEntrySfxUrl,
		musicCue: input.musicCue,
		musicUrl: input.musicUrl,
		musicVolume: input.musicVolume,
		musicPolicy: input.musicPolicy,
		musicEmotionCues: input.musicEmotionCues,
		sentenceVoiceoverPauseSec: input.sentenceVoiceoverPauseSec,
		sceneVoiceoverPauseSec: input.sceneVoiceoverPauseSec,
		maxVisualBeatSec: input.maxVisualBeatSec,
		maxVoiceoverSegmentSec: input.maxVoiceoverSegmentSec,
		staticSceneMovement: input.staticSceneMovement,
		overrideSceneTransition: input.overrideSceneTransition,
		sceneTransition: input.sceneTransition,
		imageGuidancePrompt: input.imageGuidancePrompt,
	});
}

/* Fixtures first in shipped order, then the operator's own rows newest-first — the
 * same rule the preset list uses, and for the same reason: bootstrap rewrites fixture
 * rows, so `updated_at` would reorder the library every time the app started.
 *
 * Bootstrap itself used to run HERE, on every list and every get. It now runs once per
 * process, in `library-fixtures.ts`. */
export async function listContentTimelineTemplates(db: Db = openDb()): Promise<TimelineTemplate[]> {
	return (
		await db.all<TimelineTemplateDbRow>(`SELECT * FROM content_timeline_templates WHERE retired IS DISTINCT FROM 1
		 ORDER BY CASE WHEN source = 'fixture' THEN 0 ELSE 1 END, fixture_rank, updated_at DESC, name ASC`)
	).map(mapTimelineTemplateRow);
}

export async function getContentTimelineTemplate(
	id: string,
	db: Db = openDb(),
): Promise<TimelineTemplate | null> {
	const row = await db.get<TimelineTemplateDbRow>(
		"SELECT * FROM content_timeline_templates WHERE id = ?",
		[id],
	);
	return row ? mapTimelineTemplateRow(row) : null;
}

/* Resolve a shipped template by its slug.
 *
 * Callers that want "the default template" used to name `DEFAULT_TIMELINE_TEMPLATE_ID`
 * directly, back when a shipped row was inserted under a hardcoded primary key. Ids are
 * local now — a fresh database assigns its own — so the slug is the only identity that
 * still means the same thing everywhere. Existing databases keep their legacy id, which
 * the bootstrap adopts, so both resolve to the same row. */
export async function getFixtureTimelineTemplateBySlug(
	slug: string,
	db: Db = openDb(),
): Promise<TimelineTemplate | null> {
	const row = await db.get<TimelineTemplateDbRow>(
		"SELECT * FROM content_timeline_templates WHERE slug = ? AND source = 'fixture'",
		[slug],
	);
	return row ? mapTimelineTemplateRow(row) : null;
}

/** The template a project falls back to when it names none. */
export async function getDefaultTimelineTemplate(
	db: Db = openDb(),
): Promise<TimelineTemplate | null> {
	return await getFixtureTimelineTemplateBySlug(DEFAULT_TIMELINE_TEMPLATE_SLUG, db);
}

export async function createContentTimelineTemplate(
	input: TimelineTemplateInput,
	db: Db = openDb(),
): Promise<TimelineTemplate> {
	const validated = timelineTemplateInputSchema.parse(input);
	const now = Date.now();
	const id = randomUUID();
	const slug = generateUserSlug(validated.name, await takenTemplateSlugs(db), "template");
	await db.run(
		`INSERT INTO content_timeline_templates (id, name, description, template_json, slug, source, retired, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'user', 0, ?, ?)`,
		[id, validated.name, validated.description, templateConfigJson(validated), slug, now, now],
	);
	return (await getContentTimelineTemplate(id, db))!;
}

export async function updateContentTimelineTemplate(
	id: string,
	input: TimelineTemplateInput,
	db: Db = openDb(),
): Promise<TimelineTemplate | null> {
	const validated = timelineTemplateInputSchema.parse(input);
	/* Shipped templates USED to be editable in place — only DELETE was refused. They
	 * are fixtures now, so the WHERE clause excludes them and the route offers a fork
	 * instead. Any in-place edit made before this shipped is preserved as a user row by
	 * the migration in library-fixtures.ts, not overwritten by bootstrap. */
	const result = await db.run(
		"UPDATE content_timeline_templates SET name = ?, description = ?, template_json = ?, updated_at = ? WHERE id = ? AND source IS DISTINCT FROM 'fixture'",
		[validated.name, validated.description, templateConfigJson(validated), Date.now(), id],
	);
	return result.changes > 0 ? getContentTimelineTemplate(id, db) : null;
}

/** Copy a template — the only way to edit a fixture one. The copy is the operator's:
 *  new id, generated slug, `(copy)` name, and no fixture status to inherit. */
export async function forkContentTimelineTemplate(
	id: string,
	db: Db = openDb(),
): Promise<TimelineTemplate | null> {
	const row = await db.get<TimelineTemplateDbRow>(
		"SELECT * FROM content_timeline_templates WHERE id = ?",
		[id],
	);
	if (!row) return null;
	const now = Date.now();
	const newId = randomUUID();
	const takenNames = (
		await db.all<{ name: string }>("SELECT name FROM content_timeline_templates")
	).map((r) => r.name);
	const name = forkCopyName(row.name, takenNames);
	await db.run(
		`INSERT INTO content_timeline_templates (id, name, description, template_json, slug, source, retired, fixture_rank, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'user', 0, 0, ?, ?)`,
		[
			newId,
			name,
			row.description,
			row.template_json,
			generateUserSlug(name, await takenTemplateSlugs(db), "template"),
			now,
			now,
		],
	);
	return getContentTimelineTemplate(newId, db);
}

export async function deleteContentTimelineTemplate(
	id: string,
	db: Db = openDb(),
): Promise<boolean> {
	const result = await db.run(
		"DELETE FROM content_timeline_templates WHERE id = ? AND source IS DISTINCT FROM 'fixture'",
		[id],
	);
	return result.changes > 0;
}

// ── Content presets (style + refs + settings bundles) ──
// A named snapshot seeded into new projects at create time. The default is a
