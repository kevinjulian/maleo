import { expect, test } from "vite-plus/test";
import {
	generationRequested,
	mediaProcessingRequested,
	mediaProcessingRequestedEvent,
} from "./events.ts";

test("processing event carries scoped persisted identity; generation contract remains separate", () => {
	const data = { jobId: "j1", workspaceId: "w1", projectId: "p1", idempotencyKey: "j1" };
	expect(mediaProcessingRequested.parse(data)).toEqual(data);
	expect(mediaProcessingRequestedEvent.create(data).name).toBe("media/processing.requested");
	expect(
		mediaProcessingRequested.safeParse({ ...data, url: "https://untrusted.test" }).success,
	).toBe(false);
	expect(mediaProcessingRequested.safeParse({ jobId: "j1" }).success).toBe(false);
	expect(
		generationRequested.safeParse({ ...data, kind: "processing", prompt: "file" }).success,
	).toBe(false);
});
