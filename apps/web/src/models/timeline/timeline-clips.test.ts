import { describe, expect, test } from "vite-plus/test";
import { importSrtCaptions, parseSrt } from "@models/captions/srt.ts";
import {
	adjacentVisualPairs,
	audioLaneGroup,
	buildFreeClips,
	clipId,
	compactFreeTrackMap,
	freeRowCount,
	isVisualClip,
	organizeClipsInRange,
	overlapsTime,
	parseClipId,
	resolveFreeTrack,
	rippleAfterDurationChange,
	rippleShift,
	sceneInsertIndex,
	laneLabel,
	laneGroupOf,
	laneGroupOfClip,
	snapTime,
	upsertAgentClips,
	type OverlayTimelineClip,
} from "./timeline-clips.ts";

const clip = (
	over: Partial<OverlayTimelineClip> & {
		id: string;
		start: number;
		dur: number;
		track: number;
		source: OverlayTimelineClip["source"];
		media: OverlayTimelineClip["media"];
	},
): OverlayTimelineClip => ({
	refId: 0,
	label: "",
	...over,
});

describe("clip id helpers", () => {
	test("round-trips source + refId", () => {
		expect(clipId("scene", 3)).toBe("scene:3");
		expect(parseClipId("video:7")).toEqual({ source: "video", refId: 7 });
		expect(parseClipId("bogus")).toBeNull();
	});
});

describe("rippleShift", () => {
	const removed = [
		{ track: 0, start: 2, dur: 3 }, // 2..5 on track 0
		{ track: 1, start: 0, dur: 1 }, // 0..1 on track 1
	];
	test("sums durations of removed clips earlier on the same track", () => {
		expect(rippleShift(removed, 0, 6)).toBe(3); // after the 2..5 hole
		expect(rippleShift(removed, 1, 4)).toBe(1); // after the 0..1 hole
	});
	test("ignores other tracks and clips at/after the position", () => {
		expect(rippleShift(removed, 0, 2)).toBe(0); // not strictly after start
		expect(rippleShift(removed, 2, 9)).toBe(0); // unrelated track never shifts
	});
	test("accumulates multiple holes before the position", () => {
		const two = [
			{ track: 0, start: 1, dur: 2 },
			{ track: 0, start: 5, dur: 1.5 },
		];
		expect(rippleShift(two, 0, 8)).toBe(3.5);
	});
});

describe("resolveFreeTrack", () => {
	test("keeps preferred track when time range is clear", () => {
		expect(resolveFreeTrack([{ track: 1, start: 0, dur: 1 }], { start: 2, dur: 1 }, 1)).toBe(1);
	});

	test("walks down until it finds a non-overlapping track", () => {
		const occupied = [
			{ track: 1, start: 0, dur: 2 },
			{ track: 2, start: 0.5, dur: 2 },
		];
		expect(resolveFreeTrack(occupied, { start: 1, dur: 1 }, 1)).toBe(3);
	});

	test("touching edges do not count as collision", () => {
		expect(overlapsTime({ start: 2, dur: 1 }, { start: 0, dur: 2 })).toBe(false);
		expect(resolveFreeTrack([{ track: 0, start: 0, dur: 2 }], { start: 2, dur: 1 }, 0)).toBe(0);
	});
});

describe("rippleAfterDurationChange", () => {
	test("pushes later clips by the regenerated duration delta", () => {
		const clips = [
			{ id: 1, start: 0, dur: 2 },
			{ id: 2, start: 2, dur: 3 },
			{ id: 3, start: 5, dur: 1 },
		];
		expect(rippleAfterDurationChange(clips, 2, 2, 1.5)).toEqual([
			{ id: 1, start: 0, dur: 2 },
			{ id: 2, start: 2, dur: 3 },
			{ id: 3, start: 6.5, dur: 1 },
		]);
	});
});

describe("isVisualClip", () => {
	test("image/video clips are visual; text/audio/effect are not", () => {
		expect(
			isVisualClip(
				clip({ id: "video:9", start: 0, dur: 2, track: 0, source: "video", media: "image" }),
			),
		).toBe(true);
		expect(
			isVisualClip(
				clip({ id: "video:1", start: 0, dur: 2, track: 0, source: "video", media: "video" }),
			),
		).toBe(true);
		expect(
			isVisualClip(
				clip({ id: "text:1", start: 0, dur: 2, track: 0, source: "text", media: "text" }),
			),
		).toBe(false);
		expect(
			isVisualClip(
				clip({ id: "audio:1", start: 0, dur: 2, track: 0, source: "audio", media: "audio" }),
			),
		).toBe(false);
	});
});

