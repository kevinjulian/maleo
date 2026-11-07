/* Production comparison of a shadow render with its authoritative output
 * (OpenSpec p2-export E7).
 *
 * 1. `ffprobe` both files: size, frame rate, frame count and duration.
 * 2. Extract the frames the host's `plan` names (each base visual start, each
 *    transition midpoint, each whole second) as PNG, and score them with the
 *    golden corpus SSIM through `maleo-render compare-frames`.
 * 3. Decode both audio tracks to 48 kHz mono float. Compare loudness per window
 *    where the reference is above the floor, and the onset near each clip start.
 *
 * The criteria come from `comparison.json`. A failed comparison keeps its
 * frames, difference images and `scores.json` in its artifact directory; a
 * passing one removes the directory and keeps only the scores it returns. */
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { Storyboard } from "@maleo/video/schema";
import { storyboardOutput } from "./rust-export";
import {
	hostCompareFrames,
	hostPlan,
	writeHostJob,
	type FrameScore,
	type HostRun,
} from "./rust-host";

const run = promisify(execFile);
const RATE = 48_000;

const limit = z.object({ value: z.number(), reason: z.string().min(1) });
export const comparisonConfigSchema = z.object({
	version: z.number().int().positive(),
	/** `thresholds.frame` of `crates/renderer/corpus/manifest.json`. */
	corpusFrame: z.number(),
	/** Subtracted from `corpusFrame`: the SSIM two H.264 encodes lose (task 4.2). */
	encodingAllowance: limit,
	durationFrames: z.number().nonnegative(),
	loudness: z.object({
		windowMs: z.number().positive(),
		toleranceDb: z.number().positive(),
		floorDbfs: z.number(),
	}),
	onsetFrames: z.number().positive(),
	/** Samples (48 kHz) Remotion's AAC output starts late; removed from its track before audio scoring. */
	remotionAudioDelay: z.object({
		samples: z.number().int().nonnegative(),
		reason: z.string().min(1),
	}),
	/** Lowered frame thresholds by project ID, each with its reason (corpus manifest shape). */
	lowered: z.record(z.object({ frame: z.number(), reason: z.string().min(1) })),
});
export type ComparisonConfig = z.infer<typeof comparisonConfigSchema>;

export async function loadComparisonConfig(
	file = path.resolve(import.meta.dir, "..", "comparison.json"),
): Promise<ComparisonConfig> {
	return comparisonConfigSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

export function frameThreshold(config: ComparisonConfig, projectId?: string | null): number {
	const lowered = projectId ? config.lowered[projectId] : undefined;
	return lowered?.frame ?? config.corpusFrame - config.encodingAllowance.value;
}

export interface Probe {
	width: number;
	height: number;
	fps: number;
	frames: number;
	duration: number;
}

const probeSchema = z.object({
	streams: z
		.array(
			z.object({
				width: z.number(),
				height: z.number(),
				r_frame_rate: z.string(),
				nb_read_packets: z.string(),
				duration: z.string().optional(),
			}),
		)
		.min(1),
	format: z.object({ duration: z.string() }),
});

function ffmpeg(): string {
	return process.env.MALEO_FFMPEG?.trim() || "ffmpeg";
}

export async function probe(file: string): Promise<Probe> {
	const { stdout } = await run(process.env.MALEO_FFPROBE?.trim() || "ffprobe", [
		"-v",
		"error",
		"-select_streams",
		"v:0",
		"-count_packets",
		"-show_entries",
		"stream=width,height,r_frame_rate,nb_read_packets,duration:format=duration",
		"-of",
		"json",
		file,
	]);
	const parsed = probeSchema.parse(JSON.parse(stdout));
	const stream = parsed.streams[0]!;
	const [num, den] = stream.r_frame_rate.split("/").map(Number);
	return {
		width: stream.width,
		height: stream.height,
		fps: (num ?? 0) / (den || 1),
		frames: Number(stream.nb_read_packets),
		duration: Number(stream.duration ?? parsed.format.duration),
	};
}

/** Writes the listed frames of `file` as `<frame>.png` into `dir`. */
async function extractFrames(file: string, frames: readonly number[], dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
	const select = frames.map((frame) => `eq(n\\,${frame})`).join("+");
	await run(ffmpeg(), [
		"-v",
		"error",
		"-i",
		file,
		"-vf",
		`select='${select}'`,
		"-fps_mode",
		"passthrough",
		"-start_number",
		"0",
		path.join(dir, "%06d.png"),
	]);
	// FFmpeg numbers the selected frames in order; name each by its frame number.
	const written = (await readdir(dir)).filter((name) => name.endsWith(".png")).sort();
	if (written.length !== frames.length)
		throw new Error(`${file}: extracted ${written.length} of ${frames.length} sampled frames`);
	for (const [index, name] of written.entries())
		await rename(
			path.join(dir, name),
			path.join(dir, `f${String(frames[index]).padStart(6, "0")}.png`),
		);
}

/** Mono 48 kHz samples of the first audio stream; empty when the file has none. */
export async function decodeAudio(file: string): Promise<Float32Array> {
	const { stdout: streams } = await run(process.env.MALEO_FFPROBE?.trim() || "ffprobe", [
		"-v",
		"error",
		"-select_streams",
		"a",
		"-show_entries",
		"stream=index",
		"-of",
		"csv=p=0",
		file,
	]);
	if (!streams.trim()) return new Float32Array(0);
	const { stdout } = await run(
		ffmpeg(),
		[
			"-v",
			"error",
			"-i",
			file,
			"-map",
			"0:a:0",
			"-f",
			"f32le",
			"-ac",
			"1",
			"-ar",
			String(RATE),
			"pipe:1",
		],
		{ encoding: "buffer", maxBuffer: 2 ** 31 },
	);
	const bytes = new Uint8Array(stdout);
	return new Float32Array(
		bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.byteLength & ~3)),
	);
}

