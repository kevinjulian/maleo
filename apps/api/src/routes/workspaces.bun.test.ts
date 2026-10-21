/* The registry an operator chooses their scope from.
 *
 * Driven through the real route because the switcher's whole job depends on the
 * response SHAPE — a bare name per row is what the previous caller expected, and
 * it carries neither the branding the chip renders nor the counts that tell an
 * operator which workspaces hold work before entering one. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorkspaceSummary } from "@maleo/shared";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { scaffoldWorkspace } from "../lib/workspace/scaffold.ts";
import { getWorkspaceConfigText } from "@maleo/db/workspace-config";
import { workspacesRoutes } from "./workspaces.ts";
import { addWorkspaceMember, isWorkspaceMember } from "@maleo/db/workspace-members";
import { pruneMembershipsOutsideRegistry } from "@maleo/db/workspace-members";
import { getWorkspace } from "@maleo/db/workspaces";
import { testApp } from "../middleware/auth-testing.ts";
import type { Caller } from "@maleo/auth/session";

const priorDbPath = process.env.MALEO_DB_PATH;
const priorDataDir = process.env.MALEO_DATA_DIR;
let dataDir = "";

const json = { "content-type": "application/json" };

beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "maleo-workspaces-route-"));
	process.env.MALEO_DATA_DIR = dataDir;
	process.env.MALEO_DB_PATH = join(dataDir, "test.db");
	await closeMaleoDb();
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

async function list(): Promise<WorkspaceSummary[]> {
	const res = await testApp(workspacesRoutes()).request("/");
	expect(res.status).toBe(200);
	return ((await res.json()) as { items: WorkspaceSummary[] }).items;
}

/* `async` rather than a bare `return`: Hono's `request()` is typed
 * `Response | Promise<Response>`, which does not satisfy a `Promise<Response>`
 * annotation on its own. Awaiting inside normalises it. */
async function create(name: unknown): Promise<Response> {
	return await testApp(workspacesRoutes()).request("/", {
		method: "POST",
		headers: json,
		body: JSON.stringify({ name }),
	});
}

