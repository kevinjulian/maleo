/* Health is a value, never an exception, and never a billed request.
 *
 * `provider-conformance` requires `health()` to report absence rather than
 * throw, because every CI runner is a machine with no credentials. It also must
 * not generate: a readiness probe that costs a neuron is a probe nobody can
 * afford to call from a picker. */
import { readCredentials } from "./credentials.ts";
import { configuredImageModel } from "./models.ts";

export type CloudflareHealth = "ready" | "unconfigured" | "down";

export function cloudflareImageHealth(): CloudflareHealth {
	if (!readCredentials()) return "unconfigured";
	try {
		// A model id this package cannot describe is a misconfiguration, not an
		// outage — but it does mean generation cannot run, so it is not "ready".
		configuredImageModel();
	} catch {
		return "unconfigured";
	}
	return "ready";
}
