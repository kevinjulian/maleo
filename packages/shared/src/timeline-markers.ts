/* First-class scene markers (D3): load, merge, and persist semantic scene groupings.
 *
 * A `SceneMarker` groups the clips of one story beat. Its time range (`startSec`/
 * `endSec`) and `clipIds` are DERIVED from the clips it groups — annotation only, so
 * moving/retiming clips updates the range but the marker never retimes its clips.
 * Its metadata (`title`, `beat`, `voiceoverText`) is authoritative: loaded from the
 * persisted storyboard, edited via MarkerCommand, and carried across the array→doc
 * rebuild by `mergeMarkerMetadata` so it survives every timeline edit.
 *
 * A marker is NOT a chapter. It is one per scene and the vui ruler renders every
 * one of them; chapters are their own record (`Chapter` in timeline-doc.ts).
 */
import type { SceneMarker } from "./timeline-doc.ts";

/** Parse persisted `markers[]` (schemaVersion-2 storyboard) defensively. */
export function parseMarkers(raw: unknown): SceneMarker[] {
	if (!Array.isArray(raw)) return [];
	const out: SceneMarker[] = [];
	for (const m of raw) {
		if (!m || typeof m !== "object") continue;
		const o = m as Record<string, unknown>;
		if (typeof o.id !== "number") continue;
		out.push({
			id: o.id,
			title: typeof o.title === "string" ? o.title : `Scene ${o.id}`,
			clipIds: Array.isArray(o.clipIds)
				? o.clipIds.filter((x): x is string => typeof x === "string")
				: [],
			startSec: typeof o.startSec === "number" ? o.startSec : 0,
			endSec: typeof o.endSec === "number" ? o.endSec : 0,
			beat: typeof o.beat === "string" ? o.beat : undefined,
			voiceoverText: typeof o.voiceoverText === "string" ? o.voiceoverText : undefined,
			...(typeof o.storyBeatId === "string" && o.storyBeatId ? { storyBeatId: o.storyBeatId } : {}),
			...(typeof o.sourceRevisionId === "string" && o.sourceRevisionId
				? { sourceRevisionId: o.sourceRevisionId }
				: {}),
		});
	}
	return out;
}

/** Overlay persisted marker metadata onto the freshly-derived (scene-shaped) markers.
 *  Derived markers own `clipIds`/`startSec`/`endSec` (range follows the clips);
 *  persisted markers contribute `title`/`beat`/`voiceoverText` where they match
 *  by id. */
export function mergeMarkerMetadata(
	derived: SceneMarker[],
	persisted: SceneMarker[],
): SceneMarker[] {
	if (!persisted.length) return derived;
	const byId = new Map(persisted.map((m) => [m.id, m]));
	return derived.map((m) => {
		const prior = byId.get(m.id);
		if (!prior) return m;
		const storyBeatId = prior.storyBeatId ?? m.storyBeatId;
		const sourceRevisionId = prior.sourceRevisionId ?? m.sourceRevisionId;
		return {
			...m,
			title: prior.title,
			beat: prior.beat,
			voiceoverText: prior.voiceoverText,
			...(storyBeatId ? { storyBeatId } : {}),
			...(sourceRevisionId ? { sourceRevisionId } : {}),
		};
	});
}
