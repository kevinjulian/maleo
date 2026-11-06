import { FifoSampleBuffer, Stretch } from "@soundtouchjs/core";
import type { PcmReservations } from "./audio-client.ts";

/** Upstream FIFO can grow past its initial maximum. Refuse growth before allocation. */
class BoundedFifo extends FifoSampleBuffer {
	constructor(private readonly limit: number) {
		super(limit);
		super.ensureCapacity(limit);
	}
	override ensureCapacity(frames = 0) {
		if (!Number.isSafeInteger(frames) || frames < 0 || frames > this.limit)
			throw new Error("Tempo FIFO exceeds two-second PCM capacity");
		super.ensureCapacity(frames);
	}
	dispose() {
		structuredClone(this.vector.buffer, { transfer: [this.vector.buffer] });
	}
}

/**
 * WSOLA parameters below 1x. Upstream's automatic 120 ms sequence at 0.5x places single
 * transients up to about 90 ms from their mark; 40 ms holds them within about 18 ms
 * (`archive/2026-11-06-p2-half-speed-sync/evidence/tempo-sweep.md`). Rates above 1x keep automatic parameters.
 */
const SLOW_PARAMETERS = { sequenceMs: 40, seekWindowMs: 15, overlapMs: 8, quickSeek: true };
const AUTO_PARAMETERS = { sequenceMs: 0, seekWindowMs: 0, overlapMs: 8, quickSeek: true };

/**
 * Timeline seconds by which upstream WSOLA output leads its input, by transport rate.
 * Mean of 0.5 s clicks over 30 s at 48 kHz with @soundtouchjs/core: rates below 1x measured
 * 2026-11-06 with `SLOW_PARAMETERS` (`archive/2026-11-06-p2-half-speed-sync/evidence/tempo-sweep.md`), the others
 * 2026-10-29 with automatic parameters. `audio-tempo.test.ts` re-measures it, so an upstream
 * change cannot shift the clock silently.
 */
const LEAD_SECONDS: ReadonlyArray<readonly [rate: number, lead: number]> = [
	[0.25, 0.04],
	[0.5, 0.031],
	[0.75, 0.025],
	[1, 0],
	[1.25, 0.005],
	[1.5, -0.007],
	[2, -0.025],
	[3, -0.054],
	[4, -0.049],
];

export function tempoLeadSeconds(rate: number): number {
	if (rate === 1) return 0;
	const upper = LEAD_SECONDS.findIndex(([at]) => at >= rate);
	if (upper <= 0) return LEAD_SECONDS[upper === 0 ? 0 : LEAD_SECONDS.length - 1]![1];
	const [r0, l0] = LEAD_SECONDS[upper - 1]!,
		[r1, l1] = LEAD_SECONDS[upper]!;
	return l0 + ((rate - r0) / (r1 - r0)) * (l1 - l0);
}

