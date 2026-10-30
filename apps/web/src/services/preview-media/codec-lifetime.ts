interface Codec {
	close(): void;
}
interface SampleMethods<T extends Codec> {
	close(this: T): void;
	clone(this: T): T;
}
function sampleLifetime<T extends Codec>(prototype: SampleMethods<T>) {
	const samples = new Set<T>();
	const close = prototype.close,
		clone = prototype.clone;
	prototype.close = function (this: T) {
		samples.delete(this);
		close.call(this);
	};
	prototype.clone = function (this: T) {
		const sample = clone.call(this);
		samples.add(sample);
		return sample;
	};
	return {
		add: (sample: T) => samples.add(sample),
		close: () => {
			for (const sample of [...samples]) sample.close();
		},
	};
}
function lifetime(afterClose: () => void = () => {}) {
	const live = new Set<Codec>();
	let limit = 0;
	return {
		allow(slots: number) {
			limit = slots;
		},
		admit() {
			if (live.size >= limit) throw new Error("Codec allocation exceeds its native decoder lease");
		},
		add(codec: Codec) {
			live.add(codec);
		},
		remove(codec: Codec) {
			return live.delete(codec);
		},
		close() {
			for (const codec of [...live]) codec.close();
			limit = 0;
			afterClose();
		},
	};
}

/** Each dedicated media worker has one codec owner; hidden library instances share its grant. */
export function installCodecLifetime() {
	const frames = globalThis.VideoFrame
		? sampleLifetime<VideoFrame>(VideoFrame.prototype)
		: undefined;
	const samples = globalThis.AudioData ? sampleLifetime<AudioData>(AudioData.prototype) : undefined;
	const video = lifetime(() => frames?.close()),
		audio = lifetime(() => samples?.close());
	const NativeVideo = globalThis.VideoDecoder;
	if (NativeVideo)
		globalThis.VideoDecoder = class extends NativeVideo {
			constructor(init: VideoDecoderInit) {
				video.admit();
				super({
					...init,
					output: (frame) => {
						frames?.add(frame);
						init.output(frame);
					},
				});
				video.add(this);
			}
			override close() {
				if (video.remove(this) && this.state !== "closed") super.close();
			}
		};
	const NativeAudio = globalThis.AudioDecoder;
	if (NativeAudio)
		globalThis.AudioDecoder = class extends NativeAudio {
			constructor(init: AudioDecoderInit) {
				audio.admit();
				super({
					...init,
					output: (sample) => {
						samples?.add(sample);
						init.output(sample);
					},
				});
				audio.add(this);
			}
			override close() {
				if (audio.remove(this) && this.state !== "closed") super.close();
			}
		};
	return { video, audio };
}
