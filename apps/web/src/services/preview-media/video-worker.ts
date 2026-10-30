import {
	ALL_FORMATS,
	HLS,
	BlobSource,
	Input,
	VideoSampleSink,
	type InputVideoTrack,
	type VideoSample,
} from "mediabunny";
import { installCodecLifetime } from "./codec-lifetime.ts";
import {
	videoRequestSchema,
	type LocalVideoSource,
	type VideoLease,
} from "@models/timeline/preview-video-protocol.ts";
interface WorkerScope {
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: unknown, transfer?: Transferable[]): void;
}
// SAFETY: built only as a dedicated media-worker entry.
const scope = globalThis as WorkerScope;
const codecs = installCodecLifetime();
let source: LocalVideoSource | undefined,
	input: Input | undefined,
	track: InputVideoTrack | undefined;
let iterator: AsyncGenerator<VideoSample> | undefined,
	current: VideoSample | undefined,
	next: VideoSample | undefined;
let firstTimestamp = 0,
	timeResolution = 1,
	generation = -1,
	lastTime = -Infinity,
	slots = 0,
	epoch = 0,
	closed = false,
	busy = false;
let previousTimestamp: number | undefined;
const reservations = new Map<
	number,
	(result: { accepted: boolean; message?: string; cancelled?: boolean }) => void
>();

const waiters = new Set<() => void>();

/**
 * Ends the current read. `return()` must finish before a new iterator starts, or the old decode
 * pump can take the only codec slot; a cancel meanwhile closes the codec under it and would
 * leave it unsettled, so it races the cancellation.
 */
async function reset() {
	const ending = iterator;
	iterator = undefined;
	if (ending) await untilCancelled(ending.return(undefined)).catch(() => {});
	discard();
}
/** Drops every decode resource now. Native instances and delivered samples close here. */
function discard() {
	current?.close();
	next?.close();
	current = next = undefined;
	previousTimestamp = undefined;
	iterator = undefined;
	codecs.video.close();
	input?.dispose();
	input = undefined;
	track = undefined;
	generation = -1;
	lastTime = -Infinity;
}
/**
 * Reads the next sample. Cancelling closes the codec, which leaves a pending read unresolved
 * forever, so the read races the cancellation instead of hanging its request.
 */
