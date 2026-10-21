#!/usr/bin/env bun
/* Export the editor compatibility corpus from the development database.
 *
 *   bun --env-file .env scripts/export-editor-corpus.ts
 *
 * For each project's latest storyboard it builds the editing scope exactly as
 * the editor does on load (`parseLoadedProject`, then the document fields the
 * store is seeded with), sanitizes it (`packages/shared/src/editor/corpus/
 * sanitize.ts`) and writes it to `packages/shared/src/editor/corpus/scopes/`.
 * Chat, decisions and other editor state are never read into the output.
 *
 * Re-running replaces the directory, so the corpus is always one export. It
 * prints which compatibility features the corpus covers; a feature no real
 * project uses yet stays covered by the hand-written golden fixtures. */
import { readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeMaleoDb, openDb } from "../packages/db/src/db/connection.ts";
import {
	parseLoadedProject,
	type LoadedProjectDetail,
} from "../apps/web/src/models/storyboard/parse-loaded-project.ts";
import {
	corpusToken,
	sanitizeCorpusValue,
	vocabularyOf,
} from "../packages/shared/src/editor/corpus/sanitize.ts";
import type { EditScope } from "../packages/shared/src/editor/scope.ts";

const ROOT = join(import.meta.dirname, "..");
const SHARED_SRC = join(ROOT, "packages/shared/src");
const OUT = join(SHARED_SRC, "editor/corpus/scopes");

/* What an authored feature looks like in a scope, for the coverage report. */
const FEATURES: Record<string, (json: string) => boolean> = {
	markers: (j) => /"markers":\[\{/.test(j),
	bookmarks: (j) => /"bookmarks":\[\{/.test(j),
	chapters: (j) => /"chapters":\[\{/.test(j),
	captions: (j) => j.includes('"captions":{'),
	materials: (j) => j.includes('"materials":{'),
	projectReferences: (j) => j.includes('"projectReferences":{'),
	trackFlags: (j) => /"trackFlags":\{"/.test(j),
	retiming: (j) => /"playbackRate":(?!1[,}])/.test(j) || j.includes('"reverse":true'),
	keyframes: (j) => j.includes('"animation":{'),
	reveals: (j) => /"reveal/i.test(j),
	compositing: (j) => /"(blendMode|masks|opacity)":/.test(j),
	slides: (j) => /"slides":\[\{/.test(j),
	posts: (j) => /"posts":\[\{/.test(j),
	mediaAssets: (j) => /"mediaAssets":\[\{/.test(j),
};

function sourcesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourcesUnder(path);
		return entry.name.endsWith(".ts") && !entry.name.includes(".test.")
			? [readFileSync(path, "utf8")]
			: [];
	});
}

const parseJson = (value: unknown): unknown =>
	typeof value === "string" ? JSON.parse(value) : (value ?? null);

const db = openDb();
try {
	const projects = await db.all<{
		id: string;
		title: string;
		type: string;
		target_audience: string | null;
		target_duration_sec: number | null;
		target_format: string | null;
		target_platform: string | null;
		brief_json: unknown;
		editor_state_json: unknown;
	}>(
		`SELECT id, title, type, target_audience, target_duration_sec, target_format, target_platform, brief_json, editor_state_json FROM content_projects ORDER BY id`,
	);
	const vocabulary = vocabularyOf(sourcesUnder(SHARED_SRC));
	rmSync(OUT, { recursive: true, force: true });
	mkdirSync(OUT, { recursive: true });
	const covered = new Map<string, number>();
	let written = 0;
	for (const project of projects) {
		const latest = await db.all<{ storyboard_json: unknown }>(
			`SELECT storyboard_json FROM content_storyboards WHERE project_id = $1 ORDER BY version DESC, created_at DESC LIMIT 1`,
			[project.id],
		);
		/* SAFETY: the rows are the same columns the API route serializes into a
		 * `LoadedProjectDetail` (JSON columns parsed above); `parseLoadedProject`
		 * reads them tolerantly and `entities` is optional. */
		const detail = {
			project: {
				...project,
				brief_json: parseJson(project.brief_json),
				editor_state_json: parseJson(project.editor_state_json),
			},
			storyboards: latest.map((row) => ({ storyboard_json: parseJson(row.storyboard_json) })),
		} as LoadedProjectDetail;
		const parsed = parseLoadedProject(detail);
		/* The document fields `create-content.tsx` seeds the store with on load. */
		const scope: EditScope = {
			mediaAssets: parsed.mediaAssets,
			doc: {
				schemaVersion: 2,
				clips: parsed.clips,
				markers: parsed.markers,
				chapters: parsed.chapters,
				bookmarks: parsed.bookmarks,
				projectReferences: parsed.projectReferences,
				materials: parsed.materials,
				captions: parsed.captions,
				trackFlags: parsed.trackFlags,
			},
			slides: parsed.slides,
			posts: parsed.posts,
		};
		const clean = JSON.stringify(
			sanitizeCorpusValue(JSON.parse(JSON.stringify(scope)), vocabulary),
		);
		for (const [name, has] of Object.entries(FEATURES))
			if (has(clean)) covered.set(name, (covered.get(name) ?? 0) + 1);
		writeFileSync(
			join(OUT, `${project.type}-${corpusToken(project.id)}.json`),
			`${JSON.stringify(JSON.parse(clean), null, "\t")}\n`,
		);
		written++;
	}
	console.log(`wrote ${written} scope(s) to ${OUT}`);
	for (const name of Object.keys(FEATURES))
		console.log(
			`  ${(covered.get(name) ?? 0) > 0 ? "covered" : "MISSING"}  ${name} (${covered.get(name) ?? 0})`,
		);
} finally {
	await closeMaleoDb();
}
