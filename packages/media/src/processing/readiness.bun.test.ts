import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMediaApp } from "../worker.ts";
import { processingReadiness } from "./readiness.ts";

test("worker health exposes executable processing readiness; missing binaries refuse import explicitly", async () => {
	const app = buildMediaApp();
	const server = Bun.serve({ port: 0, fetch: app.fetch });
	const path = process.env.PATH;
	const empty = await mkdtemp(join(tmpdir(), "maleo-missing-media-binaries-"));
	const token = process.env.MALEO_SERVICE_TOKEN;
	try {
		const health = await fetch(new URL("/health", server.url));
		expect(await health.json()).toMatchObject({ ok: true, processing: { available: true } });
		process.env.PATH = empty;
		expect(await processingReadiness()).toMatchObject({
			available: false,
			reason: "Install FFmpeg and ffprobe on media worker",
		});
		expect(await (await fetch(new URL("/health", server.url))).json()).toMatchObject({
			ok: true,
			processing: { available: false },
		});
		process.env.MALEO_SERVICE_TOKEN = "readiness-proof-only";
		const response = await fetch(new URL("/processing", server.url), {
			method: "POST",
			headers: { authorization: "Bearer readiness-proof-only", "content-type": "application/json" },
			body: JSON.stringify({
				importId: "i1",
				workspaceId: "w1",
				projectId: "p1",
				sourceRevision: "r1",
				fingerprint: "a".repeat(64),
				originalFilename: "file.mp4",
				kind: "video",
				idempotencyKey: "missing-binary",
			}),
		});
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ error: "processing_unavailable" });
	} finally {
		void server.stop(true);
		if (path === undefined) delete process.env.PATH;
		else process.env.PATH = path;
		if (token === undefined) delete process.env.MALEO_SERVICE_TOKEN;
		else process.env.MALEO_SERVICE_TOKEN = token;
		await rm(empty, { recursive: true, force: true });
	}
});
