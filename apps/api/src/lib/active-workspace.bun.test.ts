/* One resolution point, validated.
 *
 * The behaviour under test is the refusal. A resolver that fell back to
 * `default` on an unrecognised name would pass every "the app is scoped" test
 * while showing an operator another tenant's work, so the unregistered case is
 * asserted as an error rather than as an absence. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { closeMaleoDb } from "@maleo/db/connection";
import { scaffoldWorkspace } from "./workspace/scaffold.ts";
import { ensureDefaultWorkspace, syncWorkspaceRegistry } from "./workspace/registry.ts";
import {
	ABSENT_WORKSPACE_RESOLVES_TO,
	activeWorkspace,
	workspaceScope,
} from "./active-workspace.ts";
import { installTestCaller } from "../middleware/auth-testing.ts";

const priorDbPath = process.env.MALEO_DB_PATH;
const priorDataDir = process.env.MALEO_DATA_DIR;
let dataDir = "";

beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "maleo-active-workspace-"));
	process.env.MALEO_DATA_DIR = dataDir;
	process.env.MALEO_DB_PATH = join(dataDir, "test.db");
	await closeMaleoDb();
	await ensureDefaultWorkspace();
	await syncWorkspaceRegistry();
});

afterEach(async () => {
	await closeMaleoDb();
	rmSync(dataDir, { recursive: true, force: true });
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	// Restored, never deleted: MALEO_DATA_DIR is the floor that keeps a suite
	// which clears MALEO_DB_PATH off the real database. See
	// scripts/test-db-guard.ts.
	if (priorDataDir !== undefined) process.env.MALEO_DATA_DIR = priorDataDir;
});

function app(): Hono {
	const instance = new Hono();
	instance.use("*", installTestCaller());
	instance.use("*", workspaceScope());
	instance.get("/probe", (c) => c.json({ workspace: activeWorkspace(c) }));
	return instance;
}

describe("resolving the active workspace", () => {
	test("a registered workspace resolves to itself", async () => {
		await scaffoldWorkspace("veronika");

		const res = await app().request("/probe?workspace=veronika");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ workspace: "veronika" });
	});

	test("an unregistered workspace is refused, not served default's data", async () => {
		const res = await app().request("/probe?workspace=veronikaa");

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "unknown_workspace", workspace: "veronikaa" });
	});

	test("no workspace named resolves the same way every time", async () => {
		// API startup reconciliation registers `default`, so absence resolves.
		const res = await app().request("/probe");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ workspace: ABSENT_WORKSPACE_RESOLVES_TO });
	});

	test("an empty workspace parameter is the absent case, not an unknown one", async () => {
		const res = await app().request("/probe?workspace=%20");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ workspace: ABSENT_WORKSPACE_RESOLVES_TO });
	});
});
