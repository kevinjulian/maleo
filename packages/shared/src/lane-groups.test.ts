import { describe, expect, test } from "vite-plus/test";
import {
	laneGroupsAreDeclared,
	laneGroupOfType,
	migrateLaneGroups,
	occupiesFreeLane,
} from "./lane-groups.ts";
import type { Clip, ClipType } from "./timeline-doc.ts";
import { LANE_GROUP_ORDER, type TrackFlags } from "./timeline-model.ts";

function clip(
	id: string,
	type: ClipType,
	track: number,
	startSec: number,
	durationSec: number,
): Clip {
	return { id, type, track, startSec, durationSec };
}

const timing = (
	clips: readonly Clip[],
): Array<{ id: string; startSec: number; durationSec: number }> =>
	clips
		.map(({ id, startSec, durationSec }) => ({ id, startSec, durationSec }))
		.sort((a, b) => a.id.localeCompare(b.id));

const groupAt = (flags: TrackFlags, row: number): string | undefined => flags[row]?.group;

describe("laneGroupOfType", () => {
	test("classifies every lane-occupying clip type", () => {
		expect(laneGroupOfType("image")).toBe("visual");
		expect(laneGroupOfType("video")).toBe("visual");
		expect(laneGroupOfType("audio")).toBe("audio");
		expect(laneGroupOfType("text")).toBe("text");
		expect(laneGroupOfType("caption")).toBe("caption");
		expect(laneGroupOfType("effect")).toBe("effect");
	});

	test("every lane-occupying clip resolves to one of five groups", () => {
		const types: ClipType[] = ["image", "video", "text", "audio", "effect", "caption"];
		const groups = new Set(types.map(laneGroupOfType));
		expect([...groups].sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
			"audio",
			"caption",
			"effect",
			"text",
			"visual",
		]);
		expect(LANE_GROUP_ORDER).toEqual(["visual", "audio", "text", "caption", "effect"]);
	});

	test("a transition has no lane of its own", () => {
		expect(laneGroupOfType("transition")).toBeUndefined();
		expect(occupiesFreeLane(clip("trans:1", "transition", 0, 0, 1))).toBe(false);
	});

	test("the base scene track is not a free lane", () => {
		expect(occupiesFreeLane(clip("video:1", "video", -1, 0, 1))).toBe(false);
	});
});

