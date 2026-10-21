/* Upstream failures are raised, never slept on (design.md D8).
 *
 * `generation-run` owns durable retry. An in-provider sleep burns wall-clock
 * inside an Inngest step and competes with the retry policy that is already
 * backing the same work off, so the provider's job is to fail promptly and
 * preserve enough of the upstream response for that policy to act on. */

export class CloudflareRequestError extends Error {
	readonly status: number;
	readonly retryable: boolean;

	constructor(status: number, detail: string) {
		super(`Cloudflare Workers AI request failed (${status}): ${detail}`);
		this.name = "CloudflareRequestError";
		this.status = status;
		// 429 and 5xx can succeed later; 4xx otherwise cannot, and retrying a bad
		// request only spends the daily neuron allowance.
		this.retryable = status === 429 || status >= 500;
	}
}

interface CloudflareErrorBody {
	errors?: { code?: number; message?: string }[];
}

export function describeFailure(status: number, body: unknown): CloudflareRequestError {
	// SAFETY: `body` is an already-failed response parsed with a `.catch(() => null)`,
	// so it is genuinely unknown. Every field of `CloudflareErrorBody` is optional
	// and the result is guarded by `Array.isArray` before use, so a body of any
	// other shape degrades to "no error detail returned" rather than throwing.
	const errors = (body as CloudflareErrorBody | null)?.errors;
	const detail =
		Array.isArray(errors) && errors.length > 0
			? errors
					.map((e) => (e.code ? `${e.code} ${e.message ?? ""}`.trim() : (e.message ?? "")))
					.join("; ")
			: "no error detail returned";
	return new CloudflareRequestError(status, detail);
}
