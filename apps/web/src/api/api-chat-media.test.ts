import { describe, expect, test } from "vite-plus/test";
import { resequenceScenes } from "@maleo/shared";
import { startChatAgent } from "./chat.ts";
import { buildChatEnvelope } from "@models/chat/build-chat-envelope.ts";
import { buildSceneImageRequest } from "./media.ts";
import { storyboardJson } from "@models/storyboard/document-wire.ts";
import {
	buildStoryAudioOverlays,
	buildStoryScenes,
	storyTotalDurationSec,
	type StorySection,
} from "../../../../apps/api/src/lib/story.ts";

test("startChatAgent sends selected global timeline template id", async () => {
	const priorFetch = globalThis.fetch;
	let requestBody: Record<string, unknown> | undefined;
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
		return new Response(JSON.stringify({ jobId: "job-1" }), {
			status: 202,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
	try {
		/* The selected template still has to reach the wire; it now travels inside
		 * the envelope's validated inputs rather than as a loose `context` bag. */
		await startChatAgent({
			projectId: "p1",
			instruction: "make video",
			contentType: "video",
			envelope: buildChatEnvelope({
				projectId: "p1",
				scope: {
					doc: { schemaVersion: 2, clips: [], markers: [] } as never,
					slides: [],
					posts: [],
					mediaAssets: [],
				},
				inputs: { referenceIds: [], timelineTemplateId: "tpl-global" },
			}).envelope,
		});
		const envelope = requestBody?.envelope as { inputs: Record<string, unknown> };
		expect(envelope.inputs.timelineTemplateId).toBe("tpl-global");
	} finally {
		globalThis.fetch = priorFetch;
	}
});

describe("scene image request — global style ref", () => {
	test("style ref goes to style_image_urls, separate from product refs", () => {
		const body = buildSceneImageRequest(
			{
				visual: "kitchen scene",
				refs: [
					{
						id: "p1",
						label: "Serum",
						seed: 1,
						role: "product",
						imageUrl: "https://cdn.example.com/serum.png",
					},
					{
						id: "c1",
						label: "Host",
						seed: 2,
						role: "character",
						imageUrl: "https://cdn.example.com/host.png",
					},
				],
				styleImageUrl: "https://cdn.example.com/style.png",
				projectId: "p-1",
				source: "clip",
			},
			"https://dash.example.com",
		);
		expect(body.product_image_urls).toEqual([
			"https://cdn.example.com/serum.png",
			"https://cdn.example.com/host.png",
		]);
		expect(body.style_image_urls).toEqual(["https://cdn.example.com/style.png"]);
		expect(body.intent).toMatchObject({
			references: [
				{ url: "https://cdn.example.com/serum.png", role: "product", label: "Serum" },
				{ url: "https://cdn.example.com/host.png", role: "character", label: "Host" },
				{ url: "https://cdn.example.com/style.png", role: "style" },
			],
		});
		// Style ref must NOT leak into product refs (the bug this fixes).
		expect(body.product_image_urls).not.toContain("https://cdn.example.com/style.png");
	});
	/* The context this request used to omit entirely. Without it the route's
	 * `if (job_id && body.workspace)` guard was always false, so every clip,
	 * reference and studio image was unmetered and unrecorded. */
	test("carries the project and the producing source", () => {
		const body = buildSceneImageRequest(
			{ visual: "x", refs: [], projectId: "p-1", source: "clip" },
			"https://dash.example.com",
		);
		expect(body.project_id).toBe("p-1");
		expect(body.source).toBe("clip");
	});

	test("a workspace-scoped reference image names no project", () => {
		const body = buildSceneImageRequest(
			{ visual: "x", refs: [], source: "reference" },
			"https://dash.example.com",
		);
		expect(body.project_id).toBeUndefined();
		expect(body.source).toBe("reference");
	});

	test("never names a tenant — the server resolves it from the project", () => {
		const body = buildSceneImageRequest(
			{ visual: "x", refs: [], projectId: "p-1", source: "clip" },
			"https://dash.example.com",
		);
		// A workspace on the body would let a caller pick a tenant by sending
		// different JSON. content_projects.workspace is the authoritative record.
		expect(body).not.toHaveProperty("workspace");
	});

	test("relative style url is absolutized via origin; empty when unset", () => {
		const withStyle = buildSceneImageRequest(
			{ visual: "x", refs: [], styleImageUrl: "/uploads/s.png", projectId: "p-1", source: "clip" },
			"https://dash.example.com",
		);
		expect(withStyle.style_image_urls).toEqual(["https://dash.example.com/uploads/s.png"]);
		const none = buildSceneImageRequest(
			{ visual: "x", refs: [], projectId: "p-1", source: "clip" },
			"https://dash.example.com",
		);
		expect(none.style_image_urls).toEqual([]);
	});

	test("scene intent strips mentions and splits project brief from visual moment", () => {
		const body = buildSceneImageRequest(
			{
				visual:
					"Project reference brief: @Sketch Stickman only\n\nClip prompt: sleepy @Sketch Stickman face",
				refs: [
					{
						id: "sketch",
						label: "Sketch Stickman",
						seed: 1,
						role: "character",
						imageUrl: "/uploads/sketch.png",
						description: "simple line sketch",
					},
				],
				projectId: "p-1",
				source: "clip",
			},
			"https://dash.example.com",
		);
		expect(body.intent).toMatchObject({
			scene: { visualMoment: "sleepy Sketch Stickman face" },
			style: { visualTreatment: "Sketch Stickman only" },
			subjectLocks: [{ label: "Sketch Stickman", descriptors: ["simple line sketch"] }],
		});
		expect(JSON.stringify(body.intent)).not.toContain("@Sketch");
	});
});

describe("longform → schemaVersion 2 timeline (measured-audio aligned)", () => {
	test("image + voiceover clips align by measured audio durations", () => {
		// Post-TTS sections: real measured audio durations (NOT word estimates).
		const sections: StorySection[] = [
			{
				id: "a",
				title: "Intro",
				narration: "first",
				visualPrompt: "v1",
				estimatedDurationSec: 99,
				audioUrl: "/a.wav",
				audioDurationSec: 3,
				imageUrl: "/a.png",
			},
			{
				id: "b",
				title: "Middle",
				narration: "second",
				visualPrompt: "v2",
				estimatedDurationSec: 99,
				audioUrl: "/b.wav",
				audioDurationSec: 5,
				imageUrl: "/b.png",
			},
			{
				id: "c",
				title: "End",
				narration: "third",
				visualPrompt: "v3",
				estimatedDurationSec: 99,
				audioUrl: "/c.wav",
				audioDurationSec: 4,
				imageUrl: "/c.png",
			},
		];
		const scenes = buildStoryScenes(sections);
		// Map to editor Scene[] + voiceover overlays the way applyAgentScenes does.
		const clientScenes = resequenceScenes(
			scenes.map((s, i) => ({
				id: i + 1,
				dur: s.durationSec,
				name: s.name,
				shot: s.shot,
				move: s.move,
				vis: s.visual,
				vo: s.voiceover,
				img: Boolean(s.image),
				src: s.image,
			})),
		);
		// Voiceover overlays are emitted separately (not from scene.audioUrl) so they
		// persist as real audio:* clips — same as the agent tool does.
		const audioOverlays = buildStoryAudioOverlays(sections).map((a) => ({
			id: a.id,
			kind: a.kind,
			content: a.content,
			url: a.url,
			start: a.startSec,
			dur: a.durationSec,
		}));

		const out = storyboardJson("video", { scenes: clientScenes }, { audioOverlays });
		expect(out.schemaVersion).toBe(2);
		const clips = out.clips;
		const imageClips = clips
			.filter((c) => String(c.id).startsWith("scene:"))
			.sort((a, b) => (a.startSec as number) - (b.startSec as number));
		const audioClips = clips
			.filter((c) => String(c.id).startsWith("audio:"))
			.sort((a, b) => (a.startSec as number) - (b.startSec as number));
		// Default inter-section pause (0.6s) shifts each start; the prior section's
		// image holds through the silent gap so the visual never cuts to black.
		expect(imageClips.map((c) => c.startSec)).toEqual([0, 3.6, 9.2]);
		expect(imageClips.map((c) => c.durationSec)).toEqual([3.6, 5.6, 4]); // last shot holds the pause
		// Each voiceover clip starts with its image clip but keeps its real (shorter)
		// duration — the trailing gap is silent, a breath between sections.
		expect(audioClips.map((c) => c.startSec)).toEqual([0, 3.6, 9.2]);
		expect(audioClips.map((c) => c.durationSec)).toEqual([3, 5, 4]);
		// Total = final image/audio end (3 + .6 + 5 + .6 + 4).
		const lastImage = imageClips[imageClips.length - 1];
		expect((lastImage.startSec as number) + (lastImage.durationSec as number)).toBe(
			storyTotalDurationSec(sections),
		);
		expect(storyTotalDurationSec(sections)).toBe(13.2);
	});
});