describe("GET /workspaces", () => {
	test("carries the branding a chooser renders, not a bare name", async () => {
		await scaffoldWorkspace("veronika");

		// `default` is registered by openMaleoDb's reconciliation, so the list is
		// never just the workspaces this test made.
		const row = (await list()).find((w) => w.name === "veronika");

		expect(row?.name).toBe("veronika");
		expect(row?.display_name).toBe("veronika");
		expect(row?.status).toBe("active");
		// Derived from the name hash, so a workspace created today looks right with
		// no config: the chip must never have to invent a colour.
		expect(row?.color).toMatch(/^#[0-9a-f]{6}$/);
		expect(row?.color_bright).toMatch(/^#[0-9a-f]{6}$/);
		expect(row?.color_deep).toMatch(/^#[0-9a-f]{6}$/);
		expect(row?.initials).toBe("VE");
		expect(row?.tagline).toBe("workspace");
	});

	test("counts what each workspace holds, so an empty one is expected before entering it", async () => {
		await scaffoldWorkspace("busy");
		await scaffoldWorkspace("empty");
		await createContentProject({ title: "One", workspace: "busy" });
		await createContentProject({ title: "Two", workspace: "busy" });

		const byName = Object.fromEntries((await list()).map((w) => [w.name, w.project_count]));

		expect(byName.busy).toBe(2);
		// Absent from the GROUP BY, not missing from the response.
		expect(byName.empty).toBe(0);
	});
});

describe("POST /workspaces", () => {
	test("creates a workspace that is usable, not just listed", async () => {
		const res = await create("newroom");

		expect(res.status).toBe(201);
		expect(((await res.json()) as { item: WorkspaceSummary }).item.name).toBe("newroom");
		// A registry row alone is selectable and then fails on first read. Its
		// configuration row is what makes it a created workspace — and no
		// configuration file is written anywhere.
		expect(await getWorkspaceConfigText("newroom")).toContain("name: newroom");
		expect(await Bun.file(join(dataDir, "workspaces", "newroom", "config.yaml")).exists()).toBe(
			false,
		);
		expect((await list()).map((w) => w.name)).toContain("newroom");
	});

	test("a creation whose configuration write fails leaves no workspace behind", async () => {
		await openDb().exec(`
			CREATE FUNCTION refuse_config() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN RAISE EXCEPTION 'config write refused'; END $$;
			CREATE TRIGGER refuse_config BEFORE INSERT ON workspace_config FOR EACH ROW EXECUTE FUNCTION refuse_config();
		`);
		const res = await create("halfroom");

		expect(res.status).toBe(500);
		expect(await getWorkspace("halfroom")).toBeNull();
		expect(await getWorkspaceConfigText("halfroom")).toBeNull();
		expect((await list()).map((w) => w.name)).not.toContain("halfroom");
	});

	test("a new workspace starts empty", async () => {
		await create("newroom");

		expect((await list()).find((w) => w.name === "newroom")?.project_count).toBe(0);
	});

	test("a duplicate is refused", async () => {
		await create("newroom");

		const res = await create("newroom");

		expect(res.status).toBe(409);
		expect(((await res.json()) as { error: string }).error).toBe("workspace_exists");
	});

	test("an invalid name is refused rather than escaping the workspaces dir", async () => {
		for (const name of ["../escape", "has space", "with/slash"]) {
			const res = await create(name);
			expect(res.status).toBe(400);
			expect(((await res.json()) as { error: string }).error).toBe("invalid_workspace_name");
		}
	});

	test("a missing name is refused", async () => {
		const res = await create(undefined);

		expect(res.status).toBe(400);
	});
});

describe("the switcher lists only what the caller may act in", () => {
	const alice: Caller = { userId: "u-alice", email: "a@example.com", role: "member" };
	const bob: Caller = { userId: "u-bob", email: "b@example.com", role: "member" };

	const listAs = async (caller: Caller): Promise<WorkspaceSummary[]> => {
		const res = await testApp(workspacesRoutes(), caller).request("/");
		expect(res.status).toBe(200);
		return ((await res.json()) as { items: WorkspaceSummary[] }).items;
	};

	test("each account sees its own workspaces and no others", async () => {
		await scaffoldWorkspace("veronika");
		await scaffoldWorkspace("marcus");
		await addWorkspaceMember({ workspace: "veronika", user_id: alice.userId, role: "owner" });
		await addWorkspaceMember({ workspace: "marcus", user_id: bob.userId, role: "owner" });

		expect((await listAs(alice)).map((w) => w.name)).toEqual(["veronika"]);
		expect((await listAs(bob)).map((w) => w.name)).toEqual(["marcus"]);
	});

	test("an account with no memberships sees an empty registry, not every tenant", async () => {
		await scaffoldWorkspace("veronika");

		// The switcher must not double as a directory of the deployment.
		expect(await listAs(alice)).toEqual([]);
	});

	test("creating a workspace makes the creator its owner", async () => {
		const res = await testApp(workspacesRoutes(), alice).request("/", {
			method: "POST",
			headers: json,
			body: JSON.stringify({ name: "newroom" }),
		});
		expect(res.status).toBe(201);

		// Without the grant, a workspace vanishes the instant it is created:
		// the listing above is scoped to membership.
		expect((await listAs(alice)).map((w) => w.name)).toContain("newroom");
		expect(await listAs(bob)).toEqual([]);
	});
});

describe("one workspace, read and edited", () => {
	const owner: Caller = { userId: "u-owner", email: "o@example.com", role: "member" };
	const member: Caller = { userId: "u-member", email: "m@example.com", role: "member" };
	const outsider: Caller = { userId: "u-out", email: "x@example.com", role: "member" };

	const app = (caller: Caller) => testApp(workspacesRoutes(), caller);

	const seed = async (): Promise<void> => {
		await scaffoldWorkspace("veronika");
		await addWorkspaceMember({ workspace: "veronika", user_id: owner.userId, role: "owner" });
		await addWorkspaceMember({ workspace: "veronika", user_id: member.userId, role: "member" });
	};

	test("an owner reads it, description and their own role included", async () => {
		await seed();

		const res = await app(owner).request("/veronika");
		const body = (await res.json()) as {
			item: { description: string | null; viewer_role: string };
		};

		expect(res.status).toBe(200);
		expect(body.item.description).toBeNull();
		// The surface needs this to decide whether to render controls at all.
		expect(body.item.viewer_role).toBe("owner");
	});

	test("a member reads it, and is told they are a member", async () => {
		await seed();

		const body = (await (await app(member).request("/veronika")).json()) as {
			item: { viewer_role: string };
		};

		expect(body.item.viewer_role).toBe("member");
	});

	test("an outsider is told nothing, not even that it exists", async () => {
		await seed();

		const res = await app(outsider).request("/veronika");

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "unknown_workspace", workspace: "veronika" });
	});

	test("an owner edits the display name and the description", async () => {
		await seed();

		const res = await app(owner).request("/veronika", {
			method: "PATCH",
			headers: json,
			body: JSON.stringify({ display_name: "Veronika Co", description: "Autumn campaign." }),
		});
		const body = (await res.json()) as { item: { display_name: string; description: string } };

		expect(res.status).toBe(200);
		expect(body.item.display_name).toBe("Veronika Co");
		expect(body.item.description).toBe("Autumn campaign.");
	});

	test("a rename does not move the partition key", async () => {
		await seed();
		await createContentProject({ workspace: "veronika", title: "Work", type: "video" });

		await app(owner).request("/veronika", {
			method: "PATCH",
			headers: json,
			body: JSON.stringify({ display_name: "Renamed Entirely" }),
		});

		// Still reachable by its key, and its project is still attached to it.
		const body = (await (await app(owner).request("/veronika")).json()) as {
			item: { name: string; project_count: number };
		};
		expect(body.item.name).toBe("veronika");
		expect(body.item.project_count).toBe(1);
	});

	test("a member cannot edit, and is told why rather than lied to", async () => {
		await seed();

		const res = await app(member).request("/veronika", {
			method: "PATCH",
			headers: json,
			body: JSON.stringify({ display_name: "Nope" }),
		});

		// 403, not "unknown workspace": a member already knows it exists, so the
		// refusal can say what it is.
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ error: "not_workspace_owner" });
	});

	test("an outsider editing is refused as an unknown workspace", async () => {
		await seed();

		const res = await app(outsider).request("/veronika", {
			method: "PATCH",
			headers: json,
			body: JSON.stringify({ display_name: "Nope" }),
		});

		// The tenant list stays private: a non-member learns nothing.
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "unknown_workspace" });
	});

	test("an invalid body is refused rather than partially applied", async () => {
		await seed();

		const res = await app(owner).request("/veronika", {
			method: "PATCH",
			headers: json,
			body: JSON.stringify({ display_name: "" }),
		});

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "invalid_body" });
	});
});

