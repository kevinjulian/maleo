import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { putMedia, deleteMedia } from "@maleo/storage";
import { mintMediaId, toTimelineDoc } from "@maleo/shared";
import { reserveProjectMediaImport } from "@maleo/db/media-imports";
import { registerMediaObject, mediaObjectUrl } from "@maleo/db/media-objects";
import { createContentProject } from "@maleo/db/project-detail";
import { videoRoutes } from "../routes/video.ts";
import { installTestCaller } from "../middleware/auth-testing.ts";
import { renderMediaBlockers } from "./render-media-preflight.ts";

const previousData = process.env.MALEO_DATA_DIR,
	previousBackend = process.env.MALEO_MEDIA_STORAGE_BACKEND;
if (!previousData) throw new Error("Run preflight tests with test-db-guard preload");
let directory: string;
beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "maleo-render-preflight-"));
	process.env.MALEO_DATA_DIR = directory;
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
});
afterAll(async () => {
	process.env.MALEO_DATA_DIR = previousData;
	if (previousBackend === undefined) delete process.env.MALEO_MEDIA_STORAGE_BACKEND;
	else process.env.MALEO_MEDIA_STORAGE_BACKEND = previousBackend;
	await rm(directory, { recursive: true, force: true });
});

test("preflight checks real source existence and owner; ignores unused incompatible files", async () => {
	const stored = await putMedia({
		workspace: "default",
		kind: "video",
		body: new Uint8Array([1]),
		contentType: "video/mp4",
	});
	const row = await registerMediaObject({
		workspace: "default",
		kind: "video",
		hash: stored.hash,
		storage_key: stored.key,
		size: stored.size,
		content_type: stored.contentType,
	});
	const url = mediaObjectUrl(row.id),
		input = { scenes: [{ visualClips: [{ url }] }], audioOverlays: [{ url }] };
	expect(await renderMediaBlockers(input, "default", null)).toEqual([]);
	expect(await renderMediaBlockers(input, "other", null)).toHaveLength(1);
	const editorState = {
		media_assets: [
			{
				label: "Camera footage",
				url,
				compatibility: {
					preview: { status: "supported" },
					render: { status: "failed", reason: "Conversion failed" },
				},
			},
		],
	};
	expect(await renderMediaBlockers(input, "default", editorState)).toEqual([
		"Camera footage: Conversion failed. Replace source before export.",
	]);
	expect(await renderMediaBlockers({ url: "/stock.mp4" }, "default", editorState)).toEqual([]);
	await deleteMedia(stored.key);
	expect(await renderMediaBlockers(input, "default", null)).toEqual([
		"Source file unavailable. Restore storage or replace source before export.",
	]);
});

test("preflight refuses a clip placed past its source's measured length", async () => {
	const doc = toTimelineDoc(
		[],
		[
			{
				id: 2,
				kind: "video",
				url: "/stock.mp4",
				mediaAssetId: "k1",
				start: 0,
				dur: 4.6,
				mediaStartSec: 0.5,
				track: 0,
			},
		],
	);
	const editorState = {
		media_assets: [{ id: "k1", label: "beach.mov", url: "/stock.mp4", metadata: { duration: 5 } }],
	};
	expect(await renderMediaBlockers(doc, "default", editorState)).toEqual([
		"beach.mov: the clip runs past the end of its source. Trim it before export.",
	]);
});

test("authenticated runtime render refuses unregistered source before contacting renderer", async () => {
	const project = (await createContentProject({ title: "Missing source proof" }))!;
	const app = new Hono();
	app.use("*", installTestCaller());
	app.route("/", videoRoutes());
	const server = Bun.serve({ port: 0, fetch: app.fetch });
	try {
		const response = await fetch(new URL("/render", server.url), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				project_id: project.project.id,
				preset: "storyboard-horizontal",
				storyboard: { scenes: [{ image: `/api/media/${randomUUID()}` }] },
			}),
		});
		expect(response.status).toBe(422);
		expect(await response.json()).toMatchObject({
			error: "media_unavailable",
			blockers: ["Managed source unavailable. Replace missing source before export."],
		});
	} finally {
		void server.stop(true);
	}
});

