/* Pocket TTS Indonesian against the shared provider contract, plus the
 * properties that are this provider's own: it declares no voices, it cannot
 * synthesize without a clone, and it refuses text the model cannot read. */
import { afterEach, describe, expect, it, test } from "bun:test";
import { describeProviderConformance } from "../conformance.ts";
import { PROVIDERS, providersFor } from "../registry.ts";
import { pocketTtsIdProvider } from "./index.ts";
import { POCKET_TTS_URL_KEY } from "./service.ts";
import { PocketTtsTextError, prepareIndonesianText } from "./text.ts";

describeProviderConformance({ describe, test, expect }, pocketTtsIdProvider);

function withUrl(value: string | undefined): void {
	if (value === undefined) delete process.env[POCKET_TTS_URL_KEY];
	else process.env[POCKET_TTS_URL_KEY] = value;
}

const priorUrl = process.env[POCKET_TTS_URL_KEY];
afterEach(() => withUrl(priorUrl));

describe("pocket-tts-id provider surface", () => {
	it("declares tts and ships an implementation, so providersFor sees it", () => {
		expect(pocketTtsIdProvider.meta.capabilities).toEqual(["tts"]);
		expect(pocketTtsIdProvider.tts).toBeDefined();
	});

	it("declares no voices of its own — every voice it speaks is a clone", () => {
		expect(pocketTtsIdProvider.meta.tts?.voices).toEqual([]);
	});

	it("declares its service URL as a config field rather than requiring an env file", () => {
		const keys = pocketTtsIdProvider.meta.config?.map((field) => field.key) ?? [];
		expect(keys).toContain(POCKET_TTS_URL_KEY);
		expect(pocketTtsIdProvider.meta.config?.[0]?.required).toBe(true);
	});
});

describe("pocket-tts-id readiness", () => {
	it("reports unconfigured with no service URL, rather than throwing", async () => {
		withUrl(undefined);
		expect(await pocketTtsIdProvider.meta.health("tts")).toBe("unconfigured");
	});

	it("reports ready once a service URL is configured", async () => {
		withUrl("https://pocket-tts-id.example.test");
		expect(await pocketTtsIdProvider.meta.health("tts")).toBe("ready");
	});

	it("reachability fails with the reason when no URL is set", async () => {
		withUrl(undefined);
		const result = await pocketTtsIdProvider.meta.reachable!("tts");
		expect(result.ok).toBe(false);
		expect(result.reason).toContain(POCKET_TTS_URL_KEY);
	});

	it("reachability fails when nothing is listening, rather than reporting success", async () => {
		// Port 1 on loopback: reserved, and nothing binds it.
		withUrl("http://127.0.0.1:1");
		const result = await pocketTtsIdProvider.meta.reachable!("tts");
		expect(result.ok).toBe(false);
		expect(result.reason).toBeTruthy();
	});
});

describe("pocket-tts-id synthesis preconditions", () => {
	it("refuses a synthesis with no cloned voice, naming what is missing", async () => {
		withUrl("https://pocket-tts-id.example.test");
		await expect(
			pocketTtsIdProvider.tts!.synthesize({ text: "Selamat pagi" }, { workspaceId: "w" }),
		).rejects.toThrow(/cloned voices/i);
	});

	it("refuses a voice id with no reference audio behind it", async () => {
		withUrl("https://pocket-tts-id.example.test");
		await expect(
			pocketTtsIdProvider.tts!.synthesize(
				{ text: "Selamat pagi", voice: "vc_1" },
				{ workspaceId: "w" },
			),
		).rejects.toThrow(/cloned voices/i);
	});

	it("refuses reference audio that is not a readable managed file", async () => {
		withUrl("https://pocket-tts-id.example.test");
		await expect(
			pocketTtsIdProvider.tts!.synthesize(
				{ text: "Selamat pagi", voice: "vc_1", voiceRefUrl: "https://evil.test/etc/passwd" },
				{ workspaceId: "w" },
			),
		).rejects.toThrow(/managed file/i);
	});

	it("refuses to synthesize with no service configured", async () => {
		withUrl(undefined);
		await expect(
			pocketTtsIdProvider.tts!.synthesize(
				{ text: "Selamat pagi", voice: "vc_1", voiceRefUrl: "/uploads/voice.wav" },
				{ workspaceId: "w" },
			),
		).rejects.toThrow(/not configured/i);
	});
});

describe("pocket-tts-id text constraints", () => {
	it("refuses digits rather than mispronouncing them silently", () => {
		expect(() => prepareIndonesianText("Ada 15 orang")).toThrow(PocketTtsTextError);
		expect(() => prepareIndonesianText("Ada 15 orang")).toThrow(/lima belas/);
	});

	it("accepts numbers written as words", () => {
		expect(prepareIndonesianText("Ada lima belas orang")).toBe("Ada lima belas orang");
	});

	it("replaces unsupported exclamation marks rather than failing a speakable line", () => {
		expect(prepareIndonesianText("Selamat pagi! Apa kabar!")).toBe("Selamat pagi. Apa kabar.");
	});
});

describe("registry placement", () => {
	it("is registered after kokoro, so the TTS default is unchanged", () => {
		const tts = providersFor("tts").map((p) => p.meta.id);
		expect(tts.indexOf("pocket-tts-id")).toBeGreaterThan(tts.indexOf("kokoro"));
	});

	it("appears exactly once in the registry", () => {
		expect(PROVIDERS.filter((p) => p.meta.id === "pocket-tts-id")).toHaveLength(1);
	});
});
