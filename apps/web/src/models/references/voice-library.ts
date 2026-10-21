/* Maleo — Content-First Create · Data, helpers, constants, types */

import { type Speaker } from "@maleo/shared";

export interface Voice {
	id: string;
	name: string;
	desc: string;
	lang: string;
	/** Derived server-side, from the one rule in lib/voice-catalogue-source.ts.
	 *  It used to be computed two ways — hand-picked constants here, `hashHue(id)`
	 *  in the catalogue client — so one voice drew in two colours depending on
	 *  which surface you were looking at. */
	hue: number;
	/** The baked audition clip, or null when this voice has not been baked. The
	 *  API has always sent this; the type did not carry it, so every surface but
	 *  the pickers silently dropped it on arrival. */
	sampleUrl?: string | null;
}

export interface ResolvedVoice {
	name: string;
	desc: string;
	hue: number;
	gen?: boolean;
}

/* ════ The catalogue this module resolves against ════
 *
 * `VOICE_LIB` used to live here: five hand-written voices with hand-picked hues,
 * missing M1 entirely, and unrelated to whichever provider was actually
 * configured. A voice the operator could select in the editor resolved to nothing
 * here, and one this list named might not exist at the provider at all.
 *
 * The catalogue now arrives from the API — one list, resolved for the effective
 * provider — and is registered here once when it is fetched. This is a cache of a
 * server answer, not a second source: nothing in the web app defines a voice.
 *
 * `resolveVoice` stays synchronous because its four callers are render paths. The
 * cost is an ordering window: a render before the catalogue lands resolves to a
 * name with no description, which is the same degradation as a voice the
 * catalogue no longer offers, and is what the spec asks for in both cases. */
let catalogue: readonly Voice[] = [];

export function setVoiceCatalogue(voices: readonly Voice[]): void {
	catalogue = voices;
}

export function voiceCatalogue(): readonly Voice[] {
	return catalogue;
}

function getVoice(id: string | undefined): Voice | null {
	return catalogue.find((v) => v.id === id) || null;
}

/* ════ Resolve a speaker → display voice info ════ */

/** The colour a voice falls back to when nothing names one. */
const UNRESOLVED_HUE = 268;

export function resolveVoice(speaker: Speaker | undefined): ResolvedVoice {
	if (!speaker) return { name: "—", desc: "", hue: UNRESOLVED_HUE };
	// An explicitly custom or described speaker carries its own identity and is
	// not a catalogue voice at all, so the catalogue is not consulted for it.
	if (speaker.custom)
		return { name: speaker.name, desc: speaker.custom.desc, hue: speaker.custom.hue, gen: true };
	if (speaker.voiceDesc)
		return { name: speaker.name, desc: speaker.voiceDesc, hue: speaker.hue ?? UNRESOLVED_HUE };
	const v = getVoice(speaker.voiceId);
	return v
		? { name: speaker.name, desc: v.desc, hue: v.hue }
		: { name: speaker.name, desc: "", hue: UNRESOLVED_HUE };
}

/* ════ Soft gradient pool for "generated" frames ════ */
