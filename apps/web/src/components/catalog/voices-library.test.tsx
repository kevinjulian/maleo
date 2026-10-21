/* The voice library lists every registered provider, which introduces two things
 * a single-provider list never had to handle: voice ids that are only unique
 * WITHIN a provider, and a search whose results span providers. */
import { describe, expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TtsProviderOption } from "@maleo/shared";
import { sampleKey } from "@hooks/timeline/use-voice-sample.ts";
import { filterVoiceRows, sectionize, voiceRows, VoicesLibrary } from "./voices-library.tsx";

/* Two providers that both ship `M1`. Contrived, and exactly the collision the
 * bare voice id could not survive: ids are provider-scoped, not global. */
const PROVIDERS: TtsProviderOption[] = [
	{
		id: "provider-a",
		label: "Provider A",
		health: "ready",
		voices: [
			{
				id: "M1",
				name: "Marcus",
				desc: "Warm male · calm",
				lang: "EN",
				hue: 111,
				sampleUrl: "/uploads/voice-sample-provider-a-M1-v2.wav",
			},
			{ id: "F1", name: "Aria", desc: "Warm female · calm", lang: "EN", hue: 222, sampleUrl: null },
		],
	},
	{
		id: "kokoro",
		label: "Kokoro (self-hosted TTS)",
		health: "unconfigured",
		voices: [
			{
				id: "M1",
				name: "Someone Else",
				desc: "Male · Japanese",
				lang: "JA",
				hue: 333,
				sampleUrl: "/uploads/voice-sample-kokoro-M1-v2.wav",
			},
			{
				id: "af_heart",
				name: "Heart",
				desc: "Female · US English",
				lang: "EN-US",
				hue: 44,
				sampleUrl: "/uploads/voice-sample-kokoro-af_heart-v2.wav",
			},
		],
	},
];

describe("rows carry the provider, because the voice id alone does not identify one", () => {
	test("flattens every provider's voices, keeping which provider each came from", () => {
		const rows = voiceRows(PROVIDERS);
		expect(rows).toHaveLength(4);
		expect(rows.map((r) => `${r.provider}/${r.voice.id}`)).toEqual([
			"provider-a/M1",
			"provider-a/F1",
			"kokoro/M1",
			"kokoro/af_heart",
		]);
	});

	/* The React key and the play key. Two rows sharing `M1` must not collapse
	   into one, and playing one must not light up the other. */
	test("a shared voice id yields two distinct keys", () => {
		const rows = voiceRows(PROVIDERS).filter((r) => r.voice.id === "M1");
		const keys = rows.map((r) => sampleKey(r.provider, r.voice.id));
		expect(keys).toEqual(["provider-a:M1", "kokoro:M1"]);
		expect(new Set(keys).size).toBe(2);
	});
});

describe("search spans providers until one is chosen", () => {
	const rows = voiceRows(PROVIDERS);

	test("lists everything when nothing is narrowed", () => {
		expect(filterVoiceRows(rows, "", null)).toHaveLength(4);
	});

	/* The failure a provider tab strip would have caused: a name that exists
	   under another provider reading as "no results". */
	test("finds a voice belonging to a provider that is not the effective one", () => {
		const found = filterVoiceRows(rows, "heart", null);
		expect(found.map((r) => r.voice.id)).toEqual(["af_heart"]);
	});

	test("narrows to one provider and drops the others", () => {
		const found = filterVoiceRows(rows, "", "kokoro");
		expect(found.every((r) => r.provider === "kokoro")).toBe(true);
		expect(found).toHaveLength(2);
	});

	test("combines a query with a provider", () => {
		expect(filterVoiceRows(rows, "M1", "kokoro")).toHaveLength(0);
		expect(filterVoiceRows(rows, "someone", "kokoro").map((r) => r.voice.id)).toEqual(["M1"]);
	});

	test("matches on the provider label too, so a provider name finds its voices", () => {
		expect(filterVoiceRows(rows, "kokoro", null)).toHaveLength(2);
	});

	test("matches on language, which is how a narrator finds a language they need", () => {
		expect(filterVoiceRows(rows, "ja", null).map((r) => r.voice.name)).toEqual(["Someone Else"]);
	});
});

describe("sections break the list by provider and language", () => {
	test("groups each provider's languages separately", () => {
		const sections = sectionize(voiceRows(PROVIDERS));
		expect(sections.map((s) => s.key)).toEqual(["provider-a:EN", "kokoro:JA", "kokoro:EN-US"]);
	});

	test("keeps every row exactly once", () => {
		const sections = sectionize(voiceRows(PROVIDERS));
		expect(sections.flatMap((s) => s.rows)).toHaveLength(4);
	});

	test("files a voice with no language rather than dropping it", () => {
		const sections = sectionize(
			voiceRows([
				{
					id: "p",
					label: "P",
					health: "ready",
					voices: [{ id: "x", name: "X", desc: "", sampleUrl: null }],
				},
			]),
		);
		expect(sections[0]?.lang).toBe("OTHER");
	});
});

describe("VoicesLibrary", () => {
	/* The hook fetches, so a static render is the pre-response state. */
	test("searches through the shared toolbar", () => {
		const html = renderToStaticMarkup(<VoicesLibrary />);
		expect(html).toContain('placeholder="Search voices"');
	});

	/* No providers yet means no provider chips — not an "All" chip standing over
	   an empty set, which would be a filter that can never do anything. */
	test("offers no provider filter before any provider is known", () => {
		const html = renderToStaticMarkup(<VoicesLibrary />);
		expect(html).not.toContain('aria-label="Filter by provider"');
		expect(html).toContain("Loading voices");
	});
});
