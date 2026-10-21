/* Rows commit before files are touched.
 *
 * The assertion that matters is the negative one: when the row transaction
 * fails, every file is still there. A deletion that removed media first and
 * then failed to commit would leave a workspace that reads as healthy in every
 * query and renders broken on every screen — and nothing would report it. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { getWorkspace, upsertWorkspace } from "@maleo/db/workspaces";
import { addWorkspaceMember } from "@maleo/db/workspace-members";
import { deleteWorkspace, FinalWorkspaceError } from "./delete.ts";

const priorDbPath = process.env.MALEO_DB_PATH;
const priorDataDir = process.env.MALEO_DATA_DIR;
let dataDir = "";
let uploadsDir = "";

/** A file under public/uploads, which is where resolveUploadFilePath looks. */
function upload(name: string): string {
	const path = join(uploadsDir, name);
	writeFileSync(path, "bytes");
	return path;
}

async function seed(ws: string, opts: { assetSrc?: string } = {}): Promise<string> {
	const dir = join(dataDir, "workspaces", ws);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "config.yaml"), "name: " + ws);
	await upsertWorkspace({ name: ws, workspace_dir: dir });
	await addWorkspaceMember({ workspace: ws, user_id: "u1", role: "owner" });
	if (opts.assetSrc) {
		await openDb().run(
			`INSERT INTO content_assets (id, workspace, kind, label, src, created_at, updated_at)
			 VALUES (?, ?, 'image', 'a', ?, ?, ?)`,
			[`ast-${ws}`, ws, opts.assetSrc, Date.now(), Date.now()],
		);
	}
	return dir;
}

beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "maleo-ws-delete-"));
	process.env.MALEO_DATA_DIR = dataDir;
	process.env.MALEO_DB_PATH = join(dataDir, "test.db");
	await closeMaleoDb();
	// resolveUploadFilePath resolves "public/uploads" relative to the process
	// working directory first, so the test writes where it will actually look.
	uploadsDir = join(process.cwd(), "public", "uploads");
	mkdirSync(uploadsDir, { recursive: true });
	// A deployment always keeps one workspace; this one outlives each deletion.
	await upsertWorkspace({ name: "keeper", workspace_dir: join(dataDir, "workspaces", "keeper") });
});

afterEach(async () => {
	await closeMaleoDb();
	rmSync(dataDir, { recursive: true, force: true });
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	// Restored, never deleted — see scripts/test-db-guard.ts.
	if (priorDataDir !== undefined) process.env.MALEO_DATA_DIR = priorDataDir;
});

describe("deleting a workspace removes its files", () => {
	test("an uploaded file the workspace referenced is removed", async () => {
		const name = `ws-delete-${Date.now()}.png`;
		const path = upload(name);
		await seed("alpha", { assetSrc: `/uploads/${name}` });

		const report = await deleteWorkspace("alpha");

		expect(existsSync(path)).toBe(false);
		expect(report.filesRemoved).toBe(1);
	});

	test("the workspace directory is removed", async () => {
		const dir = await seed("alpha");

		const report = await deleteWorkspace("alpha");

		expect(existsSync(dir)).toBe(false);
		expect(report.directoryRemoved).toBe(true);
	});

	test("the rows are gone as well as the files", async () => {
		await seed("alpha");

		await deleteWorkspace("alpha");

		expect(await getWorkspace("alpha")).toBeNull();
	});
});

describe("files nobody gave us are left alone", () => {
	test("a reference to another server is not followed", async () => {
		await seed("alpha", { assetSrc: "https://images.example.com/not-ours.png" });

		const report = await deleteWorkspace("alpha");

		// Nothing to remove, and nothing attempted: it was never our file.
		expect(report.filesRemoved).toBe(0);
	});

	test("a traversal in a stored path resolves to nothing", async () => {
		const outside = join(dataDir, "outside.txt");
		writeFileSync(outside, "keep me");
		await seed("alpha", { assetSrc: "/uploads/../../../outside.txt" });

		await deleteWorkspace("alpha");

		// resolveUploadFilePath refuses separators and `..`, which is what stops a
		// poisoned column turning a workspace deletion into an arbitrary unlink.
		expect(existsSync(outside)).toBe(true);
	});

	test("another workspace's file survives", async () => {
		const keep = `ws-keep-${Date.now()}.png`;
		const keepPath = upload(keep);
		await seed("alpha");
		await seed("beta", { assetSrc: `/uploads/${keep}` });

		await deleteWorkspace("alpha");

		expect(existsSync(keepPath)).toBe(true);
		rmSync(keepPath, { force: true });
	});
});

