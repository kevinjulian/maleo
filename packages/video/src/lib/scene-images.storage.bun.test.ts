import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putMedia } from "@maleo/storage";
import { resolveSceneImage } from "./scene-images.ts";

test("scene image resolves stored worker output without worker file serving", async () => {
	const root = await mkdtemp(join(tmpdir(), "maleo-scene-store-"));
	const prior = {
		url: process.env.MALEO_IMAGE_URL,
		mode: process.env.MALEO_MEDIA_STORAGE_BACKEND,
		data: process.env.MALEO_DATA_DIR,
		env: process.env.NODE_ENV,
	};
	let server: ReturnType<typeof Bun.serve> | undefined;
	try {
		process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
		process.env.MALEO_DATA_DIR = join(root, "data");
		delete process.env.NODE_ENV;
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const stored = await putMedia({
			workspace: "team",
			kind: "image",
			body: bytes,
			contentType: "image/jpeg",
		});
		server = Bun.serve({
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				if (req.method === "POST" && url.pathname === "/generate")
					return Response.json({ job_id: "old" });
				if (url.pathname === "/jobs/old")
					return Response.json({ status: "done", storage_key: stored.key });
				return new Response("not_found", { status: 404 });
			},
		});
		process.env.MALEO_IMAGE_URL = `http://127.0.0.1:${server.port}`;
		const result = await resolveSceneImage("stored image", "scene", {
			cacheDir: join(root, "scene"),
		});
		expect(result.source).toBe("service");
		expect(new Uint8Array(await readFile(result.path))).toEqual(bytes);
	} finally {
		void server?.stop(true);
		for (const [name, value] of [
			["MALEO_IMAGE_URL", prior.url],
			["MALEO_MEDIA_STORAGE_BACKEND", prior.mode],
			["MALEO_DATA_DIR", prior.data],
			["NODE_ENV", prior.env],
		] as const) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		await rm(root, { recursive: true, force: true });
	}
});
