/* Storyboard retention — the bound, what it never drops, and how a dropped
 * version reads. Each test names the requirement it pins. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { pipelineArtifactKinds, writeArtifact } from "@maleo/shared";
import { openTestDb, type TestDb } from "../../src/db/handle-testing.ts";
import type { Db } from "../../src/db/handle.ts";
import { createContentProject } from "../../src/db/project-detail.ts";
import { addContentStoryboard, readStoryboardVersion } from "../../src/db/storyboards.ts";
import { createContentProjectOutput } from "../../src/db/outputs.ts";
import { addContentRender } from "../../src/db/renders.ts";
import {
	DEFAULT_STORYBOARD_RETENTION_WINDOW,
	planStoryboardPrune,
	prunableStoryboardIds,
	storyboardRetentionPolicy,
	STORYBOARD_RETENTION_WINDOW_ENV,
	type RetentionRow,
} from "../../src/db/storyboard-retention.ts";

const WINDOW = 5;
const policy = { window: WINDOW };
let db: Db;
let t: TestDb;
let projectId: string;

beforeEach(async () => {
	t = await openTestDb("postgres");
	db = t.db;
	const created = await createContentProject({ title: "Retention", type: "video" }, db);
	if (!created) throw new Error("project not created");
	projectId = created.project.id;
});
afterEach(() => t.close());

const clipsOnly = { schemaVersion: 2, clips: [], markers: [] };
const artifact = (kind: string, payload: unknown) =>
	writeArtifact(pipelineArtifactKinds, [], {
		kind,
		payload,
		producer: { type: "editor" },
		projectId: "p",
	}).artifact;
const plan = artifact("story_plan", { targetSec: 60, sections: [] });
const research = artifact("research_bundle", { topic: "t", sources: [], claimCount: 0 });
const withArtifacts = (...artifacts: unknown[]) => ({ ...clipsOnly, artifacts });

async function write(json: Record<string, unknown> = clipsOnly, status?: string) {
	const row = await addContentStoryboard(
		{ project_id: projectId, storyboard_json: json, ...(status ? { status } : {}) },
		db,
		policy,
	);
	if (!row) throw new Error("write failed");
	return row;
}
async function writeMany(n: number, json: Record<string, unknown> = clipsOnly) {
	for (let i = 0; i < n; i++) await write(json);
}
const versions = async () =>
	(
		await db.all<{ version: number }>(
			`SELECT version FROM content_storyboards WHERE project_id = ? ORDER BY version`,
			[projectId],
		)
	).map((r) => r.version);
const present = async (id: string) =>
	(await db.get(`SELECT 1 FROM content_storyboards WHERE id = ?`, [id])) !== null;

/** Make every `event` on content_storyboards fail with `message`. */
async function refuse(event: "INSERT" | "DELETE", message: string): Promise<void> {
	await db.exec(`
		CREATE FUNCTION refuse_${event.toLowerCase()}() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION '${message}'; END $$;
		CREATE TRIGGER fail_${event.toLowerCase()} BEFORE ${event} ON content_storyboards
		FOR EACH ROW EXECUTE FUNCTION refuse_${event.toLowerCase()}();
	`);
}

describe("policy configuration", () => {
	test("defaults to a twenty-version window", () => {
		expect(DEFAULT_STORYBOARD_RETENTION_WINDOW).toBe(20);
		expect(storyboardRetentionPolicy({})).toEqual({ window: 20 });
	});

	test("an override sets the window, and `off` disables pruning", () => {
		expect(storyboardRetentionPolicy({ [STORYBOARD_RETENTION_WINDOW_ENV]: "50" })).toEqual({
			window: 50,
		});
		expect(storyboardRetentionPolicy({ [STORYBOARD_RETENTION_WINDOW_ENV]: "off" })).toEqual({
			window: null,
		});
	});

	test("a malformed value is an error, not a silent fallback", () => {
		for (const bad of ["0", "-3", "2.5", "twenty"]) {
			expect(() => storyboardRetentionPolicy({ [STORYBOARD_RETENTION_WINDOW_ENV]: bad })).toThrow(
				STORYBOARD_RETENTION_WINDOW_ENV,
			);
		}
	});

	test("with pruning off, every version is kept", async () => {
		for (let i = 0; i < 12; i++)
			await addContentStoryboard({ project_id: projectId, storyboard_json: clipsOnly }, db, {
				window: null,
			});
		expect(await versions()).toHaveLength(12);
	});
});

describe("the policy decides by meaning, not only by count", () => {
	const row = (version: number, over: Partial<RetentionRow> = {}): RetentionRow => ({
		id: `v${version}`,
		version,
		status: "draft",
		referenced: false,
		...over,
	});
	const none = () => [] as const;

	test("within the window nothing is prunable", async () => {
		expect(await prunableStoryboardIds([row(3), row(2), row(1)], 3, none)).toEqual([]);
	});

	test("beyond the window, only unpinned versions are prunable", async () => {
		const rows = [
			row(6),
			row(5),
			row(4, { status: "approved" }),
			row(3, { status: "rendered" }),
			row(2, { referenced: true }),
			row(1),
		];
		expect(await prunableStoryboardIds(rows, 2, none)).toEqual(["v1"]);
	});

	test("the newest carrier of each artifact kind is kept; superseded carriers are not", async () => {
		const kinds: Record<string, Array<"story_plan" | "media">> = {
			v3: ["media"],
			v2: ["story_plan", "media"],
			v1: ["story_plan"],
		};
		const rows = [row(4), row(3), row(2), row(1)];
		expect(await prunableStoryboardIds(rows, 1, (r) => kinds[r.id] ?? [])).toEqual(["v1"]);
	});
});

