import { afterEach, expect, test } from "bun:test";
import {
	addressMedia,
	deleteMedia,
	getMedia,
	listMedia,
	putMedia,
	verifyMediaStorageReady,
} from "./storage";

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

run("MinIO stores private bytes with signed range, CORS, and expiry", async () => {
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "s3";
	process.env.MALEO_MEDIA_S3_BUCKET = process.env.MALEO_MEDIA_TEST_BUCKET ?? "maleo-test";
	process.env.MALEO_MEDIA_S3_ENDPOINT = endpoint!;
	process.env.MALEO_MEDIA_S3_PUBLIC_ENDPOINT = endpoint!;
	process.env.MALEO_MEDIA_S3_REGION = "us-east-1";
	process.env.MALEO_MEDIA_S3_ACCESS_KEY_ID = process.env.MALEO_MEDIA_TEST_ACCESS_KEY ?? "maleoapp";
	process.env.MALEO_MEDIA_S3_SECRET_ACCESS_KEY =
		process.env.MALEO_MEDIA_TEST_SECRET_KEY ?? "maleoappsecret";
	await verifyMediaStorageReady();
	const bytes = new TextEncoder().encode(`abcdef-${crypto.randomUUID()}`);
	const stored = await putMedia({
		workspace: "minio-test",
		kind: "audio",
		body: bytes,
		contentType: "audio/mpeg",
	});
	try {
		expect(
			(await Array.fromAsync(listMedia())).some(
				(entry) => entry.key === stored.key && Number.isFinite(entry.modifiedAt),
			),
		).toBe(true);
		expect(new Uint8Array(await (await getMedia(stored.key)).arrayBuffer())).toEqual(bytes);
		const signed = addressMedia(stored.key, "GET", 2)!;
		const unsigned = new URL(signed);
		unsigned.search = "";
		expect((await fetch(unsigned)).status).toBe(403);
		const range = await fetch(signed, {
			headers: { range: "bytes=1-3", origin: "http://127.0.0.1:3030" },
		});
		expect(range.status).toBe(206);
		expect(await range.text()).toBe("bcd");
		expect(range.headers.get("content-range")).toBe(`bytes 1-3/${bytes.length}`);
		expect(range.headers.get("content-length")).toBe("3");
		expect(range.headers.get("accept-ranges")).toBe("bytes");
		expect(range.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3030");
		expect(range.headers.get("access-control-expose-headers")).toContain("Content-Range");
		expect(range.headers.get("access-control-expose-headers")).toContain("Accept-Ranges");
		const head = await fetch(addressMedia(stored.key, "HEAD", 30)!, { method: "HEAD" });
		expect(head.status).toBe(200);
		await new Promise((resolve) => setTimeout(resolve, 2500));
		expect((await fetch(signed)).status).toBe(403);
		expect((await fetch(addressMedia(stored.key, "GET", 30)!)).status).toBe(200);
	} finally {
		await deleteMedia(stored.key);
	}
});

run(
	"S3 reads report the stored size, so byte checks and Content-Length agree with storage",
	async () => {
		process.env.MALEO_MEDIA_STORAGE_BACKEND = "s3";
		process.env.MALEO_MEDIA_S3_BUCKET = process.env.MALEO_MEDIA_TEST_BUCKET ?? "maleo-test";
		process.env.MALEO_MEDIA_S3_ENDPOINT = endpoint!;
		process.env.MALEO_MEDIA_S3_PUBLIC_ENDPOINT = endpoint!;
		process.env.MALEO_MEDIA_S3_REGION = "us-east-1";
		process.env.MALEO_MEDIA_S3_ACCESS_KEY_ID =
			process.env.MALEO_MEDIA_TEST_ACCESS_KEY ?? "maleoapp";
		process.env.MALEO_MEDIA_S3_SECRET_ACCESS_KEY =
			process.env.MALEO_MEDIA_TEST_SECRET_KEY ?? "maleoappsecret";
		const bytes = new Uint8Array(114_469).map((_, i) => i % 251);
		const stored = await putMedia({
			workspace: "minio-test",
			project: "p",
			kind: "file",
			body: new Blob([bytes]),
			contentType: "application/octet-stream",
			filename: "Screenshot at Jun 18.png",
		});
		try {
			const read = await getMedia(stored.key);
			expect(read.size).toBe(stored.size);
			expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
		} finally {
			await deleteMedia(stored.key);
		}
	},
);
