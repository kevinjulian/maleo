/* Bounded concurrency per provider: `traits.maxConcurrency` in-flight calls.
 *
 * The agent's model calls hold a slot for their whole length (runtime/model.ts),
 * so a run's steps cannot outrun the provider's rate limits.
 *
 * Excess requests queue in FIFO order rather than failing: a burst is normal
 * operation, not an error condition. */
export class Semaphore {
	private active = 0;
	private readonly waiting: Array<() => void> = [];

	constructor(private readonly limit: number) {
		if (limit < 1) throw new Error(`semaphore limit must be >= 1, got ${limit}`);
	}

	// Observable for tests: proves excess requests queue instead of spawning.
	get inFlight(): number {
		return this.active;
	}

	get queued(): number {
		return this.waiting.length;
	}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await fn();
		} finally {
			this.release();
		}
	}

	private acquire(): Promise<void> {
		if (this.active < this.limit) {
			this.active += 1;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			this.waiting.push(resolve);
		});
	}

	// Hand the slot straight to the next waiter rather than decrementing, so a
	// release can never be lost between the two operations.
	private release(): void {
		const next = this.waiting.shift();
		if (next) {
			next();
			return;
		}
		this.active -= 1;
	}
}

const semaphores = new Map<string, Semaphore>();

// One semaphore per provider id, created on first use from that provider's
// declared maximum. Keyed by id so two providers never contend for one budget.
export function semaphoreFor(providerId: string, limit: number): Semaphore {
	const existing = semaphores.get(providerId);
	if (existing) return existing;
	const created = new Semaphore(limit);
	semaphores.set(providerId, created);
	return created;
}
