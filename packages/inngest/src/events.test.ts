import { describe, expect, test } from "vite-plus/test";
import { generationRequested, generationRequestedEvent } from "./events.ts";

describe("durable event contracts", () => {
	test("generation stays image or tts, names its workspace and keeps provider provenance", () => {
		const event = generationRequested.parse({
			jobId: "job-1",
			kind: "image",
			prompt: "test",
			idempotencyKey: "job-1",
			workspaceId: "default",
			providerId: "sandbox",
			providerSource: "project",
		});
		expect(event.providerSource).toBe("project");
		expect(() => generationRequested.parse({ ...event, kind: "research" })).toThrow();
		expect(() => generationRequested.parse({ ...event, workspaceId: undefined })).toThrow();
	});

	test("a typed event validates its payload before it is sent", async () => {
		const valid = generationRequestedEvent.create({
			jobId: "j",
			kind: "image",
			prompt: "p",
			idempotencyKey: "k",
			workspaceId: "default",
		});
		expect(valid.name).toBe("generation/requested");
		await expect(valid.validate()).resolves.toBeUndefined();
		// SAFETY: deliberately malformed payload to prove runtime validation rejects it.
		const invalid = generationRequestedEvent.create({
			jobId: "j",
			kind: "research",
			prompt: "p",
			idempotencyKey: "k",
			workspaceId: "default",
		} as unknown as Parameters<typeof generationRequestedEvent.create>[0]);
		await expect(invalid.validate()).rejects.toThrow();
	});
});