function windowDb(samples: Float32Array, from: number, length: number): number {
	let sum = 0;
	for (let i = from; i < from + length; i++) {
		const value = samples[i] ?? 0;
		sum += value * value;
	}
	const rms = Math.sqrt(sum / length);
	return rms > 0 ? 20 * Math.log10(rms) : -120;
}

export interface LoudnessScore {
	windows: number;
	failures: LoudnessFailure[];
}

export interface LoudnessFailure {
	time: number;
	reference: number;
	candidate: number;
}

export function compareLoudness(
	reference: Float32Array,
	candidate: Float32Array,
	config: ComparisonConfig["loudness"],
): LoudnessScore {
	const length = Math.round((RATE * config.windowMs) / 1000);
	const failures: LoudnessFailure[] = [];
	let windows = 0;
	for (let from = 0; from + length <= reference.length; from += length) {
		const ref = windowDb(reference, from, length);
		if (ref <= config.floorDbfs) continue;
		windows++;
		const cand = windowDb(candidate, from, length);
		if (Math.abs(cand - ref) > config.toleranceDb)
			failures.push({ time: from / RATE, reference: ref, candidate: cand });
	}
	return { windows, failures };
}

/** First sample above a quarter of the local peak, from two frames before a clip start to 0.5 s after. */
export function onset(samples: Float32Array, start: number, fps: number): number | null {
	const from = Math.max(0, Math.floor((start - 2 / fps) * RATE));
	const to = Math.min(samples.length, Math.ceil((start + 0.5) * RATE));
	let peak = 0;
	for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i]!));
	if (peak < 1e-4) return null;
	for (let i = from; i < to; i++) if (Math.abs(samples[i]!) > peak * 0.25) return i / RATE;
	return null;
}

export interface OnsetScore {
	path: string;
	url: string;
	start: number;
	reference: number | null;
	candidate: number | null;
	offset: number | null;
}

export interface SampledFrame extends FrameScore {
	frame: number;
	time: number;
	why: string;
}

export interface ComparisonResult {
	passed: boolean;
	configVersion: number;
	/** One line per failed criterion, naming the frame, window or clip. */
	failures: string[];
	reference: Probe;
	candidate: Probe;
	frameThreshold: number;
	frames: SampledFrame[];
	loudness: LoudnessScore;
	onsets: OnsetScore[];
	/** The kept artifact directory of a failed comparison. */
	artifacts: string | null;
}

function formatFailures(reference: Probe, candidate: Probe, config: ComparisonConfig): string[] {
	const failures: string[] = [];
	if (reference.width !== candidate.width || reference.height !== candidate.height)
		failures.push(
			`size ${candidate.width}x${candidate.height}, expected ${reference.width}x${reference.height}`,
		);
	if (Math.abs(reference.fps - candidate.fps) > 1e-6)
		failures.push(`frame rate ${candidate.fps}, expected ${reference.fps}`);
	if (reference.frames !== candidate.frames)
		failures.push(`frame count ${candidate.frames}, expected ${reference.frames}`);
	if (Math.abs(reference.duration - candidate.duration) > config.durationFrames / reference.fps)
		failures.push(`duration ${candidate.duration} s, expected ${reference.duration} s`);
	return failures;
}

