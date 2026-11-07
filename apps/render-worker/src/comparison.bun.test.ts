/* The production comparison on real files (OpenSpec p2-export task 4.2). Needs
 * FFmpeg and the built host (`cargo build -p maleo-render-host`). */
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Storyboard } from "@maleo/video/schema";
import { compareOutputs, loadComparisonConfig } from "./comparison";

const HOST = resolve(import.meta.dir, "..", "..", "..", "target", "debug", "maleo-render");
const ROOT = mkdtempSync(join(tmpdir(), "maleo-comparison-"));
const ready = existsSync(HOST) ? describe : describe.skip;

/** 2 s, 30 fps; a 440 Hz burst from `burst` to `burst + 0.5` s; `box` draws a white square. */
function movie(name: string, burst: number, box = false): string {
	const file = join(ROOT, name);
	const video = box
		? "testsrc2=s=216x384:r=30:d=2,drawbox=x=40:y=80:w=120:h=120:c=white:t=fill"
		: "testsrc2=s=216x384:r=30:d=2";
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-y",
		"-f",
		"lavfi",
		"-i",
		video,
		"-f",
		"lavfi",
		"-i",
		`aevalsrc='if(between(t\\,${burst}\\,${burst + 0.5})\\,0.5*sin(2*PI*440*t)\\,0)':s=48000:d=2`,
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-shortest",
		file,
	]);
	return file;
}

const storyboard = {
	scenes: [{ image: "a.png", durationSec: 2, transition: "cut" }],
	audioOverlays: [
		{ url: "media/burst.wav", kind: "sfx", startSec: 0.5, durationSec: 0.5, volume: 1 },
	],
} as unknown as Storyboard;

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

ready("compareOutputs", () => {
	const run = { command: [HOST] };
	const reference = movie("reference.mp4", 0.5);
	const compare = async (candidate: string, name: string) =>
		compareOutputs({
			reference,
			candidate,
			storyboard,
			compositionId: "StoryboardReel",
			dir: join(ROOT, "comparisons", name),
			config: await loadComparisonConfig(),
			run,
		});

	test("identical outputs pass and keep no artifacts", async () => {
		const copy = join(ROOT, "copy.mp4");
		copyFileSync(reference, copy);
		const result = await compare(copy, "same");
		expect(result.failures).toEqual([]);
		expect(result.passed).toBe(true);
		expect(result.frames.map((f) => [f.frame, f.why])).toEqual([
			[0, "scene"],
			[30, "second"],
		]);
		expect(result.frames.every((f) => f.ssim === 1)).toBe(true);
		expect(result.onsets[0]?.offset).toBe(0);
		expect(result.loudness.windows).toBeGreaterThan(0);
		expect(existsSync(join(ROOT, "comparisons", "same"))).toBe(false);
	}, 60_000);

	test("audio more than one frame late fails and names the clip", async () => {
		// 1.5 frames: the spec fails a clip "more than one frame later".
		const late = movie("late.mp4", 0.55);
		const result = await compare(late, "late");
		expect(result.passed).toBe(false);
		const offset = result.onsets[0]?.offset ?? 0;
		expect(offset).toBeGreaterThan(0.045);
		expect(offset).toBeLessThan(0.055);
		expect(
			result.failures.some((f) => f.startsWith("audioOverlays[0] (media/burst.wav) starts")),
		).toBe(true);
		expect(result.frames.every((f) => f.ssim === 1)).toBe(true);
	}, 60_000);

	test("a visual change fails and keeps the frames and the difference image", async () => {
		const boxed = movie("boxed.mp4", 0.5, true);
		const result = await compare(boxed, "boxed");
		expect(result.passed).toBe(false);
		expect(
			result.failures.some((f) => /^frame 0 \(0\.000 s, scene\) SSIM 0\.\d+ below/.test(f)),
		).toBe(true);
		const dir = join(ROOT, "comparisons", "boxed");
		expect(result.artifacts).toBe(dir);
		expect(readdirSync(join(dir, "reference"))).toEqual(["f000000.png", "f000030.png"]);
		expect(readdirSync(join(dir, "candidate"))).toEqual(["f000000.png", "f000030.png"]);
		expect(readdirSync(join(dir, "difference"))).toEqual(["f000000.png", "f000030.png"]);
		expect(existsSync(join(dir, "scores.json"))).toBe(true);
		expect(result.onsets[0]?.offset).toBe(0);
	}, 60_000);
});
