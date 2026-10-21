/* A workspace's configuration document, stored as a row. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openTestDb, type TestDb } from "../../src/db/handle-testing.ts";
import { getWorkspaceConfigText, putWorkspaceConfigText } from "../../src/db/workspace-config.ts";
import { upsertWorkspace } from "../../src/db/workspaces.ts";
import { deleteWorkspaceRows } from "../../src/db/workspace-delete.ts";

let t: TestDb;
beforeEach(async () => {
	t = await openTestDb("postgres");
});
afterEach(() => t.close());

describe("workspace configuration rows", () => {
	test("a workspace with no stored configuration reads as absent", async () => {
		expect(await getWorkspaceConfigText("nope", t.db)).toBeNull();
	});

	test("the document is stored and read back verbatim, comments included", async () => {
		const text = "# owner notes\nname: acme\nimage_policy:\n  daily_limit: 5 # kept low\n";
		await putWorkspaceConfigText("acme", text, t.db);
		expect(await getWorkspaceConfigText("acme", t.db)).toBe(text);
	});

	test("a second write replaces the first", async () => {
		await putWorkspaceConfigText("acme", "name: acme\n", t.db);
		await putWorkspaceConfigText("acme", "name: acme\nwriter_style: plain\n", t.db);
		expect(await getWorkspaceConfigText("acme", t.db)).toBe("name: acme\nwriter_style: plain\n");
	});

	test("deleting the workspace deletes its configuration", async () => {
		await upsertWorkspace({ name: "acme", workspace_dir: "/tmp/acme" }, t.db);
		await putWorkspaceConfigText("acme", "name: acme\n", t.db);
		await deleteWorkspaceRows("acme", t.db);
		expect(await getWorkspaceConfigText("acme", t.db)).toBeNull();
	});
});
