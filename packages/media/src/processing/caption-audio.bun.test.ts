import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CaptionSourceManifestSchema, type CaptionAudioSource } from "@maleo/shared";
import { captionAudioRanges, prepareCaptionAudio } from "./caption-audio.ts";

function source(patch: Partial<CaptionAudioSource> = {}): CaptionAudioSource {
	const mediaId = randomUUID();
	return {
		binding: {
			clipId: "audio:1",
			mediaId,
			mediaRevision: "r1",
			sourceStartSec: 0.25,
			sourceEndSec: 1.25,
		},
		mediaId,
		sourceRevision: "r1",
		fingerprint: "a".repeat(64),
		kind: "audio",
		role: "voiceover",
		timelineStartSec: 1,
		durationSec: 1,
		sourceDurationSec: 2,
		playbackRate: 1,
		preservePitch: false,
		reverse: false,
		volume: 0.5,
		fadeInSec: 0,
		fadeOutSec: 0,
		loop: false,
		...patch,
	};
}
function rms(wav: Buffer, from: number, to: number) {
	let sum = 0,
		count = 0;
	for (let index = Math.floor(from * 16000); index < to * 16000; index++) {
		sum += (wav.readInt16LE(44 + index * 2) / 32768) ** 2;
		count++;
	}
	return Math.sqrt(sum / count);
}

test("recognition separates every source gap but merges touching, nested and overlapping sources", () => {
	const nested = source({ timelineStartSec: 1.2, durationSec: 0.2 });
	nested.binding.sourceEndSec = 0.45;
	const manifest = CaptionSourceManifestSchema.parse({
		version: 1,
		startSec: 1,
		endSec: 8,
		sources: [
			source({ timelineStartSec: 7 }),
			source({ timelineStartSec: 1 }),
			source({ timelineStartSec: 1.5 }),
			source({ timelineStartSec: 2.5 }),
			nested,
			source({ timelineStartSec: 3.6 }),
		],
	});
	expect(captionAudioRanges(manifest)).toEqual([
		{ startSec: 1, endSec: 3.5 },
		{ startSec: 3.6, endSec: 4.6 },
		{ startSec: 7, endSec: 8 },
	]);
});

test("temporary mix preserves offsets, overlaps, silence, gain and production edge fades", async () => {
	const directory = await mkdtemp(join(tmpdir(), "caption-audio-proof-"));
	try {
		const path = join(directory, "input.wav");
		execFileSync("ffmpeg", [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"aevalsrc=0.25*sin(2*PI*440*t):s=16000:d=2",
			path,
		]);
		const first = source({ fadeInSec: 0.2, fadeOutSec: 0.2 });
		const second = {
			...first,
			binding: { ...first.binding, clipId: "audio:2" },
			timelineStartSec: 1.5,
			fadeInSec: 0,
			fadeOutSec: 0,
		};
		const manifest = CaptionSourceManifestSchema.parse({
			version: 1,
			startSec: 0,
			endSec: 3,
			sources: [first, second],
		});
		const mix = await readFile(
			await prepareCaptionAudio(manifest, [path, path], directory, AbortSignal.timeout(10_000)),
		);
		expect(mix.length).toBe(44 + 3 * 16000 * 2);
		expect(rms(mix, 0, 0.9)).toBe(0);
		expect(rms(mix, 1.3, 1.4)).toBeCloseTo((0.25 * 0.5) / Math.sqrt(2), 3);
		expect(rms(mix, 1.6, 1.7)).toBeCloseTo(0.25 / Math.sqrt(2), 3);
		expect(rms(mix, 1, 1.03)).toBeLessThan(0.02);
		expect(rms(mix, 2.6, 3)).toBe(0);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("retimed and reversed audio use existing bounded source processor", async () => {
	const directory = await mkdtemp(join(tmpdir(), "caption-rate-proof-"));
	try {
		const path = join(directory, "input.wav");
		execFileSync("ffmpeg", [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"aevalsrc=if(lt(t\\,1)\\,0.25*sin(2*PI*440*t)\\,0.5*sin(2*PI*880*t)):s=16000:d=2",
			path,
		]);
		const item = source({
			timelineStartSec: 0,
			durationSec: 1,
			playbackRate: 2,
			reverse: true,
			volume: 1,
		});
		item.binding = { ...item.binding, sourceStartSec: 0, sourceEndSec: 2 };
		const manifest = CaptionSourceManifestSchema.parse({
			version: 1,
			startSec: 0,
			endSec: 1,
			sources: [item],
		});
		const mix = await readFile(
			await prepareCaptionAudio(manifest, [path], directory, AbortSignal.timeout(10_000)),
		);
		expect(rms(mix, 0.1, 0.3)).toBeGreaterThan(rms(mix, 0.7, 0.9) * 1.6);
		expect(mix.length).toBe(44 + 16000 * 2);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
