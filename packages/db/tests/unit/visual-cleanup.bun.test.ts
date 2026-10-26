import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openTestDb, type TestDb } from "../../src/db/handle-testing.ts";
import type { Db } from "../../src/db/handle.ts";
import { createContentProject } from "../../src/db/project-detail.ts";
import { addContentStoryboard } from "../../src/db/storyboards.ts";
import {
	commandEntriesBetween,
	headCommandSeq,
	visualCleanupSeq,
} from "../../src/db/project-commands.ts";
import {
	cleanContentProjectVisuals,
	cleanContentVisuals,
	cleanContentVisualTemplates,
} from "../../src/db/visual-cleanup.ts";
import { registerMediaObject } from "../../src/db/media-objects.ts";
import { randomUUID } from "node:crypto";
import { createTestDatabase } from "../../src/db/pg-testing.ts";
import { pgDb } from "../../src/db/handle.ts";
import {
	assertVisualContractReady,
	VISUAL_CONTRACT_SETTING,
} from "../../src/db/visual-contract.ts";
import { setGlobalSetting } from "../../src/db/global-settings.ts";
import {
	createContentClipTemplate,
	updateContentClipTemplate,
} from "../../src/db/clip-templates.ts";
import { clipTemplateInputSchema } from "@maleo/shared";

let t: TestDb;
let projectId: string;
const text = (id: number, preset: string) => ({
	id: `text:${id}`,
	type: "text",
	startSec: id * 5,
	durationSec: 2,
	track: 0,
	text: { id, content: "", preset, start: id * 5, dur: 2 },
});
const document = { schemaVersion: 2, clips: [text(1, "title"), text(2, "plain")], markers: [] };
beforeEach(async () => {
	t = await openTestDb("postgres");
	projectId = (await createContentProject({ title: "Visual cleanup", type: "video" }, t.db))!
		.project.id;
	await addContentStoryboard(
		{ project_id: projectId, storyboard_json: { ...document, clips: [document.clips[1]] } },
		t.db,
	);
	// Historical data predates the write guard; only test setup writes it raw.
	await t.db.run("UPDATE content_storyboards SET storyboard_json = ? WHERE project_id = ?", [
		JSON.stringify(document),
		projectId,
	]);
});
afterEach(() => t.close());

const heads = (db: Db) =>
	db.all<{ version: number; storyboard_json: string }>(
		"SELECT version, storyboard_json FROM content_storyboards WHERE project_id = ? ORDER BY version",
		[projectId],
	);
const seedTemplate = (db: Db, id: string, kind: string, base: string, config: unknown) =>
	db.run(
		"INSERT INTO content_clip_templates (id, kind, label, intent, category, base, config_json, created_at, updated_at) VALUES (?, ?, ?, '', 'text', ?, ?, 10, 20)",
		[id, kind, id, base, JSON.stringify(config)],
	);
const layer = {
	preset: "shape-rect",
	content: "",
	relStart: 4,
	dur: 2,
	track: 3,
	params: { fill: "transparent", opacity: 0 },
};
const retired = { ...layer, preset: "title", relStart: 0 };

