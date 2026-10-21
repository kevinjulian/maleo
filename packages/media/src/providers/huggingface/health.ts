/* Health is a value, never an exception, and never a billed request.
 *
 * It answers for credentials only. Whether the configured model is currently
 * served is deliberately NOT a health state: checking it costs a Hub round-trip
 * on every picker render, and a cold model is actionable as a generation error
 * that names it, where "provider down" is not. */
import { readToken } from "./models.ts";

export type HuggingFaceHealth = "ready" | "unconfigured" | "down";

export function huggingFaceImageHealth(): HuggingFaceHealth {
	return readToken() ? "ready" : "unconfigured";
}