/** Global transport only. Authored edits remain validated derivatives before Rust mixing. */
export class AudioTempo {
	private readonly lease: bigint;
	private readonly input: BoundedFifo;
	private readonly output: BoundedFifo;
	private readonly padding: Float32Array<ArrayBuffer>;
	private stretch: Stretch | undefined;
	private closed = false;
	private ended = false;
	private inputFrames = 0;
	private readFrames = 0;
	private trimFrames = 0;
	private speed: number;
	readonly capacityFrames: number;
	constructor(
		readonly sampleRate: number,
		rate: number,
		private readonly budget: PcmReservations,
	) {
		if (
			!Number.isInteger(sampleRate) ||
			sampleRate < 8000 ||
			sampleRate > 192000 ||
			!Number.isFinite(rate) ||
			rate < 0.25 ||
			rate > 4
		)
			throw new Error("Invalid transport sample rate or speed");
		this.speed = rate;
		this.capacityFrames = sampleRate * 2;
		// Two fixed stereo FIFOs plus upstream's three 8 ms overlap arrays, rounded upward.
		this.lease = budget.reserve(
			(this.capacityFrames * 2 + Math.ceil(sampleRate * 0.025) + 256) * 8,
		);
		let input: BoundedFifo | undefined, output: BoundedFifo | undefined;
		try {
			this.padding = new Float32Array(512);
			this.input = input = new BoundedFifo(this.capacityFrames);
			this.output = output = new BoundedFifo(this.capacityFrames);
			this.stretch = new Stretch({ sampleRate });
			this.stretch.inputBuffer = input;
			this.stretch.outputBuffer = output;
			this.configure(rate);
		} catch (error) {
			input?.dispose();
			output?.dispose();
			budget.release(this.lease);
			throw error;
		}
	}
	get rate() {
		return this.speed;
	}
	private configure(rate: number) {
		if (!this.stretch) return;
		this.stretch.setStretchParameters(rate < 1 ? SLOW_PARAMETERS : AUTO_PARAMETERS);
		this.stretch.tempo = rate;
	}
	/** Start input this much timeline earlier so output content matches the consumed-sample clock. */
	get leadSeconds() {
		return tempoLeadSeconds(this.speed);
	}
	get outputFrames() {
		return this.output.frameCount;
	}
	/** Conservative queued output duration, including the processor's pending input. */
	get queuedFrames() {
		return this.output.frameCount + Math.ceil(this.input.frameCount / this.speed);
	}
	/** Initial input required before upstream can emit output. Measured output latency is separate. */
	get primingFrames() {
		return this.speed === 1
			? 0
			: this.stretch
				? this.stretch.inputChunkSize + this.stretch.overlapLength
				: 0;
	}
	push(pcm: Float32Array): boolean {
		if (this.closed) throw new Error("Audio tempo processor is closed");
		if (this.ended) throw new Error("Audio tempo input already finished");
		if (
			pcm.length % 2 ||
			pcm.length > this.capacityFrames * 2 ||
			pcm.some((value) => !Number.isFinite(value))
		)
			throw new Error("Invalid stereo tempo input");
		const frames = pcm.length / 2;
		if (this.speed === 1) {
			if (this.output.frameCount + frames > this.capacityFrames) return false;
			this.output.putSamples(pcm, 0, frames);
			this.inputFrames += frames;
			return true;
		}
		const stretch = this.stretch;
		if (!stretch) throw new Error("Audio tempo processor is unavailable");
		const maximum =
			this.output.frameCount +
			Math.ceil((this.input.frameCount + frames) / this.speed) +
			stretch.outputChunkSize;
		if (maximum > this.capacityFrames || this.input.frameCount + frames > this.capacityFrames)
			return false;
		this.input.putSamples(pcm, 0, frames);
		stretch.process();
		this.inputFrames += frames;
		return true;
	}
	/** `trimFrames` of input fed ahead of the clock (the lead) do not lengthen the output. */
	finish(trimFrames = 0) {
		if (this.closed) throw new Error("Audio tempo processor is closed");
		if (!Number.isSafeInteger(trimFrames)) throw new Error("Invalid tempo trim");
		this.ended = true;
		this.trimFrames = trimFrames;
	}
	read(output: Float32Array): number {
		if (this.closed) throw new Error("Audio tempo processor is closed");
		if (output.length % 2 || output.length > this.capacityFrames * 2)
			throw new Error("Invalid stereo tempo output");
		const remaining = this.ended
			? Math.max(0, Math.round((this.inputFrames - this.trimFrames) / this.speed) - this.readFrames)
			: Infinity;
		if (remaining === 0) {
			this.stretch?.clear();
			return 0;
		}
		if (this.ended && output.length > 0 && this.output.frameCount === 0 && this.speed !== 1) {
			const stretch = this.stretch;
			if (!stretch) throw new Error("Audio tempo processor is unavailable");
			let padded = 0;
			while (this.output.frameCount === 0) {
				if (padded >= this.capacityFrames) throw new Error("Upstream tempo tail did not complete");
				this.input.putSamples(this.padding);
				stretch.process();
				padded += this.padding.length / 2;
			}
		}
		const frames = Math.min(output.length / 2, this.output.frameCount, remaining);
		this.output.extract(output.subarray(0, frames * 2), 0, frames);
		this.output.receive(frames);
		this.readFrames += frames;
		if (this.ended && frames === remaining) this.stretch?.clear();
		return frames;
	}
	reset(rate = this.speed) {
		if (this.closed) throw new Error("Audio tempo processor is closed");
		if (!Number.isFinite(rate) || rate < 0.25 || rate > 4)
			throw new Error("Invalid transport speed");
		this.stretch?.clear();
		this.configure(rate);
		this.speed = rate;
		this.inputFrames = this.readFrames = this.trimFrames = 0;
		this.ended = false;
	}
	dispose() {
		if (this.closed) return;
		this.closed = true;
		this.stretch = undefined;
		this.input.dispose();
		this.output.dispose();
		structuredClone(this.padding.buffer, { transfer: [this.padding.buffer] });
		this.budget.release(this.lease);
	}
}
