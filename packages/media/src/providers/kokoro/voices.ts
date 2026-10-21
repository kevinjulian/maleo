import type { TtsVoice } from "../types.ts";

/* The Kokoro voice catalogue.
 *
 * Static, not fetched from the service's own `/v1/audio/voices`, because the
 * catalogue has to be readable with the service down: the settings surface lists
 * an unconfigured provider's voices, and the sample bake needs the list before
 * it dials anything. `voices.live.test.ts` is what keeps the two honest — it
 * asserts this list against the deployed service whenever one is configured.
 *
 * Only the ids and display names are stated. Language and gender are ENCODED IN
 * THE ID and are derived, never restated: fifty-four hand-written rows is
 * fifty-four chances for a voice to be filed under the wrong language, and the
 * derivation cannot disagree with itself.
 *
 *   af_heart      →  a = en-US,  f = female,  "Heart"
 *   bm_george     →  b = en-GB,  m = male,    "George"
 *   jf_gongitsune →  j = ja,     f = female,  "Gongitsune"
 */

/** Language prefix → BCP-47 tag and the label a description reads with. */
const LANGUAGE_BY_PREFIX: Readonly<Record<string, { tag: string; label: string }>> = {
	a: { tag: "en-US", label: "US English" },
	b: { tag: "en-GB", label: "British English" },
	e: { tag: "es", label: "Spanish" },
	f: { tag: "fr", label: "French" },
	h: { tag: "hi", label: "Hindi" },
	i: { tag: "it", label: "Italian" },
	j: { tag: "ja", label: "Japanese" },
	p: { tag: "pt-BR", label: "Brazilian Portuguese" },
	z: { tag: "zh", label: "Mandarin Chinese" },
};

const GENDER_BY_PREFIX: Readonly<Record<string, TtsVoice["gender"]>> = {
	f: "female",
	m: "male",
};

/* Every voice the pinned image ships, in the upstream's own order. Adding a
 * voice here is adding its id; everything else about it follows from the id.
 *
 * All of them, including the `v0` variants. A voice the service can speak but
 * the catalogue omits is a voice an operator cannot pick and the live test
 * cannot account for; hiding them would trade a small picker for a catalogue
 * that quietly disagrees with the service. They are labelled as legacy instead
 * — see `displayName`. */
const KOKORO_VOICE_IDS: readonly string[] = [
	// American English
	"af_alloy",
	"af_aoede",
	"af_bella",
	"af_heart",
	"af_jadzia",
	"af_jessica",
	"af_kore",
	"af_nicole",
	"af_nova",
	"af_river",
	"af_sarah",
	"af_sky",
	"af_v0",
	"af_v0bella",
	"af_v0irulan",
	"af_v0nicole",
	"af_v0sarah",
	"af_v0sky",
	"am_adam",
	"am_echo",
	"am_eric",
	"am_fenrir",
	"am_liam",
	"am_michael",
	"am_onyx",
	"am_puck",
	"am_santa",
	"am_v0adam",
	"am_v0gurney",
	"am_v0michael",
	// British English
	"bf_alice",
	"bf_emma",
	"bf_isabella",
	"bf_lily",
	"bf_v0emma",
	"bf_v0isabella",
	"bm_daniel",
	"bm_fable",
	"bm_george",
	"bm_lewis",
	"bm_v0george",
	"bm_v0lewis",
	// Spanish
	"ef_dora",
	"em_alex",
	"em_santa",
	// French
	"ff_siwis",
	// Hindi
	"hf_alpha",
	"hf_beta",
	"hm_omega",
	"hm_psi",
	// Italian
	"if_sara",
	"im_nicola",
	// Japanese
	"jf_alpha",
	"jf_gongitsune",
	"jf_nezumi",
	"jf_tebukuro",
	"jm_kumo",
	// Brazilian Portuguese
	"pf_dora",
	"pm_alex",
	"pm_santa",
	// Mandarin Chinese
	"zf_xiaobei",
	"zf_xiaoni",
	"zf_xiaoxiao",
	"zf_xiaoyi",
	"zm_yunjian",
	"zm_yunxi",
	"zm_yunxia",
	"zm_yunyang",
];

/* "af_heart" → "Heart". The upstream suffix is the voice's given name.
 *
 * A `v0` suffix marks a voice carried over from the previous model, and several
 * duplicate a current voice under the same name — `af_bella` and `af_v0bella`
 * both read as "Bella". Labelling the legacy one is what stops an operator
 * choosing the older-sounding of two identically named voices by accident.
 * `af_v0` alone carries no name at all: it is that model's default. */
function displayName(id: string): string {
	const suffix = id.slice(id.indexOf("_") + 1);
	if (suffix === "v0") return "Default (v0)";
	if (suffix.startsWith("v0")) {
		const base = suffix.slice(2);
		return `${base.charAt(0).toUpperCase()}${base.slice(1)} (v0)`;
	}
	return suffix.charAt(0).toUpperCase() + suffix.slice(1);
}

/** True for a voice carried over from Kokoro's previous model. */
function isLegacy(id: string): boolean {
	return id.slice(id.indexOf("_") + 1).startsWith("v0");
}

/* Throws rather than defaulting. A prefix outside the table means the upstream
 * image added a language, and a voice quietly filed under a guessed language is
 * how a language-locked voice ends up auditioned in the wrong one. */
export function kokoroVoiceFromId(id: string): TtsVoice {
	const language = LANGUAGE_BY_PREFIX[id[0] ?? ""];
	const gender = GENDER_BY_PREFIX[id[1] ?? ""];
	if (!language) throw new Error(`kokoro voice "${id}": unknown language prefix "${id[0] ?? ""}"`);
	if (!gender) throw new Error(`kokoro voice "${id}": unknown gender prefix "${id[1] ?? ""}"`);
	const name = displayName(id);
	return {
		id,
		name,
		/* The language belongs in the description because several names repeat
		 * across languages — Santa speaks English, Spanish and Portuguese, and
		 * Alpha speaks Hindi and Japanese. */
		desc: `${gender === "female" ? "Female" : "Male"} · ${language.label}${isLegacy(id) ? " · legacy model" : ""}`,
		gender,
		lang: language.tag,
	};
}

export const KOKORO_VOICES: readonly TtsVoice[] = KOKORO_VOICE_IDS.map(kokoroVoiceFromId);

export function getKokoroVoiceById(id: string): TtsVoice | undefined {
	return KOKORO_VOICES.find((v) => v.id === id);
}
