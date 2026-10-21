import {
	SpeechStatusSchema,
	SpeechResultSchema,
	SpeechOptionsSchema,
	SPEECH_UPLOAD_BYTES,
	type SpeechMediaClient,
} from "./speech.ts";
export type { SpeechStatus, SpeechResult, SpeechMediaClient } from "./speech.ts";
/* Media client — the single, centralized entry the dashboard uses for content
 * generation. Encapsulates transport (base URL + auth + the worker's HTTP
 * contract) so callers do image/tts/video submit + poll without touching URLs. Swap the
 * worker location via config, not scattered env reads at every call site. */
import type { ImageRequest, TtsRequest, VideoRequest, MediaJob } from "./types.ts";
import { z } from "zod";
import {
	ProcessingJobSchema,
	ProcessingRequestSchema,
	ProcessingReadinessSchema,
	type ProcessingReadiness,
	type ProcessingJob,
	type ProcessingRequest,
} from "./processing.ts";
export type {
	ProcessingJob,
	ProcessingRequest,
	ProcessingResult,
	ProcessingReadiness,
	MediaProcessingRequest,
	MediaProcessingResult,
	MediaProcessingJob,
	CaptionProcessingRequest,
	CaptionProcessingJob,
} from "./processing.ts";
export { isCaptionProcessingJob } from "./processing.ts";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Worker answered with an HTTP failure; callers branch on status, not message text. */
export class MediaWorkerHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "MediaWorkerHttpError";
	}
}

