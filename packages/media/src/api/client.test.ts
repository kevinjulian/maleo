import { describe, expect, test } from "vite-plus/test";
import { createMediaClient } from "./client.ts";

function hangingFetch(): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
	return (_input: RequestInfo | URL, init?: RequestInit) =>
		new Promise<Response>((_resolve, reject) => {
			const signal = init?.signal;
			if (!signal) return;
			if (signal.aborted) return reject(signal.reason);
			signal.addEventListener("abort", () => reject(signal.reason), { once: true });
		});
}

describe("media client transport bounds", () => {
	test("video submission is bounded and carries provider, owner, and retry identity", async () => {
		const hung = createMediaClient({
			baseUrl: "http://media.test",
			requestTimeoutMs: 10,
			fetch: hangingFetch(),
		});
		await expect(
			hung.submitVideo({ imageUrl: "source", prompt: "", durationSec: 7 }),
		).rejects.toThrow("media /video timed out");
		let body: unknown;
		const client = createMediaClient({
			baseUrl: "http://media.test",
			fetch: async (_, init) => {
				body = JSON.parse(String(init?.body));
				return Response.json({ job_id: "v1" });
			},
		});
		expect(
			await client.submitVideo({
				imageUrl: "source",
				prompt: "mock",
				durationSec: 7,
				workspaceId: "w",
				projectId: "p",
				providerId: "sandbox",
				providerSource: "workspace",
				idempotencyKey: "retry",
			}),
		).toBe("v1");
		expect(body).toMatchObject({
			image_url: "source",
			duration_sec: 7,
			workspace_id: "w",
			project_id: "p",
			provider_id: "sandbox",
			provider_source: "workspace",
			idempotency_key: "retry",
		});
	});
	test("completed video metadata retains four-second source duration", async () => {
		const client = createMediaClient({
			baseUrl: "http://media.test",
			fetch: async () =>
				Response.json({
					id: "v1",
					kind: "video",
					status: "done",
					duration_sec: 4,
					provider_id: "sandbox",
					model: "sandbox-mp4",
					storage_key: "workspaces/w/video/file.mp4",
					storage_hash: "hash",
					storage_size: 100,
					storage_content_type: "video/mp4",
				}),
		});
		expect(await client.poll("v1")).toMatchObject({
			kind: "video",
			durationSec: 4,
			providerId: "sandbox",
			stored: { contentType: "video/mp4" },
		});
	});
	test.each([true, false])("maps optional video poster: %s", async (withPoster) => {
		const client = createMediaClient({
			baseUrl: "http://media.test",
			fetch: async () =>
				Response.json({
					id: "video",
					kind: "video",
					status: "done",
					...(withPoster
						? {
								poster_storage_key: "workspaces/w/image/poster.jpg",
								poster_storage_hash: "jpeg-hash",
								poster_storage_size: 42,
								poster_storage_content_type: "image/jpeg",
							}
						: {}),
				}),
		});
		expect((await client.poll("video")).poster).toEqual(
			withPoster
				? {
						key: "workspaces/w/image/poster.jpg",
						hash: "jpeg-hash",
						size: 42,
						contentType: "image/jpeg",
					}
				: undefined,
		);
	});
	test("times out a hung image submission", async () => {
		const client = createMediaClient({
			baseUrl: "http://media.test",
			requestTimeoutMs: 10,
			fetch: hangingFetch(),
		});

		await expect(client.submitImage({ prompt: "frame" })).rejects.toThrow(
			"media /generate timed out after 10ms",
		);
	});

	test("times out a hung job poll", async () => {
		const client = createMediaClient({
			baseUrl: "http://media.test",
			requestTimeoutMs: 10,
			fetch: hangingFetch(),
		});

		await expect(client.poll("job-1")).rejects.toThrow("media poll timed out after 10ms");
	});

	test("maps a completed image job", async () => {
		const client = createMediaClient({
			baseUrl: "http://media.test/",
			fetch: async () =>
				Response.json({
					id: "job-1",
					kind: "image",
					status: "done",
					image_url: "/files/frame.png",
					from_cache: true,
					provider_id: "sandbox",
					provider_source: "workspace",
					model: "sandbox-svg",
					cost: 0,
					latency_ms: 236,
					error: null,
				}),
		});

		await expect(client.poll("job-1")).resolves.toEqual({
			id: "job-1",
			kind: "image",
			status: "done",
			imageUrl: "/files/frame.png",
			audioUrl: null,
			fromCache: true,
			providerId: "sandbox",
			providerSource: "workspace",
			model: "sandbox-svg",
			cost: 0,
			latencyMs: 236,
			error: null,
		});
	});

	test("submits image intent to the worker", async () => {
		let submitted: unknown;
		const client = createMediaClient({
			baseUrl: "http://media.test/",
			fetch: async (_url, init) => {
				submitted = JSON.parse(String(init?.body));
				return Response.json({ job_id: "job-1" }, { status: 202 });
			},
		});

		await expect(
			client.submitImage({
				prompt: "sleepy stickman",
				intent: {
					output: { kind: "single-image", aspect: "9:16", fullFrame: true },
					subjectLocks: [],
					scene: { visualMoment: "sleepy stickman" },
					constraints: { mustInclude: [], mustAvoid: [] },
					negative: [],
					references: [],
				},
			}),
		).resolves.toBe("job-1");
		expect(submitted).toMatchObject({
			prompt: "sleepy stickman",
			intent: { scene: { visualMoment: "sleepy stickman" } },
		});
	});

	test("submits TTS metadata and downloads its artifact", async () => {
		const requests: Array<{ url: string; body?: unknown }> = [];
		const client = createMediaClient({
			baseUrl: "http://media.test",
			fetch: async (url, init) => {
				requests.push({
					url: String(url),
					body: init?.body ? JSON.parse(String(init.body)) : undefined,
				});
				if (String(url).endsWith("/tts"))
					return Response.json({ job_id: "tts-1" }, { status: 202 });
				return new Response(new Uint8Array([1, 2, 3]));
			},
		});

		await client.submitTts({ text: "hello", voice: "M1", language: "id", providerId: "sandbox" });
		await expect(client.download("/files/voice.wav")).resolves.toMatchObject({
			bytes: new Uint8Array([1, 2, 3]),
			ext: "wav",
		});
		expect(requests[0]?.body).toMatchObject({
			text: "hello",
			voice: "M1",
			language: "id",
			provider_id: "sandbox",
		});
	});
});