describe("migrateLaneGroups", () => {
	test("declared caption lanes preserve authored rows, overlaps and flags", () => {
		const clips = [
			clip("caption:opaque-a", "caption", 1, 0, 4),
			clip("caption:opaque-b", "caption", 1, 2, 3),
		];
		const flags: TrackFlags = { 0: { group: "audio" }, 1: { group: "caption", locked: true } };
		const result = migrateLaneGroups(clips, flags);
		expect(result.migrated).toBe(false);
		expect(result.clips).toEqual(clips);
		expect(result.trackFlags).toEqual(flags);
	});
	test("a row of one kind takes that kind's group and no clip moves in time", () => {
		const clips = [clip("audio:1", "audio", 0, 0, 4), clip("audio:2", "audio", 0, 5, 2)];
		const result = migrateLaneGroups(clips, {});
		expect(result.migrated).toBe(true);
		expect(timing(result.clips)).toEqual(timing(clips));
		expect(groupAt(result.trackFlags, 0)).toBe("audio");
		expect(result.clips.every((c) => c.track === 0)).toBe(true);
	});

	test("a row holding two groups becomes two lanes, and nothing is retimed", () => {
		const clips = [
			clip("audio:1", "audio", 0, 0, 4),
			clip("text:2", "text", 0, 1, 2),
			clip("video:3", "video", 0, 0, 3),
		];
		const result = migrateLaneGroups(clips, {});
		expect(timing(result.clips)).toEqual(timing(clips));
		const trackOf = (id: string): number => result.clips.find((c) => c.id === id)!.track;
		expect(new Set([trackOf("audio:1"), trackOf("text:2"), trackOf("video:3")]).size).toBe(3);
		// Canonical order: visual, then audio, then text.
		expect(groupAt(result.trackFlags, trackOf("video:3"))).toBe("visual");
		expect(groupAt(result.trackFlags, trackOf("audio:1"))).toBe("audio");
		expect(groupAt(result.trackFlags, trackOf("text:2"))).toBe("text");
	});

	test("audio overlapping in time lands on separate lanes", () => {
		const clips = [clip("audio:1", "audio", 0, 0, 10), clip("audio:2", "audio", 0, 2, 3)];
		const result = migrateLaneGroups(clips, {});
		const tracks = result.clips.map((c) => c.track);
		expect(new Set(tracks).size).toBe(2);
		expect(tracks.every((t) => groupAt(result.trackFlags, t) === "audio")).toBe(true);
	});

	test("audio that does not overlap shares one lane", () => {
		const clips = [clip("audio:1", "audio", 0, 0, 2), clip("audio:2", "audio", 1, 5, 2)];
		const result = migrateLaneGroups(clips, {});
		expect(new Set(result.clips.map((c) => c.track)).size).toBe(1);
	});

	test("an empty untyped row is dropped rather than named by its position", () => {
		const clips = [clip("audio:1", "audio", 1, 0, 2)];
		const result = migrateLaneGroups(clips, { 0: { muted: true }, 1: {} });
		expect(result.clips[0]!.track).toBe(0);
		expect(Object.keys(result.trackFlags)).toEqual(["0"]);
		expect(groupAt(result.trackFlags, 0)).toBe("audio");
	});

	test("a split row's flags travel to both halves", () => {
		const clips = [clip("video:1", "video", 0, 0, 2), clip("audio:2", "audio", 0, 0, 2)];
		const result = migrateLaneGroups(clips, { 0: { muted: true, locked: true } });
		expect(result.trackFlags[0]).toEqual({ muted: true, locked: true, group: "visual" });
		expect(result.trackFlags[1]).toEqual({ muted: true, locked: true, group: "audio" });
	});

	test("the base track's flags survive untouched", () => {
		const clips = [clip("audio:1", "audio", 0, 0, 2)];
		const result = migrateLaneGroups(clips, { "-1": { hidden: true } });
		expect(result.trackFlags[-1]).toEqual({ hidden: true });
	});

	test("transitions keep their track and do not create a lane", () => {
		const clips = [clip("video:1", "video", 0, 0, 2), clip("trans:1", "transition", 0, 2, 0.5)];
		const result = migrateLaneGroups(clips, {});
		expect(Object.keys(result.trackFlags)).toEqual(["0"]);
		expect(result.clips.find((c) => c.id === "trans:1")!.track).toBe(0);
	});

	test("it is idempotent — a migrated document is not migrated again", () => {
		const clips = [
			clip("audio:1", "audio", 0, 0, 10),
			clip("audio:2", "audio", 0, 2, 3),
			clip("text:3", "text", 0, 0, 1),
			clip("video:4", "video", 1, 0, 5),
		];
		const once = migrateLaneGroups(clips, { 0: { muted: true } });
		const twice = migrateLaneGroups(once.clips, once.trackFlags);
		expect(once.migrated).toBe(true);
		expect(twice.migrated).toBe(false);
		expect(twice.clips.map((c) => c.track)).toEqual(once.clips.map((c) => c.track));
		expect(twice.trackFlags).toEqual(once.trackFlags);
	});

	test("a typed empty lane survives reopening — it is the feature, not a gap", () => {
		const clips = [clip("video:1", "video", 0, 0, 2)];
		const flags: TrackFlags = { 0: { group: "visual" }, 1: { group: "audio" } };
		const result = migrateLaneGroups(clips, flags);
		expect(result.migrated).toBe(false);
		expect(result.trackFlags).toEqual(flags);
	});

	test("a document with no clips and no flags needs no migration", () => {
		const result = migrateLaneGroups([], {});
		expect(result.migrated).toBe(false);
		expect(laneGroupsAreDeclared([], {})).toBe(true);
	});

	test("one untyped lane among typed ones still triggers migration", () => {
		const clips = [clip("video:1", "video", 0, 0, 2), clip("audio:2", "audio", 1, 0, 2)];
		expect(laneGroupsAreDeclared(clips, { 0: { group: "visual" } })).toBe(false);
		expect(migrateLaneGroups(clips, { 0: { group: "visual" } }).migrated).toBe(true);
	});
});
