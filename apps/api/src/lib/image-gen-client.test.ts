import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { getMediaClient, mediaWorkerConfigured } from "./image-gen-client.ts";

const prevWorker = process.env.MALEO_GEN_WORKER_URL;

beforeEach(() => {
	delete process.env.MALEO_GEN_WORKER_URL;
});
afterEach(() => {
	if (prevWorker === undefined) delete process.env.MALEO_GEN_WORKER_URL;
	else process.env.MALEO_GEN_WORKER_URL = prevWorker;
});

describe("media worker configuration", () => {
	test("is absent without worker URL", () => {
		expect(mediaWorkerConfigured()).toBe(false);
		expect(getMediaClient()).toBeNull();
	});

	test("uses worker URL without a transport flag", () => {
		process.env.MALEO_GEN_WORKER_URL = "http://media-worker:7071";
		expect(mediaWorkerConfigured()).toBe(true);
		expect(getMediaClient()).not.toBeNull();
	});
});
