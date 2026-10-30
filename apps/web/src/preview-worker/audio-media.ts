import { PREVIEW_AUDIO_WORKER_URL } from "@services/preview-media/script-urls.ts";
import { z } from "zod";
import type { PreviewMediaBinding } from "@models/timeline/preview-protocol.ts";
import {
	decodeLocalAudio,
	type DecodedAudioWindow,
	type PcmReservations,
} from "@services/preview-media/audio-client.ts";
import { AudioTempo } from "@services/preview-media/audio-tempo.ts";
import type { openDecoderLeases } from "@services/preview-media/decoder-leases.ts";
import { audioMetadataSchema } from "@models/timeline/preview-audio-protocol.ts";

interface NativeBudget extends PcmReservations {
	used(): number;
	free(): void;
}
export interface AudioMediaHost {
	PcmBudget: new () => NativeBudget;
	project_audio(json: string, fps: number, frames: number): string;
	audio_requests(
		mix: string,
		metadata: string,
		sampleRate: number,
		start: number,
		frames: number,
	): string;
	mix_audio(
		mix: string,
		inputs: string,
		samples: Float32Array,
		sampleRate: number,
		channels: number,
		start: number,
		frames: number,
	): Float32Array<ArrayBuffer>;
}
const sourceSchema = z
	.object({ path: z.string(), url: z.string(), embedded: z.boolean() })
	.passthrough();
const mixSchema = z.object({ sources: z.array(sourceSchema) }).passthrough();
const requestsSchema = z.array(
	z
		.object({
			path: z.string(),
			url: z.string(),
			start: z.number().finite(),
			end: z.number().finite(),
		})
		.strict(),
);
const metadataSchema = z.array(audioMetadataSchema.extend({ path: z.string() }));

