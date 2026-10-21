import { OpenAiSpeechClient } from "../openai-speech/client.ts";
import { resolveConfig } from "../config.ts";

/* Where the deployed Kokoro service lives, and how to dial it.
 *
 * The service is built and deployed from `infra/kokoro-tts`; `MALEO_KOKORO_URL`
 * is the only wiring between the two halves, and an unset value is what makes
 * the provider report `unconfigured` rather than throw. */

/** Must equal the model name the kokoro-fastapi endpoint demands. */
export const KOKORO_MODEL = "kokoro";

/** kokoro-fastapi liveness route. */
const KOKORO_HEALTH_PATH = "/health";

/** Everything kokoro-fastapi can encode. */
const KOKORO_FORMATS = ["mp3", "wav", "opus", "flac", "aac", "pcm"] as const;

export const KOKORO_URL_KEY = "MALEO_KOKORO_URL";

export function kokoroBaseUrlFromEnv(): string | undefined {
	return resolveConfig(KOKORO_URL_KEY);
}

export function kokoroSpeechClient(baseUrl: string): OpenAiSpeechClient {
	return new OpenAiSpeechClient({
		baseUrl,
		model: KOKORO_MODEL,
		healthPath: KOKORO_HEALTH_PATH,
		formats: KOKORO_FORMATS,
	});
}
