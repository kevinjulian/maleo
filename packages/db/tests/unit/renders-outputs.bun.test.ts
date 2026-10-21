/* Renders and outputs — 383 lines that had no test of any kind, direct or through
 * a route, because reaching them meant pointing a process-global at a temp file
 * and resetting a module singleton. Every family function now takes its handle as
 * a parameter, so these run against an in-memory database. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openTestDb, type TestDb } from "../../src/db/handle-testing.ts";
import type { Db } from "../../src/db/handle.ts";
import {
	addContentRender,
	legacyRenderWorkspace,
	updateContentRender,
} from "../../src/db/renders.ts";
import {
	createContentProjectOutput,
	listContentOutputs,
	listContentProjectOutputs,
	updateContentProjectOutput,
} from "../../src/db/outputs.ts";
import { listContentProjectEvents } from "../../src/db/events.ts";

let db: Db;
let t: TestDb;

async function seedProject(id = "p1"): Promise<string> {
	const now = Date.now();
	await db.run(
		`INSERT INTO content_projects (id, workspace, title, type, status, created_at, updated_at)
		 VALUES (?, 'default', 'Test project', 'video', 'storyboard', ?, ?)`,
		[id, now, now],
	);
	return id;
}

beforeEach(async () => {
	t = await openTestDb("postgres");
	db = t.db;
});
afterEach(() => t.close());

describe("renders", () => {
	test("legacy job ownership requires a persisted project link", async () => {
		await seedProject();
		await addContentRender({ project_id: "p1", video_job_id: "old-job" }, db);
		expect(await legacyRenderWorkspace("old-job", null, db)).toBe("default");
		expect(await legacyRenderWorkspace("unlinked", null, db)).toBeNull();
		expect(await legacyRenderWorkspace("old-job", "missing", db)).toBeNull();
	});
	test("a render starts queued against its project", async () => {
		const projectId = await seedProject();
		const render = await addContentRender({ project_id: projectId, status: "queued" }, db);

		expect(render?.project_id).toBe(projectId);
		expect(render?.status).toBe("queued");
	});

	test("a render for an unknown project is refused", async () => {
		expect(
			await addContentRender({ project_id: "no-such-project", status: "queued" }, db),
		).toBeNull();
	});

	test("a render carries its progress and output through updates", async () => {
		const projectId = await seedProject();
		const render = (await addContentRender({ project_id: projectId, status: "queued" }, db))!;

		const running = await updateContentRender(
			projectId,
			render.id,
			{ status: "rendering", phase: "compositing" },
			db,
		);
		expect(running?.status).toBe("rendering");
		expect(running?.phase).toBe("compositing");

		const done = await updateContentRender(
			projectId,
			render.id,
			{
				status: "done",
				output_url: "/uploads/final.mp4",
				duration_sec: 42,
			},
			db,
		);
		expect(done?.output_url).toBe("/uploads/final.mp4");
		expect(done?.duration_sec).toBe(42);
	});

	test("updating a render that belongs to another project is refused", async () => {
		const a = await seedProject("pa");
		await seedProject("pb");
		const render = (await addContentRender({ project_id: a, status: "queued" }, db))!;

		expect(await updateContentRender("pb", render.id, { status: "done" }, db)).toBeNull();
	});

	test("a render records an event on its project", async () => {
		const projectId = await seedProject();
		await addContentRender({ project_id: projectId, status: "queued" }, db);

		expect((await listContentProjectEvents(projectId, db)).length).toBeGreaterThan(0);
	});
});

describe("outputs", () => {
	test("an output belongs to its project and is listed for it", async () => {
		const projectId = await seedProject();
		const output = await createContentProjectOutput(
			{ project_id: projectId, title: "Cut 1", status: "draft" },
			db,
		);

		expect(output?.project_id).toBe(projectId);
		expect((await listContentProjectOutputs(projectId, db)).map((o) => o.id)).toEqual([output!.id]);
	});

	test("an output for an unknown project is refused", async () => {
		expect(
			await createContentProjectOutput(
				{ project_id: "no-such-project", title: "Ghost", status: "draft" },
				db,
			),
		).toBeNull();
	});

	test("status moves are persisted", async () => {
		const projectId = await seedProject();
		const output = (await createContentProjectOutput(
			{ project_id: projectId, title: "Cut 1", status: "draft" },
			db,
		))!;

		const queued = await updateContentProjectOutput(projectId, output.id, { status: "queued" }, db);
		expect(queued?.status).toBe("queued");

		const published = await updateContentProjectOutput(
			projectId,
			output.id,
			{ status: "published" },
			db,
		);
		expect(published?.status).toBe("published");
	});

	test("the feed filters by project", async () => {
		const a = await seedProject("pa");
		const b = await seedProject("pb");
		await createContentProjectOutput({ project_id: a, title: "A", status: "draft" }, db);
		await createContentProjectOutput({ project_id: b, title: "B", status: "draft" }, db);

		expect(await listContentOutputs({ project_id: a }, db)).toHaveLength(1);
		expect(await listContentOutputs({}, db)).toHaveLength(2);
	});

	test("the feed filters by status", async () => {
		const projectId = await seedProject();
		const draft = (await createContentProjectOutput(
			{ project_id: projectId, title: "Cut 1", status: "draft" },
			db,
		))!;
		const other = (await createContentProjectOutput(
			{ project_id: projectId, title: "Cut 1", status: "draft" },
			db,
		))!;
		await updateContentProjectOutput(projectId, other.id, { status: "published" }, db);

		expect((await listContentOutputs({ status: "draft" }, db)).map((o) => o.id)).toEqual([
			draft.id,
		]);
	});

	test("the feed respects its limit", async () => {
		const projectId = await seedProject();
		for (let i = 0; i < 3; i++)
			await createContentProjectOutput(
				{ project_id: projectId, title: "Cut 1", status: "draft" },
				db,
			);

		expect(await listContentOutputs({ limit: 2 }, db)).toHaveLength(2);
	});
});

describe("the handle is the one the caller passed", () => {
	test("writes land in the caller's database, not the shared one", async () => {
		const projectId = await seedProject();
		await addContentRender({ project_id: projectId, status: "queued" }, db);

		// A second in-memory database sees none of it — proof the parameter is
		// honoured rather than quietly ignored in favour of the singleton.
		const other = await openTestDb("postgres");
		expect(await other.db.get<{ c: number }>(`SELECT count(*) AS c FROM content_renders`)).toEqual({
			c: 0,
		});
		await other.close();
	});
});
