/* Per-category retry policy (Codex #8). One knob per failure class instead of a
 * single global `retries: 3`:
 *
 *   decide   — the codex decision call; flaky but READ-ONLY, so a bounded retry
 *              is safe and avoids aborting a whole run on one transient hiccup.
 *   read     — web search / page fetch; idempotent, safe to retry on a transient.
 *   plan     — planning calls; retry a little, then fail VISIBLE (surfaced to the
 *              user) rather than silently looping.
 *   generate — image / TTS asset generation; owns its own backoff via
 *              visual-gen `withRetry` (kept there so the media path is one place).
 *   persist  — DB writes; not retried here (best-effort + logged in run-repository,
 *              fail-soft so the loop continues on the in-memory job).
 *
 * Mutating tools (add_scene, update_*) are deliberately NOT retried — re-running a
 * non-idempotent mutation is unsafe; the model adapts on the next step instead. */

export type RetryCategory = "decide" | "read" | "plan" | "generate";

interface Policy {
	attempts: number;
	baseMs: number;
}

const POLICIES = {
	decide: { attempts: 2, baseMs: 400 },
	read: { attempts: 2, baseMs: 500 },
	plan: { attempts: 2, baseMs: 500 },
	generate: { attempts: 3, baseMs: 1000 },
} satisfies Record<RetryCategory, Policy>;

// Run `fn` under the category's retry policy: linear backoff between tries, throw
// the last error after the final attempt. Only wrap idempotent/read-only work —
// see the module note. `sleep` is injectable so tests don't wait.
export async function withCategoryRetry<T>(
	category: RetryCategory,
	fn: () => Promise<T>,
	sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
	const policy = POLICIES[category];
	let lastErr: unknown;
	for (let i = 0; i < policy.attempts; i++) {
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
			if (i < policy.attempts - 1) await sleep(policy.baseMs * (i + 1));
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
