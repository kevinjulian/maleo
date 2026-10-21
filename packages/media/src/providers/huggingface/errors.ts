/* Upstream failures are raised, never slept on (design.md D8).
 *
 * One HF failure is different in kind from the rest: exhausted monthly credits.
 * A free account gets $0.10 of credits, which is roughly thirty images, so this
 * is a state a real deployment reaches — and retrying it cannot succeed. A
 * durable retry policy that treats it as transient will spend its whole budget
 * rediscovering the same wall, so it is discriminated here.
 *
 * The message text below was observed, not inferred (tasks.md 1.5). Matching on
 * text as well as status is still deliberate: the observed failure arrived
 * through the SDK's error wrapper, and the status it carried was not the 402
 * the documentation implies. */

/* Task 1.5 OBSERVED the real message, and it defeated the first draft of this
 * list. Routing to a paid serving provider with the allowance spent returns:
 *
 *   "You have depleted your monthly included credits. Purchase pre-paid
 *    credits to continue using Inference Providers. Alternatively, ..."
 *
 * The guessed patterns were `exceeded your monthly included credits` and
 * `monthly credits` — neither matches "depleted", and the second is broken by
 * the word "included" sitting inside the phrase. So the classifier is now
 * anchored on the words that actually vary least: the verb is matched as an
 * alternation, and "included credits" carries no assumption about what precedes
 * it. */
const CREDIT_PATTERNS = [
	/(depleted|exceeded|exhausted)[^.]*credits/i,
	/included credits/i,
	/pre-?paid credits/i,
	/payment required/i,
	/insufficient credits/i,
	/quota exceeded/i,
];

export class HuggingFaceRequestError extends Error {
	readonly status: number | undefined;
	readonly retryable: boolean;
	readonly exhaustedCredits: boolean;

	constructor(message: string, status: number | undefined, exhaustedCredits: boolean) {
		super(message);
		this.name = "HuggingFaceRequestError";
		this.status = status;
		this.exhaustedCredits = exhaustedCredits;
		// Credits do not come back on a retry, so it is not retryable however the
		// status reads.
		this.retryable = !exhaustedCredits && (status === undefined || status === 429 || status >= 500);
	}
}

interface HttpErrorShape {
	httpResponse?: { status?: number; body?: unknown };
}

/** The upstream status, if the thrown value carries one. */
export function statusOf(error: unknown): number | undefined {
	// SAFETY: `error` is a caught value of genuinely unknown type. Every field of
	// `HttpErrorShape` is optional, the access is optional-chained, and the result
	// is narrowed by `typeof === "number"` on the next line — so an error carrying
	// no `httpResponse` (or one of another shape) yields `undefined`.
	const response = (error as HttpErrorShape | null)?.httpResponse;
	return typeof response?.status === "number" ? response.status : undefined;
}

export function isCreditExhaustion(status: number | undefined, message: string): boolean {
	if (status === 402) return true;
	return CREDIT_PATTERNS.some((pattern) => pattern.test(message));
}

export function describeFailure(error: unknown): HuggingFaceRequestError {
	const message = error instanceof Error ? error.message : String(error);
	const status = statusOf(error);
	const exhausted = isCreditExhaustion(status, message);
	const prefix = exhausted
		? "Hugging Face monthly credits are exhausted; add credits or select another image provider"
		: "Hugging Face image generation failed";
	return new HuggingFaceRequestError(
		`${prefix}${status === undefined ? "" : ` (${status})`}: ${message}`,
		status,
		exhausted,
	);
}
