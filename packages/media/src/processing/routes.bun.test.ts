import { expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { inngest } from "@maleo/inngest";
import { createMediaClient } from "../api/client.ts";
import { getProcessingJob } from "../generation/store.ts";
import { processingRoutes } from "./routes.ts";

test("processing HTTP/client fail closed, validate requests, scope polling/cancellation and retry identity", async () => {
	const oldToken = process.env.MALEO_SERVICE_TOKEN;
	const send = spyOn(inngest, "send").mockResolvedValue({ ids: ["event-proof"] });
	try {
		const app = processingRoutes();
		delete process.env.MALEO_SERVICE_TOKEN;
		expect((await app.request("http://worker.test/", { method: "POST", body: "{}" })).status).toBe(
			401,
		);
		process.env.MALEO_SERVICE_TOKEN = "processing-test-only";
		const client = createMediaClient({
			baseUrl: "http://worker.test",
			token: process.env.MALEO_SERVICE_TOKEN,
			fetch: async (input, init) => app.request(String(input).replace("/processing", ""), init),
		});
		const request = {
			importId: randomUUID(),
			workspaceId: "proof",
			projectId: "project",
			sourceRevision: "r1",
			fingerprint: "a".repeat(64),
			originalFilename: "camera.mov",
			kind: "video" as const,
			idempotencyKey: randomUUID(),
		};
		const id = await client.submitProcessing(request);
		expect(await client.submitProcessing(request)).toBe(id);
		expect(send.mock.calls).toHaveLength(2);
		expect((await client.pollProcessing(id, request)).request).toEqual(request);
		await expect(
			client.pollProcessing(id, { workspaceId: "other", projectId: "project" }),
		).rejects.toThrow("404");
		await expect(
			client.cancelProcessing(id, { workspaceId: "proof", projectId: "other" }),
		).rejects.toThrow("404");
		expect(getProcessingJob(id)?.status).toBe("queued");
		expect((await client.cancelProcessing(id, request)).status).toBe("cancelled");
		await expect(client.submitProcessing({ ...request, sourceRevision: "r2" })).rejects.toThrow(
			"409",
		);
		expect(
			(
				await app.request("http://worker.test/", {
					method: "POST",
					headers: {
						authorization: "Bearer processing-test-only",
						"content-type": "application/json",
					},
					body: JSON.stringify({ ...request, storageKey: "untrusted" }),
				})
			).status,
		).toBe(400);
		const stalled = createMediaClient({
			baseUrl: "http://worker.test",
			requestTimeoutMs: 10,
			fetch: (_input, init) =>
				new Promise((_, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
						once: true,
					});
				}),
		});
		await expect(stalled.pollProcessing(id, request)).rejects.toThrow("timed out");
		await expect(stalled.cancelProcessing(id, request)).rejects.toThrow("timed out");
	} finally {
		send.mockRestore();
		if (oldToken === undefined) delete process.env.MALEO_SERVICE_TOKEN;
		else process.env.MALEO_SERVICE_TOKEN = oldToken;
	}
});
