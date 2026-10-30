import { expect, test, vi } from "vite-plus/test";
import { AudioTempo, tempoLeadSeconds } from "./audio-tempo.ts";

const budget = () => ({ reserve: vi.fn(() => 1n), release: vi.fn() });
function tone(sampleRate: number, frames: number) {
	const pcm = new Float32Array(frames * 2);
	for (let i = 0; i < frames; i++)
		pcm[i * 2] = pcm[i * 2 + 1] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
	return pcm;
}
test("upstream tempo keeps tone pitch at 0.5x/1x/2x for 44.1/48 kHz output", () => {
	for (const sampleRate of [44100, 48000])
		for (const rate of [0.25, 0.5, 1, 2, 4]) {
			const account = budget(),
				tempo = new AudioTempo(sampleRate, rate, account),
				input = tone(sampleRate, sampleRate * 2),
				scratch = new Float32Array(2048),
				result: number[] = [];
			for (let at = 0; at < input.length; at += 1024) {
				expect(tempo.push(input.subarray(at, at + 1024))).toBe(true);
				while (tempo.outputFrames) {
					const frames = tempo.read(scratch);
					for (let i = 0; i < frames; i++) result.push(scratch[i * 2]!);
				}
			}
			tempo.finish();
			for (let frames = tempo.read(scratch); frames > 0; frames = tempo.read(scratch))
				for (let i = 0; i < frames; i++) result.push(scratch[i * 2]!);
			let crossings = 0;
			// Measure steady tone, excluding startup and the flushed end padding.
			const skip = Math.floor(result.length * 0.25),
				end = Math.floor(result.length * 0.75);
			for (let i = skip + 1; i < end; i++) if (result[i - 1]! <= 0 && result[i]! > 0) crossings++;
			const hz = (crossings * sampleRate) / (end - skip);
			expect(hz).toBeGreaterThan(435);
			expect(hz).toBeLessThan(445);
			expect(result.length).toBe(Math.round((sampleRate * 2) / rate));
			if (rate === 1) expect(result).toEqual(Array.from(input.filter((_, i) => i % 2 === 0)));
			tempo.dispose();
			tempo.dispose();
			expect(account.release).toHaveBeenCalledExactlyOnceWith(1n);
		}
});
test("reset removes old audio and backpressure bounds pending output", () => {
	const tempo = new AudioTempo(48000, 0.5, budget()),
		input = tone(48000, 512),
		out = new Float32Array(1024);
	let pushed = 0;
	while (tempo.push(input)) {
		pushed++;
		expect(tempo.queuedFrames).toBeLessThanOrEqual(96000);
		expect(pushed).toBeLessThan(1000);
	}
	expect(tempo.outputFrames).toBeGreaterThan(0);
	tempo.reset(1);
	expect(tempo.read(out)).toBe(0);
	expect(tempo.queuedFrames).toBe(0);
	expect(tempo.push(new Float32Array(1024))).toBe(true);
	expect(tempo.read(out)).toBe(512);
	expect(out.every((value) => value === 0)).toBe(true);
	tempo.dispose();
	expect(() => tempo.push(input)).toThrow("closed");
});
test("invalid settings and unavailable memory fail before processing", () => {
	for (const rate of [NaN, 0, 5]) expect(() => new AudioTempo(48000, rate, budget())).toThrow();
	const account = budget();
	account.reserve.mockImplementation(() => {
		throw Error("16 MiB PCM budget exceeded");
	});
	expect(() => new AudioTempo(48000, 1, account)).toThrow("16 MiB");
	expect(account.release).not.toHaveBeenCalled();
	const tempo = new AudioTempo(48000, 1, budget());
	expect(() => tempo.push(new Float32Array([NaN, 0]))).toThrow();
	expect(() => tempo.read(new Float32Array(1))).toThrow();
	tempo.dispose();
});

/** Mean offset, in wall milliseconds, of 0.5 s clicks fed from `lead` seconds before their marks. */
function clickOffsetMs(rate: number, seconds: number) {
	const sampleRate = 48000,
		tempo = new AudioTempo(sampleRate, rate, budget()),
		lead = tempo.leadSeconds;
	const start = Math.round(-lead * sampleRate);
	const input = new Float32Array(sampleRate * seconds * 2);
	for (let frame = 0; frame < sampleRate * seconds; frame++) {
		const time = (frame + start) / sampleRate;
		const value =
			time < 0 ? 0 : 0.05 * Math.sin(2 * Math.PI * 220 * time) + (time % 0.5 < 0.003 ? 0.9 : 0);
		input[frame * 2] = input[frame * 2 + 1] = value;
	}
	const output: number[] = [],
		block = new Float32Array(8192);
	const drain = () => {
		let count;
		while ((count = tempo.read(block))) for (let i = 0; i < count; i++) output.push(block[i * 2]!);
	};
	for (let at = 0; at < input.length; at += 8192) {
		while (!tempo.push(input.subarray(at, at + 8192))) drain();
		drain();
	}
	const offsets: number[] = [];
	let last = -Infinity;
	output.forEach((value, index) => {
		if (Math.abs(value) <= 0.5 || index - last <= sampleRate * 0.1) return;
		last = index;
		const timeline = (index / sampleRate) * rate,
			mark = Math.round(timeline / 0.5) * 0.5;
		if (mark > 0) offsets.push(((timeline - mark) / rate) * 1000);
	});
	tempo.dispose();
	return offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
}

test("lead compensation centres stretched transients on the consumed-sample clock", () => {
	expect(tempoLeadSeconds(1)).toBe(0);
	expect(tempoLeadSeconds(0.6)).toBeCloseTo(0.061 + 0.4 * (0.036 - 0.061), 6);
	for (const rate of [0.5, 0.75, 1.5, 2])
		expect(Math.abs(clickOffsetMs(rate, 20)), `${rate}x`).toBeLessThan(15);
});
