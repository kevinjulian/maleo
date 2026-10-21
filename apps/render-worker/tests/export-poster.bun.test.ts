import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getMedia } from "@maleo/storage";
import { publishExportPoster } from "../src/export-poster.ts";

test("poster comes from actual MP4 pixels and remains stored after scratch removal", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "maleo-poster-"));
	const video = path.join(root, "red.mp4");
	const run = promisify(execFile);
	try {
		await run("ffmpeg", [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=96x64:d=0.2",
			"-pix_fmt",
			"yuv420p",
			"-y",
			video,
		]);
		const stored = await publishExportPoster({
			path: video,
			workspace: "poster-test",
			project: "p",
			jobId: "j",
		});
		expect(stored?.contentType).toBe("image/jpeg");
		expect(stored?.key).toMatch(/^workspaces\/poster-test\//);
		await rm(root, { recursive: true, force: true });
		const media = await getMedia(stored!.key);
		const jpeg = new Uint8Array(await media.arrayBuffer());
		expect([...jpeg.slice(0, 2)]).toEqual([255, 216]);
		await mkdir(root);
		await Bun.write(path.join(root, "restored.jpg"), jpeg);
		const pixel = await run(
			"ffmpeg",
			[
				"-v",
				"error",
				"-i",
				path.join(root, "restored.jpg"),
				"-vf",
				"scale=1:1",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"pipe:1",
			],
			{ encoding: "buffer" },
		);
		expect(pixel.stdout[0]).toBeGreaterThan(230);
		expect(pixel.stdout[1]).toBeLessThan(20);
		expect(pixel.stdout[2]).toBeLessThan(20);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("missing or invalid MP4 leaves successful export eligible without poster", async () => {
	expect(
		await publishExportPoster({
			path: "/tmp/maleo-poster-absent.mp4",
			workspace: "poster-test",
			project: "p",
			jobId: "missing",
		}),
	).toBe(null);
});
