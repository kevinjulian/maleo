import { createHash } from "node:crypto";
import { basename } from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mediaWorkerCacheDir } from "../../paths.ts";
import { referenceToLocalPath } from "../shared/paths.ts";
import { pocketTtsBaseUrlFromEnv, pocketTtsClient } from "./service.ts";
import { prepareIndonesianText } from "./text.ts";

export interface PocketTtsResult {
	path: string;
	from_cache: boolean;
}

/* The cache key is (service, voice identity, text).
 *
 * The VOICE ID, not the reference audio, because the id is what identifies a
 * voice everywhere else in the system: a clone's audio never changes under a
 * fixed id — re-recording mints a new clone — so hashing the bytes here would
 * spend a read on every synthesis to learn something the id already says. */
function cacheKey(base: string, voice: string, text: string): string {
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

export interface PocketTtsSynthesisInput {
	text: string;
	/** The clone id. Identifies the voice for caching and for error messages. */
	voice: string;
	/** Where the clone's reference audio lives, as a managed URL or path. */
	voiceRefUrl: string;
}

/** Synthesize `text` in a cloned voice, caching the result as a WAV file.
 *  Throws with a setup-oriented message when the service URL is unset, and
 *  refuses loudly when the reference audio cannot be read. */
export async function generateSpeechViaPocketTts(
	input: PocketTtsSynthesisInput,
): Promise<PocketTtsResult> {
	const base = pocketTtsBaseUrlFromEnv();
	if (!base)
		throw new Error("Pocket TTS Indonesian not configured — set its Service URL in Settings.");

	/* Before the cache lookup, so unspeakable text is refused rather than served
	 * from an entry a previous, differently-normalized request happened to fill. */
	const text = prepareIndonesianText(input.text);

	const path = join(
		mediaWorkerCacheDir(),
		`pocket-tts-id-${cacheKey(base, input.voice, text)}.wav`,
	);
	if (await exists(path)) return { path, from_cache: true };

	/* Refused, never dropped. A synthesis that silently lost its voice prompt
	 * would still return audio — in some other voice — and the caller would see
	 * success, which is the same invisible substitution reference images refuse. */
	const local = referenceToLocalPath(input.voiceRefUrl);
	if (!local) {
		throw new Error(
			`voice ${input.voice}: reference audio is not a readable managed file (${input.voiceRefUrl})`,
		);
	}
	const bytes = new Uint8Array(await readFile(local));

	const audio = await pocketTtsClient(base).synthesize({
		text,
		prompt: { bytes, filename: basename(local) },
	});
	await mkdir(mediaWorkerCacheDir(), { recursive: true });
	await writeFile(path, audio);
	return { path, from_cache: false };
}
