import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Hono } from "hono";
import { openDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import {
	attachImportOriginal,
	cancelProjectMediaImport,
	reserveProjectMediaImport,
} from "@maleo/db/media-imports";
import { putMedia } from "@maleo/storage";
import { internalMediaImportRoutes } from "../../index.ts";

test("runtime quarantine authorization scopes revision/project/workspace and streams original bytes", async () => {
	const previous = {
		data: process.env.MALEO_DATA_DIR,
		cache: process.env.CACHE_DIR,
		backend: process.env.MALEO_MEDIA_STORAGE_BACKEND,
		token: process.env.MALEO_SERVICE_TOKEN,
	};
	const directory = await mkdtemp(join(tmpdir(), "maleo-source-proof-"));
	process.env.MALEO_DATA_DIR = directory;
	process.env.CACHE_DIR = join(directory, "cache");
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	process.env.MALEO_SERVICE_TOKEN = "source-proof-only";
	const app = new Hono();
	app.route("/internal/media-imports", internalMediaImportRoutes());
	const server = Bun.serve({ port: 0, fetch: app.fetch });
	try {
		const project = (await createContentProject({
			title: "Source proof",
			workspace: "source-proof",
		}))!;
		const bytes = execFileSync("ffmpeg", [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=c=blue:s=32x32",
			"-frames:v",
			"1",
			"-f",
			"image2pipe",
			"-c:v",
			"png",
			"pipe:1",
		]);
		const original = await putMedia({
			workspace: "source-proof",
			project: project.project.id,
			kind: "file",
			body: new Uint8Array(bytes),
			filename: "original.png",
			contentType: "application/octet-stream",
		});
		const { row } = await reserveProjectMediaImport({
			workspace: "source-proof",
			projectId: project.project.id,
			requestKey: randomUUID(),
			filename: "original.png",
			kind: "image",
			uploadTimeoutMs: 60000,
		});
		expect(await attachImportOriginal(row, original)).toBe(true);
		const query = new URLSearchParams({
			workspace: row.workspace,
			project: row.project_id,
			revision: row.source_revision,
		});
		const url = new URL(`/internal/media-imports/${row.id}/source?${query}`, server.url);
		expect((await fetch(url)).status).toBe(401);
		const headers = { authorization: "Bearer source-proof-only" };
		for (const key of ["workspace", "project", "revision"]) {
			const wrong = new URL(url);
			wrong.searchParams.set(key, "other");
			expect((await fetch(wrong, { headers })).status).toBe(404);
		}
		const source = await fetch(url, { headers });
		expect(Buffer.from(await source.arrayBuffer())).toEqual(bytes);
		const head = await fetch(url, { method: "HEAD", headers });
		expect(head.headers.get("content-length")).toBe(String(bytes.length));
		expect(await head.text()).toBe("");
		expect(
			await openDb().get("SELECT id FROM media_objects WHERE storage_key = ?", [original.key]),
		).toBeNull();
		await cancelProjectMediaImport(row);
		expect((await fetch(url, { headers })).status).toBe(404);
	} finally {
		void server.stop(true);
		if (previous.data !== undefined) process.env.MALEO_DATA_DIR = previous.data;
		for (const [key, value] of [
			["CACHE_DIR", previous.cache],
			["MALEO_MEDIA_STORAGE_BACKEND", previous.backend],
			["MALEO_SERVICE_TOKEN", previous.token],
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(directory, { recursive: true, force: true });
	}
});
