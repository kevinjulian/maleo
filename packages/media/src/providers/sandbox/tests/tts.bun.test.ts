import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSandboxWav, generateSpeechViaSandbox, sandboxSpeechSeconds } from "../index.ts";

const originalCacheDir = process.env.CACHE_DIR;
const cleanup: string[] = [];

afterEach(async () => {
	if (originalCacheDir === undefined) delete process.env.CACHE_DIR;
	else process.env.CACHE_DIR = originalCacheDir;
	await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function useTempCache(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "sandbox-tts-"));
	cleanup.push(dir);
	process.env.CACHE_DIR = dir;
	return dir;
}

/* Parse the fields a player reads before it will decode anything. Asserting the
 * bytes rather than "a file exists" is the point: an unplayable file fails
 * downstream, far from here. */
function readWavHeader(bytes: Buffer) {
	return {
		riff: bytes.toString("ascii", 0, 4),
		wave: bytes.toString("ascii", 8, 12),
		fmt: bytes.toString("ascii", 12, 16),
		audioFormat: bytes.readUInt16LE(20),
		channels: bytes.readUInt16LE(22),
		sampleRate: bytes.readUInt32LE(24),
		bitsPerSample: bytes.readUInt16LE(34),
		data: bytes.toString("ascii", 36, 40),
		dataBytes: bytes.readUInt32LE(40),
	};
}

describe("sandbox tts provider", () => {
	it("writes a WAV a player can actually decode", async () => {
		await useTempCache();
		const result = await generateSpeechViaSandbox("hello from the sandbox");
		expect(result.from_cache).toBe(false);

		const header = readWavHeader(await readFile(result.path));
		expect(header.riff).toBe("RIFF");
		expect(header.wave).toBe("WAVE");
		expect(header.fmt).toBe("fmt ");
		expect(header.audioFormat).toBe(1); // PCM
		expect(header.channels).toBe(1);
		expect(header.sampleRate).toBe(22_050);
		expect(header.bitsPerSample).toBe(16);
		expect(header.data).toBe("data");
	});

	it("declares a data length that matches the bytes it wrote", async () => {
		await useTempCache();
		const result = await generateSpeechViaSandbox("length must agree with the header");
		const bytes = await readFile(result.path);
		// A header claiming more data than the file holds is the classic way a
		// generated WAV plays as a click or not at all.
		expect(readWavHeader(bytes).dataBytes).toBe(bytes.length - 44);
	});

	it("carries real signal, not silence", () => {
		const bytes = createSandboxWav("audible", "sandbox-1");
		let peak = 0;
		for (let offset = 44; offset + 1 < bytes.length; offset += 2) {
			peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)));
		}
		expect(peak).toBeGreaterThan(0);
	});

	it("scales duration with text length, within bounds", () => {
		expect(sandboxSpeechSeconds("hi")).toBe(0.5);
		expect(sandboxSpeechSeconds("x".repeat(150))).toBe(10);
		expect(sandboxSpeechSeconds("x".repeat(100_000))).toBe(30);
	});

	it("returns the cached file on a repeat request", async () => {
		await useTempCache();
		const first = await generateSpeechViaSandbox("same words", "M1");
		const second = await generateSpeechViaSandbox("same words", "M1");
		expect(second.from_cache).toBe(true);
		expect(second.path).toBe(first.path);
	});

	it("keeps a separate cache entry per voice", async () => {
		await useTempCache();
		const first = await generateSpeechViaSandbox("same words", "M1");
		const second = await generateSpeechViaSandbox("same words", "F2");
		// One voice's audio must never be served for another — the failure would be
		// audible in the render and invisible in the job row.
		expect(second.path).not.toBe(first.path);
		expect(second.from_cache).toBe(false);
	});

	it("distinguishes voices in the audio itself, not just the filename", () => {
		const first = createSandboxWav("same words", "M1");
		const second = createSandboxWav("same words", "F2");
		expect(second.subarray(44).equals(first.subarray(44))).toBe(false);
	});
});
