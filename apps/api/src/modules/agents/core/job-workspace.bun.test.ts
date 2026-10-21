/* A run knows whose workspace it spends in.
 *
 * `AgentJob` carried no workspace, so every agent generation landed on the credit
 * ledger's default scope (`workspace/local`) no matter which workspace's project
 * it belonged to, and the workspace's own generation quota never saw it. The
 * project row has always known the answer. */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { startAgentJob } from "./run-bracket.ts";
import { clearAgentJobsForTests } from "./session-store.ts";

const testDbDir = join(tmpdir(), `maleo-job-workspace-${randomUUID().slice(0, 8)}`);
const testDbPath = join(testDbDir, "maleo.db");

describe("an agent job carries the project's workspace", () => {
	beforeEach(async () => {
		process.env.MALEO_DB_PATH = testDbPath;
		mkdirSync(dirname(testDbPath), { recursive: true });
		await closeMaleoDb();
		for (const suffix of ["", "-shm", "-wal"]) rmSync(`${testDbPath}${suffix}`, { force: true });
		openDb();
		clearAgentJobsForTests();
	});

	afterEach(async () => {
		clearAgentJobsForTests();
		await closeMaleoDb();
		delete process.env.MALEO_DB_PATH;
		if (existsSync(testDbDir)) rmSync(testDbDir, { recursive: true, force: true });
	});

	it("reads the workspace off the project row", async () => {
		const created = await createContentProject({ title: "Scoped", type: "video" });
		if (!created) throw new Error("project not created");

		const job = await startAgentJob({ projectId: created.project.id, instruction: "draft it" });

		expect(job.workspace).toBe(created.project.workspace);
		expect(job.workspace).toBeTruthy();
	});

	it("tolerates a project that has gone missing", async () => {
		// A run started against a deleted project must not throw on the way to
		// failing; it simply has no workspace to bill.
		const job = await startAgentJob({ projectId: "does-not-exist", instruction: "draft it" });

		expect(job.workspace).toBeUndefined();
	});
});
