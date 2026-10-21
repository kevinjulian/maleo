/* A voice has one identity, wherever it is displayed.
 *
 * There used to be two derivations of a voice's hue: `VOICE_LIB` in this module
 * carried hand-picked constants, and the catalogue client computed
 * `hashHue(voice.id)`. Both fed display paths, so the same voice drew in one
 * colour in the library listing and a different one in a storyboard export.
 * `VOICE_LIB` also held five voices with their own names — M1 was missing
 * entirely, so a scene narrated by M1 resolved to a blank description.
 *
 * The catalogue is now the server's answer, registered once. These assert the
 * properties that made the drift possible.
 */
import { beforeEach, describe, expect, it } from "vite-plus/test";
import type { Speaker } from "@maleo/shared";
import { resolveVoice, setVoiceCatalogue, voiceCatalogue, type Voice } from "./voice-library.ts";
import { speakersFromState } from "@models/storyboard/document-wire.ts";

const CATALOGUE: Voice[] = [
	{
		id: "M1",
		name: "Marcus",
		desc: "Warm male · calm",
		lang: "EN",
		hue: 111,
		sampleUrl: "/uploads/m1.wav",
	},
	{ id: "F1", name: "Aria", desc: "Warm female · calm", lang: "EN", hue: 222, sampleUrl: null },
];

const speaker = (over: Partial<Speaker> = {}): Speaker =>
	({ id: "s1", name: "Narrator", voiceId: "M1", ...over }) as Speaker;

beforeEach(() => {
	setVoiceCatalogue(CATALOGUE);
});

describe("a voice resolves from the catalogue, not from a local list", () => {
	it("describes a voice the old local list did not contain", () => {
		// M1 was absent from VOICE_LIB, so this used to resolve to an empty desc.
		expect(resolveVoice(speaker({ voiceId: "M1" }))).toMatchObject({
			name: "Narrator",
			desc: "Warm male · calm",
			hue: 111,
		});
	});

	it("takes the hue the catalogue gives, not one of its own", () => {
		expect(resolveVoice(speaker({ voiceId: "F1" })).hue).toBe(222);
	});

	/* The regression this replaces: the library listing read the catalogue's hue
	   and the storyboard export read VOICE_LIB's, so one voice had two colours.
	   Both paths now resolve through the same catalogue. */
	it("gives the same voice the same colour in a listing and in an export", () => {
		const fromCatalogue = voiceCatalogue().find((v) => v.id === "M1");
		const fromExport = speakersFromState("video", {
			speakers: [speaker({ voiceId: "M1" })],
		} as Parameters<typeof speakersFromState>[1]);

		expect(fromExport[0]?.hue).toBe(fromCatalogue?.hue ?? -1);
	});
});

describe("an explicit identity wins over the catalogue", () => {
	it("keeps a custom speaker's own description and colour", () => {
		const custom = speaker({ custom: { desc: "Gravelly, invented", hue: 42 } } as Partial<Speaker>);

		expect(resolveVoice(custom)).toMatchObject({ desc: "Gravelly, invented", hue: 42, gen: true });
	});

	it("keeps a speaker's stated voice description", () => {
		const described = speaker({ voiceDesc: "Bright and quick", hue: 7 } as Partial<Speaker>);

		expect(resolveVoice(described)).toMatchObject({ desc: "Bright and quick", hue: 7 });
	});
});

describe("an unresolvable voice degrades rather than failing", () => {
	it("shows the name alone for a voice the catalogue no longer offers", () => {
		expect(resolveVoice(speaker({ voiceId: "RETIRED" }))).toMatchObject({
			name: "Narrator",
			desc: "",
		});
	});

	/* The window before the catalogue lands. The same degradation as a retired
	   voice, which is what makes the synchronous resolve acceptable. */
	it("shows the name alone before the catalogue has been fetched", () => {
		setVoiceCatalogue([]);

		expect(resolveVoice(speaker({ voiceId: "M1" }))).toMatchObject({ name: "Narrator", desc: "" });
	});

	it("handles no speaker at all", () => {
		expect(resolveVoice(undefined).name).toBe("—");
	});
});

/* The reason `/api/operations/catalogue` sends the effective provider's voices
 * and every provider's voices as SEPARATE fields.
 *
 * This lookup is by bare voice id, and ids are unique within a provider but not
 * across them. Registering the union here would let a speaker bound to one
 * provider's voice resolve against another provider's entry that happens to
 * share the id — the wrong description and the wrong colour, with nothing raised
 * anywhere. */
describe("a bound speaker resolves against the effective provider only", () => {
	const EFFECTIVE = [
		{ id: "M1", name: "Marcus", desc: "Warm male · calm", lang: "EN", hue: 111, sampleUrl: null },
	];
	// Another registered provider that happens to ship the same id.
	const OTHER_PROVIDER = [
		{
			id: "M1",
			name: "Someone else",
			desc: "Bright female · upbeat",
			lang: "JA",
			hue: 999,
			sampleUrl: null,
		},
	];

	it("keeps the effective provider's description and colour", () => {
		setVoiceCatalogue(EFFECTIVE);
		expect(resolveVoice(speaker({ voiceId: "M1" }))).toMatchObject({
			desc: "Warm male · calm",
			hue: 111,
		});
	});

	it("would resolve to the wrong voice if the union were registered", () => {
		// Asserts the hazard directly: registering both is what the catalogue
		// client must never do, and this is what it would cost.
		setVoiceCatalogue([...OTHER_PROVIDER, ...EFFECTIVE]);
		expect(resolveVoice(speaker({ voiceId: "M1" })).hue).not.toBe(111);
	});
});
