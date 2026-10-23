/* Content presets — named bundles of style, references and settings, with one
 * marked default per workspace. */
import { randomUUID } from "node:crypto";
import {
	contentPresetInputSchema,
	contentPresetBundleSchema,
	forkCopyName,
	generateUserSlug,
	CONTENT_PRESET_DEFAULT_KEY,
	type ContentPreset,
	type ContentPresetInput,
} from "@maleo/shared";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

interface ContentPresetDbRow {
	id: string;
	name: string;
	description: string;
	preset_json: string;
	slug: string | null;
	source: string | null;
	retired: number | null;
	created_at: number;
	updated_at: number;
}

/* Read through the READ bundle schema, not the write one: a row saved before
 * styles became knobs still holds an identifier in `style`, and the write schema
 * rejects that. Reading normalises it; the backfill rewrites it for good. */
function mapContentPresetRow(row: ContentPresetDbRow): ContentPreset {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		bundle: contentPresetBundleSchema.parse(JSON.parse(row.preset_json)),
		/* Coerced, not parsed: a row written before these columns existed reads NULL
		 * for all three, and a NULL source is an operator's row — only bootstrap
		 * writes "fixture". */
		slug: row.slug ?? null,
		source: row.source === "fixture" ? "fixture" : "user",
		retired: row.retired === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function takenPresetSlugs(db: Db): Promise<string[]> {
	return (
		await db.all<{ slug: string }>("SELECT slug FROM content_presets WHERE slug IS NOT NULL")
	).map((row) => row.slug);
}

/* Fixtures first, in the order they ship, then the workspace's own rows newest-first.
 *
 * Fixture rows are rewritten from code on every bootstrap, so ordering the whole list
 * by `updated_at` would reshuffle the shipped presets each time the app started. The
 * previous virtual builtins were listed first with `createdAt: 0` for exactly this
 * reason; persisting them must not lose it. Retired fixtures are dropped here and still
 * resolve through `getContentPreset`. */
export async function listContentPresets(db: Db = openDb()): Promise<ContentPreset[]> {
	return (
		await db.all<ContentPresetDbRow>(`SELECT * FROM content_presets WHERE retired IS DISTINCT FROM 1
		 ORDER BY CASE WHEN source = 'fixture' THEN 0 ELSE 1 END, fixture_rank, updated_at DESC, name ASC`)
	).map(mapContentPresetRow);
}

export async function getContentPreset(
	id: string,
	db: Db = openDb(),
): Promise<ContentPreset | null> {
	const row = await db.get<ContentPresetDbRow>("SELECT * FROM content_presets WHERE id = ?", [id]);
	return row ? mapContentPresetRow(row) : null;
}

export async function createContentPreset(
	input: ContentPresetInput,
	db: Db = openDb(),
): Promise<ContentPreset> {
	const validated = contentPresetInputSchema.parse(input);
	const now = Date.now();
	const id = randomUUID();
	const slug = generateUserSlug(validated.name, await takenPresetSlugs(db), "preset");
	await db.run(
		`INSERT INTO content_presets (id, name, description, preset_json, slug, source, retired, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'user', 0, ?, ?)`,
		[id, validated.name, validated.description, JSON.stringify(validated.bundle), slug, now, now],
	);
	return (await getContentPreset(id, db))!;
}

/* A fixture row is excluded by the WHERE clause rather than checked beforehand.
 * Routes refuse a fixture write with a 409 that names the fork step; this is the
 * layer under that, so a caller reaching past the route still cannot rewrite a
 * shipped row. `slug` and `source` are absent from the SET list, which is what makes
 * a slug immutable. */
export async function updateContentPreset(
	id: string,
	input: ContentPresetInput,
	db: Db = openDb(),
): Promise<ContentPreset | null> {
	const validated = contentPresetInputSchema.parse(input);
	const result = await db.run(
		"UPDATE content_presets SET name = ?, description = ?, preset_json = ?, updated_at = ? WHERE id = ? AND source IS DISTINCT FROM 'fixture'",
		[validated.name, validated.description, JSON.stringify(validated.bundle), Date.now(), id],
	);
	return result.changes > 0 ? getContentPreset(id, db) : null;
}

/* Fork: the only way to edit a fixture.
 *
 * Copies the addressed row and nothing else. The new preset keeps the SAME material and
 * template ids in its bundle — renaming a forked preset must not clone the four
 * materials behind it, and a fixture Material is readable from every workspace anyway.
 *
 * The copy does not inherit the default pointer: forking the default is how an operator
 * builds a variant, not how they switch to one. */
export async function forkContentPreset(
	id: string,
	db: Db = openDb(),
): Promise<ContentPreset | null> {
	const source = await getContentPreset(id, db);
	if (!source) return null;
	const now = Date.now();
	const newId = randomUUID();
	const takenNames = (await db.all<{ name: string }>("SELECT name FROM content_presets")).map(
		(row) => row.name,
	);
	const name = forkCopyName(source.name, takenNames);
	await db.run(
		`INSERT INTO content_presets (id, name, description, preset_json, slug, source, retired, fixture_rank, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'user', 0, 0, ?, ?)`,
		[
			newId,
			name,
			source.description,
			JSON.stringify(source.bundle),
			generateUserSlug(name, await takenPresetSlugs(db), "preset"),
			now,
			now,
		],
	);
	return getContentPreset(newId, db);
}

export async function deleteContentPreset(id: string, db: Db = openDb()): Promise<boolean> {
	const result = await db.run(
		"DELETE FROM content_presets WHERE id = ? AND source IS DISTINCT FROM 'fixture'",
		[id],
	);
	// Clearing the pointer keeps "exactly one default" honest when it targeted
	// the removed row; a stale id would silently seed nothing.
	if ((await getDefaultContentPresetId(db)) === id) await setDefaultContentPresetId(null, db);
	return result.changes > 0;
}

/** Read the default preset id, or null when no default is configured. */
export async function getDefaultContentPresetId(db: Db = openDb()): Promise<string | null> {
	const row = await db.get<{ value: string }>("SELECT value FROM global_settings WHERE key = ?", [
		CONTENT_PRESET_DEFAULT_KEY,
	]);
	return row?.value?.trim() ? row.value : null;
}

/** Set (or clear, when null) the single default preset pointer. */
export async function setDefaultContentPresetId(
	id: string | null,
	db: Db = openDb(),
): Promise<void> {
	if (!id?.trim()) {
		await db.run("DELETE FROM global_settings WHERE key = ?", [CONTENT_PRESET_DEFAULT_KEY]);
		return;
	}
	await db.run(
		`INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		[CONTENT_PRESET_DEFAULT_KEY, id, Date.now()],
	);
}

/* Who draws from a preset, and who has drifted off it.
 *
 * Both surfaces that need this read the SAME stored fact from opposite directions: the
 * editor tells one project which preset supplied an element, and this tells one preset
 * which projects it supplies. Deriving it here rather than keeping a counter on the
 * preset row is deliberate — a counter needs invalidating on every project save and will
 * drift, and drift is the thing provenance exists to remove.
 *
 * A project counts as USING the preset when it is the project's active preset or when any
 * element records it as the supplier. It counts as DIVERGED when it uses the preset AND
 * at least one element is recorded as the operator's, because that element no longer
 * matches what the preset supplies.
 *
 * The scan is over projects that have editor state at all — 149 of 18,155 at the time of
 * writing — with a LIKE prefilter on the id to skip the rest cheaply. The prefilter can
 * admit a false positive, so every candidate is still verified by parsing it.
 */
/** What a project holds at one element path against what the preset supplies —
 *  the pair the drill-down compares. `unknown` on both sides is the honest type:
 *  the values come from editor state and a preset bundle, which are different
 *  shapes at every path. */
export interface PresetDivergedValue {
	projectValue: unknown;
	defaulterValue: unknown;
}

export interface PresetUsageProject {
	id: string;
	title: string;
	/** Element paths this project owns rather than taking from the preset. */
	diverged: string[];
	/** Same divergent elements with current project value and preset value, for UI drill-down. */
	divergedDetails: Array<{ path: string } & PresetDivergedValue>;
}

export interface PresetUsage {
	using: number;
	diverged: number;
	/** The diverged projects, capped. `diverged` is the true total. */
	projects: PresetUsageProject[];
}

const USAGE_PROJECT_CAP = 50;

function valueAtPath(
	path: string,
	state: Record<string, unknown>,
	storyboard: Record<string, unknown>,
	brief: Record<string, unknown>,
	preset: ContentPreset | null,
): PresetDivergedValue {
	if (path.startsWith("settings.")) {
		const key = path.slice("settings.".length);
		const settings =
			state.settings && typeof state.settings === "object" && !Array.isArray(state.settings)
				? (state.settings as Record<string, unknown>)
				: {};
		const presetSettings =
			preset?.bundle.settings &&
			typeof preset.bundle.settings === "object" &&
			!Array.isArray(preset.bundle.settings)
				? (preset.bundle.settings as Record<string, unknown>)
				: {};
		return { projectValue: settings[key], defaulterValue: presetSettings[key] };
	}
	if (path === "style")
		return { projectValue: brief.style_preset, defaulterValue: preset?.bundle.style };
	if (path === "projectReferences")
		return {
			projectValue: storyboard.projectReferences,
			defaulterValue: preset?.bundle.projectRefs,
		};
	if (path === "pacingDevices")
		return { projectValue: storyboard.pacingDevices, defaulterValue: preset?.bundle.pacingDevices };
	return { projectValue: undefined, defaulterValue: undefined };
}

export async function getContentPresetUsage(
	presetId: string,
	db: Db = openDb(),
): Promise<PresetUsage> {
	if (!presetId.trim()) return { using: 0, diverged: 0, projects: [] };
	const preset = await getContentPreset(presetId, db);

	const rows = await db.all<{
		id: string;
		title: string;
		brief_json: string | null;
		editor_state_json: string;
		storyboard_json: string | null;
	}>(
		`SELECT
			p.id,
			p.title,
			p.brief_json,
			p.editor_state_json,
			(SELECT s.storyboard_json FROM content_storyboards s WHERE s.project_id = p.id ORDER BY s.version DESC, s.created_at DESC LIMIT 1) AS storyboard_json
		 FROM content_projects p
		 WHERE p.editor_state_json IS NOT NULL AND p.editor_state_json != ''
		   AND strpos(p.editor_state_json, ?) > 0`,
		[presetId],
	);

	let using = 0;
	let diverged = 0;
	const projects: PresetUsageProject[] = [];

	for (const row of rows) {
		let state: { element_sources?: unknown; active_preset_id?: unknown };
		try {
			state = JSON.parse(row.editor_state_json) as typeof state;
		} catch {
			// An unreadable blob cannot be claimed as usage. Skipping is the honest answer:
			// counting it would inflate a number an operator makes decisions from.
			continue;
		}

		const sources =
			state.element_sources &&
			typeof state.element_sources === "object" &&
			!Array.isArray(state.element_sources)
				? (state.element_sources as Record<string, { layer?: unknown; defaulterId?: unknown }>)
				: {};

		const suppliedHere: string[] = [];
		const ownedHere: string[] = [];
		for (const [path, source] of Object.entries(sources)) {
			if (source?.layer === "operator") ownedHere.push(path);
			else if (source?.defaulterId === presetId) suppliedHere.push(path);
		}

		const isActive = state.active_preset_id === presetId;
		if (!isActive && suppliedHere.length === 0) continue;

		using += 1;
		if (ownedHere.length > 0) {
			diverged += 1;
			if (projects.length < USAGE_PROJECT_CAP) {
				let storyboard: Record<string, unknown> = {};
				try {
					storyboard = row.storyboard_json
						? (JSON.parse(row.storyboard_json) as Record<string, unknown>)
						: {};
				} catch {
					storyboard = {};
				}
				let brief: Record<string, unknown> = {};
				try {
					brief = row.brief_json ? (JSON.parse(row.brief_json) as Record<string, unknown>) : {};
				} catch {
					brief = {};
				}
				const sorted = ownedHere.sort();
				projects.push({
					id: row.id,
					title: row.title,
					diverged: sorted,
					divergedDetails: sorted.map((path) => ({
						path,
						...valueAtPath(path, state as Record<string, unknown>, storyboard, brief, preset),
					})),
				});
			}
		}
	}

	return { using, diverged, projects };
}
