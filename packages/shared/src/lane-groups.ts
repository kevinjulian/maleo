/* Lane groups: what a timeline lane accepts, and the one-time migration that
 * gives every lane in an existing document a declared one.
 *
 * This lives beside the canonical document rather than in the editor's clip
 * adapter because it operates on `Clip[]` and `TrackFlags` — the two things that
 * persist. The editor's `timeline-clips.ts` classifies its own `TimelineClip`
 * shape by delegating here, so a clip cannot land in one group on the way in and
 * another on the way out.
 */
import type { Clip, ClipType } from "./timeline-doc.ts";
import { LANE_GROUP_ORDER, type LaneGroup, type TrackFlags } from "./timeline-model.ts";

/* Which group accepts a clip of this type.
 *
 * `scene` is absent because scenes live on the base track (row -1), which is not
 * a free lane and has no group. `transition` is absent for the same reason it
 * has no track of its own: it bridges two visual clips rather than occupying a
 * lane, so it is carried by the visual lane its endpoints sit on. */
export function laneGroupOfType(type: ClipType): LaneGroup | undefined {
	if (type === "image" || type === "video") return "visual";
	if (type === "audio") return "audio";
	if (type === "text") return "text";
	if (type === "caption") return "caption";
	if (type === "infographic") return "data";
	if (type === "effect") return "effect";
	return undefined;
}

/** Clips that occupy a free lane. Transitions do not; nor does anything the
 * group vocabulary does not cover. */
export function occupiesFreeLane(clip: Clip): boolean {
	return clip.track >= 0 && laneGroupOfType(clip.type) !== undefined;
}

function highestFreeRow(clips: readonly Clip[], trackFlags: TrackFlags): number {
	let max = -1;
	for (const clip of clips) if (occupiesFreeLane(clip)) max = Math.max(max, clip.track);
	for (const key of Object.keys(trackFlags)) {
		const row = Number(key);
		if (Number.isFinite(row) && row >= 0) max = Math.max(max, row);
	}
	return max;
}

/** True when every free lane in the document already declares a group.
 *
 * This is the migration's idempotency gate and it is deliberately the whole of
 * it: a migrated document is one in which nothing is left to infer, so asking
 * "is anything untyped?" is the same question as "has this run?" without a
 * version counter that a restored older document would carry incorrectly. */
export function laneGroupsAreDeclared(clips: readonly Clip[], trackFlags: TrackFlags): boolean {
	const max = highestFreeRow(clips, trackFlags);
	for (let row = 0; row <= max; row++) if (!trackFlags[row]?.group) return false;
	return true;
}

export interface LaneMigration {
	clips: Clip[];
	trackFlags: TrackFlags;
	/** False when the document was already declared and nothing was touched. */
	migrated: boolean;
}

/* Give every lane a declared group, splitting any lane that holds more than one.
 *
 * The layout it produces is the canonical one: groups in `LANE_GROUP_ORDER`, and
 * within a group one lane per set of clips that do not overlap in time, which is
 * what separates a voiceover from a music bed without anyone asking. Every
 * clip's start and duration are untouched — only `track` moves.
 *
 * An empty untyped row is DROPPED rather than assigned a group by its position.
 * Position-based naming is exactly the guess this change exists to delete
 * (row 0 was called "Voiceover" because it was row 0), and an empty untyped row
 * carries no evidence of what it was for. Dropping is stable across reopening:
 * the result has no untyped rows left, so the gate above short-circuits every
 * later load. Empty lanes created AFTER migration are typed, and those persist —
 * that is the feature, and it is not in conflict with this.
 */
export function migrateLaneGroups(clips: readonly Clip[], trackFlags: TrackFlags): LaneMigration {
	if (laneGroupsAreDeclared(clips, trackFlags)) {
		return { clips: [...clips], trackFlags, migrated: false };
	}

	const lanes: Array<{ group: LaneGroup; clips: Clip[] }> = [];
	for (const group of LANE_GROUP_ORDER) {
		const members = clips
			.filter((clip) => occupiesFreeLane(clip) && laneGroupOfType(clip.type) === group)
			// Sort by the lane the clip is on first, so a project whose rows are
			// already single-kind keeps its relative row order within the group
			// instead of being reshuffled by start time alone.
			.sort((a, b) => a.track - b.track || a.startSec - b.startSec || a.id.localeCompare(b.id));
		for (const clip of members) {
			const lane = lanes.find(
				(l) => l.group === group && l.clips.every((other) => !overlaps(other, clip)),
			);
			if (lane) lane.clips.push(clip);
			else lanes.push({ group, clips: [clip] });
		}
	}

	const nextTrack = new Map<string, number>();
	const sourceRows = new Map<number, number[]>();
	lanes.forEach((lane, row) => {
		for (const clip of lane.clips) nextTrack.set(clip.id, row);
		sourceRows.set(
			row,
			[...new Set(lane.clips.map((clip) => clip.track))].sort((a, b) => a - b),
		);
	});

	const nextFlags: TrackFlags = {};
	// The base track's flags are not lane state and survive untouched.
	for (const [key, value] of Object.entries(trackFlags)) {
		const row = Number(key);
		if (row < 0) nextFlags[row] = value;
	}
	lanes.forEach((lane, row) => {
		// A split lane inherits the flags of the row it came from — both halves of a
		// muted mixed row stay muted, which is what the operator last asked for.
		const from = (sourceRows.get(row) ?? [])
			.map((source) => trackFlags[source])
			.find((flag) => flag);
		nextFlags[row] = {
			...(from?.hidden ? { hidden: true } : {}),
			...(from?.muted ? { muted: true } : {}),
			...(from?.locked ? { locked: true } : {}),
			group: lane.group,
		};
	});

	const nextClips = clips.map((clip) => {
		const track = nextTrack.get(clip.id);
		return track == null || track === clip.track ? clip : withLaneTrack(clip, track);
	});
	return { clips: nextClips, trackFlags: nextFlags, migrated: true };
}

/* Move a clip to a lane, payload included.
 *
 * `withMirroredTiming` is the usual way to keep a payload in step, and it is the
 * wrong tool here: it refreshes only keys the payload ALREADY has, so a legacy
 * overlay saved without a `track` would keep an absent one — and an absent track
 * reads as row 0, which is precisely the row the clip just left. The key has to
 * be written, not refreshed. */
function withLaneTrack(clip: Clip, track: number): Clip {
	const moved: Clip = { ...clip, track };
	if (clip.video) return { ...moved, video: { ...clip.video, track } };
	if (clip.text) return { ...moved, text: { ...clip.text, track } };
	if (clip.audio) return { ...moved, audio: { ...clip.audio, track } };
	if (clip.infographic) return { ...moved, infographic: { ...clip.infographic, track } };
	if (clip.effect) return { ...moved, effect: { ...clip.effect, track } };
	return moved;
}

function overlaps(a: Clip, b: Clip): boolean {
	return b.startSec < a.startSec + a.durationSec && b.startSec + b.durationSec > a.startSec;
}