describe("who is in a workspace", () => {
	const owner: Caller = { userId: "u-owner", email: "o@example.com", role: "member" };
	const mate: Caller = { userId: "u-mate", email: "m@example.com", role: "member" };
	const outsider: Caller = { userId: "u-out", email: "x@example.com", role: "member" };

	const app = (caller: Caller) => testApp(workspacesRoutes(), caller);

	const seed = async (): Promise<void> => {
		await scaffoldWorkspace("veronika");
		await addWorkspaceMember({ workspace: "veronika", user_id: owner.userId, role: "owner" });
		await addWorkspaceMember({ workspace: "veronika", user_id: mate.userId, role: "member" });
	};

	test("a member can see who else is in it", async () => {
		await seed();

		const res = await app(mate).request("/veronika/members");
		const body = (await res.json()) as {
			items: { user_id: string; is_you: boolean }[];
			viewer_role: string;
		};

		expect(res.status).toBe(200);
		expect(body.items.map((m) => m.user_id).sort()).toEqual(["u-mate", "u-owner"]);
		/* No auth tables in this suite, so no labels resolve — and the list still
		 * answers. Identifying people is display enrichment; who may act here is
		 * not, and one must not be able to break the other. */
		// So the surface can mark the current operator without guessing.
		expect(body.items.find((m) => m.user_id === "u-mate")?.is_you).toBe(true);
		expect(body.viewer_role).toBe("member");
	});

	test("pending invitations are shown to an owner only", async () => {
		await seed();
		await app(owner).request("/veronika/invitations", {
			method: "POST",
			headers: json,
			body: "{}",
		});

		const asOwner = (await (await app(owner).request("/veronika/members")).json()) as {
			invitations: unknown[];
		};
		const asMember = (await (await app(mate).request("/veronika/members")).json()) as {
			invitations: unknown[];
		};

		expect(asOwner.invitations).toHaveLength(1);
		// A pending invitation is an intention, not yet a fact about the workspace.
		expect(asMember.invitations).toEqual([]);
	});

	test("an outsider cannot list members", async () => {
		await seed();

		const res = await app(outsider).request("/veronika/members");

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "unknown_workspace" });
	});

	test("an owner removes a member", async () => {
		await seed();

		const res = await app(owner).request("/veronika/members/u-mate", { method: "DELETE" });

		expect(res.status).toBe(200);
		expect(await isWorkspaceMember("veronika", "u-mate")).toBe(false);
	});

	test("a member cannot remove anyone", async () => {
		await seed();

		const res = await app(mate).request("/veronika/members/u-owner", { method: "DELETE" });

		expect(res.status).toBe(403);
		expect(await isWorkspaceMember("veronika", "u-owner")).toBe(true);
	});

	test("removing the last owner is explained, not a crash", async () => {
		await seed();

		const res = await app(owner).request("/veronika/members/u-owner", { method: "DELETE" });

		// 409 with a sentence an operator can act on — the alternative was a 500
		// from an uncaught LastOwnerError.
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: string; message: string };
		expect(body.error).toBe("last_owner");
		expect(body.message).toMatch(/owner/i);
		expect(await isWorkspaceMember("veronika", "u-owner")).toBe(true);
	});

	test("an owner may leave once another owner exists", async () => {
		await seed();
		await addWorkspaceMember({ workspace: "veronika", user_id: "u-second", role: "owner" });

		const res = await app(owner).request("/veronika/members/u-owner", { method: "DELETE" });

		expect(res.status).toBe(200);
		expect(await isWorkspaceMember("veronika", "u-owner")).toBe(false);
	});

	test("removing the last plain member is allowed", async () => {
		await seed();

		// Recorded in design.md: a workspace with no members is unreachable but
		// revivable by an invitation; one with no OWNER is not administrable at all.
		const res = await app(owner).request("/veronika/members/u-mate", { method: "DELETE" });

		expect(res.status).toBe(200);
	});
});

