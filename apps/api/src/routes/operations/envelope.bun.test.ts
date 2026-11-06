import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { mediaUrl } from "@maleo/shared";
import { openDb } from "@maleo/db/connection";
import { applyMediaLibraryChange } from "@maleo/db/project-media-assets";
import {
	admitEnvelope,
	type EditScope,
	type MediaAsset,
	type ProjectEnvelope,
} from "@maleo/shared/editor";
import { createContentProject } from "@maleo/db/project-detail";
import { registerMediaObject } from "@maleo/db/media-objects";
import { installTestCaller } from "../../middleware/auth-testing.ts";
import { projectWorkspaceScope, workspaceScope } from "../../lib/active-workspace.ts";
import { editorEngine } from "../../lib/editor-engine.ts";
import { registerCommandRoutes } from "./commands.ts";
import { registerEnvelopeRoutes } from "./envelope.ts";

function app(caller?: Parameters<typeof installTestCaller>[0]): Hono {
	const instance = new Hono();
	instance.use("*", installTestCaller(caller));
	instance.use("*", workspaceScope());
	registerEnvelopeRoutes(instance);
	return instance;
}

async function project(storyboard: Record<string, unknown>, mediaAssets: MediaAsset[] = []) {
	const created = (await createContentProject({
		title: "Envelope",
		seed_storyboard: { storyboard_json: storyboard },
	}))!;
	await openDb().transaction((tx) =>
		applyMediaLibraryChange(tx, created.project.id, [], mediaAssets),
	);
	return created.project.id;
}

const clip = (url: string) => ({
	id: "video:1",
	type: "video",
	startSec: 0,
	durationSec: 2,
	track: 0,
	video: { id: 1, kind: "video", url, start: 0, dur: 2 },
});

/* The first test pays the cold start: the route compiles the engine, and the test
 * database may still be starting, which alone can pass the 5 s default. */
test("a member reads an envelope the engine admits, with head and manifest", async () => {
	const media = await registerMediaObject({
		workspace: "default",
		kind: "video",
		hash: "d".repeat(64),
		storage_key: `workspaces/default/video/${randomUUID()}-clip.mp4`,
		content_type: "video/mp4",
		size: 7,
	});
	const url = mediaUrl(media.id);
	const id = await project(
		{
			schemaVersion: 2,
			clips: [clip(url)],
			markers: [],
			presentation: { aspect: "9:16" },
			pacingDevices: { chapterPills: true },
		},
		[{ id: "asset-1", url, label: "Clip", kind: "video", source: "upload" }],
	);
	const response = await app().request(`/projects/${id}/envelope`);
	expect(response.status).toBe(200);
	const envelope = (await response.json()) as ProjectEnvelope;
	expect(envelope).toMatchObject({
		format: "maleo.project",
		formatVersion: 1,
		compatibility: { schemaVersion: 2, minReaderVersion: 1 },
		project: { id, type: "video", title: "Envelope" },
		head: { presentation: { aspect: "9:16" }, pacingDevices: { chapterPills: true } },
	});
	expect(envelope.scope.mediaAssets.map((asset) => asset.id)).toEqual(["asset-1"]);
	expect(envelope.manifest).toEqual([
		expect.objectContaining({ id: media.id, state: "ready", sha256: "d".repeat(64) }),
	]);
	expect(envelope).not.toHaveProperty("chat");
	expect(admitEnvelope(editorEngine(), JSON.stringify(envelope)).ok).toBe(true);
}, 30_000);

test("a caller outside the project's workspace learns nothing", async () => {
	const other = (await createContentProject({
		title: "Elsewhere",
		workspace: "other",
		seed_storyboard: { storyboard_json: { clips: [] } },
	}))!;
	const refused = await app().request(`/projects/${other.project.id}/envelope`);
	expect(refused.status).toBe(404);
	expect(await refused.json()).toEqual({ error: "project_not_found" });
	const own = await project({ clips: [] });
	const outsider = await app({
		userId: "outsider",
		email: "out@example.com",
		role: "member",
	}).request(`/projects/${own}/envelope`);
	expect(outsider.status).toBe(400);
	expect(await outsider.json()).toEqual({ error: "unknown_workspace", workspace: "default" });
});

test("a stored document the engine refuses gets the refusal, not a partial envelope", async () => {
	const id = await project({
		schemaVersion: 2,
		clips: [clip("blob:https://app.example/1f2e")],
		markers: [],
	});
	const response = await app().request(`/projects/${id}/envelope`);
	expect(response.status).toBe(409);
	expect(await response.json()).toEqual({
		error: "envelope_incompatible",
		reason: "device-url",
		path: "scope.doc.clips[0].video.url",
		message: expect.any(String),
	});
});

test("a stored document the total write refuses is incompatible", async () => {
	const id = await project({
		schemaVersion: 2,
		clips: [
			{
				...clip("https://cdn.example/stock.mp4"),
				video: {
					id: 1,
					kind: "video",
					url: "https://cdn.example/stock.mp4",
					start: 0,
					dur: 2,
					layout: { blendMode: "not-a-mode" },
				},
			},
		],
		markers: [],
	});
	const response = await app().request(`/projects/${id}/envelope`);
	expect(response.status).toBe(409);
	expect(await response.json()).toMatchObject({ error: "envelope_incompatible", path: "head" });
});

test("after a command through the log, the envelope holds what the editor holds", async () => {
	const instance = new Hono();
	instance.use("*", installTestCaller());
	instance.use("*", workspaceScope());
	instance.use("/projects/:id/*", projectWorkspaceScope());
	registerCommandRoutes(instance);
	registerEnvelopeRoutes(instance);
	const id = await project({
		schemaVersion: 2,
		clips: [clip("https://cdn.example/stock.mp4")],
		markers: [],
		presentation: { aspect: "1:1" },
	});
	const read = async () =>
		(await (await instance.request(`/projects/${id}/envelope`)).json()) as ProjectEnvelope;
	const before = await read();
	const command = { type: "clip.move", id: "video:1", patch: { startSec: 3 } };
	const submitted = await instance.request(`/projects/${id}/commands`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ baseSeq: 1, commands: [{ clientCommandId: "move-1", command }] }),
	});
	expect(submitted.status).toBe(200);
	expect(((await submitted.json()) as { accepted: unknown[] }).accepted).toHaveLength(1);
	// The editor applies the same command to the scope it holds.
	const executed = editorEngine().executeOnce(
		JSON.stringify(before.scope),
		JSON.stringify(command),
	);
	if (!executed.ok) throw new Error(executed.error.message);
	const editor = (JSON.parse(executed.value) as { scope: EditScope }).scope;
	const after = await read();
	expect(after.scope).toEqual(editor);
	expect(after.head).toEqual(before.head);
});
