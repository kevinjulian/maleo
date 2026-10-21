/* Render jobs: their shape, their status vocabulary, and what a given status
 * lets an operator do about it.
 *
 * The retry rules are the part worth having outside a component. A plain retry
 * cannot help a validation failure — the storyboard has to change first — and
 * a degraded render splits two ways: silent audio re-runs TTS against
 * content-hash-cached images, while placeholder art has to re-run image
 * generation. Labelling both "Retry" would promise the wrong work.
 */

export type JobStatus =
	| "queued"
	| "running"
	| "done"
	| "done_with_fallback"
	| "error"
	| "cancelled";

export type Job = {
	id: string;
	project_id?: string | null;
	project_title?: string;
	output_url?: string | null;
	thumbnail_url?: string | null;
	duration_sec?: number | null;
	preset: string;
	status: JobStatus;
	phase?: string | null;
	phase_detail?: string | null;
	output_path: string | null;
	error: string | null;
	error_code?: string | null;
	progress: number;
	created_at: number;
	finished_at: number | null;
};

// Human phase labels (mirror RenderProgress).
const PHASE_LABELS = {
	queued: "Queued",
	validating: "Validating",
	preparing_images: "Preparing images",
	synthesizing_audio: "Synthesizing voiceover",
	bundling: "Bundling",
	rendering: "Rendering",
	finalizing: "Finalizing",
} satisfies Record<string, string>;

/* Status vocab (mirrors the Campaigns standard). */
/* `as const` so the values stay literals rather than widening to `string`. The
 * chip that renders them takes a checked tone, and a widened `string` would put
 * the one thing this table exists to constrain back out of reach of the type
 * checker. `satisfies` still holds every status to a tone. */
export const STATUS_TONE = {
	done: "ok",
	done_with_fallback: "warn",
	running: "info",
	queued: "",
	error: "err",
	cancelled: "",
} as const satisfies Record<JobStatus, string>;

// Friendly copy per structured error code (mirrors video lib/error-codes.ts).
const ERROR_CODE_MSG = {
	VALIDATION_ERROR: "Storyboard data is invalid — editing is needed before retrying.",
	IMAGE_GEN_TIMEOUT: "Image service was unreachable or timed out.",
	TTS_PROVIDER_DOWN: "Text-to-speech provider was unreachable.",
	BUNDLE_FAILED: "Render bundle failed to build.",
	WORKER_CRASHED: "Render worker stopped unexpectedly.",
	CANCELLED: "Render was cancelled.",
	RENDER_FAILED: "Rendering failed.",
	UNKNOWN: "Render failed.",
} satisfies Record<string, string>;

// Codes where a plain retry can't help without a content/config change.
const NON_RETRYABLE = new Set(["VALIDATION_ERROR"]);

/* The copy for a phase or error code the server sent, or null when it named one
 * this build has no wording for. The tables keep their literal types — the
 * widening happens here, at the one boundary where the key really is a string
 * off the wire rather than something this module chose. */
function copyFor(table: Record<string, string>, key: string | null | undefined): string | null {
	return key == null ? null : (table[key] ?? null);
}

export function isJobActive(job: Pick<Job, "status">): boolean {
	return job.status === "queued" || job.status === "running";
}

export interface JobAffordances {
	active: boolean;
	ready: boolean;
	failed: boolean;
	canRetry: boolean;
	/** A degraded render whose only fault was silent audio: TTS alone re-runs. */
	audioOnly: boolean;
	phaseLabel: string | null;
	codeMsg: string | null;
}

export function jobAffordances(job: Job): JobAffordances {
	const failed = job.status === "error" || job.status === "cancelled";
	return {
		active: isJobActive(job),
		ready: job.status === "done" || job.status === "done_with_fallback",
		failed,
		canRetry: failed && !(job.error_code != null && NON_RETRYABLE.has(job.error_code)),
		audioOnly: job.status === "done_with_fallback" && (job.phase_detail ?? "").includes("silent"),
		phaseLabel: copyFor(PHASE_LABELS, job.phase),
		codeMsg: copyFor(ERROR_CODE_MSG, job.error_code),
	};
}

export type ExportConnection = "idle" | "checking" | "connected" | "disconnected" | "missing";
export interface ExportDiscovery {
	active: Job | null;
	latest: Job | null;
}
export function exportOutputAvailable(job: {
	status: JobStatus;
	output_url?: string | null;
	output_path?: string | null;
}): boolean {
	return (
		(job.status === "done" || job.status === "done_with_fallback") &&
		Boolean(job.output_url || job.output_path)
	);
}
