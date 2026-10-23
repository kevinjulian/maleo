import { afterEach, beforeEach, expect, test } from "bun:test";
import { createMediaClient } from "@maleo/media/api";
import { getMediaObject, mediaObjectUrl, registerMediaObject } from "@maleo/db/media-objects";
import { createContentProject, getContentProject } from "@maleo/db/project-detail";
import { setGlobalSetting } from "@maleo/db/global-settings";
import { putWorkspaceConfigText } from "@maleo/db/workspace-config";
import { putMedia } from "@maleo/storage";
import { testApp } from "../../middleware/auth-testing.ts";
import { videoRoutes } from "../../routes/video.ts";
import { capabilitiesRoutes } from "../../routes/capabilities.ts";
import { setMediaClientForTests } from "../image-gen-client.ts";
import { listUsageRecords } from "../credit-service.ts";
import { generateVideo, VIDEO_PROVIDER_SETTING } from "./video-generator.ts";
import { animateScene } from "../../modules/agents/core/tools/visual/animate-scene.ts";
import { agentTimelineDoc } from "../../modules/agents/core/document.ts";
import type { AgentJob } from "../../modules/agents/core/model.ts";
import { QuotaExceededError } from "../metering/meter.ts";

const priorBackend = process.env.MALEO_MEDIA_STORAGE_BACKEND;
let imageUrl: string, projectId: string, submitted: Record<string, unknown>[];
let resultProvider = "sandbox",
	jobStatus = "done";
let stored: Awaited<ReturnType<typeof putMedia>>;
let poster: Awaited<ReturnType<typeof putMedia>> | undefined;

beforeEach(async () => {
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	await putWorkspaceConfigText(
		"default",
		"image_policy:\n  daily_limit: 0\n  allowed_hours: [0, 24]\n",
	);
	await setGlobalSetting(VIDEO_PROVIDER_SETTING, "sandbox");
	const image = await putMedia({
		workspace: "default",
		kind: "image",
		contentType: "image/png",
		body: Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9z8AAAAASUVORK5CYII=",
			"base64",
		),
	});
	const object = await registerMediaObject({
		workspace: "default",
		kind: "image",
		hash: image.hash,
		storage_key: image.key,
		content_type: image.contentType,
		size: image.size,
	});
	imageUrl = mediaObjectUrl(object.id);
	projectId = (
		await createContentProject({ workspace: "default", type: "video", title: "Video sandbox test" })
	).project.id;
	stored = await putMedia({
		workspace: "default",
		kind: "video",
		body: new Blob(["worker-verified-fixture"]),
		contentType: "video/mp4",
	});
	poster = undefined;
	submitted = [];
	resultProvider = "sandbox";
	jobStatus = "done";
	setMediaClientForTests(
		createMediaClient({
			baseUrl: "http://worker.test",
			fetch: async (url, init) => {
				if (String(url).endsWith("/health"))
					return Response.json({ video: { sandbox: "ready", fal: "ready" } });
				if (String(url).endsWith("/video")) {
					submitted.push(JSON.parse(String(init?.body)));
					return Response.json({ job_id: "video-job" });
				}
				return Response.json({
					id: "video-job",
					kind: "video",
					status: jobStatus,
					duration_sec: 4,
					provider_id: resultProvider,
					model: `${resultProvider}-mp4`,
					storage_key: stored.key,
					storage_hash: stored.hash,
					storage_size: stored.size,
					storage_content_type: stored.contentType,
					poster_storage_key: poster?.key,
					poster_storage_hash: poster?.hash,
					poster_storage_size: poster?.size,
					poster_storage_content_type: poster?.contentType,
					error: "encoding failed",
				});
			},
		}),
	);
});
afterEach(async () => {
	setMediaClientForTests(undefined);
	await setGlobalSetting(VIDEO_PROVIDER_SETTING, null);
	if (priorBackend === undefined) delete process.env.MALEO_MEDIA_STORAGE_BACKEND;
	else process.env.MALEO_MEDIA_STORAGE_BACKEND = priorBackend;
});