/** One bounded mixing operation at a time. All source intervals come from Rust. */
export async function createAudioMedia(
	native: AudioMediaHost,
	openDecoders: typeof openDecoderLeases,
) {
	const response = await fetch(PREVIEW_AUDIO_WORKER_URL);
	if (!response.ok) throw new Error("Local audio decoder script is unavailable");
	const workerUrl = URL.createObjectURL(await response.blob());
	const budget = new native.PcmBudget();
	let tempo: AudioTempo | undefined;
	let abort = new AbortController(),
		revision = 0;
	let pending: Promise<unknown> = Promise.resolve();
	let busy = false,
		closed = false,
		finished = false;
	let sampleRate = 48000,
		cursor = 0,
		total = 0;
	let mix = "",
		metadata = "";
	const bindings = new Map<string, PreviewMediaBinding>();
	const held = new Set<bigint>();
	function detach(pcm: Float32Array<ArrayBuffer>) {
		structuredClone(pcm.buffer, { transfer: [pcm.buffer] });
	}
	function release(lease: bigint) {
		if (held.delete(lease)) budget.release(lease);
	}
	async function reset() {
		revision++;
		abort.abort();
		await pending.catch(() => {});
		abort = new AbortController();
		tempo?.dispose();
		tempo = undefined;
		bindings.clear();
		finished = false;
	}
	async function feed(frames: number, generation: number) {
		const requests = requestsSchema.parse(
			JSON.parse(native.audio_requests(mix, metadata, sampleRate, cursor, frames)),
		);
		const windows: Array<{ path: string; window: DecodedAudioWindow }> = [];
		let mixed: Float32Array<ArrayBuffer> | undefined,
			flattened: Float32Array<ArrayBuffer> | undefined;
		let outputLease: bigint | undefined;
		try {
			// Each complete File job independently acquires the shared two-decoder broker.
			const results = await Promise.allSettled(
				requests.map(async (request) => {
					const source = bindings.get(request.url);
					if (!source?.audio) throw new Error(`${request.path}: validated local audio is missing`);
					const window = await decodeLocalAudio(
						{
							sourceId: source.id,
							revision: source.revision,
							file: source.file,
							start: request.start,
							end: request.end,
							frames: source.audio.frames,
						},
						budget,
						{ signal: abort.signal, workerUrl, openDecoders },
					);
					windows.push({ path: request.path, window });
					const actual = window.metadata,
						expected = source.audio;
					if (
						actual.sampleRate !== expected.sampleRate ||
						actual.channels !== expected.channels ||
						actual.firstTimestamp !== expected.firstTimestamp
					)
						throw new Error(`${request.path}: decoded audio metadata changed`);
				}),
			);
			for (const result of results) if (result.status === "rejected") throw result.reason;
			if (closed || generation !== revision)
				throw new DOMException("Audio mixing cancelled", "AbortError");
			windows.sort(
				(a, b) => a.path.localeCompare(b.path) || a.window.metadata.start - b.window.metadata.start,
			);
			const inputs = new Map<
				string,
				{
					path: string;
					sampleRate: number;
					channels: number;
					firstTimestamp: number;
					frames: number;
					windows: Array<{ start: number; offset: number; count: number }>;
				}
			>(
				metadataSchema
					.parse(JSON.parse(metadata))
					.map((info) => [info.path, { ...info, windows: [] }]),
			);
			let count = 0;
			const copies: Array<{ pcm: Float32Array<ArrayBuffer>; offset: number; skip: number }> = [];
			for (const { path, window } of windows) {
				const info = window.metadata;
				let input = inputs.get(path);
				if (!input) {
					input = {
						path,
						sampleRate: info.sampleRate,
						channels: info.channels,
						firstTimestamp: info.firstTimestamp,
						frames: info.frames,
						windows: [],
					};
					inputs.set(path, input);
				}
				const last = input.windows.at(-1);
				const previousEnd = last ? last.start + last.count / info.channels : 0;
				const skip = Math.max(0, previousEnd - info.start) * info.channels;
				const length = window.pcm.length - skip;
				if (length <= 0) continue;
				input.windows.push({
					start: info.start + skip / info.channels,
					offset: count,
					count: length,
				});
				copies.push({ pcm: window.pcm, offset: count, skip });
				count += length;
			}
			// decodeLocalAudio reserved retained, flattened and WASM input copies before allocation.
			flattened = new Float32Array(count);
			for (const copy of copies) flattened.set(copy.pcm.subarray(copy.skip), copy.offset);
			outputLease = budget.reserve(frames * 8 * 2);
			mixed = native.mix_audio(
				mix,
				JSON.stringify([...inputs.values()]),
				flattened,
				sampleRate,
				2,
				cursor,
				frames,
			);
			if (!tempo?.push(mixed)) throw new Error("Audio tempo lookahead has no capacity");
			cursor += frames;
			if (cursor === total) {
				tempo.finish(Math.round(tempo.leadSeconds * sampleRate));
				finished = true;
			}
		} finally {
			if (mixed) detach(mixed);
			if (flattened) detach(flattened);
			if (outputLease !== undefined) budget.release(outputLease);
			for (const { window } of windows) window.release();
		}
	}
	return {
		budget,
		release,
		async configure(
			json: string,
			fps: number,
			frames: number,
			sources: readonly PreviewMediaBinding[],
			position: number,
			rate: number,
			deviceRate: number,
		) {
			await reset();
			if (closed) throw new Error("Audio mixer is closed");
			const projected = mixSchema.parse(JSON.parse(native.project_audio(json, fps, frames)));
			for (const source of sources) bindings.set(source.url, source);
			projected.sources = projected.sources.filter((source) => {
				const binding = bindings.get(source.url);
				if (!binding) throw new Error(`${source.path}: complete local source is missing`);
				return !(source.embedded && !binding.audio);
			});
			mix = JSON.stringify(projected);
			metadata = JSON.stringify(
				projected.sources.map((source) => {
					const info = bindings.get(source.url)?.audio;
					if (!info) throw new Error(`${source.path}: validated audio metadata is missing`);
					return { path: source.path, ...info };
				}),
			);
			tempo = new AudioTempo(deviceRate, rate, budget);
			sampleRate = deviceRate;
			// The stretch output leads its input; feed from earlier so heard audio matches the clock.
			const start = position - tempo.leadSeconds;
			if (start < 0) {
				const silence = new Float32Array(Math.round(-start * sampleRate) * 2);
				if (silence.length && !tempo.push(silence))
					throw new Error("Audio tempo lookahead has no capacity");
			}
			cursor = Math.round(Math.max(0, start) * sampleRate);
			total = Math.max(cursor, Math.round((frames / fps) * sampleRate));
			if (cursor === total) {
				tempo.finish(Math.round(tempo.leadSeconds * sampleRate));
				finished = true;
			}
		},
		async pull(availableFrames: number) {
			if (busy || closed || !tempo) throw new Error("Audio mixer is unavailable or busy");
			if (
				!Number.isSafeInteger(availableFrames) ||
				availableFrames < 1 ||
				availableFrames > sampleRate * 2
			)
				throw new Error("Invalid audio output capacity");
			busy = true;
			const generation = revision;
			const operation = (async () => {
				while (!tempo!.outputFrames && !finished) {
					const room = Math.floor(
						(availableFrames - tempo!.queuedFrames - sampleRate * 0.1) * tempo!.rate,
					);
					const frames = Math.min(total - cursor, Math.floor(sampleRate * 0.25), room);
					if (frames <= 0) throw new Error("Audio buffering: output lookahead is full");
					await feed(frames, generation);
				}
				if (generation !== revision || closed)
					throw new DOMException("Audio mixing cancelled", "AbortError");
				const maximum = Math.min(4096, availableFrames);
				const lease = budget.reserve(maximum * 8 * 2);
				let scratch: Float32Array<ArrayBuffer> | undefined;
				try {
					scratch = new Float32Array(maximum * 2);
					const count = tempo!.read(scratch);
					if (!count) {
						budget.release(lease);
						return null;
					}
					const pcm = scratch.slice(0, count * 2);
					held.add(lease);
					return { pcm, lease };
				} catch (error) {
					budget.release(lease);
					throw error;
				} finally {
					if (scratch) detach(scratch);
				}
			})();
			pending = operation;
			try {
				return await operation;
			} finally {
				busy = false;
			}
		},
		reset,
		async dispose() {
			if (closed) return;
			closed = true;
			await reset();
			for (const lease of held) budget.release(lease);
			held.clear();
			URL.revokeObjectURL(workerUrl);
			budget.free();
		},
	};
}
