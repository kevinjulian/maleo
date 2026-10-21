/* Image generation adapter — the single submit + poll + URL-normalize kernel for
 * the maleo-image service. Previously this loop was triplicated across
 * agent-orchestrator (generateSceneFrame, generatePromptImage) and the
 * /api/image-gen route; they now all funnel through here.
 *
 * The image backend is async-job: POST /generate returns a job_id, GET /jobs/:id
 * is polled until status is done|error. Generated image urls are rewritten to the
 * dashboard proxy path (/api/image-gen/files/*) so callers never see the upstream
 * host or its auth. */
import { getImageGenBaseUrl, getImagePublicBaseUrl, getMediaClient } from "../image-gen-client.ts";
import type { ImagePromptIntent } from "@maleo/shared";
import { getGlobalImageProvider } from "@maleo/db/global-settings";
import {
	attachJobId,
	completeByJobId,
	failByJobId,
	findLiveByGenerationKey,
	openGeneration,
	resolveCompleted,
	resolveFailed,
	type ImageSource,
} from "@maleo/db/image-ledger";
import { findByJobId } from "@maleo/db/image-ledger";
import { mediaObjectUrl, registerMediaObject } from "@maleo/db/media-objects";

const PROXY_PREFIX = "/api/image-gen";
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 80;

export interface ImageReference {
	url: string;
	role: string;
	entityId?: string;
	label?: string;
	description?: string;
	primary?: boolean;
	referenceUse?: ImagePromptIntent["references"][number]["referenceUse"];
}

export interface ImageSubmitInput {
	prompt: string;
	aspect?: string;
	referenceImageUrls?: ImageReference[];
	intent?: ImagePromptIntent;
}

/* Who is generating, and for what. REQUIRED on both entry points, deliberately:
 * an optional field is what let three of the four producers reach the image service
 * supplying nothing, which made them simultaneously unmetered and unrecorded. A
 * missing context is now a type error rather than a silent skip. */
export interface GenerationContext {
	workspace: string;
	/** Omit for lab and workspace-scoped reference images — means "no project". */
	projectId?: string | null;
	source: ImageSource;
	/** The generation's identity across retries (generation-scope.ts). */
	generationKey?: string;
}

/* A submit that produced no job. Thrown rather than returned, because the caller
 * is `meter()` and runBillableOperation captures usage on any FULFILLED run — so
 * returning a job-less result normally is a billed non-generation. It carries the
 * upstream status and body so the route can still forward them verbatim, which is
 * the proxy contract it has always had. */
export class ImageSubmitFailedError extends Error {
	readonly status: number;
	readonly raw: Record<string, unknown>;
	constructor(status: number, raw: Record<string, unknown>) {
		super(typeof raw.error === "string" ? raw.error : `image submit failed (${status})`);
		this.name = "ImageSubmitFailedError";
		this.status = status;
		this.raw = raw;
	}
}

export interface ImageJobStatus {
	status: string;
	/** Dashboard proxy url for <img src> — rewritten from the upstream path. */
	imageUrl?: string | null;
	/** Canonical stored path (just the /files/... segment). */
	imagePath?: string | null;
	/** Absolute public url for off-dashboard consumers (platforms). */
	imageUrlPublic?: string | null;
	fromCache?: boolean;
	error?: string | null;
	/** Untouched upstream fields, for callers that need more than the normalized shape. */
	raw: Record<string, unknown>;
}

function imageBaseOrThrow(): string {
	const base = getImageGenBaseUrl();
	if (!base) throw new Error("image service not configured");
	return base.replace(/\/+$/, "");
}

/** Rewrite an upstream image url to the dashboard proxy path + public url. */
/** One generated image URL in the three forms callers need: through the API
 *  proxy, as the bare provider path, and as the publicly reachable address. */
export interface NormalizedImageUrl {
	proxy: string;
	path: string;
	public: string;
}

