/* Token accounting shared by adapters.
 *
 * CLI runners report no token counts, so their usage is estimated from
 * character length at the long-standing 4-chars-per-token approximation. The
 * estimate is flagged as such: metering needs to tell a measured count from a
 * guess, because pricing a guess as if it were measured is how a bill drifts
 * from reality without anything looking wrong. */
import type { TokenUsage } from "./types.ts";

const CHARS_PER_TOKEN = 4;

export function estimateTokens(prompt: string, output: string): TokenUsage {
	return {
		inputTokens: Math.ceil(prompt.length / CHARS_PER_TOKEN),
		outputTokens: Math.ceil(output.length / CHARS_PER_TOKEN),
		estimated: true,
	};
}