describe("buildFreeClips", () => {
	test("caption projection retains opaque document identity and authored lane", () => {
		const doc = importSrtCaptions(
			{ schemaVersion: 2, clips: [], markers: [] },
			parseSrt("1\n00:00:01,000 --> 00:00:03,000\nOpaque caption"),
			"opaque:run",
		);
		const cue = doc.clips[0]!;
		const [projected] = buildFreeClips([], [], [], [], doc.clips);
		expect(projected).toEqual({
			id: cue.id,
			refId: cue.id,
			source: "caption",
			media: "caption",
			start: 1,
			dur: 2,
			track: cue.track,
			label: "Opaque caption",
		});
		expect(laneGroupOfClip(projected!)).toBe("caption");
	});
	test("labels non-voice audio kinds distinctly", () => {
		const clips = buildFreeClips(
			[],
			[],
			[
				{ id: 1, kind: "music", origin: "stock", content: "", start: 0, dur: 3 },
				{ id: 2, kind: "sfx", content: "", start: 3, dur: 1 },
				{ id: 3, kind: "ambient", content: "", start: 4, dur: 2 },
				{ id: 4, kind: "accent_hit", content: "", start: 6, dur: 1 },
				{ id: 5, kind: "voiceover", origin: "tts", content: "", start: 7, dur: 2 },
			],
		);
		expect(clips.map((c) => c.label)).toEqual([
			"Background Music",
			"SFX",
			"Ambient",
			"Accent Hit",
			"TTS Voiceover",
		]);
		expect(clips.map((c) => c.audioKind)).toEqual([
			"music",
			"sfx",
			"ambient",
			"accent_hit",
			"voiceover",
		]);
		expect(audioLaneGroup(clips[3]!.audioKind)).toBe("sfx");
	});
});

describe("organize timeline range", () => {
	test("groups semantics and separates overlaps without deleting or retiming clips", () => {
		const input = [
			clip({
				id: "audio:1",
				refId: 1,
				source: "audio",
				media: "audio",
				audioKind: "voiceover",
				start: 0,
				dur: 4,
				track: 0,
			}),
			clip({
				id: "audio:2",
				refId: 2,
				source: "audio",
				media: "audio",
				audioKind: "sfx",
				start: 1,
				dur: 1,
				track: 0,
			}),
			clip({ id: "text:3", refId: 3, source: "text", media: "text", start: 0, dur: 3, track: 0 }),
			clip({ id: "text:4", refId: 4, source: "text", media: "text", start: 1, dur: 3, track: 0 }),
		];
		const result = organizeClipsInRange(input, 0, 4);
		expect(result.clips).toHaveLength(input.length);
		expect(result.clips.map(({ id, start, dur }) => ({ id, start, dur }))).toEqual(
			input.map(({ id, start, dur }) => ({ id, start, dur })),
		);
		expect(result.clips.find((item) => item.id === "audio:1")!.track).not.toBe(
			result.clips.find((item) => item.id === "audio:2")!.track,
		);
		expect(result.clips.find((item) => item.id === "text:3")!.track).not.toBe(
			result.clips.find((item) => item.id === "text:4")!.track,
		);
	});

	test("leaves clips outside selected range unchanged", () => {
		const input = [
			clip({
				id: "audio:1",
				refId: 1,
				source: "audio",
				media: "audio",
				audioKind: "voiceover",
				start: 0,
				dur: 2,
				track: 4,
			}),
			clip({ id: "text:2", refId: 2, source: "text", media: "text", start: 10, dur: 2, track: 7 }),
		];
		const result = organizeClipsInRange(input, 0, 3);
		expect(result.clips.find((item) => item.id === "text:2")!.track).toBe(7);
	});

	test("reports the group of every lane it laid out", () => {
		const input = [
			clip({
				id: "audio:1",
				refId: 1,
				source: "audio",
				media: "audio",
				audioKind: "voiceover",
				start: 0,
				dur: 4,
				track: 0,
			}),
			clip({
				id: "audio:2",
				refId: 2,
				source: "audio",
				media: "audio",
				audioKind: "music",
				start: 1,
				dur: 1,
				track: 0,
			}),
			clip({
				id: "video:3",
				refId: 3,
				source: "video",
				media: "video",
				start: 0,
				dur: 3,
				track: 0,
			}),
		];
		// Visual first, then the two audio lanes the time overlap forced apart.
		expect(organizeClipsInRange(input, 0, 4).laneGroups).toEqual(["visual", "audio", "audio"]);
	});
});

