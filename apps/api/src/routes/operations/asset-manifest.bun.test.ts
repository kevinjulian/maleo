import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { mediaUrl, mintMediaId } from "@maleo/shared";
import { openDb } from "@maleo/db/connection";
import { applyMediaLibraryChange } from "@maleo/db/project-media-assets";
import type { MediaAsset } from "@maleo/shared/editor";
import { createContentProject } from "@maleo/db/project-detail";
import { registerMediaObject } from "@maleo/db/media-objects";
import { failProjectMediaImport, reserveProjectMediaImport } from "@maleo/db/media-imports";
import { installTestCaller } from "../../middleware/auth-testing.ts";
import { workspaceScope } from "../../lib/active-workspace.ts";
import { registerAssetManifestRoutes } from "./asset-manifest.ts";

function app(caller?: Parameters<typeof installTestCaller>[0]): Hono {
	const instance = new Hono();
	instance.use("*", installTestCaller(caller));
	instance.use("*", workspaceScope());
	registerAssetManifestRoutes(instance);
	return instance;
}

const register = (id?: string) =>
	registerMediaObject({
		...(id ? { id } : {}),
		workspace: "default",
		kind: "video",
		hash: "c".repeat(64),
		storage_key: `workspaces/default/video/${randomUUID()}-clip.mp4`,
		content_type: "video/mp4",
		size: 42,
	});

const reserve = (projectId: string, requestKey: string, filename: string) =>
	reserveProjectMediaImport({
		workspace: "default",
		projectId,
		requestKey,
		filename,
		kind: "video",
		uploadTimeoutMs: 60_000,
	});

async function project(clips: unknown[], mediaAssets: unknown[] = []) {
	const created = (await createContentProject({
		title: "Manifest",
		seed_storyboard: { storyboard_json: { clips } },
	}))!;
	// The project's library rows (`p1-media-library`), written as stored.
	await openDb().transaction((tx) =>
		applyMediaLibraryChange(tx, created.project.id, [], mediaAssets as MediaAsset[]),
	);
	return created.project.id;
}

const manifest = async (id: string) => {
	const response = await app().request(`/projects/${id}/asset-manifest`);
	expect(response.status).toBe(200);
	return (await response.json()) as {
		projectId: string;
		storyboardVersion: number | null;
		assets: Array<Record<string, unknown>>;
	};
};

test("each referenced identity is listed once with its state", async () => {
	const ready = await register();
	const pendingId = mintMediaId(),
		failedId = mintMediaId(),
		goneId = mintMediaId();
	const id = await project(
		[
			{ id: "video:1", video: { url: mediaUrl(ready.id), label: "Ready clip" } },
			{ id: "video:2", video: { url: mediaUrl(ready.id) } },
			{ id: "video:3", video: { url: mediaUrl(pendingId) } },
			{ id: "video:4", video: { url: mediaUrl(failedId) } },
			{ id: "video:5", video: { url: mediaUrl(goneId) } },
			{ id: "video:6", video: { url: "https://cdn.example/stock.mp4" } },
		],
		[
			{
				id: pendingId,
				label: "Spare",
				url: mediaUrl(pendingId),
				metadata: { originalFilename: "camera.mov" },
			},
		],
	);
	await reserve(id, pendingId, "camera.mov");
	const { row } = await reserve(id, failedId, "broken.mov");
	await failProjectMediaImport(row, "broken");
	const body = await manifest(id);
	expect(body.projectId).toBe(id);
	expect(body.storyboardVersion).toBe(1);
	const byId = new Map(body.assets.map((asset) => [asset.id, asset]));
	expect(body.assets).toHaveLength(5);
	expect(byId.get(ready.id)).toEqual({
		id: ready.id,
		url: mediaUrl(ready.id),
		origin: "managed",
		kind: "video",
		contentType: "video/mp4",
		size: 42,
		sha256: "c".repeat(64),
		state: "ready",
		label: "Ready clip",
		used: true,
	});
	expect(byId.get(pendingId)).toMatchObject({
		origin: "import",
		state: "pending",
		label: "camera.mov",
		used: true,
	});
	expect(byId.get(pendingId)).not.toHaveProperty("size");
	expect(byId.get(pendingId)).not.toHaveProperty("sha256");
	expect(byId.get(failedId)).toMatchObject({ state: "failed", label: "broken.mov" });
	expect(byId.get(goneId)).toMatchObject({ origin: "managed", state: "failed" });
	expect(byId.get("https://cdn.example/stock.mp4")).toEqual({
		id: "https://cdn.example/stock.mp4",
		url: "https://cdn.example/stock.mp4",
		origin: "external",
		state: "external",
		used: true,
	});
});

test("a caller outside the project's workspace learns nothing", async () => {
	const mediaId = mintMediaId();
	const other = (await createContentProject({
		title: "Elsewhere",
		workspace: "other",
		seed_storyboard: { storyboard_json: { clips: [{ video: { url: mediaUrl(mediaId) } }] } },
	}))!;
	const refused = await app().request(`/projects/${other.project.id}/asset-manifest`);
	expect(refused.status).toBe(404);
	expect(await refused.json()).toEqual({ error: "project_not_found" });
	const own = await project([]);
	const outsider = await app({
		userId: "outsider",
		email: "out@example.com",
		role: "member",
	}).request(`/projects/${own}/asset-manifest`);
	expect(outsider.status).toBe(400);
	expect(await outsider.json()).toEqual({ error: "unknown_workspace", workspace: "default" });
});