export async function compareOutputs(input: {
	reference: string;
	candidate: string;
	storyboard: Storyboard;
	compositionId: string;
	projectId?: string | null;
	/** Which file Remotion made, so its `remotionAudioDelay` is removed; none when neither. */
	remotion?: "reference" | "candidate";
	/** The artifact directory; removed when the comparison passes. */
	dir: string;
	config: ComparisonConfig;
	run?: HostRun;
}): Promise<ComparisonResult> {
	const { config, dir } = input;
	const output = storyboardOutput(input.compositionId, input.storyboard);
	if (!output) throw new Error(`${input.compositionId} has no comparison`);
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	const jobFile = path.join(dir, "plan.json");
	await writeHostJob(jobFile, {
		storyboard: input.storyboard,
		media: {},
		...output,
		out: path.join(dir, "unused.mp4"),
	});
	const plan = await hostPlan(jobFile, input.run);
	await rm(jobFile, { force: true });
	const [reference, candidate] = await Promise.all([
		probe(input.reference),
		probe(input.candidate),
	]);
	const failures = formatFailures(reference, candidate, config);
	const threshold = frameThreshold(config, input.projectId);

	let frames: SampledFrame[] = [];
	const sampled = plan.samples.filter(
		(sample) => sample.frame < Math.min(reference.frames, candidate.frames),
	);
	if (
		sampled.length > 0 &&
		reference.width === candidate.width &&
		reference.height === candidate.height
	) {
		const dirs = {
			reference: path.join(dir, "reference"),
			candidate: path.join(dir, "candidate"),
			difference: path.join(dir, "difference"),
		};
		const numbers = sampled.map((sample) => sample.frame);
		await Promise.all([
			extractFrames(input.reference, numbers, dirs.reference),
			extractFrames(input.candidate, numbers, dirs.candidate),
		]);
		const scores = await hostCompareFrames(dirs, threshold, input.run);
		const byName = new Map(scores.map((score) => [score.name, score]));
		frames = sampled.map((sample) => {
			const score = byName.get(`f${String(sample.frame).padStart(6, "0")}.png`);
			if (!score) throw new Error(`frame ${sample.frame} has no score`);
			return { ...sample, ...score };
		});
		for (const frame of frames)
			if (frame.ssim < threshold)
				failures.push(
					`frame ${frame.frame} (${frame.time.toFixed(3)} s, ${frame.why}) SSIM ${frame.ssim.toFixed(4)} below ${threshold.toFixed(4)}`,
				);
	}

	const delay = config.remotionAudioDelay.samples;
	const trim = (samples: Float32Array, side: "reference" | "candidate") =>
		input.remotion === side ? samples.subarray(delay) : samples;
	const [refDecoded, candDecoded] = await Promise.all([
		decodeAudio(input.reference),
		decodeAudio(input.candidate),
	]);
	const refAudio = trim(refDecoded, "reference");
	const candAudio = trim(candDecoded, "candidate");
	const loudness = compareLoudness(refAudio, candAudio, config.loudness);
	if (loudness.failures.length > 0) {
		const first = loudness.failures[0]!;
		failures.push(
			`loudness differs in ${loudness.failures.length} of ${loudness.windows} windows, first at ${first.time.toFixed(2)} s (${first.candidate.toFixed(1)} dBFS, expected ${first.reference.toFixed(1)})`,
		);
	}
	const tolerance = config.onsetFrames / output.fps;
	const onsets: OnsetScore[] = plan.clips.map((clip) => {
		const ref = onset(refAudio, clip.start, output.fps);
		const cand = onset(candAudio, clip.start, output.fps);
		return {
			...clip,
			reference: ref,
			candidate: cand,
			offset: ref != null && cand != null ? cand - ref : null,
		};
	});
	for (const clip of onsets) {
		if (clip.reference == null) continue;
		if (clip.offset == null)
			failures.push(`${clip.path} (${clip.url}) has no onset near ${clip.start.toFixed(3)} s`);
		else if (Math.abs(clip.offset) > tolerance)
			failures.push(`${clip.path} (${clip.url}) starts ${(clip.offset * 1000).toFixed(1)} ms off`);
	}

	const result: ComparisonResult = {
		passed: failures.length === 0,
		configVersion: config.version,
		failures,
		reference,
		candidate,
		frameThreshold: threshold,
		frames,
		loudness,
		onsets,
		artifacts: failures.length === 0 ? null : dir,
	};
	if (result.passed) await rm(dir, { recursive: true, force: true });
	else await writeFile(path.join(dir, "scores.json"), JSON.stringify(result, null, 2));
	return result;
}