describe("nothing is deleted before the rows commit", () => {
	test("a failing row transaction leaves every file in place", async () => {
		const name = `ws-fail-${Date.now()}.png`;
		const path = upload(name);
		const dir = await seed("alpha", { assetSrc: `/uploads/${name}` });

		/* Force the transaction to fail the way a real one would. The trigger
		 * aborts the final statement — removing the registry row — so the deletes
		 * that already ran inside the transaction are rolled back with it. Any
		 * failure inside the transaction is equivalent for this assertion; this
		 * one is simply the easiest to aim. */
		await openDb().exec(
			`CREATE FUNCTION refuse_workspace_delete() RETURNS trigger LANGUAGE plpgsql AS $$
			 BEGIN RAISE EXCEPTION 'injected failure'; END $$;
			 CREATE TRIGGER block_workspace_delete BEFORE DELETE ON workspaces
			 FOR EACH ROW EXECUTE FUNCTION refuse_workspace_delete();`,
		);

		await expect(deleteWorkspace("alpha")).rejects.toThrow();

		// The file and the directory are untouched, because the code never got
		// past the commit point.
		expect(existsSync(path)).toBe(true);
		expect(existsSync(dir)).toBe(true);
		// And the workspace is still there, which is what "rolled back" means.
		expect(await getWorkspace("alpha")).not.toBeNull();

		rmSync(path, { force: true });
	});
});

describe("in-flight runs are cancelled before the rows go", () => {
	test("a running run is found and cancelled", async () => {
		await seed("alpha");
		const db = openDb();
		const now = Date.now();
		await db.run(
			`INSERT INTO content_projects (id, workspace, title, type, status, created_at, updated_at)
			 VALUES ('p1', 'alpha', 'Work', 'video', 'draft', ?, ?)`,
			[now, now],
		);
		await db.run(
			`INSERT INTO workflow_run (id, project_id, content_type, status, created_at, updated_at)
			 VALUES ('wr1', 'p1', 'video', 'running', ?, ?)`,
			[now, now],
		);

		const report = await deleteWorkspace("alpha");

		/* This count IS the ordering proof. The runs are read by joining through
		 * content_projects — rows the deletion removes. A non-zero count can only
		 * mean the read happened before the delete; had the emit come after, there
		 * would have been nothing left to find and this would be 0. */
		expect(report.runsCancelled).toBe(1);
	});

	test("a finished run is not cancelled", async () => {
		await seed("alpha");
		const db = openDb();
		const now = Date.now();
		await db.run(
			`INSERT INTO content_projects (id, workspace, title, type, status, created_at, updated_at)
			 VALUES ('p1', 'alpha', 'Work', 'video', 'draft', ?, ?)`,
			[now, now],
		);
		await db.run(
			`INSERT INTO workflow_run (id, project_id, content_type, status, created_at, updated_at)
			 VALUES ('wr1', 'p1', 'video', 'done', ?, ?)`,
			[now, now],
		);

		const report = await deleteWorkspace("alpha");

		expect(report.runsCancelled).toBe(0);
	});

	test("an unreachable job queue does not stop the deletion", async () => {
		// inngest.send throws here — nothing is listening in a unit test. The
		// operator asked for this workspace to be gone, and an unavailable queue
		// is not a reason to keep their data.
		await seed("alpha");
		const db = openDb();
		const now = Date.now();
		await db.run(
			`INSERT INTO content_projects (id, workspace, title, type, status, created_at, updated_at)
			 VALUES ('p1', 'alpha', 'Work', 'video', 'draft', ?, ?)`,
			[now, now],
		);
		await db.run(
			`INSERT INTO workflow_run (id, project_id, content_type, status, created_at, updated_at)
			 VALUES ('wr1', 'p1', 'video', 'running', ?, ?)`,
			[now, now],
		);

		await deleteWorkspace("alpha");

		expect(await getWorkspace("alpha")).toBeNull();
	});
});

describe("deleting what is not there", () => {
	test("an unknown workspace is not an error", async () => {
		const report = await deleteWorkspace("ghost");

		expect(report.filesRemoved).toBe(0);
		expect(report.directoryRemoved).toBe(false);
	});
});

describe("the deployment keeps a workspace", () => {
	test("the final workspace is refused and left intact", async () => {
		await seed("alpha");
		await deleteWorkspace("keeper");
		await expect(deleteWorkspace("alpha")).rejects.toBeInstanceOf(FinalWorkspaceError);
		expect(await getWorkspace("alpha")).not.toBeNull();
	});

	test("concurrent deletions of the last two workspaces leave one", async () => {
		await seed("alpha");
		await seed("beta");
		await deleteWorkspace("keeper");
		const results = await Promise.allSettled([deleteWorkspace("alpha"), deleteWorkspace("beta")]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const rejected = results.find((r) => r.status === "rejected");
		expect(rejected && rejected.status === "rejected" ? rejected.reason : null).toBeInstanceOf(
			FinalWorkspaceError,
		);
		expect((await openDb().get<{ c: number }>(`SELECT count(*) AS c FROM workspaces`))?.c).toBe(1);
	});
});
