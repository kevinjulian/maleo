/* A generation's identity across retries (adopt-mastra-internal-agent 2.10).
 *
 * A durable runtime re-enters a step after the process running it died, and the
 * step calls its providers again. Each tool call and workflow step runs inside a
 * scope named for it — stable across those re-entries — and each billable
 * generation inside derives its key from the scope and from what it generates.
 * The meter and the image ledger use the key so the retry finds the attempt it
 * already made: one charge, and the same image job polled rather than another
 * submitted.
 *
 * What is generated is part of the key, so generations running in parallel keep
 * their own keys whatever order they start in; identical ones are told apart by
 * their order, where swapping them changes nothing. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

interface Scope {
	id: string;
	seen: Map<string, number>;
}

const current = new AsyncLocalStorage<Scope>();

/** Run `fn` with generations keyed under `id`. */
export function withGenerationScope<T>(id: string, fn: () => Promise<T>): Promise<T> {
	return current.run({ id, seen: new Map() }, fn);
}

/** Whether generations here are keyed, so a re-entered step may resume them. */
export function inGenerationScope(): boolean {
	return current.getStore() !== undefined;
}

/** The key for a generation of `identity` in the current scope; none outside a scope. */
export function generationKey(identity: unknown): string | undefined {
	const scope = current.getStore();
	if (!scope) return undefined;
	const digest = createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24);
	const occurrence = scope.seen.get(digest) ?? 0;
	scope.seen.set(digest, occurrence + 1);
	return `${scope.id}:${digest}:${occurrence}`;
}