export function normalizeImageUrl(rawUrl: string, base: string): NormalizedImageUrl {
	if (rawUrl.startsWith("/api/media/")) return { proxy: rawUrl, path: rawUrl, public: rawUrl };
	const m = rawUrl.match(/\/files\/[^?#]+/);
	const path = m ? m[0] : rawUrl;
	const publicBase = getImagePublicBaseUrl(base).replace(/\/+$/, "");
	return { proxy: `${PROXY_PREFIX}${path}`, path, public: `${publicBase}${path}` };
}

/** Submit a generation job. Returns the upstream response (carrying job_id) plus
 *  the HTTP status so proxy callers can forward it verbatim, and the ledger row id
 *  so a caller polling inline can resolve without a job id.
 *
 *  The ledger row is opened BEFORE the submit, not after it completes. That
 *  ordering is the whole point: attribution is durable from the first moment, so a
 *  restart between submit and completion cannot lose it, and a failed ledger write
 *  surfaces before any spend. */
export async function submitImageJob(
	input: ImageSubmitInput,
	context: GenerationContext,
): Promise<{ job_id?: string; status: number; raw: Record<string, unknown>; ledgerId: string }> {
	const ledgerId = await openGeneration({
		workspace: context.workspace,
		projectId: context.projectId ?? null,
		source: context.source,
		prompt: input.prompt,
		aspect: input.aspect ?? null,
		generationKey: context.generationKey,
	});

	const finish = async (
		jobId: string | undefined,
		status: number,
		raw: Record<string, unknown>,
	) => {
		// A submit that yields no job id, or that upstream rejected, is a dead
		// attempt: nothing will ever poll it. Resolve the row failed and THROW —
		// returning normally would let meter() capture credits for a generation that
		// never started.
		if (!jobId || status >= 300) {
			await resolveFailed(ledgerId);
			// A 2xx carrying no job id is a bad upstream response, not an acceptance —
			// forwarding its 202 would tell the client the generation was queued when
			// nothing was. Only a real upstream error status is passed through.
			throw new ImageSubmitFailedError(status >= 300 ? status : 502, raw);
		}
		await attachJobId(ledgerId, jobId);
		return { job_id: jobId, status, raw, ledgerId };
	};

	try {
		const media = getMediaClient();
		if (!media) throw new Error("media worker not configured");
		const jobId = await media.submitImage({
			prompt: input.prompt,
			aspect: input.aspect,
			referenceUrls: (input.referenceImageUrls ?? []).map((r) => r.url).filter(Boolean),
			intent: input.intent,
			providerId: await getGlobalImageProvider(),
			providerSource: (await getGlobalImageProvider()) ? "workspace" : undefined,
			workspaceId: context.workspace,
			projectId: context.projectId ?? undefined,
		});
		return finish(jobId, 202, { job_id: jobId, status: "queued" });
	} catch (err) {
		await resolveFailed(ledgerId);
		throw err;
	}
}

/* Resolve a route-submitted attempt. The route polls by job id and holds no row id;
 * these read the association back from SQLite, which is what replaces the in-memory
 * jobWorkspaceMap that a restart used to discard. Both are idempotent. */
export async function recordJobCompleted(jobId: string, imageUrl: string): Promise<boolean> {
	return await completeByJobId(jobId, imageUrl);
}

export async function recordJobFailed(jobId: string): Promise<boolean> {
	return await failByJobId(jobId);
}

/** Attach the proxy-rewritten urls to a normalized status, if there is one. */
function withProxiedUrl(
	out: ImageJobStatus,
	upstreamUrl: string | null,
	root: string,
): ImageJobStatus {
	if (!upstreamUrl) return out;
	const norm = normalizeImageUrl(upstreamUrl, root);
	return { ...out, imageUrl: norm.proxy, imagePath: norm.path, imageUrlPublic: norm.public };
}

/** Poll one job tick and return the normalized status (urls rewritten to proxy).
 *
 *  The two sources are read separately because only one of them is untyped. The
 *  media client answers with a `MediaJob`, whose fields are declared; routing it
 *  through a dictionary to re-read `status` and `imageUrl` with `typeof` guards
 *  discarded a type we already had. The direct HTTP path has no such contract —
 *  it is an upstream body — so it keeps the defensive read. */
export async function pollImageJob(jobId: string): Promise<ImageJobStatus> {
	const media = getMediaClient();
	if (!media) throw new Error("media worker not configured");
	const job = await media.poll(jobId);
	let managedUrl: string | null = null;
	if (job.status === "done" && job.stored) {
		const ledger = await findByJobId(jobId);
		if (!ledger) throw new Error(`generated media has no owning job: ${jobId}`);
		const row = await registerMediaObject({
			workspace: ledger.workspace,
			kind: "image",
			hash: job.stored.hash,
			storage_key: job.stored.key,
			content_type: job.stored.contentType,
			size: job.stored.size,
		});
		managedUrl = mediaObjectUrl(row.id);
	}
	return withProxiedUrl(
		{
			status: job.status,
			fromCache: job.fromCache,
			error: job.error,
			raw: { ...job },
		},
		managedUrl ?? job.imageUrl,
		managedUrl ? "" : imageBaseOrThrow(),
	);
}

/* A keyed generation that already has a job — submitted by an attempt whose
 * process died while it waited — is polled again rather than submitted again. A
 * row opened but never submitted gives its key up; the retry submits. */
async function resumeOrSubmit(
	input: ImageSubmitInput,
	context: GenerationContext,
): Promise<{ job_id?: string; ledgerId: string }> {
	const prior = context.generationKey ? await findLiveByGenerationKey(context.generationKey) : null;
	if (prior?.job_id) return { job_id: prior.job_id, ledgerId: prior.id };
	if (prior) await resolveFailed(prior.id);
	return await submitImageJob(input, context);
}

/** Submit + poll to completion server-side. Returns the dashboard-proxied image
 *  url. Throws on error or timeout — the same contract the inline callers had. */
export async function runImageJob(
	input: ImageSubmitInput,
	context: GenerationContext,
	opts: { pollIntervalMs?: number; maxAttempts?: number } = {},
): Promise<string> {
	const { job_id, ledgerId } = await resumeOrSubmit(input, context);
	if (!job_id) throw new Error("image service returned no job_id");
	const interval = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
	const attempts = opts.maxAttempts ?? POLL_MAX_ATTEMPTS;
	// This path polls inline and holds the row id, so it resolves directly rather
	// than looking the attempt back up by job id.
	for (let i = 0; i < attempts; i++) {
		await new Promise((r) => setTimeout(r, interval));
		const job = await pollImageJob(job_id);
		if (job.status === "done" && job.imageUrl) {
			await resolveCompleted(ledgerId, job.imageUrlPublic ?? job.imageUrl);
			return job.imageUrl;
		}
		if (job.status === "error" || job.status === "failed") {
			await resolveFailed(ledgerId);
			throw new Error(job.error || "image generation failed");
		}
	}
	await resolveFailed(ledgerId);
	throw new Error("image generation timed out");
}
