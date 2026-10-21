import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { registerMediaObject } from "@maleo/db/media-objects";
import { deleteMedia, putMedia } from "@maleo/storage";
import { getProvider } from "@maleo/media/providers";

const endpoint = process.env.MALEO_MEDIA_TEST_ENDPOINT;
const run = endpoint ? test : test.skip;

run(
	"external image-to-video fetch reads a fresh managed reference after delay",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "maleo-fal-minio-"));
		const prior = { ...process.env };
		const originalFetch = globalThis.fetch;
		let key: string | undefined;
		try {
			Object.assign(process.env, {
				MALEO_DB_PATH: join(root, "db.sqlite"),
				MALEO_DATA_DIR: root,
				MALEO_MEDIA_STORAGE_BACKEND: "s3",
				MALEO_MEDIA_S3_BUCKET: process.env.MALEO_MEDIA_TEST_BUCKET ?? "maleo-test",
				MALEO_MEDIA_S3_ENDPOINT: endpoint,
				MALEO_MEDIA_S3_PUBLIC_ENDPOINT: endpoint,
				MALEO_MEDIA_S3_REGION: "us-east-1",
				MALEO_MEDIA_S3_ACCESS_KEY_ID: process.env.MALEO_MEDIA_TEST_ACCESS_KEY ?? "maleoapp",
				MALEO_MEDIA_S3_SECRET_ACCESS_KEY:
					process.env.MALEO_MEDIA_TEST_SECRET_KEY ?? "maleoappsecret",
				MALEO_MEDIA_URL_LIFETIME_SECONDS: "1",
				FAL_KEY: "test-only",
			});
			await mkdir(join(root, "workspaces", "owner"), { recursive: true });
			await writeFile(
				join(root, "workspaces", "owner", "config.yaml"),
				"image_policy:\n  daily_limit: 5\n",
			);
			await closeMaleoDb();
			const db = openDb();
			const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
			const stored = await putMedia({
				workspace: "owner",
				kind: "image",
				body: bytes,
				contentType: "image/png",
			});
			key = stored.key;
			const object = await registerMediaObject(
				{
					workspace: "owner",
					kind: "image",
					hash: stored.hash,
					storage_key: stored.key,
					content_type: stored.contentType,
					size: stored.size,
				},
				db,
			);
			const fixture = await getProvider("sandbox")!.video!.generate(
				{ imageUrl: stored.key, prompt: "fixture", durationSec: 4 },
				{ workspaceId: "owner" },
			);
			const videoBytes = await Bun.file(fixture.path).arrayBuffer();
			let providerReads = 0;
			globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input) === "https://v3.fal.media/clip.mp4") return new Response(videoBytes);
				if (!String(input).startsWith("https://fal.run/")) return originalFetch(input, init);
				const body = JSON.parse(String(init?.body)) as { image_url: string };
				await Bun.sleep(1500);
				const source = await originalFetch(body.image_url);
				expect(source.status).toBe(200);
				expect(new Uint8Array(await source.arrayBuffer())).toEqual(bytes);
				providerReads++;
				return Response.json({ video: { url: "https://v3.fal.media/clip.mp4" } });
			}) as unknown as typeof fetch;
			const result = await getProvider("fal")!.video!.generate(
				{ imageUrl: object.storage_key, prompt: "animate", durationSec: 2 },
				{ workspaceId: "owner" },
			);
			expect(result.durationSec).toBe(4);
			expect(providerReads).toBe(1);
		} finally {
			globalThis.fetch = originalFetch;
			if (key) await deleteMedia(key);
			await closeMaleoDb();
			for (const name of Object.keys(process.env))
				if (!(name in prior) && name !== "MALEO_DATA_DIR") delete process.env[name];
			Object.assign(process.env, prior);
			await rm(root, { recursive: true, force: true });
		}
	},
	30_000,
);
