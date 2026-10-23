/* The project command log routes (`p1-command-log`): commands execute against
 * the head, each accepted or rejected on its own, retries change nothing, and a
 * client reads every entry it missed — or a snapshot when the log no longer
 * holds them. Driven through the workspace and project scope middleware the
 * app mounts, so the membership refusal is the real one. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { closeMaleoDb } from "@maleo/db/connection";
import { openDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { addContentStoryboard } from "@maleo/db/storyboards";
import { projectWorkspaceScope, workspaceScope } from "../../lib/active-workspace.ts";
import { installTestCaller, TEST_CALLER } from "../../middleware/auth-testing.ts";
import { registerCommandRoutes } from "./commands.ts";
import type { PresentationPatch } from "../../lib/project-commands.ts";

const dbPath = join(tmpdir(), "maleo-project-commands.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
});
afterEach(async () => {
	await resetDb();
	if (priorDbPath === undefined) process.env.MALEO_DB_PATH = "";
	else process.env.MALEO_DB_PATH = priorDbPath;
});

function app(caller = TEST_CALLER): Hono {
	const instance = new Hono();
	instance.use("*", installTestCaller(caller));
	instance.use("*", workspaceScope());
	instance.use("/projects/:id/*", projectWorkspaceScope());
	registerCommandRoutes(instance);
	return instance;
}

const json = { "content-type": "application/json" };
const clip = (id: string, startSec = 0) => ({
	id,
	type: "text",
	startSec,
	durationSec: 1,
	track: 0,
	text: { id: 1, text: id, start: startSec, dur: 1 },
});
const documentWith = (...clips: object[]) => ({ schemaVersion: 2, clips, markers: [] });
const move = (id: string, startSec: number) => ({ type: "clip.move", id, patch: { startSec } });

interface Entry {
	seq: number;
	version: number;
	commands: { type: string; scope?: { doc: { clips: { id: string }[] } } }[];
	actor: string;
	snapshot?: true;
}
interface Submitted {
	headSeq: number;
	headVersion: number;
	accepted: { clientCommandId: string; seq: number; version: number | null }[];
	rejected: { clientCommandId: string; kind: string; message: string }[];
	delivered: Entry[];
}

async function project(type: "video" | "image" = "video", ...clips: object[]): Promise<string> {
	const id = (await createContentProject({ title: "Log", type })).project.id;
	await addContentStoryboard({ project_id: id, storyboard_json: documentWith(...clips) });
	return id;
}

async function submit(
	projectId: string,
	baseSeq: number,
	commands: { clientCommandId: string; command: object }[],
	caller = TEST_CALLER,
): Promise<Response> {
	return app(caller).request(`/projects/${projectId}/commands`, {
		method: "POST",
		headers: json,
		body: JSON.stringify({ baseSeq, commands }),
	});
}

const versionCount = async (projectId: string): Promise<number> =>
	(await openDb().all(`SELECT version FROM content_storyboards WHERE project_id = ?`, [projectId]))
		.length;

const stranger = { userId: "stranger", email: "stranger@example.com", role: "user" } as const;

describe("POST /projects/:id/commands", () => {
	test("a base behind the head applies against the head and delivers what the client missed", async () => {
		const id = await project("video", clip("text:1"));
		// Another writer (the agent) saves v2 while the client sits on v1.
		await addContentStoryboard({
			project_id: id,
			storyboard_json: documentWith(clip("text:1"), clip("text:2", 3)),
		});

		const res = await submit(id, 1, [{ clientCommandId: "c1", command: move("text:1", 5) }]);

		expect(res.status).toBe(200);
		const body = (await res.json()) as Submitted;
		expect(body.accepted).toEqual([{ clientCommandId: "c1", seq: 3, version: 3 }]);
		expect(body.headSeq).toBe(3);
		expect(body.headVersion).toBe(3);
		expect(body.delivered.map((e) => [e.seq, e.version, e.commands[0]!.type])).toEqual([
			[2, 2, "scope.replace"],
		]);
		const log = (await (await app().request(`/projects/${id}/commands?after=2`)).json()) as {
			entries: Entry[];
		};
		expect(log.entries).toEqual([
			{ seq: 3, version: 3, commands: [move("text:1", 5) as never], actor: "editor" },
		]);
	});

	test("one failing command among three is rejected and the other two share one version", async () => {
		const id = await project("video", clip("text:1"), clip("text:2", 2));

		const body = (await (
			await submit(id, 1, [
				{ clientCommandId: "a", command: move("text:1", 4) },
				{ clientCommandId: "b", command: move("text:gone", 4) },
				{ clientCommandId: "c", command: move("text:2", 6) },
			])
		).json()) as Submitted;

		expect(body.accepted).toEqual([
			{ clientCommandId: "a", seq: 2, version: 2 },
			{ clientCommandId: "c", seq: 2, version: 2 },
		]);
		expect(body.rejected).toHaveLength(1);
		expect(body.rejected[0]).toMatchObject({ clientCommandId: "b", kind: "ClipNotFound" });
		expect(await versionCount(id)).toBe(2);
	});

	test("a command producing a blob: URL is rejected with the save route's reason", async () => {
		const id = await project("image");
		const slide = { key: "s1", id: 1, cap: "c", vis: "v", img: true, src: "blob:http://x/1" };

		const body = (await (
			await submit(id, 1, [{ clientCommandId: "blob", command: { type: "slide.insert", slide } }])
		).json()) as Submitted;

		expect(body.accepted).toEqual([]);
		expect(body.rejected[0]).toMatchObject({ clientCommandId: "blob", kind: "local_media_url" });
		expect(body.rejected[0]!.message).toContain("blob:");
		expect(body.headVersion).toBe(1);
		expect(await versionCount(id)).toBe(1);
	});

	test("a retried submission returns the first outcome and writes nothing", async () => {
		const id = await project("video", clip("text:1"));
		const commands = [
			{ clientCommandId: "r1", command: move("text:1", 3) },
			{ clientCommandId: "r2", command: move("text:missing", 3) },
		];
		const first = (await (await submit(id, 1, commands)).json()) as Submitted;
		const again = (await (await submit(id, 1, commands)).json()) as Submitted;

		expect(again.accepted).toEqual(first.accepted);
		expect(again.rejected).toEqual(first.rejected);
		expect(again.headVersion).toBe(2);
		// Its own version is not delivered back to it.
		expect(again.delivered).toEqual([]);
		expect(await versionCount(id)).toBe(2);
	});

	test("a non-member is refused and no command executes", async () => {
		const id = await project("video", clip("text:1"));

		const res = await submit(
			id,
			1,
			[{ clientCommandId: "x", command: move("text:1", 3) }],
			stranger,
		);

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "unknown_workspace" });
		expect(await versionCount(id)).toBe(1);
	});
});

describe("GET /projects/:id/commands", () => {
	test("a client catches up in order", async () => {
		const id = await project("video", clip("text:1"));
		for (const start of [1, 2, 3])
			await submit(id, start, [{ clientCommandId: `m${start}`, command: move("text:1", start) }]);

		const body = (await (await app().request(`/projects/${id}/commands?after=1`)).json()) as {
			headSeq: number;
			entries: Entry[];
		};

		expect(body.headSeq).toBe(4);
		expect(body.entries.map((e) => e.seq)).toEqual([2, 3, 4]);
		expect(body.entries.every((e) => !e.snapshot)).toBe(true);
	});

	test("a pruned base reads as one snapshot of the head", async () => {
		const id = await project("video", clip("text:1"));
		await submit(id, 1, [{ clientCommandId: "p1", command: move("text:1", 2) }]);
		await submit(id, 2, [{ clientCommandId: "p2", command: move("text:1", 3) }]);
		// Retention dropped v2 and its entry.
		await openDb().run(
			`DELETE FROM content_project_commands WHERE project_id = ? AND version = 2`,
			[id],
		);
		await openDb().run(`DELETE FROM content_storyboards WHERE project_id = ? AND version = 2`, [
			id,
		]);

		const body = (await (await app().request(`/projects/${id}/commands?after=1`)).json()) as {
			entries: Entry[];
		};

		expect(body.entries).toHaveLength(1);
		expect(body.entries[0]).toMatchObject({ seq: 3, version: 3, snapshot: true });
		expect(body.entries[0]!.commands[0]!.type).toBe("scope.replace");
	});

	test("a base older than the oldest retained entry reads as a snapshot", async () => {
		const id = await project("video", clip("text:1"));
		await submit(id, 1, [{ clientCommandId: "o1", command: move("text:1", 2) }]);
		await submit(id, 2, [{ clientCommandId: "o2", command: move("text:1", 3) }]);
		// Retention dropped the first two entries with their versions; the newest stays.
		await openDb().run(`DELETE FROM content_project_commands WHERE project_id = ? AND seq <= 2`, [
			id,
		]);
		await openDb().run(`DELETE FROM content_storyboards WHERE project_id = ? AND version <= 2`, [
			id,
		]);

		const body = (await (await app().request(`/projects/${id}/commands?after=0`)).json()) as {
			entries: Entry[];
		};

		expect(body.entries).toHaveLength(1);
		expect(body.entries[0]).toMatchObject({ seq: 3, version: 3, snapshot: true });
		expect(body.entries[0]!.commands[0]!.scope!.doc.clips.map((c) => c.id)).toEqual(["text:1"]);
	});

	test("without `after` the read returns where the head is, and no entries", async () => {
		const id = await project("video", clip("text:1"));
		await submit(id, 1, [{ clientCommandId: "h1", command: move("text:1", 2) }]);
		const body = await (await app().request(`/projects/${id}/commands`)).json();
		expect(body).toMatchObject({ headSeq: 2, headVersion: 2, entries: [] });
		expect(typeof body.headStoryboardId).toBe("string");
	});

	test("a non-member is refused", async () => {
		const id = await project("video", clip("text:1"));
		const res = await app(stranger).request(`/projects/${id}/commands?after=0`);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "unknown_workspace" });
	});
});

describe("PATCH /projects/:id/storyboard-presentation", () => {
	const patch = (id: string, body: PresentationPatch, caller = TEST_CALLER) =>
		app(caller).request(`/projects/${id}/storyboard-presentation`, {
			method: "PATCH",
			headers: json,
			body: JSON.stringify(body),
		});

	test("writes only the presentation fields onto the head and logs a scope.replace", async () => {
		const id = await project("video", clip("text:1"));
		await submit(id, 1, [{ clientCommandId: "p1", command: move("text:1", 5) }]);

		const res = await patch(id, { pacingDevices: { chapterPills: true } });

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, version: 3 });
		const stored = (await openDb().get<{ storyboard_json: string }>(
			`SELECT storyboard_json FROM content_storyboards WHERE project_id = ? AND version = 3`,
			[id],
		))!;
		const doc = JSON.parse(stored.storyboard_json);
		expect(doc.pacingDevices).toEqual({ chapterPills: true });
		// The clip keeps the command's effect: nothing scope-owned was rewritten.
		expect(doc.clips.map((c: { startSec: number }) => c.startSec)).toEqual([5]);
		const log = (await (await app().request(`/projects/${id}/commands?after=2`)).json()) as {
			entries: Entry[];
		};
		expect(log.entries.map((e) => [e.seq, e.actor, e.commands[0]!.type])).toEqual([
			[3, "editor", "scope.replace"],
		]);
	});

	test("refuses a non-member", async () => {
		const id = await project("video", clip("text:1"));
		const res = await patch(id, { presentation: null }, stranger);
		expect(res.status).toBe(400);
		expect(await versionCount(id)).toBe(1);
	});
});

describe("the media library travels in the log (p1-media-library)", () => {
	const asset = (id: string, url = `/api/media/${id}`) => ({
		id,
		label: id,
		url,
		kind: "image",
		source: "stock",
	});
	const admit = (id: string, url?: string) => ({ type: "media.admit", asset: asset(id, url) });
	const library = async (projectId: string) =>
		(
			await openDb().all<{ id: string }>(
				`SELECT id FROM project_media_assets WHERE project_id = ? ORDER BY position DESC`,
				[projectId],
			)
		).map((row) => row.id);

	test("a library-only submission stores the asset and writes no version", async () => {
		const id = await project("video", clip("text:1"));
		const res = await submit(id, 1, [{ clientCommandId: "m1", command: admit("a") }]);
		const body = (await res.json()) as Submitted;
		expect(body.accepted).toEqual([{ clientCommandId: "m1", seq: 2, version: null }]);
		expect(body.headVersion).toBe(1);
		expect(await versionCount(id)).toBe(1);
		expect(await library(id)).toEqual(["a"]);
	});

	test("admit and place in one submission write one version holding both commands", async () => {
		const id = await project("video", clip("text:1"));
		const place = { type: "clip.insert", clip: { ...clip("text:2", 3), mediaAssetId: "a" } };
		const body = (await (
			await submit(id, 1, [
				{ clientCommandId: "a1", command: admit("a") },
				{ clientCommandId: "a2", command: place },
			])
		).json()) as Submitted;
		expect(body.rejected).toEqual([]);
		expect(body.accepted.map((a) => [a.seq, a.version])).toEqual([
			[2, 2],
			[2, 2],
		]);
		expect(await versionCount(id)).toBe(2);
		expect(await library(id)).toEqual(["a"]);
		const log = (await (await app().request(`/projects/${id}/commands?after=1`)).json()) as {
			entries: Entry[];
		};
		expect(log.entries[0]!.commands.map((c) => c.type)).toEqual(["media.admit", "clip.insert"]);
	});

	test("two clients admitting one URL get one asset", async () => {
		const id = await project("video", clip("text:1"));
		await submit(id, 1, [{ clientCommandId: "d1", command: admit("a", "/same") }]);
		await submit(id, 1, [{ clientCommandId: "d2", command: admit("b", "/same") }]);
		expect(await library(id)).toEqual(["a"]);
	});

	test("a submitted scope.replace keeps the server's library", async () => {
		const id = await project("video", clip("text:1"));
		await submit(id, 1, [{ clientCommandId: "r1", command: admit("a") }]);
		const replace = {
			type: "scope.replace",
			scope: { doc: documentWith(clip("text:9")), slides: [], posts: [], mediaAssets: [] },
		};
		const body = (await (
			await submit(id, 2, [{ clientCommandId: "r2", command: replace }])
		).json()) as Submitted;
		expect(body.rejected).toEqual([]);
		expect(await library(id)).toEqual(["a"]);
	});

	test("a snapshot carries the library", async () => {
		const id = await project("video", clip("text:1"));
		await submit(id, 1, [{ clientCommandId: "s1", command: admit("a") }]);
		await submit(id, 2, [{ clientCommandId: "s2", command: move("text:1", 2) }]);
		await openDb().run(`DELETE FROM content_project_commands WHERE project_id = ? AND seq <= 2`, [
			id,
		]);
		const body = (await (await app().request(`/projects/${id}/commands?after=0`)).json()) as {
			entries: { snapshot?: true; commands: { scope?: { mediaAssets: { id: string }[] } }[] }[];
		};
		expect(body.entries).toHaveLength(1);
		expect(body.entries[0]!.snapshot).toBe(true);
		expect(body.entries[0]!.commands[0]!.scope!.mediaAssets.map((a) => a.id)).toEqual(["a"]);
	});
});
