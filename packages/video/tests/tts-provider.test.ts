import { afterEach, describe, expect, test } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { synthesize } from "../src/lib/tts";

const origFetch = globalThis.fetch;
const cacheDir = mkdtempSync(join(tmpdir(), "tts-prov-"));

afterEach(() => {
	globalThis.fetch = origFetch;
	delete process.env.MALEO_TTS_PROVIDER;
	delete process.env.MALEO_KOKORO_URL;
	delete process.env.ELEVENLABS_API_KEY;
});

// Minimal valid WAV so wavDuration parses (byteRate 16000 -> ~0.0625s for 1000 data bytes).
function fakeWav(): ArrayBuffer {
	const data = 1000;
	const buf = Buffer.alloc(44 + data);
	buf.write("RIFF", 0, "ascii");
	buf.write("WAVE", 8, "ascii");
	buf.writeUInt32LE(16000, 28); // byteRate
	buf.write("data", 36, "ascii");
	buf.writeUInt32LE(data, 40);
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

describe("tts provider routing", () => {
	test("routes to Kokoro OpenAI-compatible endpoint when URL set", async () => {
		process.env.MALEO_KOKORO_URL = "http://127.0.0.1:8880";
		let calledUrl = "";
		let calledBody: Record<string, unknown> = {};
		globalThis.fetch = (async (url: string, init?: { body?: string }) => {
			calledUrl = url;
			calledBody = JSON.parse(init?.body ?? "{}");
			return new Response(fakeWav(), { status: 200, headers: { "content-type": "audio/wav" } });
		}) as unknown as typeof fetch;

		const res = await synthesize({ text: "halo dunia", cacheDir });
		expect(calledUrl).toBe("http://127.0.0.1:8880/v1/audio/speech");
		expect(calledBody.input).toBe("halo dunia");
		expect(calledBody.voice).toBeDefined();
		expect(res.audioPath.endsWith(".wav")).toBe(true);
		expect(res.durationSec).toBeGreaterThan(0);
	});

	test("explicit provider=kokoro overrides", async () => {
		process.env.MALEO_TTS_PROVIDER = "kokoro";
		let hit = false;
		globalThis.fetch = (async (url: string) => {
			hit = String(url).includes("/v1/audio/speech");
			return new Response(fakeWav(), { status: 200 });
		}) as unknown as typeof fetch;
		await synthesize({ text: "tes", cacheDir: join(cacheDir, "b") });
		expect(hit).toBe(true);
	});

	test("falls back to elevenlabs error when no provider configured", async () => {
		// No Kokoro URL, no ElevenLabs key -> paid path throws clear error.
		await expect(synthesize({ text: "x", cacheDir: join(cacheDir, "c") })).rejects.toThrow(
			/No TTS configured|ELEVENLABS/,
		);
	});
});

rmSync(cacheDir, { recursive: true, force: true });
