// Structured render-failure codes. The worker stores a free-form message AND a
// machine-readable code so the dashboard can show a clear cause and decide
// whether a retry is worth offering (transient vs permanent).

export type RenderErrorCode =
	| "VALIDATION_ERROR" // storyboard/product JSON failed schema parse — permanent
	| "BUNDLE_FAILED" // Remotion bundle step threw — usually transient (deps/IO)
	| "RENDER_FAILED" // renderMedia threw — often transient
	| "IMAGE_GEN_TIMEOUT" // image service unreachable / timed out
	| "TTS_PROVIDER_DOWN" // TTS provider unreachable
	| "WORKER_CRASHED" // lease expired, worker presumed dead — transient
	| "CANCELLED" // operator cancelled
	| "UNKNOWN";

export interface ClassifiedError {
	code: RenderErrorCode;
	/** Short, user-facing sentence. */
	message: string;
	/** Whether retrying could plausibly succeed without a config/content change. */
	retryable: boolean;
}

const RULES: ReadonlyArray<{
	code: RenderErrorCode;
	test: RegExp;
	retryable: boolean;
	message: string;
}> = [
	{
		code: "VALIDATION_ERROR",
		test: /invalid|parse|schema|zod|required|expected/i,
		retryable: false,
		message: "Storyboard data is invalid.",
	},
	{
		code: "IMAGE_GEN_TIMEOUT",
		test: /image.*(timeout|unreachable|503|econn|fetch failed)|generate.*fail/i,
		retryable: true,
		message: "Image service was unreachable or timed out.",
	},
	{
		code: "TTS_PROVIDER_DOWN",
		test: /tts|kokoro|elevenlabs|voiceover.*(fail|unreachable)/i,
		retryable: true,
		message: "Text-to-speech provider was unreachable.",
	},
	{
		code: "BUNDLE_FAILED",
		test: /bundle|webpack|esbuild|compile/i,
		retryable: true,
		message: "Render bundle failed to build.",
	},
	{
		code: "WORKER_CRASHED",
		test: /lease expired|presumed crashed|worker/i,
		retryable: true,
		message: "Render worker stopped unexpectedly.",
	},
	{ code: "CANCELLED", test: /cancel/i, retryable: true, message: "Render was cancelled." },
	{
		code: "RENDER_FAILED",
		test: /render|remotion|composition|ffmpeg|frame/i,
		retryable: true,
		message: "Rendering failed.",
	},
];

// Classify a raw error message into a structured code. Order matters: the most
// specific patterns are checked first, falling back to RENDER_FAILED/UNKNOWN.
export function classifyRenderError(raw: string): ClassifiedError {
	const msg = (raw ?? "").trim();
	for (const rule of RULES) {
		if (rule.test.test(msg)) {
			return { code: rule.code, message: rule.message, retryable: rule.retryable };
		}
	}
	return { code: "UNKNOWN", message: "Render failed for an unknown reason.", retryable: true };
}
