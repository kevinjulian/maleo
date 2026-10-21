import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MEDIA_IMPORT_LIMITS, type MediaAudioOperation } from "@maleo/shared";
import { processSourceAudio } from "./audio.ts";
import { probeImportedMedia } from "./probe.ts";

const signal = () => new AbortController().signal;
const decode = (path: string) =>
	execFileSync(
		"ffmpeg",
		["-v", "error", "-i", path, "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"],
		{ maxBuffer: 32 * 1024 * 1024 },
	);
function frequency(pcm: Buffer, from: number, duration: number) {
	let crossings = 0,
		previous = 0;
	for (let i = Math.floor(from * 48000); i < Math.floor((from + duration) * 48000); i++) {
		const sample = pcm.readFloatLE(i * 4);
		if (previous <= 0 && sample > 0) crossings++;
		previous = sample;
	}
	return crossings / duration;
}
function peak(pcm: Buffer, from: number, to: number) {
	let value = 0;
	for (let i = Math.floor(from * 48000); i < Math.min(pcm.length / 4, Math.floor(to * 48000)); i++)
		value = Math.max(value, Math.abs(pcm.readFloatLE(i * 4)));
	return value;
}

test("native source-audio retime preserves selected duration and declared pitch at every rate/direction", async () => {
	const dir = await mkdtemp(join(tmpdir(), "maleo-audio-retime-"));
	try {
		const input = join(dir, "source.wav");
		execFileSync("ffmpeg", [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=880:sample_rate=48000:duration=6",
			"-c:a",
			"pcm_s16le",
			input,
		]);
		const original = await Bun.file(input).arrayBuffer();
		const request = { kind: "audio" as const, originalFilename: "source.wav" };
		const metadata = await probeImportedMedia(
			input,
			request,
			(await stat(input)).size,
			DEFAULT_MEDIA_IMPORT_LIMITS,
			signal(),
		);
		for (const playbackRate of [0.25, 0.5, 2, 4])
			for (const preservePitch of [false, true])
				for (const reverse of [false, true]) {
					const directory = join(dir, `${playbackRate}-${preservePitch}-${reverse}`);
					await mkdir(directory);
					const output = join(directory, "audio.m4a");
					const operation: MediaAudioOperation = {
						type: "audio",
						startSec: 1,
						durationSec: 4,
						playbackRate,
						preservePitch,
						reverse,
					};
					await processSourceAudio(
						input,
						output,
						metadata,
						operation,
						DEFAULT_MEDIA_IMPORT_LIMITS,
						signal(),
					);
					const measured = await probeImportedMedia(
						output,
						request,
						(await stat(output)).size,
						DEFAULT_MEDIA_IMPORT_LIMITS,
						signal(),
					);
					expect(Math.abs(measured.duration! - 4 / playbackRate)).toBeLessThan(0.1);
					const pcm = decode(output),
						duration = 0.5;
					const actualPitch = frequency(pcm, 0.2, duration),
						expectedPitch = 880 * (preservePitch ? 1 : playbackRate);
					expect(Math.abs(actualPitch - expectedPitch)).toBeLessThan(5);
					expect(peak(pcm, 0.2, 0.7)).toBeGreaterThan(0.05);
					console.log(
						JSON.stringify({
							playbackRate,
							preservePitch,
							reverse,
							duration: measured.duration,
							actualPitch,
							expectedPitch,
						}),
					);
				}
		expect(await Bun.file(input).arrayBuffer()).toEqual(original);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 60_000);

test("speech-like source audio reverses across bounded chunk seam and refuses invalid/no-audio/cancelled work", async () => {
	const dir = await mkdtemp(join(tmpdir(), "maleo-audio-seam-"));
	try {
		const input = join(dir, "speech-like.wav"),
			output = join(dir, "audio.m4a");
		const voiced = "(0.25*sin(2*PI*220*t)+0.07*sin(2*PI*440*t)+0.03*sin(2*PI*660*t))";
		execFileSync("ffmpeg", [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			`aevalsrc=${voiced}*between(t\\,2.1\\,2.7)+${voiced}*0.4*between(t\\,31.1\\,31.7):s=48000:d=34`,
			"-c:a",
			"pcm_s16le",
			input,
		]);
		const request = { kind: "audio" as const, originalFilename: "speech-like.wav" };
		const metadata = await probeImportedMedia(
			input,
			request,
			(await stat(input)).size,
			DEFAULT_MEDIA_IMPORT_LIMITS,
			signal(),
		);
		const operation: MediaAudioOperation = {
			type: "audio",
			startSec: 1,
			durationSec: 32,
			playbackRate: 1,
			preservePitch: true,
			reverse: true,
		};
		await processSourceAudio(
			input,
			output,
			metadata,
			operation,
			DEFAULT_MEDIA_IMPORT_LIMITS,
			signal(),
		);
		const pcm = decode(output);
		expect(peak(pcm, 30.3, 30.9)).toBeGreaterThan(0.25);
		expect(peak(pcm, 1.3, 1.9)).toBeGreaterThan(0.09);
		expect(peak(pcm, 10, 11)).toBeLessThan(0.005);
		for (const playbackRate of [0.25, 0.5, 2, 4])
			for (const preservePitch of [false, true]) {
				await processSourceAudio(
					input,
					output,
					metadata,
					{ ...operation, durationSec: 3, playbackRate, preservePitch },
					DEFAULT_MEDIA_IMPORT_LIMITS,
					signal(),
				);
				const samples = decode(output),
					expected = preservePitch ? 220 : 220 * playbackRate;
				expect(
					Math.abs(frequency(samples, 1.4 / playbackRate, 0.3 / playbackRate) - expected),
				).toBeLessThan(15);
				expect(peak(samples, 0.1 / playbackRate, 0.5 / playbackRate)).toBeLessThan(0.005);
			}
		await expect(
			processSourceAudio(
				input,
				output,
				{ ...metadata, hasAudio: false },
				operation,
				DEFAULT_MEDIA_IMPORT_LIMITS,
				signal(),
			),
		).rejects.toThrow("no audio");
		await expect(
			processSourceAudio(
				input,
				output,
				metadata,
				{ ...operation, startSec: 4 },
				DEFAULT_MEDIA_IMPORT_LIMITS,
				signal(),
			),
		).rejects.toThrow("exceeds measured");
		await expect(
			processSourceAudio(
				input,
				output,
				metadata,
				operation,
				{ ...DEFAULT_MEDIA_IMPORT_LIMITS, maxScratchBytes: 1 },
				signal(),
			),
		).rejects.toThrow("scratch limit");
		const cancelled = new AbortController();
		cancelled.abort();
		await expect(
			processSourceAudio(
				input,
				output,
				metadata,
				operation,
				DEFAULT_MEDIA_IMPORT_LIMITS,
				cancelled.signal,
			),
		).rejects.toThrow();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 60_000);
