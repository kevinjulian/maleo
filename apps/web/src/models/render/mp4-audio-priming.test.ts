import { describe, expect, test } from "vite-plus/test";
import {
	ALL_FORMATS,
	BufferSource,
	BufferTarget,
	EncodedAudioPacketSource,
	EncodedPacket,
	EncodedPacketSink,
	Input,
	Mp4OutputFormat,
	Output,
} from "mediabunny";
import { peakIndex, withAudioPriming } from "./mp4-audio-priming.ts";

const RATE = 48_000;
const FRAME = 1024;
/** AudioSpecificConfig: AAC-LC, 48 kHz, two channels. */
const ASC = new Uint8Array([0x11, 0x90]);

async function audioOnlyMp4(fastStart: "in-memory" | false, packets = 8): Promise<Uint8Array> {
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat({ fastStart }), target });
	const source = new EncodedAudioPacketSource("aac");
	output.addAudioTrack(source);
	await output.start();
	for (let index = 0; index < packets; index++) {
		const data = new Uint8Array(16).fill(index + 1);
		await source.add(
			new EncodedPacket(data, "key", (index * FRAME) / RATE, FRAME / RATE),
			index === 0
				? {
						decoderConfig: {
							codec: "mp4a.40.2",
							numberOfChannels: 2,
							sampleRate: RATE,
							description: ASC,
						},
					}
				: undefined,
		);
	}
	await output.finalize();
	return new Uint8Array(target.buffer!);
}

async function readBack(bytes: Uint8Array) {
	const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
	const track = (await input.getPrimaryAudioTrack())!;
	const sink = new EncodedPacketSink(track);
	const first = (await sink.getFirstPacket())!;
	const all: number[] = [];
	for await (const packet of sink.packets()) all.push(packet.data[0]!);
	return { first: await track.getFirstTimestamp(), data: first.data, all };
}

describe("withAudioPriming", () => {
	test.each(["in-memory", false] as const)(
		"skips the priming and keeps every packet readable (fastStart %s)",
		async (fastStart) => {
			const original = await audioOnlyMp4(fastStart);
			const patched = withAudioPriming(original, 2112);
			expect(patched.byteLength).toBe(original.byteLength + 36);
			const before = await readBack(original);
			const after = await readBack(patched);
			expect(before.first).toBe(0);
			expect(after.first).toBeCloseTo(-2112 / RATE, 6);
			// Chunk offsets moved with the inserted bytes: the same payloads read back.
			expect(after.all).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
			expect(after.data).toEqual(before.data);
		},
	);

	test("zero priming returns the file unchanged", async () => {
		const original = await audioOnlyMp4("in-memory");
		expect(withAudioPriming(original, 0)).toBe(original);
	});

	test("refuses a second edit list and priming longer than the track", async () => {
		const once = withAudioPriming(await audioOnlyMp4("in-memory"), 100);
		expect(() => withAudioPriming(once, 100)).toThrow("already has an edit list");
		const short = await audioOnlyMp4("in-memory", 2);
		expect(() => withAudioPriming(short, 4096)).toThrow("exceeds the sound track");
		expect(() => withAudioPriming(new Uint8Array(16), 1)).toThrow();
	});

	test("peakIndex finds the impulse", () => {
		const samples = new Float32Array(100);
		samples[42] = -0.8;
		samples[10] = 0.5;
		expect(peakIndex(samples)).toBe(42);
	});
});
