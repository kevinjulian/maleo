import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("an existing jobs database acquires nullable poster metadata without rewriting jobs", async () => {
	const root = await mkdtemp(join(tmpdir(), "maleo-poster-migrate-"));
	const file = join(root, "jobs.db");
	try {
		const db = new Database(file);
		db.exec(
			"CREATE TABLE render_jobs(id TEXT PRIMARY KEY, product_json TEXT, preset TEXT, status TEXT, input_hash TEXT, created_at INTEGER); INSERT INTO render_jobs VALUES('old','{}','wide','done',NULL,1)",
		);
		db.close();
		const child = Bun.spawn(
			[
				process.execPath,
				"-e",
				'const {getJob} = await import("./src/db.ts"); console.log(JSON.stringify(getJob("old")))',
			],
			{
				cwd: join(import.meta.dir, ".."),
				env: { ...process.env, MALEO_VIDEO_DB: file },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const body = await new Response(child.stdout).text();
		expect(await child.exited).toBe(0);
		expect(JSON.parse(body)).toMatchObject({ id: "old", status: "done", thumbnail_storage: null });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
