/* Kokoro — self-hosted TTS over HTTP.
 *
 * The service is built and deployed from `infra/kokoro-tts`; this is the client
 * for it. `MALEO_KOKORO_URL` is the only wiring between the two, and with it
 * unset the provider reports `unconfigured` rather than throwing — which is what
 * makes TTS fail loudly instead of falling through to the mock.
 * It is first real TTS provider, so an unconfigured selection resolves here. */
import type { ContentProvider, TtsProvider } from "../types.ts";
import { kokoroMeta } from "./meta.ts";
import { generateSpeechViaKokoro } from "./synth.ts";

const kokoroTts: TtsProvider = {
	async synthesize(input) {
		const result = await generateSpeechViaKokoro(input.text, input.voice);
		return { path: result.path, fromCache: result.from_cache };
	},
};

export const kokoroProvider: ContentProvider = {
	meta: kokoroMeta,
	tts: kokoroTts,
};

/* Internal to the media package. Voices reach `apps/api` as
 * `kokoroMeta.tts.voices` like every other provider's. */
export { kokoroBaseUrlFromEnv, kokoroSpeechClient, KOKORO_MODEL } from "./service.ts";
export { KOKORO_VOICES, getKokoroVoiceById, kokoroVoiceFromId } from "./voices.ts";