export interface MediaClientConfig {
	baseUrl: string;
	token?: string;
	/** Bound every worker request so one stalled socket cannot hold a durable step forever. */
	requestTimeoutMs?: number;
	/** Optional transport seam for tests or embedded runtimes. */
	fetch?: FetchLike;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function authHeaders(token?: string): Record<string, string> {
	return token ? { authorization: `Bearer ${token}` } : {};
}

/* The worker's job row on the wire.
 *
 * Every field except the id is optional-with-a-default, which is not laziness:
 * a job that has only just been queued genuinely has no `image_url`, `model` or
 * `cost` yet, and this client polls jobs from the moment they are submitted.
 * The old code encoded the same intent with `?? null` on each line — but it
 * reached those defaults through `raw.image_url as string | null`, which turned
 * a NUMBER into a string-typed field instead of falling back.
 *
 * `catch` rather than a strict field is what keeps that behaviour: a value of
 * the wrong type lands on the default, exactly where a missing one does. The
 * only field that can fail the parse is `id`. */
const submitResponseSchema = z.object({ job_id: z.string().optional() }).passthrough();

const nullableString = z.string().nullable().catch(null);
const nullableNumber = z.number().nullable().catch(null);

const jobResponseSchema = z
	.object({
		id: z.coerce.string(),
		kind: z.enum(["image", "tts", "video"]).catch("image"),
		status: z.enum(["queued", "processing", "done", "failed"]).catch("queued"),
		image_url: nullableString,
		audio_url: nullableString,
		duration_sec: z.number().finite().positive().optional(),
		storage_key: nullableString,
		storage_hash: nullableString,
		storage_size: nullableNumber,
		storage_content_type: nullableString,
		poster_storage_key: nullableString,
		poster_storage_hash: nullableString,
		poster_storage_size: nullableNumber,
		poster_storage_content_type: nullableString,
		from_cache: z.coerce.boolean().catch(false),
		provider_id: nullableString,
		provider_source: nullableString,
		model: nullableString,
		cost: nullableNumber,
		latency_ms: nullableNumber,
		error: nullableString,
	})
	.partial({
		kind: true,
		status: true,
		image_url: true,
		audio_url: true,
		storage_key: true,
		storage_hash: true,
		storage_size: true,
		storage_content_type: true,
		poster_storage_key: true,
		poster_storage_hash: true,
		poster_storage_size: true,
		poster_storage_content_type: true,
		from_cache: true,
		provider_id: true,
		provider_source: true,
		model: true,
		cost: true,
		latency_ms: true,
		error: true,
	})
	.passthrough();

function mapJob(raw: unknown): MediaJob {
	const j = jobResponseSchema.parse(raw);
	return {
		id: j.id,
		kind: j.kind ?? "image",
		status: j.status ?? "queued",
		imageUrl: j.image_url ?? null,
		audioUrl: j.audio_url ?? null,
		...(j.duration_sec !== undefined ? { durationSec: j.duration_sec } : {}),
		...(j.storage_key && j.storage_hash && j.storage_size != null && j.storage_content_type
			? {
					stored: {
						key: j.storage_key,
						hash: j.storage_hash,
						size: j.storage_size,
						contentType: j.storage_content_type,
					},
				}
			: {}),
		...(j.poster_storage_key &&
		j.poster_storage_hash &&
		j.poster_storage_size != null &&
		j.poster_storage_content_type
			? {
					poster: {
						key: j.poster_storage_key,
						hash: j.poster_storage_hash,
						size: j.poster_storage_size,
						contentType: j.poster_storage_content_type,
					},
				}
			: {}),
		fromCache: j.from_cache ?? false,
		providerId: j.provider_id ?? null,
		providerSource: j.provider_source ?? null,
		model: j.model ?? null,
		cost: j.cost ?? null,
		latencyMs: j.latency_ms ?? null,
		error: j.error ?? null,
	};
}

export interface ProcessingMediaClient {
	processingReadiness(kind?: "captions"): Promise<ProcessingReadiness>;
	submitProcessing(req: ProcessingRequest): Promise<string>;
	pollProcessing(
		jobId: string,
		owner: { workspaceId: string; projectId: string },
	): Promise<ProcessingJob>;
	cancelProcessing(
		jobId: string,
		owner: { workspaceId: string; projectId: string },
	): Promise<ProcessingJob>;
}

export interface MediaClient {
	submitImage(req: ImageRequest): Promise<string>;
	submitTts(req: TtsRequest): Promise<string>;
	submitVideo(req: VideoRequest): Promise<string>;
	videoReadiness(): Promise<Record<string, "ready" | "unconfigured" | "down">>;
	poll(jobId: string): Promise<MediaJob>;
	/* `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`. Bare widens to
	 * `Uint8Array<ArrayBufferLike>`, which admits a SharedArrayBuffer backing and
	 * is therefore not a `BodyInit` — so `new Response(file.bytes)` in the image
	 * file proxy failed to typecheck against a value that is always an
	 * `ArrayBuffer` in practice: the implementation below builds it from
	 * `res.arrayBuffer()`. Narrowing the declaration to what it already returns
	 * fixes both callers rather than casting at one of them. */
	download(
		path: string,
	): Promise<{ bytes: Uint8Array<ArrayBuffer>; ext: string; contentType?: string }>;
	/** Absolute URL for a worker file path (/files/…), for direct retrieval. */
	fileUrl(path: string): string;
}

export function createMediaClient(
	config: MediaClientConfig,
): MediaClient & ProcessingMediaClient & SpeechMediaClient {
	const root = config.baseUrl.replace(/\/+$/, "");
	const headers = { "content-type": "application/json", ...authHeaders(config.token) };
	const fetchImpl = config.fetch ?? globalThis.fetch;
	const requestTimeoutMs = Math.max(1, config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);

	async function request(path: string, init: RequestInit, operation: string): Promise<Response> {
		const signal = AbortSignal.timeout(requestTimeoutMs);
		try {
			return await fetchImpl(`${root}${path}`, { ...init, signal });
		} catch (err) {
			if (signal.aborted) {
				throw new Error(`media ${operation} timed out after ${requestTimeoutMs}ms`, { cause: err });
			}
			throw err;
		}
	}

	async function submit(path: string, body: unknown): Promise<string> {
		const res = await request(path, { method: "POST", headers, body: JSON.stringify(body) }, path);
		if (!res.ok) throw new MediaWorkerHttpError(res.status, `media ${path} failed: ${res.status}`);
		/* Already threw on a body with no `job_id`; now it also throws on a body
		 * that is not an object, which used to read as `undefined` and hit the
		 * same branch by accident. */
		const json = submitResponseSchema.safeParse(await res.json().catch(() => undefined));
		if (!json.success || !json.data.job_id) throw new Error(`media ${path} returned no job_id`);
		return json.data.job_id;
	}

	const selection = (req: {
		workspaceId?: string;
		projectId?: string;
		providerId?: string;
		providerSource?: "project" | "workspace" | "env" | "default";
	}) => ({
		workspace_id: req.workspaceId,
		project_id: req.projectId,
		provider_id: req.providerId,
		provider_source: req.providerSource,
	});
	async function processing(
		jobId: string,
		owner: { workspaceId: string; projectId: string },
		method: "GET" | "DELETE",
	): Promise<ProcessingJob> {
		const query = new URLSearchParams({ workspace: owner.workspaceId, project: owner.projectId });
		const res = await request(
			`/processing/${encodeURIComponent(jobId)}?${query}`,
			{ method, headers: authHeaders(config.token) },
			"processing",
		);
		if (!res.ok)
			throw new MediaWorkerHttpError(res.status, `media processing failed: ${res.status}`);
		return ProcessingJobSchema.parse(await res.json());
	}

	return {
		async speechStatus() {
			const response = await request(
				"/speech/status",
				{ method: "GET", headers: authHeaders(config.token) },
				"speech status",
			);
			if (!response.ok)
				throw new MediaWorkerHttpError(response.status, "Speech worker unavailable");
			return SpeechStatusSchema.parse(await response.json());
		},
		async setupSpeech() {
			const response = await request(
				"/speech/setup",
				{ method: "POST", headers: authHeaders(config.token) },
				"speech setup",
			);
			if (!response.ok) {
				const body = z
					.object({ error: z.string() })
					.safeParse(await response.json().catch(() => null));
				throw new MediaWorkerHttpError(
					response.status,
					body.success ? body.data.error : "Speech setup failed on media worker",
				);
			}
			return SpeechStatusSchema.parse(await response.json());
		},
		async transcribeSpeech(audio, options) {
			if (!audio.size || audio.size > SPEECH_UPLOAD_BYTES)
				throw new Error("Speech audio exceeds upload limit");
			const form = new FormData();
			form.set("audio", audio, "speech.wav");
			form.set("options", JSON.stringify(SpeechOptionsSchema.parse(options)));
			const response = await request(
				"/speech",
				{ method: "POST", headers: authHeaders(config.token), body: form },
				"speech recognition",
			);
			if (!response.ok)
				throw new MediaWorkerHttpError(
					response.status,
					"Speech recognition failed on media worker",
				);
			return SpeechResultSchema.parse(await response.json());
		},
		async videoReadiness() {
			const response = await request(
				"/health",
				{ headers: authHeaders(config.token) },
				"video readiness",
			);
			if (!response.ok) throw new Error(`media video readiness failed: ${response.status}`);
			return z
				.object({ video: z.record(z.enum(["ready", "unconfigured", "down"])) })
				.parse(await response.json()).video;
		},
		async processingReadiness(kind) {
			const res = await request(
				`/processing/readiness${kind ? "?kind=captions" : ""}`,
				{ headers: authHeaders(config.token) },
				"processing readiness",
			);
			if (!res.ok) throw new Error(`media processing readiness failed: ${res.status}`);
			return ProcessingReadinessSchema.parse(await res.json());
		},
		submitProcessing: (req) => submit("/processing", ProcessingRequestSchema.parse(req)),
		pollProcessing: (id, owner) => processing(id, owner, "GET"),
		cancelProcessing: (id, owner) => processing(id, owner, "DELETE"),
		submitVideo: (req) =>
			submit("/video", {
				image_url: req.imageUrl,
				prompt: req.prompt,
				duration_sec: req.durationSec,
				aspect: req.aspect,
				idempotency_key: req.idempotencyKey,
				...selection(req),
			}),
		submitImage: (req) =>
			submit("/generate", {
				prompt: req.prompt,
				aspect: req.aspect,
				reference_urls: req.referenceUrls,
				intent: req.intent,
				...selection(req),
			}),
		submitTts: (req) =>
			submit("/tts", {
				text: req.text,
				voice: req.voice,
				language: req.language,
				voice_ref_url: req.voiceRefUrl,
				...selection(req),
			}),
		async poll(jobId) {
			const res = await request(
				`/jobs/${encodeURIComponent(jobId)}`,
				{ headers: authHeaders(config.token) },
				"poll",
			);
			if (!res.ok) throw new Error(`media poll failed: ${res.status}`);
			return mapJob(await res.json().catch(() => undefined));
		},
		async download(path) {
			const res = await request(path, { headers: authHeaders(config.token) }, "download");
			if (!res.ok) throw new Error(`media download failed: ${res.status}`);
			const ext = new URL(path, root).pathname.split(".").pop() || "wav";
			return {
				bytes: new Uint8Array(await res.arrayBuffer()),
				ext,
				contentType: res.headers.get("content-type") ?? undefined,
			};
		},
		fileUrl: (path) => `${root}${path}`,
	};
}