describe("pruning on write", () => {
	test("the bound holds throughout a long run, not only after it", async () => {
		for (let i = 1; i <= 300; i++) {
			await write();
			expect((await versions()).length).toBe(Math.min(i, WINDOW));
		}
		expect(await versions()).toEqual([296, 297, 298, 299, 300]);
	});

	test("a pruned number is never reused", async () => {
		await writeMany(WINDOW * 3);
		const highest = Math.max(...(await versions()));
		const next = await write();
		expect(next.version).toBe(highest + 1);
		expect(await versions()).not.toContain(1);
	});

	test("a failed insert prunes nothing", async () => {
		await writeMany(WINDOW);
		const before = await versions();
		await refuse("INSERT", "insert refused");
		await expect(write()).rejects.toThrow("insert refused");
		expect(await versions()).toEqual(before);
	});

	test("a prune that fails takes the insert down with it", async () => {
		await writeMany(WINDOW);
		const before = await versions();
		await refuse("DELETE", "prune refused");
		await expect(write()).rejects.toThrow("prune refused");
		expect(await versions()).toEqual(before);
	});
});

describe("every retained category survives a run far beyond the window", () => {
	const RUN = WINDOW * 40;

	test("the current version", async () => {
		await writeMany(RUN);
		const current = await write();
		expect(await present(current.id)).toBe(true);
		expect(Math.max(...(await versions()))).toBe(current.version);
	});

	test("an approved version", async () => {
		const approved = await write(clipsOnly, "approved");
		await writeMany(RUN);
		expect(await present(approved.id)).toBe(true);
	});

	test("a rendered version", async () => {
		const rendered = await write(clipsOnly, "rendered");
		await writeMany(RUN);
		expect(await present(rendered.id)).toBe(true);
	});

	test("a version an output points at, and the reference still resolves", async () => {
		const target = await write();
		const output = await createContentProjectOutput(
			{ project_id: projectId, storyboard_id: target.id, title: "Cut" },
			db,
		);
		await writeMany(RUN);
		const resolved = await db.get(
			`SELECT s.id FROM content_project_outputs o JOIN content_storyboards s ON s.id = o.storyboard_id WHERE o.id = ?`,
			[output!.id],
		);
		expect(resolved).toEqual({ id: target.id });
	});

	test("a version a render record points at, and the reference still resolves", async () => {
		const target = await write();
		const render = await addContentRender(
			{ project_id: projectId, storyboard_id: target.id, status: "done" },
			db,
		);
		await writeMany(RUN);
		const resolved = await db.get(
			`SELECT s.id FROM content_renders r JOIN content_storyboards s ON s.id = r.storyboard_id WHERE r.id = ?`,
			[render!.id],
		);
		expect(resolved).toEqual({ id: target.id });
	});

	test("the newest carrier of each seedable artifact kind, behind a run of clip-only autosaves", async () => {
		const older = await write(withArtifacts(plan));
		const carrier = await write(withArtifacts(plan, research));
		await writeMany(RUN);
		expect(await present(carrier.id)).toBe(true);
		expect(await present(older.id)).toBe(false);
	});

	test("a plan that does not parse does not supersede the seedable plan behind it", async () => {
		const seedable = await write(withArtifacts(plan));
		await write(withArtifacts({ ...plan, payload: { plan: {} } }));
		await writeMany(RUN);
		expect(await present(seedable.id)).toBe(true);
	});

	test("an unparseable document carries nothing and is pruned like any other", async () => {
		const broken = await write();
		await db.run(`UPDATE content_storyboards SET storyboard_json = '{not json' WHERE id = ?`, [
			broken.id,
		]);
		await writeMany(RUN);
		expect(await present(broken.id)).toBe(false);
	});
});

describe("reading a version by number", () => {
	test("a retained version is returned as itself", async () => {
		const row = await write();
		const read = await readStoryboardVersion(projectId, row.version, db);
		expect(read.state).toBe("found");
		if (read.state === "found") expect(read.row.id).toBe(row.id);
	});

	test("a pruned version reads as pruned, with no substitute document", async () => {
		await writeMany(WINDOW * 2);
		expect(await readStoryboardVersion(projectId, 1, db)).toEqual({ state: "pruned", version: 1 });
	});

	test("a version never issued reads as never existed, distinct from pruned", async () => {
		await writeMany(WINDOW * 2);
		expect(await readStoryboardVersion(projectId, 999, db)).toEqual({
			state: "never_existed",
			version: 999,
		});
		expect(await readStoryboardVersion(projectId, 0, db)).toEqual({
			state: "never_existed",
			version: 0,
		});
		expect(await readStoryboardVersion("no-such-project", 1, db)).toEqual({
			state: "never_existed",
			version: 1,
		});
	});

	test("a failed read is reported as a failure, not as absence", async () => {
		await write();
		await t.close();
		const read = await readStoryboardVersion(projectId, 1, db);
		expect(read.state).toBe("read_failed");
	});
});

describe("planning a prune reports without removing", () => {
	test("the plan names rows and bytes and changes nothing", async () => {
		for (let i = 0; i < 12; i++)
			await addContentStoryboard({ project_id: projectId, storyboard_json: clipsOnly }, db, {
				window: null,
			});
		const plan = await planStoryboardPrune(db, projectId, WINDOW);
		expect(plan.ids).toHaveLength(12 - WINDOW);
		expect(plan.bytes).toBe((12 - WINDOW) * JSON.stringify(clipsOnly).length);
		expect(await versions()).toHaveLength(12);
	});
});
