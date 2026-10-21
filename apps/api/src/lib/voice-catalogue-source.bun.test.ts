/* One catalogue, and the payloads that must not disagree.
 *
 * Before this module there were four lists. Two derived ones drifted from the
 * canonical ones, and both routes that served the derived list hardcoded one
 * provider as the sample provider — so an operator running the other saw voices
 * that could not be synthesized and none of the ones that could, while
 * /api/tts/status reported the right thing next door.
 *
 * Then a fifth appeared here: a ternary over two provider names, importing each
 * provider's catalogue into this package. Voices come off provider metadata now,
 * so the assertions below name no provider's voice list — the point is that
 * adding a provider changes nothing in this file.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getProvider, providersFor } from "@maleo/media/providers";
import {
	effectiveVoiceCatalogue,
	ttsProviderCatalogue,
	voiceHue,
	voicesForProvider,
} from "./voice-catalogue-source.ts";

const priorKokoroUrl = process.env.MALEO_KOKORO_URL;

function setEnv(key: string, value: string | undefined): void {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

/** The registry's own voice ids for a provider — what a catalogue must mirror. */
function metaVoiceIds(provider: string): string[] {
	return (getProvider(provider)?.meta.tts?.voices ?? []).map((v) => v.id);
}

beforeEach(() => {
	process.env.MALEO_KOKORO_URL = "http://127.0.0.1:9998";
});

afterEach(() => {
	setEnv("MALEO_KOKORO_URL", priorKokoroUrl);
});

describe("voices come from the provider that can speak them", () => {
	it("mirrors a provider's declared catalogue exactly", async () => {
		for (const provider of providersFor("tts")) {
			expect((await voicesForProvider(provider.meta.id)).map((v) => v.id)).toEqual(
				metaVoiceIds(provider.meta.id),
			);
		}
	});

	/* A retired provider still appears in stored rows. A listing is not the place
	 * to fail on one — the resolution path is, and it recovers to the default. */
	it("yields an empty list for an unregistered provider rather than throwing", async () => {
		expect(await voicesForProvider("no-such-provider")).toEqual([]);
	});
});

describe("the catalogue is resolved for the effective provider", () => {
	it("offers the configured provider's voices, and no other provider's", async () => {
		const { provider, voices } = await effectiveVoiceCatalogue();

		expect(provider).toBe("kokoro");
		expect(voices.map((v) => v.id)).toEqual(metaVoiceIds("kokoro"));
	});

	/* Falling back to another provider's list would render a working picker whose
	   every choice fails at synthesis — worse than an empty one, because the
	   failure arrives later and somewhere else. */
	it("lists nothing rather than unsynthesizable voices when unconfigured", async () => {
		delete process.env.MALEO_KOKORO_URL;

		const { ready, voices, error } = await effectiveVoiceCatalogue();

		expect(ready).toBe(false);
		expect(voices).toEqual([]);
		// With the reason attached: "unavailable" alone sends an operator to the logs.
		expect(error).toBeTruthy();
	});
});

describe("every registered provider is offered to a surface that chooses one", () => {
	it("describes each registered TTS provider with its health and voices", async () => {
		const catalogue = await ttsProviderCatalogue();

		expect(catalogue.map((entry) => entry.id)).toEqual(providersFor("tts").map((p) => p.meta.id));
		for (const entry of catalogue) {
			expect(entry.label.length).toBeGreaterThan(0);
			expect(entry.voices.map((v) => v.id)).toEqual(metaVoiceIds(entry.id));
		}
	});

	/* The whole reason the payload is a list. The record it replaced named its
	 * keys in the type, so a provider could not appear without an edit here. */
	it("carries a provider that is registered but not configured", async () => {
		const catalogue = await ttsProviderCatalogue();
		const sandbox = catalogue.find((entry) => entry.id === "sandbox");

		expect(sandbox).toBeDefined();
		expect(sandbox?.health).toBe("unconfigured");
		expect(sandbox?.voices.length).toBeGreaterThan(0);
	});
});

describe("a voice's display identity is derived once", () => {
	/* Hue had two sources: hand-picked constants in the web VOICE_LIB and
	   hashHue(id) in the catalogue client. The same voice drew in one colour in
	   the library and another in a storyboard export. */
	it("gives a voice the same hue wherever it is asked for", async () => {
		const fromCatalogue = (await voicesForProvider("kokoro")).find((v) => v.id === "af_heart");

		expect(fromCatalogue?.hue).toBe(voiceHue("af_heart"));
		expect(voiceHue("af_heart")).toBe(voiceHue("af_heart"));
	});

	it("gives different voices different hues", () => {
		expect(voiceHue("af_heart")).not.toBe(voiceHue("am_puck"));
	});

	it("carries a sample location for every voice, present or explicitly absent", async () => {
		for (const voice of await voicesForProvider("kokoro")) {
			expect(voice).toHaveProperty("sampleUrl");
			expect(voice.sampleUrl === null || typeof voice.sampleUrl === "string").toBe(true);
		}
	});

	/* The pickers group by language, so a gap is not cosmetic — it is a voice
	 * with nowhere to be rendered. */
	it("reports a language for every voice of every provider rather than a gap", async () => {
		for (const provider of providersFor("tts")) {
			for (const voice of await voicesForProvider(provider.meta.id)) {
				expect(voice.lang.length).toBeGreaterThan(0);
			}
		}
	});
});
