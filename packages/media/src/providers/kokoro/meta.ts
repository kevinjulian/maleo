import {
	KOKORO_MODEL,
	KOKORO_URL_KEY,
	kokoroBaseUrlFromEnv,
	kokoroSpeechClient,
} from "./service.ts";
import { KOKORO_VOICES } from "./voices.ts";
import type { ProviderMeta } from "../types.ts";

export const kokoroMeta: ProviderMeta = {
	id: "kokoro",
	label: "Kokoro (self-hosted TTS)",
	capabilities: ["tts"],
	models: { tts: KOKORO_MODEL },
	config: [
		{
			key: KOKORO_URL_KEY,
			label: "Service URL",
			kind: "url",
			required: true,
			help: "Where the deployed kokoro-fastapi service listens. Built from infra/kokoro-tts.",
		},
	],
	tts: { voices: KOKORO_VOICES },
	/* A real request to the service's health path — the difference between "a URL
	 * is set" and "something is listening at it". */
	async reachable() {
		const base = kokoroBaseUrlFromEnv();
		if (!base) return { ok: false, reason: `${KOKORO_URL_KEY} is not set` };
		try {
			const ok = await kokoroSpeechClient(base).healthy();
			return ok ? { ok: true } : { ok: false, reason: `${base} did not answer its health check` };
		} catch (error) {
			return { ok: false, reason: error instanceof Error ? error.message : String(error) };
		}
	},
	async health() {
		// TTS is available once the Kokoro service URL is configured.
		return kokoroBaseUrlFromEnv() ? "ready" : "unconfigured";
	},
};