test("selected sandbox returns managed video and records zero spend", async () => {
	const result = await generateVideo(
		{ imageUrl, prompt: "animate", durationSec: 7 },
		{ workspace: "default", projectId },
	);
	expect(result).toMatchObject({ durationSec: 4, providerId: "sandbox", model: "sandbox-mp4" });
	expect(result.url).toMatch(/^\/api\/media\//);
	expect(result.posterUrl).toBeUndefined();
	expect(submitted[0]).toMatchObject({
		duration_sec: 7,
		provider_id: "sandbox",
		project_id: projectId,
		aspect: "1:1",
	});
	const usage = (await listUsageRecords("workspace", "default")).find(
		(row) =>
			row.provider === "sandbox" && JSON.parse(row.metadata_json ?? "{}").projectId === projectId,
	)!;
	expect(usage).toMatchObject({ provider_cost_usd: 0, charged_credits: 0, quantity: 4 });
});

test("returns managed poster when worker provides an owned JPEG", async () => {
	poster = await putMedia({
		workspace: "default",
		kind: "image",
		contentType: "image/jpeg",
		body: new Blob(["verified-jpeg"]),
	});
	const result = await generateVideo(
		{ imageUrl, prompt: "poster", durationSec: 4 },
		{ workspace: "default", projectId },
	);
	expect(result.posterUrl).toMatch(/^\/api\/media\//);
	const object = await getMediaObject(result.posterUrl!.split("/").at(-1)!);
	expect(object).toMatchObject({
		workspace: "default",
		kind: "image",
		content_type: "image/jpeg",
		storage_key: poster.key,
	});
});

test.each(["foreign owner", "wrong content type", "changed size"])(
	"rejects poster with %s",
	async (failure) => {
		poster = await putMedia({
			workspace: failure === "foreign owner" ? "other" : "default",
			kind: "image",
			contentType: "image/jpeg",
			body: new Blob(["verified-jpeg"]),
		});
		if (failure === "wrong content type") poster.contentType = "image/png";
		if (failure === "changed size") poster.size++;
		await expect(
			generateVideo(
				{ imageUrl, prompt: failure, durationSec: 4 },
				{ workspace: "default", projectId },
			),
		).rejects.toThrow(/poster/);
	},
);

test("HTTP editor animation and real agent handler share provider and source duration", async () => {
	const app = testApp(videoRoutes());
	const response = await app.request("/animate", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ imageUrl, durationSec: 2, project_id: projectId }),
	});
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({ durationSec: 4, providerId: "sandbox" });
	const job: AgentJob = {
		id: "video-tool-test",
		projectId,
		workspace: "default",
		contentType: "video",
		status: "running",
		events: [],
		scenes: [
			{
				name: "Scene",
				image: imageUrl,
				durationSec: 7,
				visual: "mock",
				voiceover: "",
				shot: "wide",
				move: "Static",
				transition: "cut",
			},
		],
		textOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		aspect: "1:1",
		brief: "test",
		startedAt: 0,
	};
	await animateScene.handler!(
		{
			job,
			toolCallId: "video-proof-call",
			helpers: {
				index: () => 0,
				str: (value) => String(value),
				num: (value) => Number(value),
				clampSceneDuration: (value) => value,
			},
		},
		{ index: 0 },
	);
	expect(job.videoOverlays[0]).toMatchObject({ durationSec: 4, sourceDurationSec: 4 });
	expect(job.videoOverlays[0]?.thumb).toBeUndefined();
	expect(
		agentTimelineDoc(job).clips.find((clip) => clip.type === "video")?.video?.sourceDurationSec,
	).toBe(4);
	expect(submitted.map((input) => input.provider_id)).toEqual(["sandbox", "sandbox"]);
	expect(
		(await getContentProject(projectId))?.events.find((event) => event.kind === "agent.asset")
			?.payload_json,
	).toMatchObject({ model: "sandbox-mp4", provider_id: "sandbox", source_duration_sec: 4 });
});

test("foreign source and arbitrary URLs are refused before submission", async () => {
	const source = await getMediaObject(imageUrl.slice("/api/media/".length));
	expect(source).not.toBeNull();
	await expect(
		generateVideo({ imageUrl, prompt: "", durationSec: 4 }, { workspace: "other" }),
	).rejects.toThrow("owned managed image");
	await expect(
		generateVideo(
			{ imageUrl: "https://localhost/private", prompt: "", durationSec: 4 },
			{ workspace: "default" },
		),
	).rejects.toThrow("owned managed image");
	expect(submitted).toHaveLength(0);
});

test("project ownership, missing worker and failed jobs fail visibly", async () => {
	await expect(
		generateVideo({ imageUrl, prompt: "", durationSec: 4 }, { workspace: "other", projectId }),
	).rejects.toThrow("project owner mismatch");
	jobStatus = "failed";
	await expect(
		generateVideo({ imageUrl, prompt: "", durationSec: 4 }, { workspace: "default", projectId }),
	).rejects.toThrow("encoding failed");
	setMediaClientForTests(null);
	await expect(
		generateVideo({ imageUrl, prompt: "", durationSec: 4 }, { workspace: "default" }),
	).rejects.toThrow("worker not configured");
});

test("real video quota prevents provider submission", async () => {
	await setGlobalSetting(VIDEO_PROVIDER_SETTING, "fal");
	const nextHour = (new Date().getHours() + 2) % 24;
	await putWorkspaceConfigText(
		"default",
		`image_policy:\n  daily_limit: 0\n  allowed_hours: [${nextHour}, ${(nextHour + 1) % 24}]\n`,
	);
	await expect(
		generateVideo({ imageUrl, prompt: "", durationSec: 4 }, { workspace: "default" }),
	).rejects.toBeInstanceOf(QuotaExceededError);
	expect(submitted).toHaveLength(0);
});

test("non-owner cannot select global video provider", async () => {
	const app = testApp(capabilitiesRoutes(), {
		userId: "member",
		email: "member@example.com",
		role: "member",
	});
	const response = await app.request("/video/provider", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ provider_id: "sandbox" }),
	});
	expect(response.status).toBe(403);
});
