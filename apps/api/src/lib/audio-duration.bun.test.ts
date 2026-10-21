/* Narration timing comes from the rendered audio, so a wrong duration is not a
 * cosmetic error: it is where the clip lands on the timeline and how long every
 * clip after it is pushed.
 *
 * The case that made this file exist: Kokoro's server STREAMS its wav, so it
 * cannot know the length when it writes the header and writes a placeholder
 * instead. Trusting that placeholder turned a five-second clip into a
 * twenty-four-hour one. */
import { describe, expect, it } from "bun:test";
import { measureAudioDurationSec, measureWavDurationSec } from "./audio-duration.ts";

const SAMPLE_RATE = 24_000;
const BYTES_PER_SAMPLE = 2;
const BYTE_RATE = SAMPLE_RATE * BYTES_PER_SAMPLE;

/** A mono 16-bit wav carrying `dataBytes` of audio. `declaredSize` overrides the
 *  `data` chunk's length field, which is what a streaming encoder gets wrong. */
function wav(dataBytes: number, declaredSize = dataBytes, extraChunk = false): Uint8Array {
	const extra = extraChunk ? 8 + 26 : 0;
	const buf = new ArrayBuffer(12 + 24 + extra + 8 + dataBytes);
	const dv = new DataView(buf);
	const u8 = new Uint8Array(buf);
	const ascii = (off: number, s: string): void => {
		for (let i = 0; i < s.length; i += 1) u8[off + i] = s.charCodeAt(i);
	};

	ascii(0, "RIFF");
	dv.setUint32(4, buf.byteLength - 8, true);
	ascii(8, "WAVE");

	ascii(12, "fmt ");
	dv.setUint32(16, 16, true);
	dv.setUint16(20, 1, true); // PCM
	dv.setUint16(22, 1, true); // mono
	dv.setUint32(24, SAMPLE_RATE, true);
	dv.setUint32(28, BYTE_RATE, true);
	dv.setUint16(32, BYTES_PER_SAMPLE, true);
	dv.setUint16(34, 16, true);

	let off = 36;
	if (extraChunk) {
		// A LIST chunk between fmt and data, which Kokoro's encoder emits.
		ascii(off, "LIST");
		dv.setUint32(off + 4, 26, true);
		off += 8 + 26;
	}
	ascii(off, "data");
	dv.setUint32(off + 4, declaredSize, true);
	return u8;
}

describe("a well-formed wav is measured from its header", () => {
	it("reads one second of mono 16-bit audio", () => {
		expect(measureWavDurationSec(wav(BYTE_RATE))).toBe(1);
	});

	it("reads a fractional duration", () => {
		expect(measureWavDurationSec(wav(BYTE_RATE / 2))).toBe(0.5);
	});

	it("skips chunks between fmt and data", () => {
		expect(measureWavDurationSec(wav(BYTE_RATE, BYTE_RATE, true))).toBe(1);
	});
});

/* The bug this guards. A streamed wav writes 0xFFFFFFFF (or 0) because the
 * length is unknown when the header goes out; the audio that follows is the
 * real length. */
describe("a streamed wav is measured from the bytes that actually arrived", () => {
	it("ignores a 0xFFFFFFFF placeholder rather than reporting 24 hours", () => {
		const clip = wav(BYTE_RATE * 5, 0xff_ff_ff_ff);
		expect(measureWavDurationSec(clip)).toBe(5);
	});

	it("does not trust any declared size larger than the file", () => {
		expect(measureWavDurationSec(wav(BYTE_RATE, BYTE_RATE * 100))).toBe(1);
	});

	it("leaves a correctly declared size alone", () => {
		// The clamp must be a no-op for a well-formed file, not a truncation.
		expect(measureWavDurationSec(wav(BYTE_RATE * 3))).toBe(3);
	});
});

describe("input that is not a measurable wav", () => {
	it("returns null for bytes too short to hold a header", () => {
		expect(measureWavDurationSec(new Uint8Array(10))).toBeNull();
	});

	it("returns null when the RIFF/WAVE tags are absent", () => {
		expect(measureWavDurationSec(new Uint8Array(64))).toBeNull();
	});

	it("returns null for a zero-length data chunk", () => {
		expect(measureWavDurationSec(wav(0, 0))).toBeNull();
	});

	/* A malformed size must not walk the parser backwards forever; the caller
	 * falls back to ffprobe on null. */
	it("gives up rather than spinning on a chunk that does not advance", () => {
		const clip = wav(BYTE_RATE);
		const dv = new DataView(clip.buffer);
		// Rewrite the fmt chunk's size so the walk cannot progress.
		dv.setUint32(16, 0xff_ff_ff_ff, true);
		expect(measureWavDurationSec(clip)).toBeNull();
	});

	it("defers a non-wav format to the ffprobe fallback", () => {
		expect(measureAudioDurationSec(wav(BYTE_RATE), "mp3")).toBeNull();
	});
});
