import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Ten-minute audiovisual marker fixture: a numbered video and a click every 0.5 s over a quiet tone. */
export const SYNC_SECONDS = 600;
export const SYNC_FPS = 30;
export const CLICK_INTERVAL_SEC = 0.5;

const output = resolve(process.argv[2] ?? "data/media-playback-sync");
mkdirSync(output, { recursive: true });
const font = resolve(import.meta.dirname, "../crates/renderer/fonts/inter-normal-latin.ttf");
const sources: Record<string, string[]> = {
	"sync-video.mp4": [
		"-f",
		"lavfi",
		"-i",
		`testsrc2=size=320x180:rate=${SYNC_FPS}:duration=${SYNC_SECONDS}`,
		"-vf",
		`drawtext=fontfile=${font}:text='%{n}':fontsize=40:fontcolor=white:box=1:boxcolor=black:x=8:y=8`,
		"-c:v",
		"libx264",
		"-preset",
		"ultrafast",
		"-crf",
		"30",
		"-g",
		String(SYNC_FPS),
		"-bf",
		"0",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
	],
	// The tone keeps output audibly non-silent, so onset after a flush is measurable between clicks.
	"sync-clicks.m4a": [
		"-f",
		"lavfi",
		"-i",
		`aevalsrc=0.05*sin(2*PI*220*t)+0.9*lt(mod(t\\,${CLICK_INTERVAL_SEC})\\,0.003):s=48000:d=${SYNC_SECONDS}`,
		"-c:a",
		"aac",
		"-b:a",
		"128k",
		"-ac",
		"1",
		"-movflags",
		"+faststart",
	],
};
const commands: string[][] = [];
const files: Record<string, { bytes: number; sha256: string }> = {};
for (const [name, input] of Object.entries(sources)) {
	const args = [
		"-v",
		"error",
		"-y",
		...input,
		"-threads",
		"2",
		"-fflags",
		"+bitexact",
		resolve(output, name),
	];
	commands.push(["ffmpeg", ...args]);
	execFileSync("ffmpeg", args, { stdio: "pipe" });
	const duration = Number(
		execFileSync(
			"ffprobe",
			["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", resolve(output, name)],
			{ encoding: "utf8" },
		),
	);
	assert.ok(Math.abs(duration - SYNC_SECONDS) < 0.1, `${name} lasts ${duration} s`);
	const bytes = readFileSync(resolve(output, name));
	files[name] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
writeFileSync(resolve(output, "manifest.json"), JSON.stringify({ commands, files }, null, 2));
console.log(`Generated the ${SYNC_SECONDS}-second sync fixture in ${output}`);
