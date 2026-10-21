/* Pocket TTS Indonesian — self-hosted TTS whose voice is a cloned recording.
 *
 * The service is built and deployed from `infra/pocket-tts-id`; this is the
 * client for it. Its URL is a provider config field entered in Settings, and
 * with it unset the provider reports `unconfigured` rather than throwing.
 *
 * It differs from every other TTS provider in one way that shapes the rest: it
 * declares no voices. The model has no speakers to pick from — it imitates an
 * audio prompt — so a synthesis here is impossible without a cloned voice, and
 * asking for one without a reference is refused rather than served in some
 * arbitrary default voice.
 */
import type { ContentProvider, TtsProvider } from "../types.ts";
import { pocketTtsIdMeta } from "./meta.ts";
import { generateSpeechViaPocketTts } from "./synth.ts";

const pocketTtsIdTts: TtsProvider = {
	async synthesize(input) {
		const voice = input.voice?.trim();
		const voiceRefUrl = input.voiceRefUrl?.trim();
		/* Both refusals name what is missing. This provider has no default voice
		 * to fall back to, and inventing one would return audio in a voice nobody
		 * chose — which reads as success everywhere downstream. */
		if (!voice || !voiceRefUrl) {
			throw new Error(
				"Pocket TTS Indonesian speaks only cloned voices — create one in the voice library and select it.",
			);
		}
		const result = await generateSpeechViaPocketTts({ text: input.text, voice, voiceRefUrl });
		return { path: result.path, fromCache: result.from_cache };
	},
};

export const pocketTtsIdProvider: ContentProvider = {
	meta: pocketTtsIdMeta,
	tts: pocketTtsIdTts,
};

/* Internal to the media package. */
export {
	POCKET_TTS_LANGUAGE,
	POCKET_TTS_MODEL,
	POCKET_TTS_URL_KEY,
	pocketTtsBaseUrlFromEnv,
	pocketTtsClient,
} from "./service.ts";
export { prepareIndonesianText, PocketTtsTextError } from "./text.ts";