async function pull(at: number) {
	const samples = iterator;
	if (!samples) throw new Error("Local video samples are unavailable");
	const value = await untilCancelled(samples.next());
	active(at);
	return value;
}
async function untilCancelled<T>(work: Promise<T>): Promise<T> {
	let stop!: () => void;
	const stopped = new Promise<never>((_, reject) => {
		stop = () => reject(new DOMException("Video request cancelled", "AbortError"));
	});
	waiters.add(stop);
	try {
		return await Promise.race([work, stopped]);
	} finally {
		waiters.delete(stop);
	}
}
async function open() {
	if (!source) throw new Error("Local video source is missing");
	input = new Input({
		formats: ALL_FORMATS.filter((format) => format !== HLS),
		source: new BlobSource(source.file),
	});
	if (!(await input.canRead())) throw new Error("Video container is unsupported or malformed");
	track = (await input.getPrimaryVideoTrack()) ?? undefined;
	if (!track || !(await track.canDecode())) throw new Error("Video track cannot be decoded");
	firstTimestamp = await track.getFirstTimestamp();
	timeResolution = await track.getTimeResolution();
	if (!Number.isFinite(timeResolution) || timeResolution <= 0)
		throw new Error("Invalid video timestamp resolution");
	return {
		width: await track.getDisplayWidth(),
		height: await track.getDisplayHeight(),
		slots: (await track.canBeTransparent()) ? (2 as const) : (1 as const),
		firstTimestamp,
	};
}
function active(at: number) {
	if (closed || at !== epoch) throw new DOMException("Video request cancelled", "AbortError");
}
async function frame(requestId: number, lease: VideoLease, at: number) {
	const request = lease.request;
	if (!source || request.sourceId !== source.id || request.revision !== source.revision)
		throw new Error("Local video source revision changed");
	if (!slots) throw new Error("Native video decoder lease is missing");
	if (iterator && (request.generation !== generation || request.time < lastTime)) await reset();
	active(at);
	// A cancel or reset closed the lease; reopening probes the track with a decoder, so the
	// lease comes back first. A cancel meanwhile must not leave the open unsettled either.
	codecs.video.allow(slots);
	if (!track) await untilCancelled(open());
	active(at);
	if (!iterator) {
		if (!track) throw new Error("Local video track is unavailable");
		iterator = new VideoSampleSink(track).samples(request.time);
		generation = request.generation;
	}
	const timestamp = request.time;
	const ticks = (value: number) => Math.round(value * timeResolution);
	// Remotion v4.0.462 truncates requested ticks, then selects nearest PTS; ties choose later.
	const target = Math.trunc(timestamp * timeResolution);
	if (!current) {
		const value = await pull(at);
		current = value.done ? undefined : value.value;
	}
	if (!next && current) {
		const value = await pull(at);
		next = value.done ? undefined : value.value;
	}
	while (
		next &&
		current &&
		Math.abs(ticks(next.timestamp) - target) <= Math.abs(ticks(current.timestamp) - target)
	) {
		previousTimestamp = current.timestamp;
		current?.close();
		current = next;
		next = undefined;
		const value = await pull(at);
		next = value.done ? undefined : value.value;
	}
	if (!current) throw new Error("Video has no frame at the requested source time");
	const boundary = (left: number, right: number) =>
		Math.ceil((ticks(left) + ticks(right)) / 2) / timeResolution;
	const start =
			previousTimestamp === undefined
				? current.timestamp <= firstTimestamp
					? 0
					: current.timestamp
				: boundary(previousTimestamp, current.timestamp),
		end = next ? boundary(current.timestamp, next.timestamp) : current.timestamp + current.duration;
	if (!(end > start) || request.time < start || request.time >= end)
		throw new Error("Video selection window does not cover the requested source time");
	const width = current.displayWidth,
		height = current.displayHeight,
		bytes = width * height * 4;
	if (!Number.isSafeInteger(bytes) || bytes <= 0)
		throw new Error("Invalid decoded video dimensions");
	const reserved = await new Promise<{ accepted: boolean; message?: string; cancelled?: boolean }>(
		(resolve) => {
			reservations.set(requestId, resolve);
			scope.postMessage({ type: "reserve", requestId, width, height, bytes: bytes * 2 });
		},
	);
	active(at);
	if (!reserved.accepted)
		throw reserved.cancelled
			? new DOMException("Video request cancelled", "AbortError")
			: new Error(reserved.message ?? "Video working set cannot fit the visual budget");
	active(at);
	// No await follows, so the frame cannot be orphaned by a cancellation before it is posted.
	const output = pixels(current, width, height);
	lastTime = request.time;
	scope.postMessage(
		{
			type: "frame",
			requestId,
			lease: lease.id,
			identity: {
				sourceId: request.sourceId,
				revision: request.revision,
				start,
				end,
				presentation: [current.timestamp, current.timestamp + current.duration],
				width,
				height,
			},
			pixels: output,
		},
		[output instanceof VideoFrame ? output : output.buffer],
	);
}
/** The GPU converts a transferred `VideoFrame`; only rotated sources take the canvas readback. */
function pixels(
	sample: VideoSample,
	width: number,
	height: number,
): VideoFrame | Uint8Array<ArrayBuffer> {
	if (sample.rotation === 0) {
		const frame = sample.toVideoFrame();
		if (frame.displayWidth === width && frame.displayHeight === height) return frame;
		frame.close();
	}
	return canvasFrame(sample, width, height);
}
function canvasFrame(sample: VideoSample, width: number, height: number): Uint8Array<ArrayBuffer> {
	const canvas = new OffscreenCanvas(width, height);
	try {
		const context = canvas.getContext("2d", { willReadFrequently: true });
		if (!context) throw new Error("Video RGBA output is unavailable");
		sample.draw(context, 0, 0, width, height);
		const buffer = context.getImageData(0, 0, width, height).data.buffer;
		if (!(buffer instanceof ArrayBuffer)) throw new Error("Video output must be transferable");
		return new Uint8Array(buffer);
	} finally {
		canvas.width = 0;
		canvas.height = 0;
	}
}
function cancel() {
	epoch++;
	for (const resolve of reservations.values())
		resolve({ accepted: false, message: "Video request cancelled" });
	reservations.clear();
	for (const stop of waiters) stop();
	waiters.clear();
	// The closed codec cannot serve the old iterator again; the next request opens a fresh one.
	discard();
}
async function dispose() {
	closed = true;
	cancel();
	await reset();
	scope.postMessage({ type: "disposed" });
}
scope.onmessage = ({ data }) => {
	const parsed = videoRequestSchema.safeParse(data);
	if (!parsed.success) {
		scope.postMessage({ type: "fatal", message: "Invalid video worker request" });
		return;
	}
	const message = parsed.data;
	if (message.type === "reservation") {
		reservations.get(message.requestId)?.(message);
		reservations.delete(message.requestId);
		return;
	}
	if (message.type === "cancel") {
		cancel();
		return;
	}
	if (message.type === "dispose") {
		void dispose().catch(() =>
			scope.postMessage({ type: "fatal", message: "Video worker cleanup failed" }),
		);
		return;
	}
	if (closed) return;
	if (message.type === "init") {
		if (source) {
			scope.postMessage({ type: "fatal", message: "Video worker is already initialized" });
			return;
		}
		source = message.source;
		void open().then(
			(metadata) => {
				if (!closed) scope.postMessage({ type: "metadata", metadata });
			},
			() => scope.postMessage({ type: "fatal", message: "Local video metadata is unavailable" }),
		);
		return;
	}
	if (message.type === "grant") {
		slots = message.slots;
		return;
	}
	if (busy) {
		scope.postMessage({
			type: "failed",
			requestId: message.requestId,
			message: "Video decoder already has an active request",
			cancelled: true,
		});
		return;
	}
	busy = true;
	const at = epoch;
	void frame(message.requestId, message.lease, at)
		.catch(async (error: unknown) => {
			const cancelled =
				closed || at !== epoch || (error instanceof DOMException && error.name === "AbortError");
			await reset();
			if (!closed)
				scope.postMessage({
					type: "failed",
					requestId: message.requestId,
					cancelled,
					message: cancelled
						? "Video request cancelled"
						: error instanceof Error
							? error.message
							: "Video frame decode failed",
				});
		})
		.finally(() => {
			busy = false;
		});
};
