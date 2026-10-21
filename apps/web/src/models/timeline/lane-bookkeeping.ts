/* Lane bookkeeping under declared groups.
 *
 * Three behaviours in the timeline assumed lanes were interchangeable, and all
 * three are now wrong in the same way: the row below a lane is a DIFFERENT KIND
 * of lane, an empty lane is the feature rather than a gap, and an arbitrary
 * order would put an audio lane between two visual ones.
 *
 * Pure, so the rules can be tested without a timeline. The hook that owns the
 * writes calls these and applies the answers.
 */
import { LANE_GROUP_ORDER, type LaneGroup, type TrackFlags } from "@maleo/shared";

/** The declared group of each free lane, indexed by row. `undefined` for a lane
 *  that has none — an untyped row a migration has not reached. */
export function laneGroups(trackFlags: TrackFlags, rowCount: number): Array<LaneGroup | undefined> {
	return Array.from({ length: Math.max(0, rowCount) }, (_, row) => trackFlags[row]?.group);
}

const orderOf = (group: LaneGroup | undefined): number => {
	const i = group ? LANE_GROUP_ORDER.indexOf(group) : -1;
	// An untyped lane sorts last rather than first: it is the trailing "drop
	// something here" row, and canonical order should not push it above a lane
	// that knows what it is.
	return i < 0 ? LANE_GROUP_ORDER.length : i;
};

/** Rows of a given group, in order. */
export function rowsOfGroup(
	groups: ReadonlyArray<LaneGroup | undefined>,
	group: LaneGroup,
): number[] {
	return groups.flatMap((g, row) => (g === group ? [row] : []));
}

/* Where a lane of `group` belongs when there is not one yet: after every lane
 * whose group sorts before it, which keeps the canonical order intact without
 * having to re-sort the whole gutter. */
export function canonicalInsertRow(
	groups: ReadonlyArray<LaneGroup | undefined>,
	group: LaneGroup,
): number {
	const target = orderOf(group);
	let row = 0;
	while (row < groups.length && orderOf(groups[row]) <= target) row++;
	return row;
}

/* Clamp a lane reorder so the result stays consistent with canonical group
 * order.
 *
 * A move is allowed to reposition a lane WITHIN its own group's band and no
 * further. Dropping an audio lane onto a visual row does not reject the gesture
 * — it lands at the nearest position that keeps audio contiguous, which is what
 * the operator could have reached by dragging one row less far.
 *
 * A lane with no declared group is unconstrained: there is no band to stay in.
 */
export function clampRowMove(
	groups: ReadonlyArray<LaneGroup | undefined>,
	from: number,
	to: number,
): number {
	const group = groups[from];
	if (!group) return to;
	const others = groups.filter((_, row) => row !== from);
	const band = rowsOfGroup(others, group);
	// Positions in the WITHOUT-from array that keep the group contiguous.
	const lo = band.length ? band[0]! : canonicalInsertRow(others, group);
	const hi = band.length ? band[band.length - 1]! + 1 : lo;
	// `to` is an index into the same without-from array (the caller's mapRow
	// treats it that way), so it clamps directly.
	return Math.min(hi, Math.max(lo, to));
}

/* Which lane a clip of `group` should land on, given where it was dropped.
 *
 * A drop states a time and a kind, both unambiguous; only the row can be wrong,
 * and the row is derivable. Rejecting it would discard two correct pieces of
 * information to punish the third — so a mismatched drop is ROUTED to the
 * nearest lane that accepts it, preserving the time it was dropped at.
 *
 * `null` means no lane of that group exists and one has to be created at
 * `canonicalInsertRow`. */
export function routeToLane(
	groups: ReadonlyArray<LaneGroup | undefined>,
	group: LaneGroup,
	preferredRow: number,
): number | null {
	if (groups[preferredRow] === group) return preferredRow;
	const candidates = rowsOfGroup(groups, group);
	if (!candidates.length) return null;
	return candidates.reduce((best, row) =>
		Math.abs(row - preferredRow) < Math.abs(best - preferredRow) ? row : best,
	);
}

/* The lane a colliding drop relocates to: the next lane of its OWN group below
 * the one it landed on, then the nearest one above, and `null` when every lane
 * of the group is occupied in that window and a fresh one has to be inserted.
 *
 * "The next row down" was the old answer and is now a different kind of lane. */
export function nextFreeLaneOfGroup(
	groups: ReadonlyArray<LaneGroup | undefined>,
	group: LaneGroup,
	fromRow: number,
	isFree: (row: number) => boolean,
): number | null {
	const rows = rowsOfGroup(groups, group);
	const below = rows.filter((row) => row > fromRow).find(isFree);
	if (below != null) return below;
	const above = [...rows]
		.reverse()
		.filter((row) => row < fromRow)
		.find(isFree);
	return above ?? null;
}

/* Which rows survive compaction.
 *
 * Compaction exists to close the gaps a move leaves, and under declared groups
 * an EMPTY LANE IS NOT A GAP — keeping "the audio lane" in place after its last
 * clip is removed is the whole point of declaring the group. So a lane is kept
 * when it holds a clip OR when it declares a group. Caption generation used to
 * append a lane after each deletion: retain one empty caption lane, or occupied
 * caption lanes, plus any lane with authored mute/hide/lock settings. */
export function rowsToKeep(
	occupied: Iterable<number>,
	trackFlags: TrackFlags,
	rowCount: number,
): number[] {
	const keep = new Set<number>();
	for (const row of occupied) if (Number.isFinite(row) && row >= 0) keep.add(row);
	let hasCaptionLane = [...keep].some((row) => trackFlags[row]?.group === "caption");
	for (let row = 0; row < rowCount; row++) {
		const flags = trackFlags[row];
		if (!flags?.group) continue;
		if (flags.group === "caption") {
			if (hasCaptionLane && !keep.has(row) && !flags.muted && !flags.hidden && !flags.locked)
				continue;
			hasCaptionLane = true;
		}
		keep.add(row);
	}
	return [...keep].sort((a, b) => a - b);
}

/** Old row -> new row for a compaction that keeps `rows`. */
export function compactionMap(rows: readonly number[]): Map<number, number> {
	return new Map(rows.map((row, index) => [row, index]));
}

/** Shift every lane at or below `at` down by one, opening a row for a new lane. */
export function withLaneInserted(trackFlags: TrackFlags, at: number, group: LaneGroup): TrackFlags {
	const next: TrackFlags = {};
	for (const [key, value] of Object.entries(trackFlags)) {
		const row = Number(key);
		if (row < 0) next[row] = value;
		else next[row >= at ? row + 1 : row] = value;
	}
	next[at] = { group };
	return next;
}
