/* Voice sample previews — the naming scheme for the prebaked audition clips and
 * the only place it is written down. The baker (scripts/bake-voice-samples.ts)
 * and the two catalogue routes (/api/tts/status, /api/voices) all resolve through
 * here, so the file a bake writes is by construction the file a route serves.
 *
 * There is deliberately no manifest. The filename encodes the whole identity —
 * provider, voice id, sample-text version — so the presence of the file IS the
 * cache entry. A manifest would be a second source of truth that can disagree
 * with the filesystem.
 *
 * Names are flat (no directory component) because `resolveUploadFilePath`
 * rejects any name carrying a separator; that keeps samples on the existing
 * /uploads static path with no second route and no second path-safety rule. */
import { existsSync } from "node:fs";
import { resolveUploadFilePath } from "./upload-files.ts";
import type { TtsProviderId } from "./tts-synth.ts";

/* The sentence a voice speaks in its audition clip, per language.
 *
 * It was one English constant, and that was right while every catalogued voice
 * was English. It is wrong now: Kokoro's voices are LANGUAGE-LOCKED, so handing
 * a Japanese voice an English sentence does not audition that voice — it
 * produces whatever the phonemizer makes of foreign words, which tells an
 * operator nothing about the voice they are choosing.
 *
 * So the comparison narrows from "every voice" to "every voice OF A LANGUAGE".
 * Two voices are still only comparable on identical words, and within a language
 * they still get them.
 *
 * Each line is chosen to carry varied prosody in one breath: a statement, a
 * pause, then a clause that lands soft, which exposes pacing and warmth
 * differences a flat sentence hides. */
const SAMPLE_TEXT_BY_LANGUAGE: Readonly<Record<string, string>> = {
	en: "Every story needs a voice — and if this one sounds right to you, we can begin.",
	es: "Cada historia necesita una voz — y si esta te suena bien, podemos empezar.",
	fr: "Chaque histoire a besoin d'une voix — et si celle-ci vous convient, nous pouvons commencer.",
	hi: "हर कहानी को एक आवाज़ चाहिए — और अगर यह आपको ठीक लगे, तो हम शुरू कर सकते हैं।",
	it: "Ogni storia ha bisogno di una voce — e se questa ti convince, possiamo iniziare.",
	ja: "物語には声が要ります。この声がしっくりくるなら、はじめましょう。",
	pt: "Toda história precisa de uma voz — e se esta soa bem para você, podemos começar.",
	zh: "每个故事都需要一个声音——如果这个声音适合你，我们就可以开始了。",
};

/** The default, used for a language with no sample text of its own. A voice
 *  auditioned in the wrong language is still more use than no play control, and
 *  the fallback is visible: its clip speaks English while its entry does not. */
const DEFAULT_SAMPLE_LANGUAGE = "en";

/** The sentence a voice of this language speaks. Regional variants share their
 *  base language's text — `en-US` and `en-GB` are compared on the same words,
 *  which is the whole point of having any fixed sentence at all. */
export function sampleTextForLanguage(lang: string | undefined): string {
	const base = (lang ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
	return SAMPLE_TEXT_BY_LANGUAGE[base] ?? SAMPLE_TEXT_BY_LANGUAGE[DEFAULT_SAMPLE_LANGUAGE]!;
}

/** The English sentence, kept as a named export because callers that have no
 *  language in hand still need the default. */
export const SAMPLE_TEXT = SAMPLE_TEXT_BY_LANGUAGE[DEFAULT_SAMPLE_LANGUAGE]!;

/** Every language the bake can speak, for a caller enumerating coverage. */
export const SAMPLE_TEXT_LANGUAGES = Object.keys(SAMPLE_TEXT_BY_LANGUAGE);

/** Bump when ANY language's sample text changes. Every baked filename carries
 *  it, so a bump renames the whole set at once: old clips stop being addressable
 *  and no picker can compare a clip of superseded wording against a current one.
 *
 *  v2: the text became per-language, so every v1 clip is superseded. */
export const SAMPLE_TEXT_VERSION = "v2";

/** Extensions a sample may have been baked as. Kokoro can emit several; the
 *  bake currently takes wav. The
 *  resolver probes these in order rather than storing the ext anywhere. */
const SAMPLE_EXTS = ["mp3", "wav", "ogg", "flac"] as const;

const SAMPLE_PREFIX = "voice-sample";

/** Voice ids are provider-controlled, so they are sanitized before they become
 *  part of a filename — a flat name is a correctness requirement here, not a
 *  cosmetic one. */
function safeSegment(value: string): string {
	return value.trim().replace(/[^A-Za-z0-9_-]/g, "_");
}

/** The filename a sample for this provider/voice/ext is baked to and served from. */
export function voiceSampleFilename(provider: TtsProviderId, voiceId: string, ext: string): string {
	return `${SAMPLE_PREFIX}-${safeSegment(provider)}-${safeSegment(voiceId)}-${SAMPLE_TEXT_VERSION}.${safeSegment(ext)}`;
}

/** Public url for a baked sample, or null when this voice has not been baked.
 *  Null is the normal state for an environment that has not run the bake, and
 *  every caller treats it as "no play control" rather than an error. */
export function voiceSampleUrl(provider: TtsProviderId, voiceId: string): string | null {
	for (const ext of SAMPLE_EXTS) {
		const url = `/uploads/${voiceSampleFilename(provider, voiceId, ext)}`;
		const path = resolveUploadFilePath(url);
		if (path && existsSync(path)) return url;
	}
	return null;
}

/** Attach `sampleUrl` to a catalogue entry. The routes serve three differently
 *  shaped voice lists; this keeps the field's derivation identical across them. */
export function withVoiceSampleUrl<T extends { id: string }>(
	provider: TtsProviderId,
	voice: T,
): T & { sampleUrl: string | null } {
	return { ...voice, sampleUrl: voiceSampleUrl(provider, voice.id) };
}
