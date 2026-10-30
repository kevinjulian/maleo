import { ALL_FORMATS, HLS, AudioSampleSink, BlobSource, Input, VideoSampleSink } from "mediabunny";
import type { PreviewMediaSource } from "@maleo/shared";
import { audioMetadataSchema } from "@models/timeline/preview-audio-protocol.ts";

export interface DecoderPermit {
	id: number;
	yielded: Promise<void>;
	isYielded(): boolean;
}
export type DecoderProbe = <T>(
	kind: "video" | "audio",
	probe: (permit: DecoderPermit) => Promise<T>,
	slots?: 1 | 2,
) => Promise<T>;

/** Probe only. No codec/sample survives this call. Later packets can still fail. */
export async function validateSource(
	file: File,
	kinds: PreviewMediaSource["kinds"],
	withDecoder: DecoderProbe,
) {
	if (!file.size) throw new Error("Media source has no bytes");
	if (!kinds.length) throw new Error("Media source has no required track kind");
	if (kinds.includes("image")) {
		if (kinds.some((kind) => kind !== "image"))
			throw new Error("Unsupported mixed image and audiovisual source requirements");
		let bitmap: ImageBitmap;
		try {
			bitmap = await createImageBitmap(file, { resizeWidth: 1, resizeHeight: 1 });
		} catch {
			throw new Error("Image source cannot be decoded");
		}
		bitmap.close();
		return {
			container: "image",
			codecs: ["image"],
			videoTracks: 0,
			audioTracks: 0,
			video: null,
			audio: null,
		};
	}
	const input = new Input({
		formats: ALL_FORMATS.filter((format) => format !== HLS),
		source: new BlobSource(file),
	});
	try {
		if (!(await input.canRead())) throw new Error("Media container is unsupported or malformed");
		const videos = kinds.includes("video") ? await input.getVideoTracks() : [];
		const audios = await input.getAudioTracks();
		if (kinds.includes("video") && !videos.length)
			throw new Error("Video source has no video track");
		if (kinds.includes("audio") && !audios.length)
			throw new Error("Audio source has no audio track");
		const codecs: string[] = [];
		for (const track of videos) {
			const codec = await track.getCodec();
			if (!codec || !(await track.canDecode()))
				throw new Error(`Unsupported video codec: ${codec ?? "unknown"}`);
			await withDecoder(
				"video",
				async () => {
					let decoded = false;
					// Drain the finite iterator: getSample() returns before its decoder pump closes.
					for await (const sample of new VideoSampleSink(track).samplesAtTimestamps([
						await track.getFirstTimestamp(),
					])) {
						if (!sample) throw new Error("Video track produced no initial decoded frame");
						try {
							if (sample.codedWidth <= 0 || sample.codedHeight <= 0)
								throw new Error("Video track has invalid frame dimensions");
							decoded = true;
						} finally {
							sample.close();
						}
					}
					if (!decoded) throw new Error("Video track produced no initial decoded frame");
				},
				(await track.canBeTransparent()) ? 2 : 1,
			);
			codecs.push(codec);
		}
		// Only the primary audio track reaches the mix; secondary tracks must not block playback.
		const primaryAudio = await input.getPrimaryAudioTrack();
		for (const track of primaryAudio ? [primaryAudio] : []) {
			const codec = await track.getCodec();
			if (!codec || !(await track.canDecode()))
				throw new Error(`Unsupported audio codec: ${codec ?? "unknown"}`);
			await withDecoder("audio", async () => {
				let decoded = false;
				for await (const sample of new AudioSampleSink(track).samplesAtTimestamps([
					await track.getFirstTimestamp(),
				])) {
					if (!sample) throw new Error("Audio track produced no initial decoded sample");
					try {
						if (sample.numberOfFrames <= 0 || sample.numberOfChannels <= 0)
							throw new Error("Audio track has invalid sample dimensions");
						decoded = true;
					} finally {
						sample.close();
					}
				}
				if (!decoded) throw new Error("Audio track produced no initial decoded sample");
			});
			codecs.push(codec);
		}
		const primary = kinds.includes("video") ? await input.getPrimaryVideoTrack() : null;
		const video = primary
			? {
					width: await primary.getDisplayWidth(),
					height: await primary.getDisplayHeight(),
					firstTimestamp: await primary.getFirstTimestamp(),
					slots: (await primary.canBeTransparent()) ? (2 as const) : (1 as const),
				}
			: null;
		let audio = null;
		if (primaryAudio) {
			const sampleRate = await primaryAudio.getSampleRate();
			const firstTimestamp = await primaryAudio.getFirstTimestamp();
			audio = audioMetadataSchema.parse({
				sampleRate,
				firstTimestamp,
				channels: await primaryAudio.getNumberOfChannels(),
				frames: Math.round(((await primaryAudio.computeDuration()) - firstTimestamp) * sampleRate),
			});
		}
		return {
			container: (await input.getFormat()).name,
			codecs,
			videoTracks: videos.length,
			audioTracks: audios.length,
			video,
			audio,
		};
	} finally {
		input.dispose();
	}
}
