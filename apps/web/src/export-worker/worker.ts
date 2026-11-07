/* The browser export worker (OpenSpec p2-export E2): one export per worker.
 *
 * It loads its own renderer module instance from `/renderer/`, so its session,
 * canvas and clock are separate from the live preview. For each output frame it
 * seeks the paused session, supplies every requested media frame through the
 * preview's visual pipeline, draws, and hands the canvas to a MediaBunny H.264
 * encoder as one `VideoFrame`. The audio track is the production Rust mix
 * (`project_audio`, `mix_audio`) at 48 kHz stereo, encoded as AAC and written
 * up to each video frame's end. The encoder's priming is measured once per
 * export and written as the sound track's edit list, so audio starts on time
 * in every player. A frame drawn with a coverage problem (missing
 * media, an unsupported element) or on a lost device is never encoded: the
 * export fails instead.
 *
 * Not part of the app bundle: `scripts/build-renderer-wasm.ts` bundles it to
 * `target/renderer-wasm/export-worker.js`, served at `/renderer/`. */
import {
	AudioSample,
	AudioSampleSource,
	BufferTarget,
	Mp4OutputFormat,
	Output,
	VideoSample,
	VideoSampleSource,
} from "mediabunny";
import { exportRequestSchema, type ExportStart } from "@models/render/export-protocol.ts";
import { peakIndex, withAudioPriming } from "@models/render/mp4-audio-priming.ts";
import { previewNow, type PreviewState } from "@models/timeline/preview-protocol.ts";
import { createWorkerDecoderRouter } from "../preview-worker/decoder-router.ts";
import { createVisualMedia, type VisualMediaHost } from "../preview-worker/visual-media.ts";
import { createAudioMedia, type AudioMediaHost } from "../preview-worker/audio-media.ts";

/** The session exports this worker uses (wasm-bindgen glue of `crates/renderer-wasm`). */
interface ExportModule extends VisualMediaHost, AudioMediaHost {
	default: () => Promise<unknown>;
	init: (canvas: OffscreenCanvas, onChange: () => void) => Promise<void>;
	set_storyboard_context: (
		json: string,
		fps: number,
		durationFrames: number,
		context: string,
		now: number,
	) => void;
	media_dispatch: (json: string, now: number) => boolean;
	seek: (position: number, now: number) => void;
	resize: (width: number, height: number) => void;
	tick: (now: number) => Promise<boolean>;
	wants_tick: (now: number) => boolean;
	state: (now: number) => string;
}

interface WorkerScope {
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	postMessage: (message: unknown, transfer?: Transferable[]) => void;
}

// SAFETY: this module runs only as a dedicated worker's entry, whose global has these members.
const scope = globalThis as WorkerScope;
const MODULE_URL = "/renderer/maleo_renderer_wasm.js";
/** How long one frame may wait for its media before the export fails. */
const MEDIA_WAIT_MS = 30_000;
/** Draw attempts per frame before the export reports that nothing was drawn. */
const DRAW_ATTEMPTS = 8;
const GENERATION = 1;
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const AUDIO_BITRATE = 192_000;
/** Output capacity offered to the mixer per pull, in frames. */
const AUDIO_PULL_FRAMES = 4096 * 4;

class Cancelled extends Error {}

let started = false;
let cancelled = false;
const decoders = createWorkerDecoderRouter((event) => scope.postMessage(event));