describe("authoritative visual cleanup", () => {
	test("ordinary project/import/template writes reject retired IDs before any partial write", async () => {
		const before = await heads(t.db);
		await expect(
			addContentStoryboard({ project_id: projectId, storyboard_json: document }, t.db),
		).rejects.toThrow("Retired visual presets");
		expect(await heads(t.db)).toEqual(before);
		const projects = await t.db.all("SELECT id FROM content_projects");
		await expect(
			createContentProject(
				{ title: "Invalid import", type: "video", seed_storyboard: { storyboard_json: document } },
				t.db,
			),
		).rejects.toThrow("Retired visual presets");
		expect(await t.db.all("SELECT id FROM content_projects")).toEqual(projects);
		const valid = clipTemplateInputSchema.parse({
			kind: "text",
			label: "Text",
			category: "text",
			base: "plain",
			config: {},
		});
		const created = await createContentClipTemplate(valid, t.db);
		const rows = await t.db.all("SELECT * FROM content_clip_templates");
		const invalid = JSON.parse(JSON.stringify({ ...valid, base: "title" }));
		await expect(createContentClipTemplate(invalid, t.db)).rejects.toThrow(
			"Unsupported visual primitive",
		);
		await expect(updateContentClipTemplate(created.id, invalid, t.db)).rejects.toThrow(
			"Unsupported visual primitive",
		);
		expect(await t.db.all("SELECT * FROM content_clip_templates")).toEqual(rows);
	});
	test("interrupted cleanup blocks runtime readiness until all remaining heads succeed", async () => {
		await setGlobalSetting(VISUAL_CONTRACT_SETTING, null, t.db);
		await expect(assertVisualContractReady(t.db)).rejects.toThrow("migration is incomplete");
		await cleanContentProjectVisuals(projectId, true, t.db);
		const first = await heads(t.db);
		const other = (await createContentProject({ title: "Needs repair", type: "video" }, t.db))
			.project.id;
		await addContentStoryboard(
			{ project_id: other, storyboard_json: { schemaVersion: 2, clips: [] } },
			t.db,
		);
		await t.db.run("UPDATE content_storyboards SET storyboard_json = ? WHERE project_id = ?", [
			JSON.stringify({ schemaVersion: 2, clips: [text(3, "unknown")] }),
			other,
		]);
		await expect(cleanContentVisuals(true, t.db)).rejects.toThrow("unknown visual preset");
		await expect(assertVisualContractReady(t.db)).rejects.toThrow("migration is incomplete");
		await t.db.run("UPDATE content_storyboards SET storyboard_json = ? WHERE project_id = ?", [
			JSON.stringify({ schemaVersion: 2, clips: [text(3, "title")] }),
			other,
		]);
		expect((await cleanContentVisuals(true, t.db)).changedProjects).toBe(1);
		await assertVisualContractReady(t.db);
		expect(await heads(t.db)).toEqual(first);
		expect((await cleanContentVisuals(true, t.db)).changedProjects).toBe(0);
	});
	test("dry-run writes nothing; apply writes one version and durable snapshot boundary", async () => {
		const original = await heads(t.db);
		expect((await cleanContentProjectVisuals(projectId, false, t.db)).counts.removedClips).toBe(1);
		expect(await heads(t.db)).toEqual(original);
		expect(await headCommandSeq(t.db, projectId)).toBe(1);
		await cleanContentProjectVisuals(projectId, true, t.db);
		const versions = await heads(t.db);
		expect(versions).toHaveLength(2);
		expect(versions[0]).toEqual(original[0]);
		expect(JSON.parse(versions[1]!.storyboard_json).clips).toEqual([document.clips[1]]);
		expect(await visualCleanupSeq(projectId, t.db)).toBe(2);
		expect(await commandEntriesBetween(projectId, 0, 2, t.db)).toBeNull();
		const entry = await t.db.get<{ command_json: string }>(
			"SELECT command_json FROM content_project_commands WHERE project_id = ? AND seq = 2",
			[projectId],
		);
		const command = JSON.parse(entry!.command_json);
		expect(command.type).toBe("scope.replace");
		expect(command.scope.doc.clips.map((c: { id: string }) => c.id)).toEqual(["text:2"]);
		expect((await cleanContentProjectVisuals(projectId, true, t.db)).changed).toBe(false);
		expect(await heads(t.db)).toEqual(versions);
		expect(await headCommandSeq(t.db, projectId)).toBe(2);
	});

	test("transaction failure rolls back version, log and cleanup boundary", async () => {
		const original = await heads(t.db);
		const failing: Db = {
			...t.db,
			transaction: (fn) =>
				t.db.transaction((tx) =>
					fn({
						...tx,
						run: async (sql, params) => {
							if (sql.startsWith("UPDATE content_projects SET visual_cleanup_seq"))
								throw new Error("injected rollback");
							return tx.run(sql, params);
						},
					}),
				),
		};
		await expect(cleanContentProjectVisuals(projectId, true, failing)).rejects.toThrow(
			"injected rollback",
		);
		expect(await heads(t.db)).toEqual(original);
		expect(await headCommandSeq(t.db, projectId)).toBe(1);
		expect(await visualCleanupSeq(projectId, t.db)).toBe(0);
	});

	test("library cleanup is transactional, dry-run is read-only, counts repeat empty and media survives", async () => {
		await seedTemplate(t.db, "mixed", "composition", "composition", {
			overlays: [retired, layer],
			spanSec: 10,
		});
		await seedTemplate(t.db, "empty", "composition", "composition", {
			overlays: [retired],
			spanSec: 10,
		});
		await seedTemplate(t.db, "retired", "text", "title", {});
		await seedTemplate(t.db, "retained", "text", "plain", {});
		await registerMediaObject(
			{
				workspace: "default",
				kind: "image",
				hash: "a".repeat(64),
				storage_key: `workspaces/default/image/${randomUUID()}-title.png`,
				content_type: "image/png",
				size: 5,
			},
			t.db,
		);
		const media = await t.db.all("SELECT * FROM media_objects");
		const before = await t.db.all("SELECT * FROM content_clip_templates ORDER BY id");
		const report = {
			changedTemplates: 3,
			removedTemplates: 2,
			removedLayers: 2,
			changedProjects: 1,
			removedClips: 1,
		};
		const dry = await t.db.transaction(async (tx) => {
			await tx.exec("SET TRANSACTION READ ONLY");
			return cleanContentVisuals(false, tx);
		});
		expect(dry).toEqual(report);
		expect(await t.db.all("SELECT * FROM content_clip_templates ORDER BY id")).toEqual(before);
		expect(await cleanContentVisuals(true, t.db)).toEqual(report);
		const kept = await t.db.all<{
			id: string;
			config_json: string;
			created_at: number;
			updated_at: number;
		}>("SELECT * FROM content_clip_templates ORDER BY id");
		expect(kept.map((row) => row.id)).toEqual(["mixed", "retained"]);
		expect(JSON.parse(kept[0]!.config_json)).toEqual({
			schemaVersion: 1,
			overlays: [layer],
			spanSec: 10,
		});
		expect(kept[0]!.created_at).toBe(10);
		expect(kept[0]!.updated_at).toBe(20);
		expect(await t.db.all("SELECT * FROM media_objects")).toEqual(media);
		expect(await cleanContentVisuals(true, t.db)).toEqual({
			changedTemplates: 0,
			removedTemplates: 0,
			removedLayers: 0,
			changedProjects: 0,
			removedClips: 0,
		});
	});

	test("a malformed later library row rolls back earlier deletes", async () => {
		await seedTemplate(t.db, "a", "text", "title", {});
		await seedTemplate(t.db, "z", "text", "unknown", {});
		await expect(cleanContentVisualTemplates(true, t.db)).rejects.toThrow("template.base");
		expect(await t.db.all("SELECT id FROM content_clip_templates")).toHaveLength(2);
	});

	test("maintenance CLI executes dry-run and apply against throwaway data", async () => {
		const isolated = await createTestDatabase();
		try {
			const db = pgDb(isolated.sql);
			await setGlobalSetting(VISUAL_CONTRACT_SETTING, null, db);
			const start = Bun.spawn(
				[
					process.execPath,
					"-e",
					`import { databaseReady } from ${JSON.stringify(new URL("../../src/db/connection.ts", import.meta.url).pathname)}; await databaseReady();`,
				],
				{
					env: { ...process.env, MALEO_DATABASE_URL: isolated.url },
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const startupError = await new Response(start.stderr).text();
			expect(await start.exited).not.toBe(0);
			expect(startupError).toContain("Visual preset migration is incomplete");
			await seedTemplate(db, "old", "text", "title", {});
			const run = async (apply: boolean) => {
				const proc = Bun.spawn(
					[
						process.execPath,
						new URL("../../../../scripts/cleanup-visual-presets.ts", import.meta.url).pathname,
						...(apply ? ["--apply"] : []),
					],
					{
						env: { ...process.env, MALEO_DATABASE_URL: isolated.url },
						stdout: "pipe",
						stderr: "pipe",
					},
				);
				const [stdout, stderr, exit] = await Promise.all([
					new Response(proc.stdout).text(),
					new Response(proc.stderr).text(),
					proc.exited,
				]);
				expect(stderr).toBe("");
				expect(exit).toBe(0);
				return JSON.parse(stdout);
			};
			expect((await run(false)).removedTemplates).toBe(1);
			expect(await db.all("SELECT id FROM content_clip_templates")).toHaveLength(1);
			expect((await run(true)).removedTemplates).toBe(1);
			expect(await db.all("SELECT id FROM content_clip_templates")).toHaveLength(0);
			expect((await run(true)).removedTemplates).toBe(0);
		} finally {
			await isolated.drop();
		}
	});
});
