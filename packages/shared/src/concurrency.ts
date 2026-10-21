/* Bounded-concurrency map — a single worker-pool primitive shared by every
 * fan-out producer (blueprint frames, story section assets, the durable media
 * worker) so the concurrency semantics live in one tested place instead of being
 * hand-rolled per call site.
 *
 * Semantics:
 * - Results are returned in INPUT order regardless of completion order.
 * - At most `limit` invocations of `fn` are in flight at once (clamped to
 *   [1, items.length]); an empty input resolves to `[]`.
 * - `fn` owns its own error handling. A rejection from `fn` rejects the whole
 *   map (fail-fast); callers that want partial success must catch inside `fn`.
 */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const total = items.length;
	if (total === 0) return [];
	const results: R[] = Array.from({ length: total });
	const concurrency = Math.max(1, Math.min(Math.floor(limit) || 1, total));
	let next = 0;
	const worker = async (): Promise<void> => {
		// `next++` is synchronous between awaits, so no two workers ever claim the
		// same index (single-threaded event loop — no lock needed).
		while (next < total) {
			const i = next++;
			results[i] = await fn(items[i]!, i);
		}
	};
	await Promise.all(Array.from({ length: concurrency }, worker));
	return results;
}
