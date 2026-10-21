import { describe, expect, test } from "vite-plus/test";
import {
	canonicalInsertRow,
	clampRowMove,
	compactionMap,
	laneGroups,
	nextFreeLaneOfGroup,
	routeToLane,
	rowsOfGroup,
	rowsToKeep,
	withLaneInserted,
} from "./lane-bookkeeping.ts";
import type { LaneGroup, TrackFlags } from "@maleo/shared";

const flags = (...groups: Array<LaneGroup | undefined>): TrackFlags =>
	Object.fromEntries(groups.map((group, row) => [row, group ? { group } : {}]));

describe("laneGroups", () => {
	test("reads the declared group of each row, undefined for an untyped one", () => {
		expect(laneGroups(flags("visual", undefined, "audio"), 3)).toEqual([
			"visual",
			undefined,
			"audio",
		]);
	});
});

describe("canonicalInsertRow", () => {
	test("a new lane lands after every group that sorts before it", () => {
		expect(canonicalInsertRow(["visual", "audio"], "text")).toBe(2);
		expect(canonicalInsertRow(["visual", "text"], "audio")).toBe(1);
		expect(canonicalInsertRow(["audio"], "visual")).toBe(0);
	});

	test("an untyped trailing row does not push a typed lane below it", () => {
		expect(canonicalInsertRow(["visual", undefined], "audio")).toBe(1);
	});
});

describe("clampRowMove", () => {
	const groups: Array<LaneGroup | undefined> = ["visual", "visual", "audio", "audio", "text"];

	test("a lane reorders freely within its own group's band", () => {
		// audio at row 3 moving up to row 2 stays inside the audio band.
		expect(clampRowMove(groups, 3, 2)).toBe(2);
	});

	test("a lane dragged past its band lands at the nearest position that keeps order", () => {
		// audio dragged to the top would put audio above visual.
		expect(clampRowMove(groups, 2, 0)).toBe(2);
		// visual dragged to the bottom would put visual below text.
		expect(clampRowMove(groups, 0, 4)).toBe(1);
	});

	test("an untyped lane is unconstrained", () => {
		expect(clampRowMove(["visual", undefined], 1, 0)).toBe(0);
	});

	test("the only lane of its group goes where canonical order puts it", () => {
		expect(clampRowMove(["visual", "audio", "text"], 1, 0)).toBe(1);
	});
});

describe("routeToLane", () => {
	const groups: Array<LaneGroup | undefined> = ["visual", "audio", "text", "audio"];

	test("a drop on a lane that accepts it stays put", () => {
		expect(routeToLane(groups, "audio", 1)).toBe(1);
	});

	test("audio dropped on a text lane routes to the nearest audio lane", () => {
		expect(routeToLane(groups, "audio", 2)).toBe(1);
		expect(routeToLane(groups, "audio", 3)).toBe(3);
	});

	test("a kind with no lane to receive it reports that one must be created", () => {
		expect(routeToLane(groups, "effect", 0)).toBeNull();
	});
});

describe("nextFreeLaneOfGroup", () => {
	const groups: Array<LaneGroup | undefined> = ["visual", "audio", "audio", "text"];

	test("a colliding drop falls to the next lane of its OWN group, not the row below", () => {
		// Row 2 is the next audio lane; row 3 is text and must not be considered.
		expect(nextFreeLaneOfGroup(groups, "audio", 1, (row) => row === 2)).toBe(2);
	});

	test("it looks above when nothing below is free", () => {
		expect(nextFreeLaneOfGroup(groups, "audio", 2, (row) => row === 1)).toBe(1);
	});

	test("every lane of the group occupied means a fresh one is needed", () => {
		expect(nextFreeLaneOfGroup(groups, "audio", 1, () => false)).toBeNull();
	});
});

describe("compaction", () => {
	test("caption retries leave one lane instead of a stack of empty lanes", () => {
		const declared = flags("audio", "effect", "caption", "caption", "caption", "caption");
		expect(rowsToKeep([0, 1, 5], declared, 6)).toEqual([0, 1, 5]);
		expect(rowsToKeep([0, 1], declared, 6)).toEqual([0, 1, 2]);
	});

	test("caption cleanup preserves occupied lanes and authored flags", () => {
		const declared = flags("audio", "caption", "caption", "caption", "caption", "caption");
		declared[1]!.locked = true;
		declared[2]!.hidden = true;
		declared[3]!.muted = true;
		expect(rowsToKeep([0, 4], declared, 6)).toEqual([0, 1, 2, 3, 4]);
	});

	test("an empty typed lane is kept — it is the feature, not a gap", () => {
		const keep = rowsToKeep([0, 2], flags("visual", "audio", "text"), 3);
		expect(keep).toEqual([0, 1, 2]);
	});

	test("an empty UNTYPED row still closes up", () => {
		const keep = rowsToKeep([0, 2], flags("visual", undefined, "text"), 3);
		expect(keep).toEqual([0, 2]);
		expect(compactionMap(keep)).toEqual(
			new Map([
				[0, 0],
				[2, 1],
			]),
		);
	});

	test("an occupied row is kept whether or not it declares a group", () => {
		expect(rowsToKeep([1], flags(undefined, undefined), 2)).toEqual([1]);
	});
});

describe("withLaneInserted", () => {
	test("lanes at or below the insertion point shift down and the new lane is typed", () => {
		const next = withLaneInserted(
			{ 0: { group: "visual" }, 1: { group: "text", muted: true } },
			1,
			"audio",
		);
		expect(next).toEqual({
			0: { group: "visual" },
			1: { group: "audio" },
			2: { group: "text", muted: true },
		});
	});

	test("the base track is not a lane and does not shift", () => {
		expect(withLaneInserted({ "-1": { hidden: true } }, 0, "audio")[-1]).toEqual({ hidden: true });
	});
});

/* What a lane reorder has to carry with it. `moveFreeRow` remaps clip tracks and
 * the flag map through the SAME `mapRow`, so a lane's visibility, mute, lock and
 * group move with its clips by construction. Restated here as the rule the move
 * has to satisfy, since the hook that applies it is not unit-testable. */
describe("a reordered lane carries its clips and its flags", () => {
	const mapRow =
		(from: number, to: number) =>
		(r: number): number => {
			if (r === from) return to;
			if (from < to) return r > from && r <= to ? r - 1 : r;
			return r >= to && r < from ? r + 1 : r;
		};

	test("flags follow the lane, group included", () => {
		const flagsIn: TrackFlags = {
			0: { group: "visual" },
			1: { group: "audio", muted: true, locked: true },
			2: { group: "audio", hidden: true },
		};
		const map = mapRow(1, 2);
		const out: TrackFlags = {};
		for (const [key, value] of Object.entries(flagsIn)) out[map(Number(key))] = value;
		expect(out[2]).toEqual({ group: "audio", muted: true, locked: true });
		expect(out[1]).toEqual({ group: "audio", hidden: true });
		expect(out[0]).toEqual({ group: "visual" });
	});

	test("clips on the lane land on the same row its flags did", () => {
		const map = mapRow(1, 2);
		expect(map(1)).toBe(2);
		expect(map(2)).toBe(1);
		expect(map(0)).toBe(0);
	});

	test("the base track is never remapped", () => {
		// `moveFreeRow` guards `r < 0` before mapping; the scene reel is not a lane.
		expect(clampRowMove(["visual", "audio"], 0, 1)).toBe(0);
	});
});

describe("rowsOfGroup", () => {
	test("reports every row of a group in order", () => {
		expect(rowsOfGroup(["audio", "visual", "audio"], "audio")).toEqual([0, 2]);
	});
});
