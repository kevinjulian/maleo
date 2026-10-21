import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasAudioTools, probeDurationSec, slug } from "./music-audio.ts";

describe("naming", () => {
	it("makes a filename-safe slug", () => {
		expect(slug("Soft Ambient Pad (Loop)")).toBe("soft-ambient-pad-loop");
	});

	it("falls back rather than producing an empty name", () => {
		expect(slug("!!!")).toBe("bed");
	});
});

/* Duration cannot be checked without decoding, so these generate a real tone
 * and measure it. Skipped where ffprobe is absent — publishing warns and carries
 * on without durations rather than refusing. */
const audio = hasAudioTools() ? describe : describe.skip;

audio("measuring real audio", () => {
	let dir = "";

	/** A steady tone at a given amplitude, long enough to pass the duration gate. */
	async function tone(name: string, amplitude: number, seconds: number): Promise<string> {
		const path = join(dir, name);
		const proc = Bun.spawn(
			[
				"ffmpeg",
				"-y",
				"-f",
				"lavfi",
				"-i",
				`sine=frequency=220:duration=${seconds}:sample_rate=44100`,
				"-filter:a",
				`volume=${amplitude}`,
				"-ac",
				"2",
				path,
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		await proc.exited;
		return path;
	}

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "music-audio-"));
	});

	afterAll(async () => {
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	it("measures a short bed and publishes it anyway", async () => {
		// A short bed is not refused: the resolver prefers a long one and falls
		// back to the longest it has, so this is a bed that gets picked less often
		// rather than a bed that is unusable.
		const short = await tone("short.wav", 0.3, 8);
		expect(await probeDurationSec(short)).toBeCloseTo(8, 0);
	}, 60_000);

	it("reports zero for a file that is not audio, rather than throwing", async () => {
		const notAudio = join(dir, "notes.txt");
		await Bun.write(notAudio, "this is not a wav file");
		expect(await probeDurationSec(notAudio)).toBe(0);
	}, 60_000);
});
