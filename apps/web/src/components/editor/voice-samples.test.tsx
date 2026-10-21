/* Audition controls in the two voice surfaces.
 *
 * The web suite renders statically and has no DOM, so it can prove what is
 * MOUNTED but not what happens on click. Presence/absence of the control is
 * asserted here; single-clip playback is a browser check. */
import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiceOptionList } from "./editor-settings.tsx";
import type { TtsVoiceOption } from "@maleo/shared";

const BAKED: TtsVoiceOption = {
	id: "af_heart",
	name: "Heart",
	desc: "Warm female",
	sampleUrl: "/uploads/voice-sample-kokoro-af_heart-v2.wav",
};
const UNBAKED: TtsVoiceOption = { id: "F1", name: "Aria", desc: "Warm female", sampleUrl: null };

function render(
	voices: TtsVoiceOption[],
	value = "",
	disabled = false,
	preferLang?: string,
): string {
	return renderToStaticMarkup(
		<VoiceOptionList
			voices={voices}
			value={value}
			disabled={disabled}
			preferLang={preferLang}
			onChange={() => {}}
		/>,
	);
}

/** A catalogue spanning languages, as a provider with dozens of voices has. */
const MULTILINGUAL: TtsVoiceOption[] = [
	{ id: "af_heart", name: "Heart", desc: "Female · US English", lang: "EN-US", sampleUrl: null },
	{
		id: "bm_george",
		name: "George",
		desc: "Male · British English",
		lang: "EN-GB",
		sampleUrl: null,
	},
	{ id: "jf_alpha", name: "Alpha", desc: "Female · Japanese", lang: "JA", sampleUrl: null },
];

describe("Project Settings voice list", () => {
	test("offers a play control for a voice that has a baked sample", () => {
		const html = render([BAKED]);
		expect(html).toContain("Play Heart sample");
		expect(html).toContain("cv-voicesample");
	});

	test("omits the control entirely for a voice with no sample", () => {
		const html = render([UNBAKED]);
		// Listed and pickable...
		expect(html).toContain("Aria");
		// ...but no control, rather than one that cannot work.
		expect(html).not.toContain("Play Aria sample");
		expect(html).not.toContain("cv-voicesample");
	});

	test("keeps an unbaked voice selectable alongside a baked one", () => {
		const html = render([BAKED, UNBAKED]);
		expect(html).toContain("Heart");
		expect(html).toContain("Aria");
		expect(html).toContain("Play Heart sample");
		expect(html).not.toContain("Play Aria sample");
	});

	test("marks the selected voice", () => {
		expect(render([BAKED, UNBAKED], "F1")).toContain('aria-selected="true"');
	});

	test("provider default is a row with nothing to audition", () => {
		const html = render([BAKED]);
		expect(html).toContain("Provider default");
		// Exactly one control: the named voice, not the default row.
		expect(html.match(/cv-voicesample/g)?.length).toBe(1);
	});

	test("says so when the provider has no voices", () => {
		expect(render([], "", true)).toContain("No voices available");
	});
});

describe("scene voice picker", () => {
	/* The menu is closed until clicked and there is no DOM here to click with, so
	 * these assert the source shape — the same approach the sibling settings test
	 * uses for panel composition. */
	const source = readFileSync(`${import.meta.dirname}/../references/panels.tsx`, "utf8");

	test("renders the control only when a sample url resolved", () => {
		expect(source).toContain("{url && (");
		expect(source).toContain("cv-voicesample");
	});

	test("resolves a speaker to a voice through the supplied catalogue", () => {
		expect(source).toContain("voiceOptions");
		expect(source).toContain("v.id === speaker.voiceId");
	});

	test("select and play are siblings, not nested buttons", () => {
		// A <button> inside a <button> is invalid markup and browsers recover from
		// it unpredictably; the row is a flex container for exactly this reason.
		expect(source).toContain("cv-voicemenu-row");
		const start = source.indexOf("cv-voicemenu-row");
		const row = source.slice(start, source.indexOf("</div>", start));
		// The select button must close before the sample button opens.
		const firstOpen = row.indexOf("<button");
		const firstClose = row.indexOf("</button>");
		const secondOpen = row.indexOf("<button", firstClose);
		expect(firstOpen).toBeGreaterThan(-1);
		expect(secondOpen).toBeGreaterThan(firstClose);
		expect(firstClose).toBeGreaterThan(firstOpen);
	});
});

describe("playback exclusivity", () => {
	const hook = readFileSync(
		`${import.meta.dirname}/../../hooks/timeline/use-voice-sample.ts`,
		"utf8",
	);

	test("one shared audio element backs every picker", () => {
		// Module-level, not per-component: that is what makes overlap impossible
		// rather than merely discouraged.
		expect(hook).toContain("let element: HTMLAudioElement | null = null");
		expect(hook).not.toContain("useRef");
	});

	test("playing the same voice again stops it", () => {
		expect(hook).toMatch(
			/if\s*\(\s*playingId\s*===\s*voiceId,?\s*\)\s*\{\s*stop\(\s*,?\s*\);\s*return;\s*,?\s*\}/,
		);
	});

	test("a failed play does not leave the ui showing it as playing", () => {
		expect(hook).toContain("el.onerror = () => setPlaying(null)");
		expect(hook).toContain(".catch(() => setPlaying(null))");
	});
});

/* Six English voices read fine as one run; fifty-four across nine languages do
 * not. The grouping earns its place only in the second case, so it appears only
 * in the second case. */
describe("voice list grouping", () => {
	test("groups by language when a provider spans more than one", () => {
		const html = render(MULTILINGUAL);
		expect(html).toContain("cv-voicelist-group");
		for (const lang of ["EN-US", "EN-GB", "JA"]) expect(html).toContain(`>${lang}<`);
	});

	test("stays flat for a single-language catalogue rather than adding a lone heading", () => {
		const html = render([
			{ ...BAKED, lang: "EN" },
			{ ...UNBAKED, lang: "EN" },
		]);
		expect(html).not.toContain("cv-voicelist-group");
	});

	test("lists every voice exactly once whether grouped or not", () => {
		const html = render(MULTILINGUAL);
		for (const voice of MULTILINGUAL) {
			expect(html.split(`>${voice.name}<`).length - 1).toBe(1);
		}
	});

	/* An operator writing Japanese should not scroll past forty other voices to
	 * reach the five that can speak it. */
	test("floats the project's narration language to the top", () => {
		const html = render(MULTILINGUAL, "", false, "ja");
		expect(html.indexOf(">JA<")).toBeLessThan(html.indexOf(">EN-US<"));
	});

	test("matches a base language, so 'en' floats both English variants", () => {
		const html = render(MULTILINGUAL, "", false, "en");
		expect(html.indexOf(">EN-US<")).toBeLessThan(html.indexOf(">JA<"));
		expect(html.indexOf(">EN-GB<")).toBeLessThan(html.indexOf(">JA<"));
	});

	test("groups a voice with no language rather than dropping it", () => {
		const html = render([
			...MULTILINGUAL,
			{ id: "x", name: "Nameless", desc: "", sampleUrl: null },
		]);
		expect(html).toContain(">OTHER<");
		expect(html).toContain(">Nameless<");
	});
});
