/* The catalogue states only ids and derives everything else, so these cover the
 * derivation: a wrong language on a language-locked voice is what makes it
 * audition in a language it cannot speak. */
import { describe, expect, it } from "vite-plus/test";
import { KOKORO_VOICES, getKokoroVoiceById, kokoroVoiceFromId } from "./voices.ts";
import { kokoroMeta } from "./meta.ts";

describe("language and gender derive from the id", () => {
	it("reads an American English female voice", () => {
		expect(kokoroVoiceFromId("af_heart")).toMatchObject({
			name: "Heart",
			lang: "en-US",
			gender: "female",
		});
	});

	it("reads a British English male voice", () => {
		expect(kokoroVoiceFromId("bm_george")).toMatchObject({
			name: "George",
			lang: "en-GB",
			gender: "male",
		});
	});

	it("reads a Japanese female voice", () => {
		expect(kokoroVoiceFromId("jf_alpha")).toMatchObject({
			name: "Alpha",
			lang: "ja",
			gender: "female",
		});
	});

	/* Not a default. A prefix outside the table means the upstream image added a
	 * language, and guessing files a language-locked voice under the wrong one. */
	it("throws on an unknown language prefix rather than guessing", () => {
		expect(() => kokoroVoiceFromId("qf_someone")).toThrow(/unknown language prefix/);
	});

	it("throws on an unknown gender prefix", () => {
		expect(() => kokoroVoiceFromId("ax_someone")).toThrow(/unknown gender prefix/);
	});

	/* Several names repeat across languages — Santa speaks three, Alpha two —
	 * so the language has to reach a flat listing through the description. */
	it("names the language in the description, because names repeat across them", () => {
		expect(kokoroVoiceFromId("am_santa").desc).toBe("Male · US English");
		expect(kokoroVoiceFromId("pm_santa").desc).toBe("Male · Brazilian Portuguese");
	});
});

describe("the catalogue", () => {
	it("carries every voice the pinned image ships", () => {
		expect(KOKORO_VOICES).toHaveLength(68);
	});

	/* The v0 voices duplicate current ones by name — af_bella and af_v0bella both
	   read as "Bella" — so the label is what keeps an operator from picking the
	   older-sounding of two identical entries. */
	it("marks a legacy-model voice rather than listing it as a twin", () => {
		expect(kokoroVoiceFromId("af_v0bella").name).toBe("Bella (v0)");
		expect(kokoroVoiceFromId("af_v0bella").desc).toContain("legacy model");
		expect(kokoroVoiceFromId("af_bella").name).toBe("Bella");
		expect(kokoroVoiceFromId("af_bella").desc).not.toContain("legacy");
	});

	it("names the bare v0 default, which carries no name of its own", () => {
		expect(kokoroVoiceFromId("af_v0").name).toBe("Default (v0)");
	});

	it("voice ids are unique — they key a lookup and a cache entry", () => {
		const ids = KOKORO_VOICES.map((v) => v.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("covers every language the model supports", () => {
		expect(new Set(KOKORO_VOICES.map((v) => v.lang))).toEqual(
			new Set(["en-US", "en-GB", "es", "fr", "hi", "it", "ja", "pt-BR", "zh"]),
		);
	});

	it("resolves a known voice by id and nothing for an unknown one", () => {
		expect(getKokoroVoiceById("af_heart")?.name).toBe("Heart");
		expect(getKokoroVoiceById("no-such-voice")).toBeUndefined();
	});

	/* The route a consumer outside this package takes: `apps/api` builds its
	 * catalogue from registered providers' metadata. */
	it("reaches callers through provider metadata", () => {
		expect(kokoroMeta.tts?.voices).toEqual(KOKORO_VOICES);
	});
});
