import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { CloudflareRequestError } from "./errors.ts";
import { buildBody, buildEndpoint, extensionForBytes, generateCloudflareImage } from "./image.ts";
import { resolveImageModel } from "./models.ts";

const dir = await mkdtemp(join(tmpdir(), "cf-image-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

const klein = resolveImageModel("@cf/black-forest-labs/flux-2-klein-4b");
const schnell = resolveImageModel("@cf/black-forest-labs/flux-1-schnell");

const pngBytes = new Uint8Array(
	await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } })
		.png()
		.toBuffer(),
);
const pngBase64 = Buffer.from(pngBytes).toString("base64");

function respond(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/** Records the one request made, so the encoding can be asserted. */
function stub(response: Response) {
	const calls: Request[] = [];
	const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push(new Request(typeof url === "string" ? url : url.toString(), init));
		return response;
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}

beforeEach(() => {
	process.env.MALEO_CF_ACCOUNT_ID = "acct-1";
	process.env.MALEO_CF_API_TOKEN = "token-1";
	process.env.MALEO_CF_IMAGE_MODEL = "";
	process.env.CACHE_DIR = dir;
});

describe("request shape", () => {
	it("targets the account's model run endpoint", () => {
		expect(buildEndpoint("acct-1", klein.id)).toBe(
			"https://api.cloudflare.com/client/v4/accounts/acct-1/ai/run/@cf/black-forest-labs/flux-2-klein-4b",
		);
	});

	it("sends multipart with dimensions and indexed references for klein", () => {
		const body = buildBody(klein, "a fox", { width: 1080, height: 1920 }, [
			{ source: "/a.png", bytes: pngBytes, contentType: "image/png" },
			{ source: "/b.png", bytes: pngBytes, contentType: "image/png" },
		]);
		expect(body).toBeInstanceOf(FormData);
		const form = body as FormData;
		expect(form.get("prompt")).toBe("a fox");
		expect(form.get("width")).toBe("1080");
		expect(form.get("height")).toBe("1920");
		expect(form.get("input_image_0")).toBeInstanceOf(Blob);
		expect(form.get("input_image_1")).toBeInstanceOf(Blob);
		expect(form.get("input_image_2")).toBeNull();
	});

	it("omits steps, which klein fixes at 4 and does not vary", () => {
		const form = buildBody(klein, "a fox", { width: 1024, height: 1024 }, []) as FormData;
		expect(form.get("steps")).toBeNull();
	});

	it("sends JSON for flux-1-schnell, which takes no dimensions", () => {
		const body = buildBody(schnell, "a fox", null, []);
		expect(body).toBe(JSON.stringify({ prompt: "a fox" }));
	});
});

describe("output handling", () => {
	it("decodes the payload, writes it into CACHE_DIR, and returns that path", async () => {
		const { fetchImpl } = stub(respond(200, { result: { image: pngBase64 } }));
		const result = await generateCloudflareImage({ prompt: "a fox", aspect: "9:16", fetchImpl });

		expect(result.path.startsWith(dir)).toBe(true);
		expect(result.provider).toBe("cloudflare-ai");
		expect(result.model).toBe(klein.id);
		expect(new Uint8Array(await readFile(result.path))).toEqual(pngBytes);
	});

	it("fails on a missing payload rather than writing a zero-byte file", async () => {
		const { fetchImpl } = stub(respond(200, { result: {} }));
		await expect(generateCloudflareImage({ prompt: "a fox", fetchImpl })).rejects.toThrow(
			/returned no image payload/,
		);
	});

	it("fails on an empty payload", async () => {
		const { fetchImpl } = stub(respond(200, { result: { image: "" } }));
		await expect(generateCloudflareImage({ prompt: "a fox", fetchImpl })).rejects.toThrow(
			/no image payload/,
		);
	});

	it("names the extension from the bytes rather than assuming png", () => {
		expect(extensionForBytes(pngBytes)).toBe("png");
		expect(extensionForBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
	});
});

describe("refusals happen before any billed request", () => {
	it("refuses a non-square aspect on a square-only model without calling out", async () => {
		process.env.MALEO_CF_IMAGE_MODEL = schnell.id;
		const { fetchImpl, calls } = stub(respond(200, { result: { image: pngBase64 } }));
		await expect(
			generateCloudflareImage({ prompt: "a fox", aspect: "9:16", fetchImpl }),
		).rejects.toThrow(/fixed square/);
		expect(calls).toHaveLength(0);
	});

	it("refuses an unknown configured model without calling out", async () => {
		process.env.MALEO_CF_IMAGE_MODEL = "@cf/not/a-model";
		const { fetchImpl, calls } = stub(respond(200, { result: { image: pngBase64 } }));
		await expect(generateCloudflareImage({ prompt: "a fox", fetchImpl })).rejects.toThrow(
			/unknown Cloudflare image model/,
		);
		expect(calls).toHaveLength(0);
	});

	it("fails when credentials are absent", async () => {
		process.env.MALEO_CF_ACCOUNT_ID = "";
		const { fetchImpl } = stub(respond(200, { result: { image: pngBase64 } }));
		await expect(generateCloudflareImage({ prompt: "a fox", fetchImpl })).rejects.toThrow(
			/unconfigured/,
		);
	});
});

describe("upstream failures surface without waiting", () => {
	it("raises a rate limit promptly, preserving the status", async () => {
		const { fetchImpl } = stub(
			respond(429, { errors: [{ code: 10000, message: "rate limited" }] }),
		);
		const started = performance.now();
		const error = await generateCloudflareImage({ prompt: "a fox", fetchImpl }).catch((e) => e);
		expect(error).toBeInstanceOf(CloudflareRequestError);
		expect((error as CloudflareRequestError).status).toBe(429);
		expect((error as CloudflareRequestError).retryable).toBe(true);
		// The reference implementation slept 30s here; durable retry owns that now.
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it("carries the upstream detail into the message", async () => {
		const { fetchImpl } = stub(
			respond(500, { errors: [{ code: 3000, message: "inference failed" }] }),
		);
		await expect(generateCloudflareImage({ prompt: "a fox", fetchImpl })).rejects.toThrow(
			/inference failed/,
		);
	});

	it("marks a client error as not retryable, so retries do not spend the allowance", async () => {
		const { fetchImpl } = stub(respond(400, { errors: [{ message: "bad request" }] }));
		const error = await generateCloudflareImage({ prompt: "a fox", fetchImpl }).catch((e) => e);
		expect((error as CloudflareRequestError).retryable).toBe(false);
	});
});
