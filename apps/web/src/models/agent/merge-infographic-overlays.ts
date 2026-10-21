/* Folding an agent job's infographic overlays into the ones already on the
 * timeline. Pure, and kept apart from component state so the merge stays
 * unit-testable. */
import type { AgentJobState } from "@models/agent/agent-wire.ts";
import type { InfographicOverlay } from "@maleo/shared";
import { normalizeLayout } from "@models/timeline/clip-layout.ts";

const AUTO_INFOGRAPHIC_ID_MIN = 10_000_000;
const AUTO_INFOGRAPHIC_ID_MAX = 30_000_000;

function isAutoInfographicId(id: number): boolean {
	return id >= AUTO_INFOGRAPHIC_ID_MIN && id < AUTO_INFOGRAPHIC_ID_MAX;
}

export function mergeAgentInfographicOverlays(
	prev: InfographicOverlay[],
	incoming: AgentJobState["infographicOverlays"],
	now = Date.now(),
): InfographicOverlay[] {
	if (incoming === undefined) return prev;
	const next = incoming.map((g, i): InfographicOverlay => {
		const id = g.id ?? now + i;
		return {
			id,
			start: g.startSec,
			dur: g.durationSec,
			track: g.track ?? 0,
			layout: g.layout ? normalizeLayout(g.layout, "text") : undefined,
			animation: g.animation,
			payload: g.payload,
		};
	});
	const incomingIds = new Set(next.map((g) => g.id));
	return [...prev.filter((g) => !isAutoInfographicId(g.id) && !incomingIds.has(g.id)), ...next];
}
