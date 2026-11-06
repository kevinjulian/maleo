import {
	ALL_FORMATS,
	HLS,
	AudioSampleSink,
	BlobSource,
	Input,
	type InputAudioTrack,
} from "mediabunny";
import {
	audioDecodeRequest,
	audioWindowMetadata,
	type AudioDecodeRequest,
} from "@models/timeline/preview-audio-protocol.ts";
import { installCodecLifetime } from "./codec-lifetime.ts";
import { z } from "zod";
interface Scope {
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: unknown, transfer?: Transferable[]): void;
}
// SAFETY: this entry runs only in a dedicated media worker under an audio decoder lease.
const scope = globalThis as Scope;
const codecs = installCodecLifetime();
const PREROLL_SEC = 0.1;
interface Opened {
	input: Input;
	track: InputAudioTrack;
	sampleRate: number;
	channels: number;
	firstTimestamp: number;
	frames: number;
}
// One worker serves one source revision. The container is parsed once and every later window
// reuses it; the host terminates the worker to stop, which ends the Input with the thread.
let bound: { sourceId: string; revision: string; opened: Promise<Opened> } | undefined;
let busy = false;
let accept: ((accepted: boolean) => void) | undefined;
async function open(request: AudioDecodeRequest): Promise<Opened> {
	const input = new Input({
		formats: ALL_FORMATS.filter((format) => format !== HLS),
		source: new BlobSource(request.file),
	});
	try {
		if (!(await input.canRead())) throw new Error("Audio container is unsupported or malformed");
		const track = await input.getPrimaryAudioTrack();
		if (!track || !(await track.canDecode()))
			throw new Error("Local source has no decodable audio track");
		const sampleRate = await track.getSampleRate(),
			channels = await track.getNumberOfChannels(),
			firstTimestamp = await track.getFirstTimestamp();
		const frames =
			request.frames ?? Math.round(((await track.computeDuration()) - firstTimestamp) * sampleRate);
		return { input, track, sampleRate, channels, firstTimestamp, frames };
	} catch (error) {
		input.dispose();
		throw error;
	}
}
async function decode(request: AudioDecodeRequest, source: Opened) {
	const { track, sampleRate, channels, firstTimestamp, frames } = source;
	const start = Math.max(0, Math.floor((request.start - firstTimestamp) * sampleRate));
	const end = Math.min(frames, Math.ceil((request.end - firstTimestamp) * sampleRate) + 1);
	const metadata = audioWindowMetadata.parse({
		sourceId: request.sourceId,
		revision: request.revision,
		sampleRate,
		channels,
		firstTimestamp,
		frames,
		start,
		count: end - start,
	});
	const accepted = await new Promise<boolean>((resolve) => {
		accept = resolve;
		scope.postMessage({ type: "reserve", metadata });
	});
	accept = undefined;
	if (!accepted) throw new Error("PCM working set cannot fit the audio budget");
	try {
		const pcm = new Float32Array(metadata.count * metadata.channels);
		let written = start;
		codecs.audio.allow(1);
		// Lossy decoders need pre-roll: a cold decoder's first frame is wrong (MDCT overlap, MP3
		// reservoir). Every window decodes from earlier and keeps only the requested interval, so
		// a held source returns the same samples as a fresh one, in any window order.
		const preroll = Math.max(0, start - Math.ceil(PREROLL_SEC * sampleRate));
		for await (const sample of new AudioSampleSink(track).samples(
			firstTimestamp + preroll / sampleRate,
			firstTimestamp + end / sampleRate,
		)) {
			try {
				if (sample.sampleRate !== sampleRate || sample.numberOfChannels !== channels)
					throw new Error("Decoded audio format changed without a source revision");
				const position = Math.round((sample.timestamp - firstTimestamp) * sampleRate);
				const from = Math.max(start, position),
					to = Math.min(end, position + sample.numberOfFrames);
				if (to <= from) continue;
				if (from !== written)
					throw new Error("Decoded audio has a missing or overlapping sample interval");
				sample.copyTo(pcm.subarray((from - start) * channels, (to - start) * channels), {
					planeIndex: 0,
					format: "f32",
					frameOffset: from - position,
					frameCount: to - from,
				});
				written = to;
			} finally {
				sample.close();
			}
		}
		if (written !== end) throw new Error("Audio decode ended before the requested interval");
		if (pcm.some((value) => !Number.isFinite(value)))
			throw new Error("Decoded audio contains non-finite samples");
		// No codec or native AudioData survives between windows; only the parsed Input is held.
		codecs.audio.close();
		scope.postMessage({ type: "decoded", metadata, pcm }, [pcm.buffer]);
	} finally {
		codecs.audio.close();
	}
}
function refuse(message: string) {
	scope.postMessage({ type: "failed", message });
}
scope.onmessage = ({ data }) => {
	if (accept) {
		const result = z.object({ accepted: z.boolean() }).strict().safeParse(data);
		accept(result.success && result.data.accepted);
		return;
	}
	const parsed = audioDecodeRequest.safeParse(data);
	if (!parsed.success) return refuse("Invalid audio decode request");
	// One window at a time: the host sends the next window only after this one replies.
	if (busy) return refuse("Audio window requested out of order");
	const request = parsed.data;
	if (bound && (bound.sourceId !== request.sourceId || bound.revision !== request.revision))
		return refuse("Audio source revision mismatch");
	bound ??= { sourceId: request.sourceId, revision: request.revision, opened: open(request) };
	busy = true;
	void bound.opened
		.then((source) => decode(request, source))
		.catch((error: unknown) =>
			refuse(error instanceof Error ? error.message : "Audio decode failed"),
		)
		.finally(() => {
			busy = false;
		});
};
