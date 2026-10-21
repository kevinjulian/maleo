import { z } from "zod";

/* Client for a TTS server that speaks the OpenAI `/v1/audio/speech` shape.
 * Stateless: caller owns caching and file persistence. */

export interface SpeechClientOptions {
	baseUrl: string;
	/* The OpenAI-compatible endpoint rejects a mismatched model name: it must
	 * equal the model the server was started with. That makes it a property of
	 * the server, not of a request, which is why it lives here. */
	model: string;
	/* Liveness path exposed by server. */
	healthPath: string;
	/* What this server can actually encode. Stated per server because the two
	 * disagree, and a format the server cannot produce should be refused here
	 * rather than surfacing as an opaque error from the service. */
	formats: readonly string[];
	timeoutMs?: number;
}

const speechRequestSchema = z.object({
	text: z.string().min(1),
	voice: z.string().default("M1"),
	lang: z.string().default("en"),
	format: z.string().default("wav"),
});

export type SpeechRequest = z.input<typeof speechRequestSchema>;

const DEFAULT_TIMEOUT_MS = 60_000;
const HEALTH_TIMEOUT_MS = 5_000;

function normalizeBase(baseUrl: string): string {
	return baseUrl.replace(/\/$/, "");
}

/* Accept headers for the formats these servers encode. Anything absent falls
 * back to a generic audio accept — the server has already told us it can
 * produce the format, and the header is a preference, not a gate. */
const ACCEPT_BY_FORMAT: Record<string, string> = {
	wav: "audio/wav",
	mp3: "audio/mpeg",
	opus: "audio/opus",
	flac: "audio/flac",
	aac: "audio/aac",
	ogg: "audio/ogg",
	pcm: "audio/pcm",
};

export class OpenAiSpeechClient {
	private readonly base: string;
	private readonly model: string;
	private readonly healthPath: string;
	private readonly formats: ReadonlySet<string>;
	private readonly timeoutMs: number;

	constructor(opts: SpeechClientOptions) {
		if (!opts.baseUrl?.trim()) {
			throw new Error("OpenAiSpeechClient: baseUrl is required");
		}
		if (opts.formats.length === 0) {
			throw new Error("OpenAiSpeechClient: at least one response format is required");
		}
		this.base = normalizeBase(opts.baseUrl);
		this.model = opts.model;
		this.healthPath = opts.healthPath.startsWith("/") ? opts.healthPath : `/${opts.healthPath}`;
		this.formats = new Set(opts.formats);
		this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	/** The formats this server can encode, in declaration order. */
	supportedFormats(): string[] {
		return [...this.formats];
	}

	// Synthesize speech. Returns raw audio bytes in the requested format.
	async synthesize(req: SpeechRequest): Promise<Uint8Array> {
		const { text, voice, lang, format } = speechRequestSchema.parse(req);
		/* Refused here rather than surfacing an opaque service error. */
		if (!this.formats.has(format)) {
			throw new Error(
				`${this.model} cannot produce "${format}"; supported: ${this.supportedFormats().join(", ")}`,
			);
		}

		const res = await this.fetchWithTimeout(`${this.base}/v1/audio/speech`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: ACCEPT_BY_FORMAT[format] ?? "audio/*",
			},
			body: JSON.stringify({
				model: this.model,
				input: text,
				voice,
				lang,
				response_format: format,
			}),
		});

		if (!res.ok) {
			const detail = await res.text().catch(() => "");
			throw new Error(`${this.model} ${res.status}: ${detail || res.statusText}`);
		}

		return new Uint8Array(await res.arrayBuffer());
	}

	// Liveness probe. True when the server answers its configured health path.
	async healthy(): Promise<boolean> {
		try {
			const res = await this.fetchWithTimeout(
				`${this.base}${this.healthPath}`,
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
