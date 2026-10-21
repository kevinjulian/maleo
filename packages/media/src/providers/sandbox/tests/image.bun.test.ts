import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createSandboxSvg, generateSandboxImage, resolveSandboxDimensions } from "../index.ts";

const originalCacheDir = process.env.CACHE_DIR;
const cleanup: string[] = [];

afterEach(async () => {
	if (originalCacheDir === undefined) delete process.env.CACHE_DIR;
	else process.env.CACHE_DIR = originalCacheDir;
	await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("sandbox image provider", () => {
	it("maps supported aspects to stable resolutions", () => {
		expect(resolveSandboxDimensions({ aspect: "9:16" })).toEqual({ width: 1080, height: 1920 });
		expect(resolveSandboxDimensions({ aspect: "16:9" })).toEqual({ width: 1920, height: 1080 });
		expect(resolveSandboxDimensions({ aspect: "unknown" })).toEqual({ width: 1080, height: 1080 });
	});

	it("honors explicit dimensions and rejects partial dimensions", () => {
		expect(resolveSandboxDimensions({ width: 640, height: 360 })).toEqual({
			width: 640,
			height: 360,
		});
		expect(() => resolveSandboxDimensions({ width: 640 })).toThrow(/width and height/);
	});

	it("embeds sandbox marker, unique id, dimensions, and escaped prompt", () => {
		const svg = createSandboxSvg({
			id: "mock-id",
			prompt: "cats & <dogs>",
			width: 640,
			height: 360,
		});
		expect(svg).toContain("SANDBOX");
		expect(svg).toContain("mock-id");
		expect(svg).toContain("640 × 360");
		expect(svg).toContain("cats &amp; &lt;dogs&gt;");
	});

	it("writes a valid PNG with requested dimensions and unique filenames", async () => {
		const dir = await mkdtemp(join(tmpdir(), "maleo-sandbox-"));
		cleanup.push(dir);
		process.env.CACHE_DIR = dir;

		const first = await generateSandboxImage({ prompt: "first", width: 320, height: 180 });
		const second = await generateSandboxImage({ prompt: "second", width: 320, height: 180 });
		const metadata = await sharp(await readFile(first.path)).metadata();

		expect(metadata.format).toBe("png");
		expect(metadata.width).toBe(320);
		expect(metadata.height).toBe(180);
		expect(first.id).not.toBe(second.id);
		expect(first.path).not.toBe(second.path);
	});
});
