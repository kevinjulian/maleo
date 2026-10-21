#!/usr/bin/env bun
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sliceSourceInterval, sourceTime } from "@maleo/shared";

// Lossless red channel encodes frame index; each eighth frame introduces a VFR gap.
const dir = await mkdtemp(join(tmpdir(), "maleo-source-interval-"));
try {
	const path = join(dir, "numbered-vfr.mkv");
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"nullsrc=s=16x16:r=8:d=24",
		"-vf",
		"format=rgb24,geq=r=N:g=0:b=0,setpts=(N+floor(N/8))/(8*TB)",
		"-fps_mode",
		"vfr",
		"-c:v",
		"ffv1",
		"-pix_fmt",
		"bgr0",
		path,
	]);
	const probe = JSON.parse(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_entries",
				"frame=best_effort_timestamp_time",
				"-of",
				"json",
				path,
			],
			{ encoding: "utf8" },
		),
	);
	const timestamps: number[] = probe.frames.map((frame: { best_effort_timestamp_time: string }) =>
		Number(frame.best_effort_timestamp_time),
	);
	assert(
		timestamps.some((time, index) => index > 0 && time - timestamps[index - 1]! > 0.2),
		"Fixture must contain variable timestamps",
	);
	const frameAt = (time: number): number => {
		const rgb = execFileSync("ffmpeg", [
			"-v",
			"error",
			"-ss",
			String(time),
			"-i",
			path,
			"-frames:v",
			"1",
			"-pix_fmt",
			"rgb24",
			"-f",
			"rawvideo",
			"pipe:1",
		]);
		assert.equal(
			rgb[0],
			timestamps.findIndex((timestamp) => timestamp >= time - 0.000001),
			`Wrong native frame at ${time}s`,
		);
		return rgb[0]!;
	};
	let comparisons = 0;
	for (const rate of [0.25, 1, 4])
		for (const reverse of [false, true]) {
			const right = sliceSourceInterval(2.25, 4, rate, reverse, 1.5, 4);
			for (const local of [0, 0.75, 2.25]) {
				assert.equal(
					frameAt(sourceTime(right.start, 2.5, rate, reverse, local)),
					frameAt(sourceTime(2.25, 4, rate, reverse, 1.5 + local)),
					"Split changed retained numbered footage",
				);
				comparisons++;
			}
			const trimmed = sliceSourceInterval(2.25, 4, rate, reverse, 0.5, 3.5);
			assert.equal(
				frameAt(sourceTime(trimmed.start, 3, rate, reverse, 1.25)),
				frameAt(sourceTime(2.25, 4, rate, reverse, 1.75)),
				"Trim changed retained numbered footage",
			);
			comparisons++;
		}
	console.log(
		JSON.stringify({
			sourceFrames: timestamps.length,
			variableTimestamps: true,
			rates: [0.25, 1, 4],
			directions: ["forward", "reverse"],
			retainedFrameComparisons: comparisons,
		}),
	);
} finally {
	await rm(dir, { recursive: true, force: true });
}
