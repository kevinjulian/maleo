/* The image routes refuse an unregistered workspace, like the operations routes do.
 *
 * They could not use the `workspaceScope()` middleware — `/generate` takes its
 * tenant from the BODY, and the reads accept an absent workspace as "every
 * workspace" rather than defaulting it — so they validated nothing at all. That
 * split produced two different answers to the same typo:
 *
 *   /api/operations/content/feed?workspace=nope  -> 400 unknown_workspace
 *   /api/image-gen/images?workspace=nope         -> 200 { items: [] }
 *
 * The 200 is the dangerous one. Empty is a truthful answer for most workspaces,
 * so a gallery showing nothing for a misspelled tenant is indistinguishable from
 * a gallery showing nothing because that tenant owns nothing. On `/generate` it
 * was worse than misleading: the job metered and recorded under a workspace no
 * switcher can select and no report can group by. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { scaffoldWorkspace } from "../lib/workspace/scaffold.ts";
import { imageGenRoutes } from "./image-gen.ts";
import { testApp } from "../middleware/auth-testing.ts";

const priorDbPath = process.env.MALEO_DB_PATH;
const priorDataDir = process.env.MALEO_DATA_DIR;
let dataDir = "";

const json = { "content-type": "application/json" };

beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "maleo-imagegen-ws-"));
	process.env.MALEO_DATA_DIR = dataDir;
	process.env.MALEO_DB_PATH = join(dataDir, "test.db");
	await closeMaleoDb();
	await scaffoldWorkspace("veronika");
});

afterEach(async () => {
	await closeMaleoDb();
	rmSync(dataDir, { recursive: true, force: true });
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	// Restored, never deleted — see scripts/test-db-guard.ts.
	if (priorDataDir !== undefined) process.env.MALEO_DATA_DIR = priorDataDir;
});

describe("GET /images", () => {
	test("refuses an unregistered workspace instead of returning an empty gallery", async () => {
		const res = await testApp(imageGenRoutes()).request("/images?workspace=__codex_unknown_ws__");

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: "unknown_workspace",
			workspace: "__codex_unknown_ws__",
		});
	});

	test("serves a registered workspace", async () => {
		const res = await testApp(imageGenRoutes()).request("/images?workspace=veronika");

		expect(res.status).toBe(200);
	});

	test("an absent workspace still reads across every workspace", async () => {
		// Unchanged on purpose: this route's contract is "unless narrowed". Only a
		// NAMED workspace that does not exist is an error.
		const res = await testApp(imageGenRoutes()).request("/images");

		expect(res.status).toBe(200);
	});
});

describe("GET /images/facets", () => {
	test("refuses an unregistered workspace", async () => {
		const res = await testApp(imageGenRoutes()).request(
			"/images/facets?workspace=__codex_unknown_ws__",
		);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: "unknown_workspace",
			workspace: "__codex_unknown_ws__",
		});
	});

	test("serves a registered workspace", async () => {
		expect(
			(await testApp(imageGenRoutes()).request("/images/facets?workspace=veronika")).status,
		).toBe(200);
	});
});

describe("POST /generate", () => {
	test("refuses an unregistered workspace before metering it", async () => {
		const res = await testApp(imageGenRoutes()).request("/generate", {
			method: "POST",
			headers: json,
			body: JSON.stringify({ prompt: "a cat", workspace: "__codex_unknown_ws__" }),
		});

		// 400, not a 5xx from a failed upstream call: the refusal has to land
		// BEFORE meter() reserves credits, or the spend is booked against a tenant
		// that does not exist.
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: "unknown_workspace",
			workspace: "__codex_unknown_ws__",
		});
	});

	test("still refuses a missing workspace with its own error", async () => {
		const res = await testApp(imageGenRoutes()).request("/generate", {
			method: "POST",
			headers: json,
			body: JSON.stringify({ prompt: "a cat" }),
		});

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "workspace_required" });
	});
});
