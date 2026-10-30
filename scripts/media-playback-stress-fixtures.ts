import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve(process.argv[2] ?? "data/media-playback-stress");
mkdirSync(output, { recursive: true });
const commands: string[][] = [];
type Stream = { width?: number; height?: number; nb_frames?: string };
const files: Record<string, { bytes: number; sha256: string; streams: Stream[] }> = {};
const font = resolve(import.meta.dirname, "../crates/renderer/fonts/inter-normal-latin.ttf");
for (const name of ["video-a.mp4", "video-b.mp4", "voice.wav", "music.wav"]) {
	const video = name.endsWith("mp4");
	const input = video
		? `${name.includes("a.") ? "testsrc2" : "smptebars"}=size=1920x1080:rate=30:duration=60`
		: name === "voice.wav"
			? "aevalsrc=0.1*sin(2*PI*(220*t+2*t*t)):s=48000:d=60"
			: "sine=frequency=80:sample_rate=44100:duration=60";
	const args = ["-v", "error", "-y", "-f", "lavfi", "-i", input];
	args.push(
		...(video
			? [
					"-vf",
					`drawtext=fontfile=${font}:text='Frame %{n}':fontsize=80:fontcolor=white:box=1:boxcolor=black:x=40:y=40`,
					"-c:v",
					"libx264",
					"-preset",
					"ultrafast",
					"-crf",
					"28",
					"-g",
					"30",
					"-bf",
					"0",
					"-pix_fmt",
					"yuv420p",
					"-movflags",
					"+faststart",
				]
			: ["-c:a", "pcm_s16le", "-ac", name === "voice.wav" ? "1" : "2"]),
		"-threads",
		"2",
		"-fflags",
		"+bitexact",
		resolve(output, name),
	);
	commands.push(["ffmpeg", ...args]);
	execFileSync("ffmpeg", args, { stdio: "pipe" });
	const probe: { streams: Stream[] } = JSON.parse(
		execFileSync(
			"ffprobe",
			["-v", "error", "-show_streams", "-of", "json", resolve(output, name)],
			{ encoding: "utf8" },
		),
	);
	assert.equal(probe.streams.length, 1);
	if (video) {
		assert.equal(probe.streams[0]?.width, 1920);
		assert.equal(probe.streams[0]?.height, 1080);
		assert.equal(probe.streams[0]?.nb_frames, "1800");
	}
	const bytes = readFileSync(resolve(output, name));
	files[name] = {
		bytes: bytes.length,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		...probe,
	};
}
writeFileSync(resolve(output, "manifest.json"), JSON.stringify({ commands, files }, null, 2));
console.log(`Generated four 60-second sources in ${output}`);
