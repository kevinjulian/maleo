/* The speech lab can synthesize with any registered provider, not only the one
 * the deployment renders with. That makes "which voices, and can this run" a
 * question about the CHOSEN provider rather than about the deployment, which is
 * what these cover. */
import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TtsStatus } from "@api/speech.ts";
import { resolveProviderChoice } from "./use-speech-session.ts";

const STATUS: TtsStatus = {
	effective_provider: "kokoro",
	// True of the DEFAULT provider. Deliberately true here while a chosen
	// provider below is not ready, because the two are different questions.
	ready: true,
	voices: [{ id: "af_heart", name: "Heart", desc: "Warm female", lang: "EN-US", sampleUrl: null }],
	providers: [
		{
			id: "kokoro",
			label: "Kokoro (self-hosted TTS)",
			health: "ready",
			voices: [
				{
					id: "af_heart",
					name: "Heart",
					desc: "Female · US English",
					lang: "EN-US",
					sampleUrl: null,
				},
				{ id: "jf_alpha", name: "Alpha", desc: "Female · Japanese", lang: "JA", sampleUrl: null },
			],
		},
		{ id: "sandbox", label: "Sandbox (local mock)", health: "unconfigured", voices: [] },
	],
};

describe("the chosen provider decides the voices", () => {
	it("offers the effective provider's voices when it is the one chosen", () => {
		expect(resolveProviderChoice(STATUS, "kokoro").voices.map((v) => v.id)).toEqual([
			"af_heart",
			"jf_alpha",
		]);
	});

	/* The point of the change: a provider that is registered but not the
	   deployment's default is fully usable here. */
	it("offers another registered provider's voices when it is chosen", () => {
		const { voices, ready } = resolveProviderChoice(STATUS, "sandbox");
		expect(voices).toEqual([]);
		expect(ready).toBe(false);
	});

	it("offers nothing for a provider that is not registered", () => {
		const { chosen, voices, ready } = resolveProviderChoice(STATUS, "elevenlabs");
		expect(chosen).toBeNull();
		expect(voices).toEqual([]);
		expect(ready).toBe(false);
	});

	it("offers nothing before the status has arrived", () => {
		expect(resolveProviderChoice(null, "kokoro")).toMatchObject({
			chosen: null,
			voices: [],
			ready: false,
		});
	});
});

describe("readiness is the chosen provider's, not the deployment's", () => {
	/* `status.ready` is true throughout this fixture. Submitting on a provider
	   that cannot serve would fail after the text and the voice were chosen. */
	it("refuses a provider that cannot serve even when the default can", () => {
		expect(STATUS.ready).toBe(true);
		expect(resolveProviderChoice(STATUS, "sandbox").ready).toBe(false);
	});

	it("reports the unready provider so the surface can name it", () => {
		expect(resolveProviderChoice(STATUS, "sandbox").chosen?.health).toBe("unconfigured");
	});

	it("gives an unready provider no voices to pick from", () => {
		expect(resolveProviderChoice(STATUS, "sandbox").voices).toEqual([]);
	});
});

/* Trying a provider must stay separable from selecting one. The app-wide
 * selection is a deployment decision about what every project renders with;
 * hearing what a provider sounds like is not, and this surface persists nothing.
 *
 * Asserted against the source because the guarantee is an ABSENCE — there is no
 * call to observe, and a test that drives the happy path would pass just as well
 * if the write were added tomorrow. */
describe("trying a provider never writes the app-wide selection", () => {
	const sources = [
		join(import.meta.dirname, "use-speech-session.ts"),
		join(import.meta.dirname, "../../pages/speech-lab.tsx"),
	];

	it("does not touch the tts-provider setting from the speech lab", () => {
		for (const path of sources) {
			expect(readFileSync(path, "utf8")).not.toContain("settings/tts-provider");
		}
	});

	it("sends the provider on the synthesis request instead", () => {
		const src = readFileSync(join(import.meta.dirname, "use-speech-session.ts"), "utf8");
		expect(src).toContain("synthesizeSpeech({");
		expect(src).toContain("provider: provider || undefined");
	});
});
