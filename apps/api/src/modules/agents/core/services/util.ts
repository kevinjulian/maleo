/* Pure coercion + fingerprint helpers shared by the orchestrator and the flow
 * services. No orchestrator/state imports — safe for any service to use. */

export function num(v: unknown, fallback: number): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

export function str(v: unknown, fallback = ""): string {
	return typeof v === "string" ? v : fallback;
}

export function arr<T>(value: unknown): T[] {
	// SAFETY: the element type is the caller's claim, not checked here. Every caller
	// reads a pipeline checkpoint (`rehydrate.ts`) that `agent-trace.ts` wrote from
	// the same `AgentJob` fields.
	return Array.isArray(value) ? (value as T[]) : [];
}

export function obj(value: unknown): Record<string, unknown> | null {
	// SAFETY: checked to be a non-null object; it is only read by key.
	return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

// Stable fingerprint of the brief a research pass covers — lets a re-run detect a
// CHANGED brief and avoid reusing stale research.
export function fingerprintBrief(brief: string): string {
	return (brief || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 240);
}
