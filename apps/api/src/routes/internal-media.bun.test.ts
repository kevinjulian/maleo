/* The render worker's media read carries the registry SHA-256 (OpenSpec p2-export 3.4):
 * the worker checks the bytes against it before a render uses them. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { putMedia } from "@maleo/storage";
import { registerMediaObject } from "@maleo/db/media-objects";
import { internalMediaRoutes } from "./internal-media.ts";

const previous = {
	data: process.env.MALEO_DATA_DIR,
	backend: process.env.MALEO_MEDIA_STORAGE_BACKEND,
	token: process.env.MALEO_SERVICE_TOKEN,
};
if (!previous.data) throw new Error("Run with the test-db-guard preload");
let directory: string;
beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "maleo-internal-media-"));
	process.env.MALEO_DATA_DIR = directory;
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	process.env.MALEO_SERVICE_TOKEN = "internal-media-test";
});
afterAll(async () => {
	for (const [key, value] of [
		["MALEO_DATA_DIR", previous.data],
		["MALEO_MEDIA_STORAGE_BACKEND", previous.backend],
		["MALEO_SERVICE_TOKEN", previous.token],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	await rm(directory, { recursive: true, force: true });
});

test("a render input read sends the bytes with their registry SHA-256", async () => {
	const bytes = new Uint8Array([7, 8, 9, 10]);
	const stored = await putMedia({
		workspace: "render-hash",
		kind: "image",
		body: bytes,
		contentType: "image/png",
	});
	const row = await registerMediaObject({
		workspace: "render-hash",
		kind: "image",
		hash: stored.hash,
		storage_key: stored.key,
		size: stored.size,
		content_type: stored.contentType,
	});
	const app = new Hono().route("/internal/media", internalMediaRoutes());
	const response = await app.request(`/internal/media/${row.id}?workspace=render-hash`, {
		headers: { authorization: "Bearer internal-media-test" },
	});
	expect(response.status).toBe(200);
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
	const sha = createHash("sha256").update(bytes).digest("hex");
	expect(response.headers.get("x-maleo-sha256")).toBe(row.hash);
	expect(row.hash).toBe(sha);
});
