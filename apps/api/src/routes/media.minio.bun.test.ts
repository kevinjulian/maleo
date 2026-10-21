import { afterEach, expect, test } from "bun:test";
import { openTestDb } from "@maleo/db/handle-testing";
import { addWorkspaceMember } from "@maleo/db/workspace-members";
import { registerMediaObject } from "@maleo/db/media-objects";
import { deleteMedia, putMedia } from "@maleo/storage";
import { serveMedia } from "./media";

const endpoint = process.env.MALEO_MEDIA_TEST_ENDPOINT;
const run = endpoint ? test : test.skip;
const keys = [
	"MALEO_MEDIA_STORAGE_BACKEND",
	"MALEO_MEDIA_S3_BUCKET",
	"MALEO_MEDIA_S3_ENDPOINT",
	"MALEO_MEDIA_S3_PUBLIC_ENDPOINT",
	"MALEO_MEDIA_S3_REGION",
	"MALEO_MEDIA_S3_ACCESS_KEY_ID",
	"MALEO_MEDIA_S3_SECRET_ACCESS_KEY",
	"MALEO_MEDIA_URL_LIFETIME_SECONDS",
] as const;
const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterEach(() => {
	for (const key of keys) {
		const value = prior[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

run("stable URL renews private signed destination and delivers byte ranges", async () => {
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "s3";
	process.env.MALEO_MEDIA_S3_BUCKET = process.env.MALEO_MEDIA_TEST_BUCKET ?? "maleo-test";
	process.env.MALEO_MEDIA_S3_ENDPOINT = endpoint!;
	process.env.MALEO_MEDIA_S3_PUBLIC_ENDPOINT = endpoint!;
	process.env.MALEO_MEDIA_S3_REGION = "us-east-1";
	process.env.MALEO_MEDIA_S3_ACCESS_KEY_ID = process.env.MALEO_MEDIA_TEST_ACCESS_KEY ?? "maleoapp";
	process.env.MALEO_MEDIA_S3_SECRET_ACCESS_KEY =
		process.env.MALEO_MEDIA_TEST_SECRET_KEY ?? "maleoappsecret";
	process.env.MALEO_MEDIA_URL_LIFETIME_SECONDS = "2";
	const t = await openTestDb("postgres");
	const db = t.db;
	await addWorkspaceMember({ workspace: "team", user_id: "member" }, db);
	const bytes = new TextEncoder().encode(`abcdef-${crypto.randomUUID()}`);
	const stored = await putMedia({
		workspace: "team",
		kind: "audio",
		body: bytes,
		contentType: "audio/mpeg",
	});
	const row = await registerMediaObject(
		{
			workspace: "team",
			kind: "audio",
			hash: stored.hash,
			storage_key: stored.key,
			content_type: stored.contentType,
			size: stored.size,
		},
		db,
	);
	const server = Bun.serve({
		port: 0,
		fetch: async (req) =>
			await serveMedia(
				row.id,
				req.headers.get("x-test-user") ?? "member",
				req.headers.get("range"),
				db,
				req.method === "HEAD" ? "HEAD" : "GET",
			),
	});
	const url = `http://127.0.0.1:${server.port}/api/media/${row.id}`;
	try {
		const denied = await fetch(url, { headers: { "x-test-user": "stranger" }, redirect: "manual" });
		expect(denied.status).toBe(404);
		const redirect = await fetch(url, { redirect: "manual" });
		expect(redirect.status).toBe(302);
		expect(redirect.headers.get("cache-control")).toBe("private, no-store");
		const signed = redirect.headers.get("location")!;
		const unsigned = new URL(signed);
		unsigned.search = "";
		expect((await fetch(unsigned)).status).toBe(403);
		for (const [header, expected, contentRange] of [
			["bytes=0-0", "a", `bytes 0-0/${bytes.length}`],
			[
				"bytes=3-",
				new TextDecoder().decode(bytes.slice(3)),
				`bytes 3-${bytes.length - 1}/${bytes.length}`,
			],
			[
				"bytes=-2",
				new TextDecoder().decode(bytes.slice(-2)),
				`bytes ${bytes.length - 2}-${bytes.length - 1}/${bytes.length}`,
			],
		]) {
			const response = await fetch(url, { headers: { range: header! } });
			expect(response.status).toBe(206);
			expect(await response.text()).toBe(expected);
			expect(response.headers.get("content-range")).toBe(contentRange);
			expect(response.headers.get("accept-ranges")).toBe("bytes");
		}
		const plain = await fetch(url);
		expect(plain.status).toBe(200);
		expect(plain.headers.get("accept-ranges")).toBe("bytes");
		const head = await fetch(url, { method: "HEAD" });
		expect(head.status).toBe(200);
		await new Promise((resolve) => setTimeout(resolve, 2500));
		expect((await fetch(signed)).status).toBe(403);
		expect((await fetch(url)).status).toBe(200);
	} finally {
		void server.stop(true);
		await deleteMedia(stored.key);
		await t.close();
	}
});
