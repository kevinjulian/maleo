/* The workspace writer style route.
 *
 * The assertions that matter are about `config.yaml` surviving the write: this is
 * an operator-edited file, and a settings route that reformats it or drops its
 * comments costs more than the setting is worth. */
import { getWorkspaceConfigText, putWorkspaceConfigText } from "@maleo/db/workspace-config";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { settingsRoutes } from "./settings.ts";
import { upsertWorkspace } from "@maleo/db/workspaces";
import { addWorkspaceMember, getWorkspaceMember } from "@maleo/db/workspace-members";
import { TEST_CALLER, testApp } from "../middleware/auth-testing.ts";

const root = join(tmpdir(), `maleo-writer-style-route-${randomUUID().slice(0, 8)}`);
const priorDataDir = process.env.MALEO_DATA_DIR;

/* Stored the way an operator's document is: a row, comments and all. */
function writeConfig(name: string, body: string): Promise<void> {
	return putWorkspaceConfigText(name, body);
}

beforeAll(() => {
	mkdirSync(root, { recursive: true });
	process.env.MALEO_DATA_DIR = root;
});

/* Restored, never deleted — `scripts/test-db-guard.ts` points this at a temp dir
 * so a suite that clears it cannot fall back to the real database. */
afterAll(() => {
	rmSync(root, { recursive: true, force: true });
	if (priorDataDir !== undefined) process.env.MALEO_DATA_DIR = priorDataDir;
});

beforeEach(async () => {
	// The route is workspace-scoped: reads need membership, writes ownership.
	await upsertWorkspace({ name: "acme", workspace_dir: join(root, "acme") });
	if (!(await getWorkspaceMember("acme", TEST_CALLER.userId))) {
		await addWorkspaceMember({ workspace: "acme", user_id: TEST_CALLER.userId, role: "owner" });
	}
	await writeConfig("acme", "# operator notes, keep me\nname: acme\nniche: woodworking\n");
});

describe("GET /workspaces/:name/writer-style", () => {
	test("offers the library and reports no selection when none is stored", async () => {
		const res = await testApp(settingsRoutes()).request("/workspaces/acme/writer-style");
		const body = (await res.json()) as {
			selected: string | null;
			options: Array<{ key: string; label: string }>;
		};
		expect(res.status).toBe(200);
		expect(body.selected).toBeNull();
		expect(body.options.length).toBeGreaterThan(1);
		expect(body.options.map((option) => option.key)).toContain("plainspoken_reportage");
	});

	test("reports a stored selection", async () => {
		await writeConfig("acme", "name: acme\nwriter_style: socratic_plain\n");
		const res = await testApp(settingsRoutes()).request("/workspaces/acme/writer-style");
		expect(((await res.json()) as { selected: string | null }).selected).toBe("socratic_plain");
	});

	/* Retiring a profile must not make a workspace unreadable — the read path
	 * degrades a stale key to "no selection" rather than offering it back. */
	test("a retired key reads as no selection", async () => {
		await writeConfig("acme", "name: acme\nwriter_style: retired_profile\n");
		const res = await testApp(settingsRoutes()).request("/workspaces/acme/writer-style");
		expect(((await res.json()) as { selected: string | null }).selected).toBeNull();
	});
});

describe("PUT /workspaces/:name/writer-style", () => {
	async function put(body: unknown) {
		return testApp(settingsRoutes()).request("/workspaces/acme/writer-style", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	test("stores a chosen key", async () => {
		const res = await put({ writerStyle: "essayistic_reflective" });
		expect(res.status).toBe(200);
		const after = await testApp(settingsRoutes()).request("/workspaces/acme/writer-style");
		expect(((await after.json()) as { selected: string | null }).selected).toBe(
			"essayistic_reflective",
		);
	});

	/* The whole reason this writes through `YAML.parseDocument` rather than
	 * re-serialising a parsed object. */
	test("keeps the operator's comments and other keys", async () => {
		await put({ writerStyle: "essayistic_reflective" });
		const text = (await getWorkspaceConfigText("acme"))!;
		expect(text).toContain("# operator notes, keep me");
		expect(text).toContain("niche: woodworking");
		expect(text).toContain("writer_style: essayistic_reflective");
	});

	/* Unset is a real state: it means "plan as this workspace did before writer
	 * styles existed", so it has to stay reachable from the picker. */
	test("null clears the selection", async () => {
		await put({ writerStyle: "essayistic_reflective" });
		const cleared = await put({ writerStyle: null });
		expect(cleared.status).toBe(200);
		const after = await testApp(settingsRoutes()).request("/workspaces/acme/writer-style");
		expect(((await after.json()) as { selected: string | null }).selected).toBeNull();
		expect((await getWorkspaceConfigText("acme"))!).not.toContain("writer_style");
	});

	/* The write path validates against the live library, unlike the read path.
	 * An unknown key here is an operator mistake, not a legacy value to tolerate. */
	test("rejects a key outside the library without writing", async () => {
		const res = await put({ writerStyle: "hemingway" });
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe("invalid_writer_style");
		expect((await getWorkspaceConfigText("acme"))!).not.toContain("hemingway");
	});

	test("rejects a missing field", async () => {
		expect((await put({})).status).toBe(400);
	});
});
