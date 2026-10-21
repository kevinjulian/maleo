// Retry with exponential backoff + jitter for transient network failures.
// Used by every external call in the prep pipeline (image fetch, image service,
// TTS, transcription) so a single flaky 5xx/timeout no longer kills a whole job.
//
// A call is retried only when the error is classified transient. Permanent
// errors (4xx other than 408/429, validation) throw immediately — retrying them
// just wastes wall-clock.

export interface RetryOptions {
	/** Max attempts including the first. Default 3. */
	attempts?: number;
	/** Base delay in ms for the first backoff. Default 500. */
	baseDelayMs?: number;
	/** Cap on any single backoff delay. Default 8000. */
	maxDelayMs?: number;
	/** Decide whether an error is worth retrying. Default: transient classifier. */
	isRetryable?: (err: unknown) => boolean;
	/** Label for log lines. */
	label?: string;
	/** Injectable sleep (tests). */
	sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Treat network errors, timeouts, and retryable HTTP statuses as transient.
export function isTransientError(err: unknown): boolean {
	if (err instanceof HttpError)
		return err.status === 408 || err.status === 429 || err.status >= 500;
	const msg = err instanceof Error ? err.message : String(err);
	return /\b(ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|timeout|socket hang up)\b/i.test(
		msg,
	);
}

// Carries an HTTP status so isTransientError can classify it. Throw this from
// fetch wrappers instead of a bare Error to get correct retry behavior.
export class HttpError extends Error {
	readonly status: number;
	readonly body: string;
	constructor(status: number, body: string, label?: string) {
		super(`${label ? `${label} ` : ""}HTTP ${status}: ${body.slice(0, 200)}`);
		this.name = "HttpError";
		this.status = status;
		this.body = body;
	}
}

// Backoff delay for attempt n (0-indexed): base * 2^n, capped, +/- 25% jitter.
export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
	const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
	const jitter = exp * 0.25 * (Math.random() * 2 - 1);
	return Math.max(0, Math.round(exp + jitter));
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
	const attempts = opts.attempts ?? 3;
	const baseDelayMs = opts.baseDelayMs ?? 500;
	const maxDelayMs = opts.maxDelayMs ?? 8000;
	const isRetryable = opts.isRetryable ?? isTransientError;
	const sleep = opts.sleep ?? defaultSleep;

	let lastErr: unknown;
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
			const last = attempt === attempts - 1;
			if (last || !isRetryable(err)) throw err;
			const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs);
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(
				`[retry]${opts.label ? ` ${opts.label}` : ""} attempt ${attempt + 1}/${attempts} failed (${msg.slice(0, 120)}); retrying in ${delay}ms`,
			);
			await sleep(delay);
		}
	}
	throw lastErr;
}

// fetch wrapper that throws HttpError on non-2xx (so retry classification works)
// and retries transient failures. Returns the Response on success.
export async function fetchWithRetry(
	url: string,
	init?: RequestInit,
	opts: RetryOptions = {},
): Promise<Response> {
	return withRetry(async () => {
		const res = await fetch(url, init);
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new HttpError(res.status, body, opts.label);
		}
		return res;
	}, opts);
}
