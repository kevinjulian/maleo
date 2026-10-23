import { afterEach, expect, test } from "vite-plus/test";
import { mediaUrl, mintMediaId, type ReadyImportedMedia } from "@maleo/shared";
import { saveEditorState, saveStoryboard } from "./projects.ts";
import { submitVideoRender } from "./project-render.ts";
import {
	clearPendingSources,
	setPendingLocalUrl,
	setPendingReady,
} from "@models/core/pending-media-sources.ts";

const k1 = mintMediaId(),
	k2 = mintMediaId();
const managed = mediaUrl(k1);
const ready = {
	id: "row",
	label: "beach.mov",
	url: managed,
	kind: "video",
	source: "upload",
	dur: 4.2,
	metadata: { originalFilename: "beach.mov", byteSize: 4, kind: "video", duration: 4.2 },
	compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
	importedSource: { revision: "r", fingerprint: "a".repeat(64), originalMediaId: "o" },
} as ReadyImportedMedia;
const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	clearPendingSources();
});

test("saves keep every minted URL, take ready metadata, and never write a local URL", async () => {
	const bodies: string[] = [];
	globalThis.fetch = Object.assign(
		async (_input: RequestInfo | URL, init?: RequestInit) => {
			bodies.push(String(init?.body));
			return new Response(JSON.stringify({ storyboard: {} }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
		{ preconnect: realFetch.preconnect },
	);
	setPendingReady(k1, ready);
	setPendingLocalUrl(k2, "blob:http://local/2");
	await saveStoryboard("p", {
		clips: [
			{ id: "video:1", video: { url: managed, mediaAssetId: k1 } },
			{ id: "video:2", video: { url: mediaUrl(k2) } },
		],
	});
	await saveEditorState("p", {
		mediaAssets: [{ id: k1, label: "Mine", url: managed, kind: "video", source: "upload" }],
	});
	const [storyboard, state] = bodies.map((body) => JSON.parse(body));
	expect(
		storyboard.storyboard_json.clips.map((clip: { video: { url: string } }) => clip.video.url),
	).toEqual([managed, mediaUrl(k2)]);
	expect(state.editor_state.media_assets[0]).toMatchObject({
		id: k1,
		label: "Mine",
		url: managed,
		dur: 4.2,
		metadata: ready.metadata,
	});
	expect(bodies.join("")).not.toContain("blob:");
});

test("a render request carries the minted URL unchanged", async () => {
	const bodies: Array<{ url: string; body: string }> = [];
	globalThis.fetch = Object.assign(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			bodies.push({ url: String(input), body: String(init?.body) });
			return new Response(
				JSON.stringify({ id: "x", status: "queued", output: { id: "o" }, render: { id: "r" } }),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		},
		{ preconnect: realFetch.preconnect },
	);
	setPendingReady(k1, ready);
	await submitVideoRender({
		projectId: "p",
		storyboardId: "s",
		title: "t",
		render: {
			doc: {
				schemaVersion: 2,
				clips: [{ id: "video:1", video: { url: managed } }],
				markers: [],
			} as never,
			config: {} as never,
			refs: {} as never,
		},
	});
	const render = JSON.parse(
		bodies.find((entry) => entry.url.includes("/api/video/render"))!.body,
	).render;
	expect(render.doc.clips[0].video.url).toBe(managed);
});
