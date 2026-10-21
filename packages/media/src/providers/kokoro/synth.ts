import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mediaWorkerCacheDir } from "../../paths.ts";
import { kokoroBaseUrlFromEnv, kokoroSpeechClient } from "./service.ts";
import { getKokoroVoiceById } from "./voices.ts";

export interface KokoroTtsResult {
	path: string;
	from_cache: boolean;
}

/* `af_heart` is the upstream's own default and the voice its samples are cut
 * from. Stated here rather than left to the service so the cache key is
 * complete: a request with no voice must key the same entry every time. */
const DEFAULT_VOICE = "af_heart";

function cacheKey(base: string, text: string, voice: string): string {
	return createHash("sha256").update(`${base} ${voice} ${text}`).digest("hex").slice(0, 32);
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/** Synthesize `text` to a cached WAV file via the Kokoro TTS service.
 *  Caches by (base url, voice, text) so repeat calls skip the network round-trip.
 *  Throws with a setup-oriented message when MALEO_KOKORO_URL is unset. */
export async function generateSpeechViaKokoro(
	text: string,
	voice?: string,
): Promise<KokoroTtsResult> {
	const base = kokoroBaseUrlFromEnv();
	if (!base) throw new Error("Kokoro TTS not configured — set MALEO_KOKORO_URL.");
	const speaker = voice?.trim() || DEFAULT_VOICE;
	const cacheDir = mediaWorkerCacheDir();
	const path = join(cacheDir, `kokoro-tts-${cacheKey(base, text, speaker)}.wav`);
	if (await exists(path)) return { path, from_cache: true };

	/* Kokoro voices are language-locked, and the language the service phonemizes
	 * with follows the voice id — so `lang` comes from the catalogue rather than
	 * from a caller-supplied `TtsInput.language`, which could only contradict the
	 * voice. An unknown id is passed through with no language: the service is the
	 * authority on which voices exist, and one it added is not an error here. */
	const lang = getKokoroVoiceById(speaker)?.lang;
	const bytes = await kokoroSpeechClient(base).synthesize({
		text,
		voice: speaker,
		format: "wav",
		...(lang ? { lang } : {}),
	});
	await mkdir(cacheDir, { recursive: true });
	await writeFile(path, bytes);
	return { path, from_cache: false };
}
