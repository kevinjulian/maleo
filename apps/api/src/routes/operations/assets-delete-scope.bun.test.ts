/* Deleting a reference removes it from ONE workspace.
 *
 * `deleteContentAssetReference` expands the id it is given across `id`,
 * `source_ref`, `item_id` and `meta_json.id`, then deletes everything matching
 * any of them. None of those are unique across tenants: a workspace collection
 * item is identified by a short id, and two workspaces can hold items sharing
 * one. Unscoped, deleting veronika's reference deleted kunti's too, and the
 * suppression that follows then hid it for every workspace — with a 200 and a
 * `deleted_ids` list that named the shared id, so nothing looked wrong.
 *
 * Driven through the route because the workspace has to arrive from the
 * resolver; the accessor accepting a workspace it is never passed would be the
 * same bug with a wider signature. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { closeMaleoDb } from "@maleo/db/connection";
import { listContentAssets, listSuppressedAssetRefs, upsertContentAsset } from "@maleo/db/assets";
import { scaffoldWorkspace } from "../../lib/workspace/scaffold.ts";
import { workspaceScope } from "../../lib/active-workspace.ts";
import { registerAssetRoutes } from "./assets.ts";
import { installTestCaller } from "../../middleware/auth-testing.ts";

const priorDbPath = process.env.MALEO_DB_PATH;
const priorDataDir = process.env.MALEO_DATA_DIR;
let dataDir = "";

/** The same logical item id in two workspaces — the collision the bug needed. */
const SHARED_REF = "6e030e3f";

function app(): Hono {
	const instance = new Hono();
	instance.use("*", installTestCaller());
	instance.use("*", workspaceScope());
	registerAssetRoutes(instance);
	return instance;
}

async function seed(workspace: string): Promise<void> {
	await upsertContentAsset({
		scope: "workspace",
		workspace,
		kind: "character",
		label: `${workspace} portrait`,
		tags: ["character"],
		seed: 1,
		default: false,
		src: `/api/workspaces/${workspace}/collections/characters/items/${SHARED_REF}/sheets/a.png`,
		source_type: "workspace_collection",
		source_ref: `${workspace}:characters:${SHARED_REF}`,
		collection: "characters",
		item_id: SHARED_REF,
		meta_json: { id: SHARED_REF },
	});
}

async function countFor(workspace: string): Promise<number> {
	return (await listContentAssets({ workspace, limit: 100 })).length;
}

beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "maleo-asset-delete-"));
	process.env.MALEO_DATA_DIR = dataDir;
	process.env.MALEO_DB_PATH = join(dataDir, "test.db");
	await closeMaleoDb();
	await scaffoldWorkspace("ws-a");
	await scaffoldWorkspace("ws-b");
	await seed("ws-a");
	await seed("ws-b");
});

afterEach(async () => {
	await closeMaleoDb();
	rmSync(dataDir, { recursive: true, force: true });
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	// Restored, never deleted — see scripts/test-db-guard.ts.
	if (priorDataDir !== undefined) process.env.MALEO_DATA_DIR = priorDataDir;
});

describe("DELETE /assets/:refId", () => {
	test("deletes from the active workspace only", async () => {
		expect(await countFor("ws-a")).toBe(1);
		expect(await countFor("ws-b")).toBe(1);

		const res = await app().request(`/assets/${SHARED_REF}?workspace=ws-a`, { method: "DELETE" });

		expect(res.status).toBe(200);
		expect(await countFor("ws-a")).toBe(0);
		// The assertion the bug failed: before this fix both went to 0.
		expect(await countFor("ws-b")).toBe(1);
	});

	test("suppression does not hide the other workspace's copy", async () => {
		await app().request(`/assets/${SHARED_REF}?workspace=ws-a`, { method: "DELETE" });

		expect((await listSuppressedAssetRefs("ws-a")).has(SHARED_REF)).toBe(true);
		// Suppression is what makes a workspace-collection deletion stick across
		// the catalogue's re-import from disk. Global, it made ws-a's deletion
		// re-hide ws-b's item on the next catalogue read even after the row
		// survived the DELETE above.
		expect((await listSuppressedAssetRefs("ws-b")).has(SHARED_REF)).toBe(false);
	});

	test("each workspace can delete its own copy of a shared id", async () => {
		// Two suppressions of one ref. Keyed on the ref alone, the second hit
		// ON CONFLICT DO NOTHING and was silently dropped.
		await app().request(`/assets/${SHARED_REF}?workspace=ws-a`, { method: "DELETE" });
		await app().request(`/assets/${SHARED_REF}?workspace=ws-b`, { method: "DELETE" });

		expect(await countFor("ws-a")).toBe(0);
		expect(await countFor("ws-b")).toBe(0);
		expect((await listSuppressedAssetRefs("ws-a")).has(SHARED_REF)).toBe(true);
		expect((await listSuppressedAssetRefs("ws-b")).has(SHARED_REF)).toBe(true);
	});

	test("an unregistered workspace is refused before anything is deleted", async () => {
		const res = await app().request(`/assets/${SHARED_REF}?workspace=__codex_unknown_ws__`, {
			method: "DELETE",
		});

		expect(res.status).toBe(400);
		expect(await countFor("ws-a")).toBe(1);
		expect(await countFor("ws-b")).toBe(1);
	});
});
