/* The registry's editable fields.
 *
 * `upsertWorkspace` is the sync's entry point and `updateWorkspace` is the
 * operator's. They must not be the same function: a sync that ran on every boot
 * and carried no description would erase one every time the process restarted,
 * and the erasure would look like the operator's own text never having saved. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openTestDb, type TestDb } from "./handle-testing.ts";
import type { Db } from "./handle.ts";
import { getWorkspace, listWorkspaces, updateWorkspace, upsertWorkspace } from "./workspaces.ts";

let db: Db;
let t: TestDb;

const seed = async (name: string): Promise<void> => {
	await upsertWorkspace({ name, workspace_dir: `/tmp/${name}` }, db);
};

beforeEach(async () => {
	t = await openTestDb("postgres");
	db = t.db;
});
afterEach(() => t.close());

describe("a workspace's description", () => {
	test("is absent until someone writes it", async () => {
		await seed("alpha");

		expect((await getWorkspace("alpha", db))?.description).toBeNull();
	});

	test("is stored and read back", async () => {
		await seed("alpha");

		await updateWorkspace("alpha", { description: "Client work for the autumn campaign." }, db);

		expect((await getWorkspace("alpha", db))?.description).toBe(
			"Client work for the autumn campaign.",
		);
	});

	test("appears in the listing", async () => {
		await seed("alpha");
		await updateWorkspace("alpha", { description: "Described." }, db);

		expect((await listWorkspaces(db)).find((w) => w.name === "alpha")?.description).toBe(
			"Described.",
		);
	});

	test("a derived tagline does not become a description", async () => {
		// What the registry sync writes: branding is derived from a name hash, so
		// a tagline arrives without anyone typing one. The description must not
		// follow it, or every workspace would ship prose nobody wrote.
		await upsertWorkspace(
			{
				name: "alpha",
				workspace_dir: "/tmp/alpha",
				branding: { tagline: "Derived from a hash", initials: "AL" },
			},
			db,
		);

		const row = await getWorkspace("alpha", db);
		expect(row?.tagline).toBe("Derived from a hash");
		expect(row?.description).toBeNull();
	});

	test("can be cleared by writing null", async () => {
		await seed("alpha");
		await updateWorkspace("alpha", { description: "Temporary." }, db);

		await updateWorkspace("alpha", { description: null }, db);

		expect((await getWorkspace("alpha", db))?.description).toBeNull();
	});

	test("whitespace alone is stored as absent, not as a blank string", async () => {
		await seed("alpha");

		await updateWorkspace("alpha", { description: "   " }, db);

		expect((await getWorkspace("alpha", db))?.description).toBeNull();
	});
});

describe("renaming a workspace", () => {
	test("changes the display name", async () => {
		await seed("alpha");

		await updateWorkspace("alpha", { display_name: "Autumn Campaign" }, db);

		expect((await getWorkspace("alpha", db))?.display_name).toBe("Autumn Campaign");
	});

	test("does not move the partition key", async () => {
		await seed("alpha");

		await updateWorkspace("alpha", { display_name: "Something Else" }, db);

		// The key nineteen tables are partitioned by is untouched. A rename that
		// moved it would be a migration across the whole database.
		expect((await getWorkspace("alpha", db))?.name).toBe("alpha");
		expect(await getWorkspace("Something Else", db)).toBeNull();
	});

	test("an empty display name keeps the current one rather than blanking it", async () => {
		await seed("alpha");
		await updateWorkspace("alpha", { display_name: "Named" }, db);

		await updateWorkspace("alpha", { display_name: "  " }, db);

		expect((await getWorkspace("alpha", db))?.display_name).toBe("Named");
	});
});

describe("the two write paths stay separate", () => {
	test("a registry sync does not erase a description", async () => {
		await seed("alpha");
		await updateWorkspace("alpha", { description: "Written by the owner." }, db);

		// What syncWorkspaceRegistry does on every boot.
		await upsertWorkspace(
			{
				name: "alpha",
				workspace_dir: "/tmp/alpha",
				last_synced_at: Date.now(),
			},
			db,
		);

		expect((await getWorkspace("alpha", db))?.description).toBe("Written by the owner.");
	});

	test("editing one field leaves the other alone", async () => {
		await seed("alpha");
		await updateWorkspace("alpha", { display_name: "Named", description: "Described." }, db);

		await updateWorkspace("alpha", { display_name: "Renamed" }, db);

		expect((await getWorkspace("alpha", db))?.description).toBe("Described.");
	});

	test("updating a workspace that does not exist reports it rather than creating one", async () => {
		expect(await updateWorkspace("ghost", { display_name: "Ghost" }, db)).toBeNull();
		expect(await getWorkspace("ghost", db)).toBeNull();
	});
});
