import {
	POCKET_TTS_LANGUAGE,
	POCKET_TTS_MODEL,
	POCKET_TTS_URL_KEY,
	pocketTtsBaseUrlFromEnv,
	pocketTtsClient,
} from "./service.ts";
import type { ProviderMeta } from "../types.ts";

export const pocketTtsIdMeta: ProviderMeta = {
	id: "pocket-tts-id",
	label: "Pocket TTS Indonesian (self-hosted)",
	capabilities: ["tts"],
	models: { tts: POCKET_TTS_MODEL },
	config: [
		{
			key: POCKET_TTS_URL_KEY,
			label: "Service URL",
			kind: "url",
			required: true,
			help: "Where the deployed Pocket TTS Indonesian service listens. Built from infra/pocket-tts-id.",
		},
	],
	/* NO DECLARED VOICES, and that is the provider, not an omission.
	 *
	 * Kokoro ships fifty-four speakers; this model ships none. Its voice is
	 * whatever audio prompt it is handed, so every voice it can speak is a clone
	 * in the workspace's own library. An empty list here is therefore the honest
	 * answer to "what can you speak with no voice supplied": nothing.
	 *
	 * The catalogue unions this with the calling workspace's clones, so a
	 * workspace that has created one sees it, and one that has not sees an empty
	 * list rather than voices that would fail at the point of use. */
	tts: { voices: [], voiceSource: "cloned", language: POCKET_TTS_LANGUAGE },
	/* A real request to the service's health path — the difference between "a URL
	 * is set" and "something is listening at it". */
	async reachable() {
		const base = pocketTtsBaseUrlFromEnv();
		if (!base) return { ok: false, reason: `${POCKET_TTS_URL_KEY} is not set` };
		try {
			const ok = await pocketTtsClient(base).healthy();
			return ok ? { ok: true } : { ok: false, reason: `${base} did not answer its health check` };
		} catch (error) {
			return { ok: false, reason: error instanceof Error ? error.message : String(error) };
		}
	},
	async health() {
		// Configuration only, no network: this is called on every settings render.
		return pocketTtsBaseUrlFromEnv() ? "ready" : "unconfigured";
	},
};
