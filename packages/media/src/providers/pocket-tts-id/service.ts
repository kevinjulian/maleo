/* Where the deployed Pocket TTS Indonesian service lives, and how to dial it.
 *
 * The service is built and deployed from `infra/pocket-tts-id`. Its URL is
 * declared as a provider config field and entered in Settings, so an unset
 * value is what makes the provider report `unconfigured` rather than throw.
 *
 * This does NOT reuse `OpenAiSpeechClient`. That client sends a JSON body with
 * a `voice` NAME, and this service takes a voice as BYTES — there is no speaker
 * id to send. Bending it to carry multipart would add a second request shape to
 * a client whose whole job is the first one.
 */
import { resolveConfig } from "../config.ts";

/** The model behind the service, for attribution on a generation row. */
export const POCKET_TTS_MODEL = "pocket-tts-indonesian-6l";

/** The only language this model speaks. */
export const POCKET_TTS_LANGUAGE = "id";

/** Liveness route the deployed server exposes. */
const POCKET_TTS_HEALTH_PATH = "/health";

export const POCKET_TTS_URL_KEY = "MALEO_POCKET_TTS_URL";

const DEFAULT_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 5_000;

export function pocketTtsBaseUrlFromEnv(): string | undefined {
	return resolveConfig(POCKET_TTS_URL_KEY);
}

export interface PocketTtsSynthesisRequest {
	text: string;
	/* The voice prompt the model imitates, and the name to send it under.
	 *
	 * `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array` — the same narrowing
	 * `MediaClient.download` carries and for the same reason: bare widens to
	 * `ArrayBufferLike`, which admits a SharedArrayBuffer backing and is
	 * therefore not a `BlobPart`. Stating it here keeps the multipart body
	 * assertion-free rather than casting at the one place it is read. */
	prompt: { bytes: Uint8Array<ArrayBuffer>; filename: string };
}

export class PocketTtsClient {
	private readonly base: string;
	private readonly timeoutMs: number;

	constructor(baseUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
		if (!baseUrl.trim()) throw new Error("PocketTtsClient: baseUrl is required");
		this.base = baseUrl.replace(/\/+$/, "");
		this.timeoutMs = timeoutMs;
	}

	/** Synthesize `text` in the voice of the supplied prompt. Returns WAV bytes. */
	async synthesize(req: PocketTtsSynthesisRequest): Promise<Uint8Array> {
		const form = new FormData();
		form.set("input", req.text);
		form.set("response_format", "wav");
		/* Deliberately not claiming a type. A clone's recording may be any
		 * container the library accepts, the service decodes it by content, and
		 * labelling every prompt `audio/wav` was a lie that happened not to
		 * matter. The filename carries the only hint worth sending. */
		form.set(
			"voice_prompt",
			new Blob([req.prompt.bytes], { type: "application/octet-stream" }),
			req.prompt.filename,
		);

		const res = await this.fetchWithTimeout(`${this.base}/v1/audio/speech`, {
			method: "POST",
			headers: { Accept: "audio/wav" },
			body: form,
		});
		if (!res.ok) {
			const detail = await res.text().catch(() => "");
			throw new Error(`${POCKET_TTS_MODEL} ${res.status}: ${detail || res.statusText}`);
		}
		return new Uint8Array(await res.arrayBuffer());
	}

	/** Liveness probe. True when the server answers its health path. */
	async healthy(): Promise<boolean> {
		try {
			const res = await this.fetchWithTimeout(
				`${this.base}${POCKET_TTS_HEALTH_PATH}`,
				{ method: "GET" },
				HEALTH_TIMEOUT_MS,
			);
			return res.ok;
		} catch {
			return false;
		}
	}

	private async fetchWithTimeout(
		url: string,
		init: RequestInit,
		timeoutMs = this.timeoutMs,
	): Promise<Response> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await fetch(url, { ...init, signal: controller.signal });
		} finally {
			clearTimeout(timer);
		}
	}
}

export function pocketTtsClient(baseUrl: string): PocketTtsClient {
	return new PocketTtsClient(baseUrl);
}