describe("lane groups", () => {
	const groupOf = (
		source: OverlayTimelineClip["source"],
		media: OverlayTimelineClip["media"],
		refId = 1,
	): string =>
		laneGroupOfClip(
			clip({ id: `${source}:${refId}`, refId, source, media, start: 0, dur: 1, track: 0 }),
		);

	test("every clip kind resolves to exactly one of the five groups", () => {
		expect(groupOf("video", "video")).toBe("visual");
		expect(groupOf("video", "image")).toBe("visual");
		expect(groupOf("audio", "audio")).toBe("audio");
		expect(groupOf("text", "text")).toBe("text");
		expect(groupOf("effect", "effect")).toBe("effect");
	});

	test("image and video share one group so a transition between them stays expressible", () => {
		expect(groupOf("video", "image")).toBe(groupOf("video", "video"));
	});

	test("a text clip keeps its group when its preset becomes a motion template", () => {
		// Intro motion is a text overlay identified by its refId range. Splitting it
		// into its own group would teleport the clip the moment the preset changed.
		const plain = clip({
			id: "text:3",
			refId: 3,
			source: "text",
			media: "text",
			start: 0,
			dur: 2,
			track: 0,
		});
		const motion = clip({
			id: "text:51000000",
			refId: 51_000_000,
			source: "text",
			media: "text",
			start: 0,
			dur: 2,
			track: 0,
		});
		expect(laneGroupOfClip(motion)).toBe(laneGroupOfClip(plain));
	});

	test("a lane names itself from its declared group, not from its contents", () => {
		expect(laneLabel("audio", 0)).toEqual({ group: "Audio", label: "Audio" });
	});

	test("an untyped lane falls back to its index rather than guessing by position", () => {
		// Row 0 used to be called "Voiceover" and row 1 "SFX" purely by position.
		expect(laneLabel(undefined, 0)).toEqual({ label: "Layer 1" });
		expect(laneLabel(undefined, 1)).toEqual({ label: "Layer 2" });
	});

	test("a declared group is read from the flags, and the base track has none", () => {
		expect(laneGroupOf({ 0: { group: "audio" } }, 0)).toBe("audio");
		expect(laneGroupOf({ "-1": { group: "visual" } }, -1)).toBeUndefined();
		expect(laneGroupOf({}, 2)).toBeUndefined();
	});
});

describe("upsertAgentClips (agent run must not duplicate existing clips)", () => {
	type Clip = { id: number; content: string; track: number };
	type Job = { id?: number; content: string; track?: number };
	const build = (j: Job, id: number): Clip => ({ id, content: j.content, track: j.track ?? 0 });

	test("a seeded clip (same id) is replaced, not duplicated; track preserved", () => {
		const prev: Clip[] = [{ id: 7, content: "OLD", track: 2 }];
		// Agent returns the seeded clip (id 7, possibly edited) — must NOT duplicate.
		const out = upsertAgentClips(
			prev,
			[{ id: 7, content: "EDITED", track: 2 } as Job],
			(j) => j.id,
			build,
			1000,
		);
		expect(out).toHaveLength(1);
		expect(out[0]).toEqual({ id: 7, content: "EDITED", track: 2 });
	});

	test("an agent-created clip (no id) is appended with a fresh id", () => {
		const prev: Clip[] = [{ id: 7, content: "KEEP", track: 1 }];
		const out = upsertAgentClips(
			prev,
			[{ id: 7, content: "KEEP", track: 1 }, { content: "NEW" }] as Job[],
			(j) => j.id,
			build,
			1000,
		);
		expect(out).toHaveLength(2);
		expect(out.find((c) => c.id === 7)?.content).toBe("KEEP");
		expect(out.find((c) => c.id === 1000)?.content).toBe("NEW");
	});

	test("multiple existing clips survive a run with no duplication", () => {
		const prev: Clip[] = [
			{ id: 5, content: "A", track: 1 },
			{ id: 9, content: "B", track: 3 },
		];
		const out = upsertAgentClips(
			prev,
			[
				{ id: 5, content: "A", track: 1 },
				{ id: 9, content: "B", track: 3 },
			] as Job[],
			(j) => j.id,
			build,
			2000,
		);
		expect(out).toHaveLength(2);
		expect(out.map((c) => c.id).sort((a, b) => a - b)).toEqual([5, 9]);
	});
});