test("server preflight refuses unresolved reverse even for readable legacy video", async () => {
	expect(
		await renderMediaBlockers(
			{
				videoOverlays: [
					{
						kind: "video",
						label: "Reversed camera",
						url: "/stock.mp4",
						durationSec: 2,
						layout: { reverse: true },
					},
				],
			},
			"default",
			null,
		),
	).toEqual([
		"Reversed camera: reverse source is unavailable or changed. Process this source range again before export.",
	]);
});

test("server preflight refuses unsupported mask and blend before tolerant projection", async () => {
	expect(
		await renderMediaBlockers(
			{
				videoOverlays: [
					{
						label: "Overlay",
						url: "/image.png",
						layout: { blendMode: "overlay", mask: { shape: "path" } },
					},
				],
			},
			"default",
			null,
		),
	).toEqual([
		"Overlay: invalid mask. Repair compositing before export.",
		"Overlay: invalid blendMode. Repair compositing before export.",
	]);
});

test("runtime render blocks unresolved authored audio before projection removes its source", async () => {
	const project = (await createContentProject({ title: "Retime preflight proof" }))!;
	const app = new Hono();
	app.use("*", installTestCaller());
	app.route("/", videoRoutes());
	const response = await app.request("/render", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			project_id: project.project.id,
			render: {
				config: {},
				refs: { images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } },
				doc: {
					schemaVersion: 2,
					markers: [],
					clips: [
						{
							id: "audio:1",
							type: "audio",
							startSec: 0,
							durationSec: 8,
							track: 0,
							audio: {
								id: 1,
								kind: "music",
								content: "",
								url: "/stock.m4a",
								start: 0,
								dur: 8,
								playbackRate: 0.5,
								preservePitch: true,
							},
						},
					],
				},
			},
		}),
	});
	expect(response.status).toBe(422);
	expect(await response.json()).toMatchObject({
		error: "media_unavailable",
		blockers: [
			"Media clip: processed audio is unavailable or changed. Process this source range again before export.",
		],
	});
});

test("a quarantined original is never a render source, whatever compatibility the client claims", async () => {
	const stored = await putMedia({
		workspace: "default",
		kind: "file",
		body: new Uint8Array([1]),
		contentType: "application/octet-stream",
	});
	const row = await registerMediaObject({
		workspace: "default",
		kind: "file",
		hash: stored.hash,
		storage_key: stored.key,
		size: stored.size,
		content_type: stored.contentType,
	});
	const url = mediaObjectUrl(row.id);
	const editorState = {
		media_assets: [
			{
				label: "Original",
				url,
				compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
			},
		],
	};
	expect(await renderMediaBlockers({ videoOverlays: [{ url }] }, "default", editorState)).toEqual([
		"Original upload is not a playable source. Replace source before export.",
	]);
});

test("an export that uses a minted identity still importing names the uploading file", async () => {
	const project = (await createContentProject({ title: "Minted export" }))!;
	const mediaId = mintMediaId();
	await reserveProjectMediaImport({
		workspace: "default",
		projectId: project.project.id,
		requestKey: mediaId,
		filename: "camera.mov",
		kind: "video",
		uploadTimeoutMs: 60_000,
	});
	const doc = { clips: [{ id: "video:1", video: { url: mediaObjectUrl(mediaId) } }] };
	expect(await renderMediaBlockers(doc, "default", null)).toEqual([
		"camera.mov is still uploading. Wait for it to finish before export.",
	]);
	// Unplaced, it blocks nothing.
	expect(
		await renderMediaBlockers({ clips: [] }, "default", {
			media_assets: [{ url: mediaObjectUrl(mediaId), label: "camera.mov" }],
		} as never),
	).toEqual([]);
});