function message(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function report(live: ExportModule): PreviewState {
	// SAFETY: the WASM session emits the complete PreviewState shape.
	return JSON.parse(live.state(previewNow())) as PreviewState;
}

/** Resolves on the next media change, or rejects after the wait limit. */
function createChangeSignal() {
	let wake: (() => void) | null = null;
	return {
		notify() {
			wake?.();
			wake = null;
		},
		wait(): Promise<void> {
			return new Promise((resolve, reject) => {
				const timer = setTimeout(
					() => reject(new Error("Media for an output frame did not load in time")),
					MEDIA_WAIT_MS,
				);
				wake = () => {
					clearTimeout(timer);
					resolve();
				};
			});
		},
	};
}

async function load(start: ExportStart) {
	// A variable, not a literal: the bundler must leave this import to the browser.
	// SAFETY: the module at MODULE_URL is crates/renderer-wasm's glue, whose exports `ExportModule` lists.
	const live = (await import(/* @vite-ignore */ MODULE_URL)) as ExportModule;
	await live.default();
	const canvas = new OffscreenCanvas(start.width, start.height);
	let deviceChanged = false;
	await live.init(canvas, () => {
		deviceChanged = true;
	});
	live.resize(start.width, start.height);
	const signal = createChangeSignal();
	let mediaProblem: string | null = null;
	const media = createVisualMedia(live, decoders.open, signal.notify, (path, problem) => {
		mediaProblem = `${path}: ${problem}`;
		signal.notify();
	});
	await media.prepare();
	const now = previewNow();
	const revision = `export:${start.frames}`;
	live.set_storyboard_context(
		start.json,
		start.fps,
		start.frames,
		JSON.stringify({ generation: GENERATION, revision }),
		now,
	);
	live.media_dispatch(
		JSON.stringify({
			type: "readiness",
			generation: GENERATION,
			readiness: { revision, sourceGeneration: 0, sequence: 1, ready: true, blockers: [] },
		}),
		now,
	);
	media.setSources(start.media);
	const audio = await createAudioMedia(live, decoders.open);
	await audio.configure(start.json, start.fps, start.frames, start.media, 0, 1, SAMPLE_RATE);
	return {
		live,
		audio,
		canvas,
		media,
		signal,
		problem: () => mediaProblem,
		deviceChanged: () => deviceChanged,
	};
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** Draws output frame `index` with every requested media frame supplied. */
async function draw(loaded: Loaded, index: number, fps: number): Promise<void> {
	const { live, media, signal } = loaded;
	live.seek(index / fps, previewNow());
	media.invalidate();
	while (!media.update(previewNow())) {
		if (cancelled) throw new Cancelled();
		const problem = loaded.problem();
		if (problem) throw new Error(problem);
		await signal.wait();
	}
	for (let attempt = 0; ; attempt++) {
		if (await live.tick(previewNow())) break;
		if (attempt >= DRAW_ATTEMPTS || !live.wants_tick(previewNow()))
			throw new Error(`Output frame ${index} was not drawn`);
	}
	const state = report(live);
	if (loaded.deviceChanged() || state.status === "device-lost" || state.status === "failed")
		throw new Error(state.message ?? "The GPU device was lost during export");
	const problem = state.coverage[0];
	if (problem)
		throw new Error(`Frame ${index} cannot be exported: ${problem.path} ${problem.reason}`);
}

/** Writes mixed PCM until `until` samples are in the track. A block that crosses
 *  `until` keeps its tail for the next call. A finished mix is followed by
 *  silence, so the audio track always covers the video. */
function createAudioWriter(loaded: Loaded, source: AudioSampleSource) {
	let written = 0;
	let carry: Float32Array = new Float32Array(0);
	const next = async (): Promise<Float32Array> => {
		if (carry.length) return carry;
		const block = await loaded.audio.pull(AUDIO_PULL_FRAMES);
		if (!block) return new Float32Array(0);
		const pcm = block.pcm.slice();
		loaded.audio.release(block.lease);
		return pcm;
	};
	return async (until: number): Promise<void> => {
		while (written < until) {
			if (cancelled) throw new Cancelled();
			const pcm = await next();
			const wanted = until - written;
			const frames = pcm.length ? Math.min(pcm.length / CHANNELS, wanted) : wanted;
			// A copy, not a view: a sample whose data starts inside a larger buffer
			// encoded the buffer's start instead (p2-export task 2.2 evidence).
			const data = pcm.length
				? pcm.slice(0, frames * CHANNELS)
				: new Float32Array(frames * CHANNELS);
			carry = pcm.subarray(frames * CHANNELS);
			const sample = new AudioSample({
				data,
				format: "f32",
				numberOfChannels: CHANNELS,
				sampleRate: SAMPLE_RATE,
				timestamp: written / SAMPLE_RATE,
			});
			try {
				await source.add(sample);
			} finally {
				sample.close();
			}
			written += frames;
		}
	};
}

/**
 * Priming samples this browser's AAC encoder and decoder add, in output samples:
 * one impulse goes through the same encoder configuration MediaBunny uses and
 * back, and the shift of its peak is the priming (E2).
 */
async function measureAacPriming(): Promise<number> {
	const frames = 9600,
		at = 2400;
	const pcm = new Float32Array(frames * CHANNELS);
	pcm.fill(0.5, at * CHANNELS, (at + 1) * CHANNELS);
	const chunks: EncodedAudioChunk[] = [];
	let config: AudioDecoderConfig | undefined;
	let failure: unknown;
	const encoder = new AudioEncoder({
		output: (chunk, meta) => {
			chunks.push(chunk);
			config ??= meta?.decoderConfig;
		},
		error: (error) => (failure = error),
	});
	encoder.configure({
		codec: "mp4a.40.2",
		sampleRate: SAMPLE_RATE,
		numberOfChannels: CHANNELS,
		bitrate: AUDIO_BITRATE,
	});
	const data = new AudioData({
		format: "f32",
		sampleRate: SAMPLE_RATE,
		numberOfFrames: frames,
		numberOfChannels: CHANNELS,
		timestamp: 0,
		data: pcm,
	});
	encoder.encode(data);
	data.close();
	await encoder.flush();
	encoder.close();
	if (failure || !config) throw new Error("The AAC encoder could not be measured");
	const decoded: Float32Array[] = [];
	const decoder = new AudioDecoder({
		output: (audio) => {
			const plane = new Float32Array(audio.numberOfFrames);
			audio.copyTo(plane, { planeIndex: 0, format: "f32-planar" });
			decoded.push(plane);
			audio.close();
		},
		error: (error) => (failure = error),
	});
	decoder.configure(config);
	for (const chunk of chunks) decoder.decode(chunk);
	await decoder.flush();
	decoder.close();
	if (failure) throw new Error("The AAC decoder could not be measured");
	const all = new Float32Array(decoded.reduce((sum, plane) => sum + plane.length, 0));
	let offset = 0;
	for (const plane of decoded) {
		all.set(plane, offset);
		offset += plane.length;
	}
	return Math.max(0, peakIndex(all) - at);
}

async function run(start: ExportStart): Promise<void> {
	scope.postMessage({ type: "progress", phase: "loading", frame: 0, frames: start.frames });
	const priming = await measureAacPriming();
	const loaded = await load(start);
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
	const video = new VideoSampleSource({
		codec: "avc",
		bitrate: start.bitrate,
		keyFrameInterval: 2,
	});
	output.addVideoTrack(video, { frameRate: start.fps });
	const sound = new AudioSampleSource({ codec: "aac", bitrate: AUDIO_BITRATE });
	output.addAudioTrack(sound);
	const writeAudio = createAudioWriter(loaded, sound);
	const samplesAt = (frame: number): number => Math.round((frame / start.fps) * SAMPLE_RATE);
	try {
		await output.start();
		for (let index = 0; index < start.frames; index++) {
			if (cancelled) throw new Cancelled();
			await draw(loaded, index, start.fps);
			const frame = new VideoFrame(loaded.canvas, {
				timestamp: Math.round((index / start.fps) * 1e6),
				duration: Math.round(1e6 / start.fps),
			});
			const sample = new VideoSample(frame, {
				timestamp: index / start.fps,
				duration: 1 / start.fps,
			});
			try {
				await video.add(sample);
			} finally {
				sample.close();
			}
			await writeAudio(samplesAt(index + 1));
			scope.postMessage({
				type: "progress",
				phase: "rendering",
				frame: index + 1,
				frames: start.frames,
			});
		}
		scope.postMessage({
			type: "progress",
			phase: "finishing",
			frame: start.frames,
			frames: start.frames,
		});
		await output.finalize();
		if (!target.buffer) throw new Error("The encoder produced no file");
		const bytes = withAudioPriming(new Uint8Array(target.buffer), priming).slice().buffer;
		scope.postMessage({ type: "done", bytes }, [bytes]);
	} catch (cause) {
		await output.cancel().catch(() => {});
		throw cause;
	} finally {
		await loaded.audio.dispose();
		await loaded.media.dispose();
	}
}

scope.onmessage = (event) => {
	const parsed = exportRequestSchema.safeParse(event.data);
	if (!parsed.success) {
		scope.postMessage({ type: "failed", message: "Invalid export worker request" });
		return;
	}
	const data = parsed.data;
	if (data.type === "cancel") {
		cancelled = true;
		return;
	}
	if (data.type !== "start") {
		decoders.handle(data);
		return;
	}
	if (started) {
		scope.postMessage({ type: "failed", message: "This export worker has already started" });
		return;
	}
	started = true;
	run(data).catch((cause: unknown) => {
		scope.postMessage(
			cause instanceof Cancelled
				? { type: "cancelled" }
				: { type: "failed", message: message(cause) },
		);
	});
};
