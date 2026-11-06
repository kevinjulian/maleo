import { PREVIEW_AUDIO_WORKER_URL } from "@services/preview-media/script-urls.ts";
import { z } from "zod";
import type { PreviewMediaBinding } from "@models/timeline/preview-protocol.ts";
import {
	createAudioSourceClient,
	type DecodedAudioWindow,
	type PcmReservations,
} from "@services/preview-media/audio-client.ts";
import { AudioTempo, tempoLeadSeconds } from "@services/preview-media/audio-tempo.ts";
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
	// Held across seeks and reconfiguration; replaced only when the source revision changes.
	const clients = new Map<string, ReturnType<typeof createAudioSourceClient>>();
	function client(binding: PreviewMediaBinding) {
		const held = clients.get(binding.url);
		if (held?.source.id === binding.id && held.source.revision === binding.revision) return held;
		held?.dispose();
		const created = createAudioSourceClient(
			{
				id: binding.id,
				revision: binding.revision,
				file: binding.file,
				...(binding.audio ? { frames: binding.audio.frames } : {}),
			},
			budget,
			{ workerUrl, openDecoders },
		);
		clients.set(binding.url, created);
		return created;
	}
	/** Sources no longer bound give up their decoder and parsed container at once. */
	function retain(urls: ReadonlySet<string>) {
		for (const [url, held] of clients)
			if (!urls.has(url)) {
				held.dispose();
				clients.delete(url);
			}
	}
	const held = new Set<bigint>();
	/** The mix plan for a storyboard and its complete local bindings, without touching live state. */
	function project(
		json: string,
		fps: number,
		frames: number,
		sources: readonly PreviewMediaBinding[],
	) {
		const bound = new Map(sources.map((source) => [source.url, source]));
		const projected = mixSchema.parse(JSON.parse(native.project_audio(json, fps, frames)));
		projected.sources = projected.sources.filter((source) => {
			const binding = bound.get(source.url);
			if (!binding) throw new Error(`${source.path}: complete local source is missing`);
			return !(source.embedded && !binding.audio);
		});
		return {
			bound,
			mix: JSON.stringify(projected),
			metadata: JSON.stringify(
				projected.sources.map((source) => {
					const info = bound.get(source.url)?.audio;
					if (!info) throw new Error(`${source.path}: validated audio metadata is missing`);
					return { path: source.path, ...info };
				}),
			),
		};
	}
	// The first lookahead block at a paused playhead, decoded ahead of Play (D2). A seek, a source
	// change or the first feed ends its generation; its windows hold PCM budget until then.
	let warm:
		| {
				controller: AbortController;
				done: Promise<unknown>;
				windows: Array<{ url: string; window: DecodedAudioWindow }>;
		  }
		| undefined;
	let warmGeneration = 0,
		lastRate = 1;
	const WARM_MARGIN_SEC = 0.02;
	function discardWarm() {
		warmGeneration++;
		if (!warm) return;
		warm.controller.abort();
		for (const { window } of warm.windows) window.release();
		warm = undefined;
	}
	function warmAt(
		json: string,
		fps: number,
		frames: number,
		sources: readonly PreviewMediaBinding[],
		position: number,
	): Promise<unknown> {
		discardWarm();
		if (closed) return Promise.resolve();
		const generation = warmGeneration;
		const plan = project(json, fps, frames, sources);
		// Mirror configure(): the tempo lead moves the first block earlier. A small margin keeps the
		// block covering the first feed when the device rate rounds differently.
		const margin = Math.round(sampleRate * WARM_MARGIN_SEC);
		const start = Math.max(
			0,
			Math.round((position - tempoLeadSeconds(lastRate)) * sampleRate) - margin,
		);
		const count = Math.min(
			Math.round((frames / fps) * sampleRate) - start,
			Math.floor(sampleRate * 0.25) + margin * 2,
		);
		if (count <= 0) return Promise.resolve();
		const requests = requestsSchema.parse(
			JSON.parse(native.audio_requests(plan.mix, plan.metadata, sampleRate, start, count)),
		);
		const controller = new AbortController();
		const windows: Array<{ url: string; window: DecodedAudioWindow }> = [];
		const done = Promise.all(
			requests.map(async (request) => {
				const binding = plan.bound.get(request.url);
				if (!binding?.audio) return;
				const window = await client(binding).decode(request.start, request.end, controller.signal);
				if (generation === warmGeneration) windows.push({ url: request.url, window });
				else window.release();
			}),
		);
		warm = { controller, done, windows };
		return done;
	}
	/** A view of a warm window that covers the request exactly as the worker would decode it. */
	function fromWarm(
		binding: PreviewMediaBinding,
		start: number,
		end: number,
	): DecodedAudioWindow | undefined {
		const info = binding.audio;
		if (!info || !warm) return undefined;
		const from = Math.max(0, Math.floor((start - info.firstTimestamp) * info.sampleRate));
		const to = Math.min(info.frames, Math.ceil((end - info.firstTimestamp) * info.sampleRate) + 1);
		for (const { url, window } of warm.windows) {
			const held = window.metadata;
			if (
				url !== binding.url ||
				held.sourceId !== binding.id ||
				held.revision !== binding.revision ||
				held.start > from ||
				held.start + held.count < to
			)
				continue;
			return {
				metadata: { ...held, start: from, count: to - from },
				pcm: window.pcm.subarray(
					(from - held.start) * held.channels,
					(to - held.start) * held.channels,
				),
				// The warm window owns the reservation; discardWarm() returns it after this feed.
				release() {},
			};
		}
		return undefined;
	}
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
		if (warm) await warm.done.catch(() => {});
		const requests = requestsSchema.parse(
			JSON.parse(native.audio_requests(mix, metadata, sampleRate, cursor, frames)),
		);
		const windows: Array<{ path: string; window: DecodedAudioWindow }> = [];
		let mixed: Float32Array<ArrayBuffer> | undefined,
			flattened: Float32Array<ArrayBuffer> | undefined;
		let outputLease: bigint | undefined;
		try {
			// Each source's held client acquires the shared two-decoder broker and yields under contention.
			const results = await Promise.allSettled(
				requests.map(async (request) => {
					const source = bindings.get(request.url);
					if (!source?.audio) throw new Error(`${request.path}: validated local audio is missing`);
					const window =
						fromWarm(source, request.start, request.end) ??
						(await client(source).decode(request.start, request.end, abort.signal));
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
			// The audio client reserved retained, flattened and WASM input copies before allocation.
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
			discardWarm();
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
			const plan = project(json, fps, frames, sources);
			for (const source of sources) bindings.set(source.url, source);
			retain(new Set(bindings.keys()));
			mix = plan.mix;
			metadata = plan.metadata;
			lastRate = rate;
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
		/** Decode the first block at a paused playhead. Best effort: Play decodes on a miss. */
		warm: warmAt,
		discardWarm,
		async dispose() {
			if (closed) return;
			closed = true;
			discardWarm();
			await reset();
			retain(new Set());
			for (const lease of held) budget.release(lease);
			held.clear();
			URL.revokeObjectURL(workerUrl);
			budget.free();
		},
	};
}