describe("the danger zone", () => {
	const owner: Caller = { userId: "u-owner", email: "o@example.com", role: "member" };
	const mate: Caller = { userId: "u-mate", email: "m@example.com", role: "member" };

	const app = (caller: Caller) => testApp(workspacesRoutes(), caller);

	/** Two workspaces, because deleting your only one is refused. */
	const seed = async (): Promise<void> => {
		await scaffoldWorkspace("veronika");
		await scaffoldWorkspace("marcus");
		await addWorkspaceMember({ workspace: "veronika", user_id: owner.userId, role: "owner" });
		await addWorkspaceMember({ workspace: "marcus", user_id: owner.userId, role: "owner" });
		await addWorkspaceMember({ workspace: "veronika", user_id: mate.userId, role: "member" });
	};

	const del = (caller: Caller, name: string, confirm: string) =>
		app(caller).request(`/${name}`, {
			method: "DELETE",
			headers: json,
			body: JSON.stringify({ confirm_name: confirm }),
		});

	test("an owner deletes it by typing its name", async () => {
		await seed();
		await createContentProject({ workspace: "veronika", title: "Work", type: "video" });

		const res = await del(owner, "veronika", "veronika");

		expect(res.status).toBe(200);
		expect(await getWorkspace("veronika")).toBeNull();
		// The other one is untouched.
		expect(await getWorkspace("marcus")).not.toBeNull();
	});

	test("a mistyped name deletes nothing", async () => {
		await seed();

		const res = await del(owner, "veronika", "veronik");

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "confirmation_mismatch" });
		expect(await getWorkspace("veronika")).not.toBeNull();
	});

	test("an empty confirmation deletes nothing", async () => {
		await seed();

		const res = await app(owner).request("/veronika", {
			method: "DELETE",
			headers: json,
			body: "{}",
		});

		expect(res.status).toBe(400);
		expect(await getWorkspace("veronika")).not.toBeNull();
	});

	test("a member cannot delete", async () => {
		await seed();

		const res = await del(mate, "veronika", "veronika");

		expect(res.status).toBe(403);
		expect(await getWorkspace("veronika")).not.toBeNull();
	});

	test("your only workspace is refused", async () => {
		await scaffoldWorkspace("veronika");
		await addWorkspaceMember({ workspace: "veronika", user_id: owner.userId, role: "owner" });

		const res = await del(owner, "veronika", "veronika");

		// Not about data safety: an account with no memberships lands in an app
		// scoped to nothing, which reads as broken rather than as a consequence.
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ error: "last_workspace" });
		expect(await getWorkspace("veronika")).not.toBeNull();
	});

	test("it disappears from the caller's listing", async () => {
		await seed();

		await del(owner, "veronika", "veronika");

		const items = (await (await app(owner).request("/")).json()) as { items: { name: string }[] };
		expect(items.items.map((w) => w.name)).toEqual(["marcus"]);
	});

	test("membership rows go with it, leaving the prune with nothing to do", async () => {
		await seed();

		await del(owner, "veronika", "veronika");

		// pruneMembershipsOutsideRegistry was a no-op until deletion existed.
		// After a correct delete it should still find nothing.
		expect(await pruneMembershipsOutsideRegistry()).toBe(0);
		expect(await isWorkspaceMember("veronika", mate.userId)).toBe(false);
	});
});
