import { beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applyUnifiedSchema } from "../packages/db/src/db/unified-schema.ts";
import { createContentProject } from "../packages/db/src/db/project-detail.ts";
import { addContentStoryboard } from "../packages/db/src/db/storyboards.ts";
import { reclaimStoryboardHistory } from "./reclaim-storyboard-history.ts";
import { sqliteDb } from "../packages/db/src/db/handle.ts";

const WINDOW = 3;
const doc = { schemaVersion: 2, clips: [], markers: [] };
let db: Database;
let projects: string[];

/* History written before retention existed: pruning off. */
beforeEach(async () => {
	db = new Database(":memory:");
	applyUnifiedSchema(db);
	projects = [];
	for (const [i, versions] of [30, 12, 2].entries()) {
		const id = (await createContentProject({ title: `P${i}`, type: "video" }, sqliteDb(db)))!
			.project.id;
		for (let v = 0; v < versions; v++)
			await addContentStoryboard({ project_id: id, storyboard_json: doc }, sqliteDb(db), {
				window: null,
			});
		projects.push(id);
	}
});

const count = (projectId: string) =>
	db
		.query<{ n: number }, [string]>(
			`SELECT COUNT(*) AS n FROM content_storyboards WHERE project_id = ?`,
		)
		.get(projectId)!.n;

test("a dry run reports rows and bytes per project and removes nothing", async () => {
	const report = await reclaimStoryboardHistory({ db, window: WINDOW, apply: false });
	expect(report.projects.map((p) => [p.projectId, p.prunable])).toEqual([
		[projects[0], 27],
		[projects[1], 9],
	]);
	expect(report.prunableBytes).toBe(36 * JSON.stringify(doc).length);
	expect(report.deletedRows).toBe(0);
	expect(projects.map(count)).toEqual([30, 12, 2]);
});

test("an interrupted apply leaves the database consistent, and a re-run completes it", async () => {
	let committed = 0;
	let batches = 0;
	await expect(
		reclaimStoryboardHistory({
			db,
			window: WINDOW,
			apply: true,
			batchSize: 5,
			onBatch: (deleted) => {
				committed = deleted;
				if (++batches === 2) throw new Error("interrupted");
			},
		}),
	).rejects.toThrow("interrupted");
	// Exactly the committed batches are gone; which project they came from follows id order.
	expect(committed).toBeGreaterThan(0);
	expect(projects.map(count).reduce((a, b) => a + b)).toBe(44 - committed);

	const rerun = await reclaimStoryboardHistory({ db, window: WINDOW, apply: true, batchSize: 5 });
	expect(rerun.deletedRows).toBe(36 - committed);
	expect(projects.map(count)).toEqual([WINDOW, WINDOW, 2]);
	const newest = db
		.query<{ v: number }, [string]>(
			`SELECT MAX(version) AS v FROM content_storyboards WHERE project_id = ?`,
		)
		.get(projects[0]!)!.v;
	expect(newest).toBe(30);

	expect((await reclaimStoryboardHistory({ db, window: WINDOW, apply: true })).deletedRows).toBe(0);
});
