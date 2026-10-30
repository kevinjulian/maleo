import { audioOutputRequest } from "@models/timeline/preview-audio-output-protocol.ts";
declare const sampleRate: number, currentFrame: number;
declare const AudioWorkletProcessor: { new (): { port: MessagePort } };
declare function registerProcessor(
	name: string,
	processor: new () => { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean },
): void;
// About 10 ms at 48 kHz: below one display frame, far fewer messages than one per quantum.
const POSITION_QUANTA = 4;
interface Block {
	id: number;
	pcm: Float32Array;
	offset: number;
}

/** Output only. Rust mixes and the upstream tempo adapter retimes before transfer. */
class PreviewAudioOutput extends AudioWorkletProcessor {
	private blocks: Block[] = [];
	private generation = 0;
	private frames = 0;
	private queued = 0;
	private playing = false;
	private closed = false;
	private quanta = 0;
	private state: "paused" | "playing" | "buffering" = "paused";
	constructor() {
		super();
		this.port.onmessage = ({ data }: MessageEvent<unknown>) => {
			const parsed = audioOutputRequest.safeParse(data);
			if (!parsed.success) {
				this.fail("Invalid audio output message");
				return;
			}
			const message = parsed.data;
			if (message.type === "dispose") {
				this.release();
				this.closed = true;
				this.playing = false;
				return;
			}
			if (this.closed) return;
			if (message.type === "flush") {
				const ids = this.blocks.map((block) => block.id);
				if (message.generation > this.generation) {
					this.blocks = [];
					this.queued = 0;
					this.generation = message.generation;
					this.frames = 0;
					this.playing = false;
					this.state = "paused";
					this.position(currentFrame);
					this.port.postMessage({ type: "flushed", generation: message.generation, ids });
				} else this.port.postMessage({ type: "flushed", generation: message.generation, ids: [] });
				return;
			}
			if (message.generation !== this.generation) {
				if (message.type === "block")
					this.port.postMessage({ type: "released", ids: [message.id] });
				return;
			}
			if (message.type === "play") {
				this.playing = true;
				return;
			}
			const frames = message.pcm.length / 2;
			if (
				!Number.isInteger(frames) ||
				frames <= 0 ||
				this.queued + frames > sampleRate * 2 ||
				this.blocks.some((block) => block.id === message.id)
			) {
				this.fail("Invalid or oversized audio output block");
				return;
			}
			this.blocks.push({ id: message.id, pcm: message.pcm, offset: 0 });
			this.queued += frames;
		};
	}
	private release() {
		const ids = this.blocks.map((block) => block.id);
		this.blocks = [];
		this.queued = 0;
		if (ids.length) this.port.postMessage({ type: "released", ids });
	}
	private fail(message: string) {
		this.playing = false;
		this.closed = true;
		this.release();
		this.port.postMessage({ type: "failed", message });
	}
	private position(renderFrame: number) {
		this.port.postMessage({
			type: "position",
			generation: this.generation,
			frames: this.frames,
			renderFrame,
			state: this.state,
		});
	}
	process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const channels = outputs[0];
		if (!channels || channels.length !== 2) {
			this.fail("Audio output requires stereo speaker layout");
			return false;
		}
		for (const channel of channels) channel.fill(0);
		if (this.closed) return false;
		if (!this.playing) return true;
		let written = 0;
		let released: number[] | undefined;
		while (written < channels[0]!.length && this.blocks.length) {
			const block = this.blocks[0]!;
			const count = Math.min(channels[0]!.length - written, block.pcm.length / 2 - block.offset);
			for (let frame = 0; frame < count; frame++) {
				channels[0]![written + frame] = block.pcm[(block.offset + frame) * 2]!;
				channels[1]![written + frame] = block.pcm[(block.offset + frame) * 2 + 1]!;
			}
			block.offset += count;
			written += count;
			this.queued -= count;
			this.frames += count;
			if (block.offset === block.pcm.length / 2) {
				this.blocks.shift();
				(released ??= []).push(block.id);
			}
		}
		const state = written < channels[0]!.length ? "buffering" : "playing";
		if (state !== this.state || (written && ++this.quanta % POSITION_QUANTA === 0)) {
			this.state = state;
			this.position(currentFrame + written);
		}
		if (released) this.port.postMessage({ type: "released", ids: released });
		return true;
	}
}
registerProcessor("maleo-preview-audio", PreviewAudioOutput);
