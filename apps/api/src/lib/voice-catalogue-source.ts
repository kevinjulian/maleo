/* The one voice catalogue.
 *
 * There were four lists. Two canonical ones — each provider's real speaker ids —
 * and two derived copies that drifted from them:
 *
 *  - `CONTENT_VOICE_LIBRARY` in routes/operations/constants.ts, which mapped one
 *    provider's voices and nothing else, so the catalogue endpoint served that
 *    provider's voices whatever provider was configured. An operator was shown
 *    voices that could not be synthesized and none of the ones that could.
 *
 *  - `VOICE_LIB` in the web app, five hand-written voices with their own hues,
 *    missing a voice entirely.
 *
 * Both are gone, and so is the third copy this module itself used to hold: a
 * ternary over two provider names, with each provider's catalogue imported here
 * by name. Voices now arrive as `meta.tts.voices` on whichever providers are
 * registered, so adding a TTS provider adds its voices and this file does not
 * change. It attaches the sample location through the existing resolver and
 * derives the display hue by one rule.
 *
 * The hue matters more than it looks. It was computed two ways — hand-picked
 * constants in VOICE_LIB, `hashHue(id)` in the web catalogue client — so the same
 * voice drew in one colour in the library and a different one in a storyboard
 * export. Deriving it here means a voice has one colour because it has one
 * definition. */
import { getProvider } from "@maleo/media/providers";
import { listVoiceClones } from "@maleo/db/voice-clone";
import {
	resolveTtsProvider,
	ttsProviderLabel,
	ttsProviders,
	type TtsProviderId,
} from "./tts-synth.ts";
import { withVoiceSampleUrl } from "./voice-samples.ts";

/** A voice as every surface receives it. */
export interface CatalogueVoice {
	id: string;
	name: string;
	desc: string;
	/** Upper-cased BCP-47-ish tag, as the pickers group and label by it. */
	lang: string;
	gender?: "male" | "female";
	/** Derived, never stored: one rule so one voice is one colour everywhere. */
	hue: number;
	/** The baked audition clip, or null when this voice has not been baked. Null
	 *  is the ordinary state for an environment that has not run the bake, and
	 *  every caller treats it as "no play control" rather than an error.
	 *
	 *  For a CLONE this is the reference audio it was created from. The bake is an
	 *  ahead-of-time pass over the voices declared in the repository and cannot
	 *  contain a voice created after it ran — and the source recording is the more
	 *  faithful preview anyway, being what the model imitates. */
	sampleUrl: string | null;
	/** True when this voice is a workspace clone rather than a provider-declared
	 *  speaker. A surface may label it; nothing may branch on it to decide whether
	 *  the voice is usable. */
	cloned?: boolean;
}

/* The same derivation the web client used for catalogue images, lifted here so
 * voices are coloured server-side and no client can pick a second rule. Kept
 * character-for-character identical so existing voices keep the colour operators
 * already associate with them. */
export function voiceHue(id: string): number {
	let h = 0;
	for (const c of String(id || "")) h = (h * 31 + c.charCodeAt(0)) % 360;
	return h;
}

/* Every voice a provider can synthesize for one workspace, in catalogue order:
 * the voices it declares, then that workspace's clones for it.
 *
 * The two halves are disjoint by construction — a declared voice is never a row
 * and a clone is never declared — so this is one catalogue rather than two lists
 * that can disagree about the same voice.
 *
 * An id naming no registered provider yields an empty list rather than throwing:
 * a retired provider still appears in stored rows, and a listing is not the
 * place to fail on one. A workspace with no clones receives exactly the declared
 * list it received before clones existed. */
export async function voicesForProvider(
	provider: TtsProviderId,
	workspace?: string,
): Promise<CatalogueVoice[]> {
	const declared = (getProvider(provider)?.meta.tts?.voices ?? []).map((v) => ({
		...withVoiceSampleUrl(provider, {
			id: v.id,
			name: v.name,
			desc: v.desc,
			lang: v.lang.toUpperCase(),
			gender: v.gender,
		}),
		hue: voiceHue(v.id),
	}));
	if (!workspace) return declared;

	const cloned: CatalogueVoice[] = (await listVoiceClones(workspace, provider)).map((clone) => ({
		id: clone.id,
		name: clone.label,
		desc: "Cloned voice",
		lang: clone.lang.toUpperCase(),
		...(clone.gender ? { gender: clone.gender } : {}),
		hue: voiceHue(clone.id),
		/* The recording itself, not a baked clip. See CatalogueVoice.sampleUrl. */
		sampleUrl: clone.refUrl,
		cloned: true,
	}));
	return [...declared, ...cloned];
}

/** One registered TTS provider as a surface that offers a choice renders it. */
export interface CatalogueProviderEntry {
	id: string;
	label: string;
	health: "ready" | "unconfigured" | "down";
	voices: CatalogueVoice[];
	/** True when this provider's voices are cloned rather than declared, so a
	 *  surface knows that an empty list means "none created yet" rather than
	 *  "nothing to speak with", and where offering to create one belongs. */
	clones: boolean;
}

/** Every registered TTS provider with its health and its voices.
 *
 *  A list, not a record keyed by provider name. The record it replaced named its
 *  two keys in the type, which meant a third provider could not appear anywhere
 *  without an edit in this package, in the wire types, and in three arrays in
 *  the web app. */
export async function ttsProviderCatalogue(workspace?: string): Promise<CatalogueProviderEntry[]> {
	return await Promise.all(
		ttsProviders().map(async (provider) => ({
			id: provider.meta.id,
			label: provider.meta.label,
			health: await provider.meta.health("tts"),
			voices: await voicesForProvider(provider.meta.id, workspace),
			clones: provider.meta.tts?.voiceSource === "cloned",
		})),
	);
}

/* The catalogue for the provider that will actually perform the synthesis.
 *
 * An unconfigured provider yields an EMPTY list rather than a fallback to
 * another provider's voices. Falling back would show a working catalogue that
 * silently belongs to a provider nobody selected, and every voice picked from it
 * would fail at the point of use — the invisible-substitution failure the media
 * package's provider selection refuses for the same reason. */
export async function effectiveVoiceCatalogue(workspace?: string): Promise<{
	provider: TtsProviderId | null;
	label: string | null;
	ready: boolean;
	error: string | null;
	voices: CatalogueVoice[];
}> {
	try {
		const { provider } = await resolveTtsProvider();
		const id = provider.meta.id;
		return {
			provider: id,
			label: ttsProviderLabel(id),
			ready: true,
			error: null,
			voices: await voicesForProvider(id, workspace),
		};
	} catch (error) {
		/* No ready provider is an ordinary state for a fresh deployment, so it is
		 * reported rather than thrown — but with the reason attached, because
		 * "unavailable" with no cause sends an operator to the logs for something
		 * selection already knows. */
		return {
			provider: null,
			label: null,
			ready: false,
			error: error instanceof Error ? error.message : String(error),
			voices: [],
		};
	}
}
