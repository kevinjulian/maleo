/* The two derivations the timeline's render cost turns on.
 *
 * Both were the same defect in different clothes. Lane membership was a filter
 * of the whole clip array run once PER LANE, and a clip's backing overlay was
 * found by a linear scan run once PER CLIP, from four separate call sites. At
 * ten clips neither is visible; the cost curve is what makes a large project
 * feel unlike a small one.
 *
 * They live here rather than inline in the component so the shape can be
 * asserted rather than reviewed. A `useMemo` whose body quietly grows a nested
 * loop looks exactly like one that does not.
 */

/** Anything with a lane. The timeline's clip, narrowed to what this reads. */
export interface LanePlaced {
	readonly track: number;
}

/**
 * Group clips by lane in ONE pass.
 *
 * Not `lanes.map((lane) => clips.filter(...))`: that is a pass per lane, which
 * is `lanes × clips` and looks identical at the call site.
 */
export function groupByLane<T extends LanePlaced>(clips: readonly T[]): Map<number, T[]> {
	const byLane = new Map<number, T[]>();
	for (const clip of clips) {
		const lane = byLane.get(clip.track);
		if (lane) lane.push(clip);
		else byLane.set(clip.track, [clip]);
	}
	return byLane;
}

/** Anything addressable by a numeric id. */
export interface Identified {
	readonly id: number;
}

/**
 * Index records by id, so a clip's backing record is a lookup rather than a scan.
 *
 * Built once per change of the source array and read by key. The alternative —
 * `overlays.find((o) => o.id === clip.refId)` at the draw site — is a scan per
 * clip drawn, per render, and there were four of them.
 */
export function indexById<T extends Identified>(records: readonly T[]): Map<number, T> {
	return new Map(records.map((record) => [record.id, record]));
}
