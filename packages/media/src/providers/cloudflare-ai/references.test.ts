import { afterAll, describe, expect, it } from "vite-plus/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { resolveImageModel } from "./models.ts";
import { downscaleReference, resolveCloudflareReferences } from "./references.ts";

const klein = resolveImageModel("@cf/black-forest-labs/flux-2-klein-4b");
const schnell = resolveImageModel("@cf/black-forest-labs/flux-1-schnell");

const dir = await mkdtemp(join(tmpdir(), "cf-refs-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

async function fixture(
	name: string,
	width: number,
	height: number,
	format: "png" | "jpeg",
): Promise<string> {
	const path = join(dir, name);
	const image = sharp({
		create: { width, height, channels: 3, background: { r: 20, g: 40, b: 80 } },
	});
	await (format === "png" ? image.png() : image.jpeg()).toFile(path);
	return path;
}

const big = await fixture("big.png", 1200, 800, "png");
const small = await fixture("small.jpg", 200, 120, "jpeg");

describe("reference resolution", () => {
	it("returns nothing when no references are requested", async () => {
		expect(await resolveCloudflareReferences(undefined, klein)).toEqual([]);
		expect(await resolveCloudflareReferences([" "], klein)).toEqual([]);
	});

	it("refuses references on a model that accepts none, naming the alternatives", async () => {
		// The message names a way forward, and every provider it names must exist —
		// advice pointing at a retired provider is worse than no advice.
		await expect(resolveCloudflareReferences([big], schnell)).rejects.toThrow(
			/use the codex provider/,
		);
	});

	it("refuses more references than the model accepts, naming both counts", async () => {
		const many = [big, small, big, small, big].map((p, i) => `${p}#${i}`.replace(/#\d+$/, ""));
		// Five distinct requests against a cap of four.
		const requests = [...many.slice(0, 4), await fixture("fifth.png", 64, 64, "png")];
		await expect(resolveCloudflareReferences(requests, klein)).rejects.toThrow(/at most 4/);
		await expect(resolveCloudflareReferences(requests, klein)).rejects.toThrow(/received 5/);
	});

	it("refuses a reference that is not worker-reachable", async () => {
		await expect(
			resolveCloudflareReferences(["https://example.com/cat.png"], klein),
		).rejects.toThrow(/not worker-reachable/);
	});

	it("refuses a reference that cannot be decoded, naming it", async () => {
		const broken = join(dir, "broken.png");
		await writeFile(broken, "not an image");
		await expect(resolveCloudflareReferences([broken], klein)).rejects.toThrow(
			/could not be decoded/,
		);
		await expect(resolveCloudflareReferences([broken], klein)).rejects.toThrow(/broken\.png/);
	});
});

describe("reference downscaling", () => {
	it("brings an oversized reference under the model's input limit", async () => {
		const [reference] = await resolveCloudflareReferences([big], klein);
		const { width, height } = await sharp(reference!.bytes).metadata();
		expect(width!).toBeLessThanOrEqual(klein.maxReferenceEdge!);
		expect(height!).toBeLessThanOrEqual(klein.maxReferenceEdge!);
	});

	it("preserves the reference's aspect while downscaling", async () => {
		const [reference] = await resolveCloudflareReferences([big], klein);
		const { width, height } = await sharp(reference!.bytes).metadata();
		expect(width! / height!).toBeCloseTo(1200 / 800, 1);
	});

	it("leaves an already-small reference untouched and declares its real type", async () => {
		const [reference] = await resolveCloudflareReferences([small], klein);
		// Passed through, so the declared type must match the file rather than the
		// PNG the re-encode branch would have produced.
		expect(reference!.contentType).toBe("image/jpeg");
	});

	it("re-encodes rather than passing bytes through with a guessed type", async () => {
		const [reference] = await resolveCloudflareReferences([big], klein);
		expect(reference!.contentType).toBe("image/png");
	});

	it("reports an unreadable path rather than skipping it", async () => {
		await expect(downscaleReference(join(dir, "absent.png"), 511)).rejects.toThrow(
			/could not be read/,
		);
	});
});