describe("adjacentVisualPairs", () => {
	test("finds touching visual clips on the same track", () => {
		const a = clip({ id: "video:9", start: 0, dur: 2, track: 0, source: "video", media: "image" });
		const b = clip({ id: "video:1", start: 2, dur: 2, track: 0, source: "video", media: "video" });
		const pairs = adjacentVisualPairs([a, b]);
		expect(pairs).toHaveLength(1);
		expect(pairs[0]!.from.id).toBe("video:9");
		expect(pairs[0]!.to.id).toBe("video:1");
	});

	test("ignores clips with a gap between them", () => {
		const a = clip({ id: "video:9", start: 0, dur: 2, track: 0, source: "video", media: "image" });
		const b = clip({ id: "video:1", start: 3, dur: 2, track: 0, source: "video", media: "video" });
		expect(adjacentVisualPairs([a, b])).toHaveLength(0);
	});

	test("ignores clips on different tracks and non-visual clips", () => {
		const a = clip({ id: "video:9", start: 0, dur: 2, track: 0, source: "video", media: "image" });
		const other = clip({
			id: "video:1",
			start: 2,
			dur: 2,
			track: 1,
			source: "video",
			media: "video",
		});
		const txt = clip({ id: "text:1", start: 2, dur: 2, track: 0, source: "text", media: "text" });
		expect(adjacentVisualPairs([a, other, txt])).toHaveLength(0);
	});
});

describe("sceneInsertIndex", () => {
	// Sequential reel: 0..3 (dur 3), 3..7 (dur 4), 7..9 (dur 2).
	const scenes = [{ dur: 3 }, { dur: 4 }, { dur: 2 }];

	test("inserts before the scene whose midpoint lies past the click", () => {
		expect(sceneInsertIndex(scenes, 0)).toBe(0);
		expect(sceneInsertIndex(scenes, 1)).toBe(0); // before 0..3 midpoint (1.5)
		expect(sceneInsertIndex(scenes, 2)).toBe(1); // past midpoint of first scene
		expect(sceneInsertIndex(scenes, 4)).toBe(1); // before 3..7 midpoint (5)
		expect(sceneInsertIndex(scenes, 6)).toBe(2);
	});

	test("appends when the click is past the last midpoint", () => {
		expect(sceneInsertIndex(scenes, 8.5)).toBe(3);
		expect(sceneInsertIndex(scenes, 100)).toBe(3);
		expect(sceneInsertIndex([], 2)).toBe(0);
	});

	test("respects explicit (pinned) scene starts", () => {
		const pinned = [{ dur: 3 }, { start: 10, dur: 4 }];
		expect(sceneInsertIndex(pinned, 5)).toBe(1); // in the gap, before the pinned scene
		expect(sceneInsertIndex(pinned, 13)).toBe(2); // past the pinned scene midpoint (12)
	});
});

describe("snapTime", () => {
	test("snaps to the nearest candidate within threshold", () => {
		expect(snapTime(4.9, [5, 8], 0.25)).toBe(5);
		expect(snapTime(7.8, [5, 8], 0.25)).toBe(8);
	});

	test("keeps (rounds) the raw value when nothing is close", () => {
		expect(snapTime(6.333, [5, 8], 0.25)).toBe(6.33);
	});

	test("prefers the closest of several candidates and clamps at 0", () => {
		expect(snapTime(5.1, [5, 5.15], 0.25)).toBe(5.15);
		expect(snapTime(-0.2, [], 0.25)).toBe(0);
	});
});

describe("free track rows", () => {
	test("keeps one trailing empty row", () => {
		expect(freeRowCount([])).toBe(1);
		expect(
			freeRowCount([
				clip({ id: "audio:1", start: 0, dur: 2, track: 0, source: "audio", media: "audio" }),
				clip({ id: "text:2", start: 1, dur: 2, track: 2, source: "text", media: "text" }),
			]),
		).toBe(4);
	});

	test("maps occupied rows to contiguous lanes", () => {
		const map = compactFreeTrackMap([{ track: 1 }, { track: 3 }, { track: 3 }]);
		expect([...map.entries()]).toEqual([
			[1, 0],
			[3, 1],
		]);
	});
});
