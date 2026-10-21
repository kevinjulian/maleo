/* The catalogue routes must report where a sample lives without ever reaching a
 * provider — that is what makes previewing free. These tests assert both halves:
 * the field is present and correct, and serving it issues no synthesis.
 *
 * Samples are real files in a shared directory, and a developer machine may have
 * a genuine bake sitting there. So every fixture STAGES state (moving any real
 * clip aside) and restores it afterwards; nothing here writes or deletes blind,
 * and no assertion depends on whether this machine has been baked. */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { ttsRoutes } from "./tts.ts";
import { voiceSampleFilename } from "../lib/voice-samples.ts";
import { setTtsSynthesizerForTests } from "../lib/tts-synth.ts";
import type { TtsVoiceOption } from "@maleo/shared";
import { providersFor } from "@maleo/media/providers";
import { testApp } from "../middleware/auth-testing.ts";

const UPLOADS = "public/uploads";
const SAMPLE_EXTS = ["mp3", "wav", "ogg", "flac"];

type Provider = string;

/** Every path a sample for this voice could occupy, in the dir the resolver
 *  checks first (cwd-relative), which is also where these tests write. */
function samplePaths(provider: Provider, voiceId: string): string[] {
	return SAMPLE_EXTS.map((ext) => `${UPLOADS}/${voiceSampleFilename(provider, voiceId, ext)}`);
}

/** Undo log: [path, restoreFrom | null]. */
const staged: Array<{ path: string; backup: string | null }> = [];

function stashExisting(provider: Provider, voiceId: string): void {
	for (const path of samplePaths(provider, voiceId)) {
		if (!existsSync(path)) continue;
		const backup = `${path}.testbak`;
		renameSync(path, backup);
		staged.push({ path, backup });
	}
}

/** Make this voice look baked, preserving any real clip underneath. */
function stageSample(provider: Provider, voiceId: string, ext = "wav"): string {
	stashExisting(provider, voiceId);
	mkdirSync(UPLOADS, { recursive: true });
	const path = `${UPLOADS}/${voiceSampleFilename(provider, voiceId, ext)}`;
	writeFileSync(path, "fake audio");
	staged.push({ path, backup: null });
	return `/uploads/${voiceSampleFilename(provider, voiceId, ext)}`;
}

/** Make this voice look unbaked whether or not this machine has real samples. */
function stageMissing(provider: Provider, voiceId: string): void {
	stashExisting(provider, voiceId);
}

let synthCalls = 0;

beforeEach(() => {
	synthCalls = 0;
	// Any synthesis during a catalogue read is a bug, so the seam counts calls
	// rather than returning something plausible.
	setTtsSynthesizerForTests(async () => {
		synthCalls += 1;
		return { bytes: new Uint8Array([1]), ext: "wav" };
	});
});

afterEach(() => {
	setTtsSynthesizerForTests(null);
	// Reverse order: a staged file may sit on top of a stashed original.
	for (const entry of staged.splice(0).reverse()) {
		if (entry.backup) renameSync(entry.backup, entry.path);
		else rmSync(entry.path, { force: true });
	}
});

interface StatusBody {
	providers: Array<{ id: string; voices: TtsVoiceOption[] }>;
	voices: TtsVoiceOption[];
}

async function status(app = testApp(ttsRoutes())): Promise<StatusBody> {
	const res = await app.request("/status");
	expect(res.status).toBe(200);
	return await res.json();
}

function find(body: StatusBody, provider: string, id: string): TtsVoiceOption | undefined {
	return body.providers.find((p) => p.id === provider)?.voices.find((v) => v.id === id);
}

describe("tts status voice samples", () => {
	it("carries the field on every voice of every provider", async () => {
		const body = await status();
		// Every REGISTERED provider, not a pair named here — the payload is the
		// list, so this holds for a provider added after these words were written.
		expect(body.providers.length).toBeGreaterThan(1);
		for (const provider of body.providers) {
			for (const v of provider.voices) expect("sampleUrl" in v).toBe(true);
		}
	});

	/* A provider whose voices are DECLARED must offer some, or it is selectable
	 * with nothing to speak with. One whose voices are CLONED legitimately offers
	 * none until the workspace creates one, so the two are asserted apart rather
	 * than the weaker rule being applied to both. */
	it("every declaring provider offers voices", async () => {
		const body = await status();
		const declaring = providersFor("tts").filter((p) => p.meta.tts?.voiceSource !== "cloned");
		expect(declaring.length).toBeGreaterThan(0);
		for (const provider of declaring) {
			const entry = body.providers.find((p) => p.id === provider.meta.id);
			expect(entry?.voices.length).toBeGreaterThan(0);
		}
	});

	it("a cloning provider offers none until this workspace clones one", async () => {
		const body = await status();
		for (const provider of providersFor("tts").filter(
			(p) => p.meta.tts?.voiceSource === "cloned",
		)) {
			expect(body.providers.find((p) => p.id === provider.meta.id)?.voices).toEqual([]);
		}
	});

	it("reports an explicit null for a voice with no baked sample", async () => {
		stageMissing("kokoro", "af_heart");
		const voice = find(await status(), "kokoro", "af_heart");
		expect(voice).toBeDefined();
		expect(voice?.sampleUrl ?? null).toBeNull();
	});

	it("reports the url once a sample is baked", async () => {
		const url = stageSample("kokoro", "af_heart");
		expect(find(await status(), "kokoro", "af_heart")?.sampleUrl).toBe(url);
	});

	it("finds a sample whatever extension it was baked as", async () => {
		const url = stageSample("kokoro", "af_heart", "mp3");
		expect(find(await status(), "kokoro", "af_heart")?.sampleUrl).toBe(url);
	});

	it("does not serve one provider's sample for another provider's voice", async () => {
		stageSample("kokoro", "am_puck", "mp3");
		stageMissing("sandbox", "mock");
		const body = await status();
		expect(find(body, "kokoro", "am_puck")?.sampleUrl).not.toBeNull();
		expect(find(body, "sandbox", "mock")?.sampleUrl ?? null).toBeNull();
	});

	it("picks up a sample baked after the route was constructed", async () => {
		// The reason sample urls are resolved per request: baking against a running
		// server must start serving previews without a restart.
		const app = testApp(ttsRoutes());
		stageMissing("kokoro", "af_heart");
		expect(find(await status(app), "kokoro", "af_heart")?.sampleUrl ?? null).toBeNull();

		const url = stageSample("kokoro", "af_heart");
		expect(find(await status(app), "kokoro", "af_heart")?.sampleUrl).toBe(url);
	});

	it("mirrors the flat list onto the default provider's catalogue", async () => {
		const body = await status();
		for (const v of body.voices) expect("sampleUrl" in v).toBe(true);
	});

	it("serves the catalogue without synthesizing anything", async () => {
		stageSample("kokoro", "af_heart");
		await status();
		await status();
		expect(synthCalls).toBe(0);
	});
});
