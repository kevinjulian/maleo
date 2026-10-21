/* Maleo's document as timeline state, and what the edit policies make of it.
 *
 * Edits run where production runs them: the Rust edit policies
 * (`models/editor-engine/policy-gesture.ts`) commit an operation, and
 * `contentEditsOf` turns it into the writes the editor makes. */
import { describe, expect, test } from "vite-plus/test";
import { framesToProject, projectTime } from "@models/timeline-view/tick.ts";
import { type Operation } from "@models/timeline-view/operations.ts";
import { type TimelineItem } from "@models/timeline-view/types.ts";
import { testEngine } from "@models/editor-engine/engine-fixture.ts";
import { openPolicyGesture } from "@models/editor-engine/policy-gesture.ts";
import { contentEditsOf } from "./content-edits.ts";
import type { Clip, TrackFlags } from "@maleo/shared";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";
import {
	CONTENT_TIMEBASE,
	createContentDocumentAdapter,
	itemOf,
	laneRowId,
	laneTrackOf,
	rowsOf,
	sceneEditPatch,
} from "./content-document-adapter.ts";
import {
	createContentCrossAxis,
	groupAccepts,
	LANE_ACCEPTANCE,
	LANE_HEIGHT_FALLBACK_PX,
} from "./content-cross-axis.ts";

const frames = (count: number): number => framesToProject(count, CONTENT_TIMEBASE).ticks;

function clip(
	id: string,
	type: Clip["type"],
	track: number,
	startSec: number,
	durationSec: number,
	extra: Partial<Clip> = {},
): Clip {
	return { id, type, track, startSec, durationSec, ...extra };
}

function scene(id: number, name: string, dur: number): NonNullable<Clip["scene"]> {
	return { id, dur, name, shot: "wide", move: "static", vis: "", vo: "", img: true };
}

/** A document with the shapes a real storyboard has, including fields VUI never sees. */
function sampleDoc(): EditorDoc {
	return {
		schemaVersion: 2,
		clips: [
			clip("scene-1", "image", -1, 0, 3, { scene: scene(1, "Opening", 3), markerId: 1 }),
			clip("scene-2", "video", -1, 3, 4, { scene: scene(2, "Middle", 4), markerId: 1 }),
			clip("text-1", "text", 0, 1, 2, {
				text: { id: 1, content: "Title", start: 1, dur: 2, preset: "lower-third" },
				refIds: ["ref-a"],
			}),
			clip("audio-1", "audio", 1, 0, 7, {
				audio: { id: 1, kind: "voiceover", content: "Voice", start: 0, dur: 7 },
			}),
		],
		markers: [
			{ id: 1, title: "Scene one", clipIds: ["scene-1", "scene-2"], startSec: 0, endSec: 7 },
		],
		projectReferences: { prompt: "keep the brand palette", entityIds: ["ref-a"] },
	};
}

const TRACK_FLAGS: TrackFlags = { 0: { group: "text" }, 1: { group: "audio" } };

function adapterOver(initial: EditorDoc = sampleDoc()) {
	return {
		adapter: createContentDocumentAdapter({ read: () => initial, trackFlags: () => TRACK_FLAGS }),
	};
}

/* One trim sample through the engine's policies, committed. */
function trimOnce(
	state: ReturnType<ReturnType<typeof createContentDocumentAdapter>["read"]>,
	id: string,
	edge: "start" | "end",
	deltaTicks: number,
) {
	const gesture = openPolicyGesture(
		testEngine,
		"t",
		state,
		{ policy: "trim", id, edge, kind: "trim" },
		undefined,
	);
	const projection = gesture.update({ deltaTicks });
	return { terminal: gesture.commit(), clamped: projection.clamped === true };
}

/* ---- 15.1 The document adapter --------------------------------------------- */

describe("content document adapter", () => {
	test("opaque caption identities use shared trim policies and lane locks", () => {
		const caption = clip("caption:opaque:uuid", "caption", 2, 1, 3);
		const flags: TrackFlags = { 2: { group: "caption" } };
		const doc: EditorDoc = { schemaVersion: 2, clips: [caption], markers: [], trackFlags: flags };
		const adapter = createContentDocumentAdapter({ read: () => doc, trackFlags: () => flags });
		const trimmed = trimOnce(adapter.read(), caption.id, "end", -frames(30));
		if (!trimmed.terminal.ok || !trimmed.terminal.operation)
			throw new Error("caption trim did not commit");
		expect(contentEditsOf(trimmed.terminal.operation, () => caption)[0]).toMatchObject({
			clipId: caption.id,
			durSec: 2,
		});
		expect(itemOf(caption, { 2: { group: "caption", locked: true } }).locked).toBe(true);
	});
	test("generated video source duration caps drag extension without imported metadata", () => {
		const original = clip("video:1", "video", 0, 0, 2, {
			video: { id: 1, kind: "video", url: "source.mp4", sourceDurationSec: 4, start: 0, dur: 2 },
		});
		const adapter = createContentDocumentAdapter({
			read: () => ({ schemaVersion: 2, clips: [original], markers: [] }),
		});
		const extended = trimOnce(adapter.read(), original.id, "end", frames(300));
		expect(extended.clamped).toBe(true);
		if (!extended.terminal.ok || !extended.terminal.operation)
			throw new Error("the bounded trim did not commit");
		expect(contentEditsOf(extended.terminal.operation, () => original)[0]?.durSec).toBe(4);
	});
	test("measured source bounds clamp trims and map retimed/reversed media back to original seconds", () => {
		for (const rate of [0.25, 1, 4])
			for (const reverse of [false, true]) {
				const original = clip("video:1", "video", 0, 2, 4, {
					video: {
						id: 1,
						kind: "video",
						url: "source.mp4",
						start: 2,
						dur: 4,
						mediaStartSec: 3,
						layout: {
							xPct: 50,
							yPct: 50,
							widthPct: 100,
							fit: "contain",
							playbackRate: rate,
							reverse,
						},
					},
				});
				const adapter = createContentDocumentAdapter({
					read: () => ({ schemaVersion: 2, clips: [original], markers: [] }),
					sourceDuration: () => 40,
				});
				expect(adapter.read().items.get(original.id)?.source).toBeDefined();
				const head = trimOnce(adapter.read(), original.id, "start", frames(30));
				if (!head.terminal.ok || !head.terminal.operation)
					throw new Error("the head trim did not commit");
				const [edit] = contentEditsOf(head.terminal.operation, () => original);
				expect(edit?.durSec).toBe(3);
				expect(edit?.mediaStartSec).toBe(reverse ? 3 : 3 + rate);
				const extended = trimOnce(adapter.read(), original.id, "end", frames(30000));
				expect(extended.clamped).toBe(true);
				if (!extended.terminal.ok || !extended.terminal.operation)
					throw new Error("the clamped trim did not commit");
				const [tail] = contentEditsOf(extended.terminal.operation, () => original);
				expect(tail?.mediaStartSec).toBeCloseTo(reverse ? 0 : 3, 8);
			}
	});

	test("seconds become exact frames, and frames become the seconds they came from", () => {
		const { adapter } = adapterOver();
		const state = adapter.read();
		expect(state.items.get("scene-2")!.start.ticks).toBe(frames(90));
		expect(state.items.get("audio-1")!.duration.ticks).toBe(frames(210));
		expect(state.timebase.ticksPerFrame).toBe(CONTENT_TIMEBASE.ticksPerFrame);
	});

	test("lanes become rows, with the scene track magnetic and free lanes permitting overlap", () => {
		const rows = rowsOf(sampleDoc(), TRACK_FLAGS);
		expect(rows[0]).toEqual({ id: "scene", placement: "magnetic", overlap: "insert" });
		expect(rows.slice(1).every((row) => row.placement === "free" && row.overlap === "permit")).toBe(
			true,
		);
		expect(rows.map((row) => row.id)).toEqual(["scene", "lane-0", "lane-1"]);
		/* Row identity round-trips, so an operation naming a row names a lane. */
		for (const track of [-1, 0, 1, 7]) expect(laneTrackOf(laneRowId(track))).toBe(track);
	});

	test("a locked lane's clips report themselves read-only", () => {
		const locked: TrackFlags = { ...TRACK_FLAGS, 0: { group: "text", locked: true } };
		const item = itemOf(sampleDoc().clips[2]!, locked);
		expect(item.locked).toBe(true);
		expect(itemOf(sampleDoc().clips[3]!, locked).locked).toBeFalsy();
	});

	test("clips sharing a marker are a group, so a scene edit moves them together", () => {
		const state = adapterOver().adapter.read();
		expect(state.items.get("scene-1")!.groupId).toBe("marker-1");
		expect(state.items.get("scene-1")!.groupId).toBe(state.items.get("scene-2")!.groupId);
		expect(state.items.get("text-1")!.groupId).toBeUndefined();
	});

	/* 15.7. The base track is on the kernel now, and the scene run still has to
	 * roll: shorten a scene and the next one comes back with it, because a gap
	 * between scenes is a second of black in the render.
	 *
	 * The roll is DERIVED rather than written. A scene's start is its explicit
	 * `start` once it has been moved and its sequential position by order until
	 * then, so a run of untouched scenes lays itself out end to end and an edit
	 * that only changes a duration re-lays the rest for free. These two cover the
	 * halves of that: what the library asks for, and what actually gets written. */
	test("a scene trim reshapes its group and leaves every other lane alone", () => {
		const state = adapterOver().adapter.read();
		/* One second shorter, in exact frames rather than float seconds. */
		const result = trimOnce(state, "scene-1", "end", -frames(30)).terminal;
		expect(result.ok).toBe(true);
		if (!result.ok || !result.operation) return;

		const touched = new Map<string, { startTicks: number; durationTicks?: number }>();
		const walk = (operation: Operation): void => {
			if (operation.type === "composite") {
				for (const member of operation.operations) walk(member);
				return;
			}
			if (operation.type === "move")
				for (const entry of operation.entries)
					touched.set(entry.id, { startTicks: entry.to.startTicks });
			if (operation.type === "reshape")
				for (const entry of operation.entries)
					touched.set(entry.id, {
						startTicks: entry.to.startTicks,
						durationTicks: entry.to.durationTicks,
					});
		};
		walk(result.operation);

		/* The trimmed scene keeps its start — an end trim never moved it — and
		 * loses exactly the second that was dragged off. */
		expect(touched.get("scene-1")).toEqual({ startTicks: 0, durationTicks: frames(60) });
		/* `scene-2` is trimmed with it, because the two share a marker in this
		 * fixture and a marker IS a group — "items sharing a group move, trim, and
		 * undo as one" is the library's contract, and the adapter opts into it
		 * deliberately so a scene and its overlays travel together.
		 *
		 * A real storyboard gives every scene its own marker (`parse-loaded-project`
		 * asserts that shape), so two scenes never share one and this is the group
		 * contract rather than anything the base track does on its own. It is
		 * asserted here so that changing the mapping cannot pass silently. */
		expect(touched.get("scene-2")).toEqual({ startTicks: frames(90), durationTicks: frames(90) });
		/* And the free lanes are not named at all: the scene row is the magnetic
		 * one, and the timeline is not. */
		expect([...touched.keys()].sort()).toEqual(["scene-1", "scene-2"]);
	});

	test("a scene edit writes only what changed, so an unchanged start does not pin the run", () => {
		const current = { start: 3, dur: 4 };
		/* Two senses of "pin" meet here, and they are not the same thing. Writing an
		 * unchanged START pins the scene's POSITION and stops the run rolling behind
		 * it — the base track's magnetism. `durMode: "pinned"` is about DURATION: the
		 * scene no longer follows its speech. A resize sets the second, never the
		 * first. */
		/* An end trim: the library reports the whole new span, start included,
		 * because it does not know the start was never in question. Writing that
		 * start would pin the scene and stop the run rolling behind it. */
		expect(sceneEditPatch({ startSec: 3, durSec: 3 }, current)).toEqual({
			dur: 3,
			durMode: "pinned",
		});
		/* A move: the start is the edit, and a move never pins a duration. */
		expect(sceneEditPatch({ startSec: 5, durSec: 4 }, current)).toEqual({ start: 5 });
		/* Both, when both moved. */
		expect(sceneEditPatch({ startSec: 5, durSec: 3 }, current)).toEqual({
			start: 5,
			dur: 3,
			durMode: "pinned",
		});
		/* And a float that came back through ticks is the same start, not a new
		 * one — the comparison has to tolerate the round trip it just made. */
		expect(sceneEditPatch({ startSec: 3.0000001, durSec: 4 }, current)).toEqual({});
	});
});

/* ---- 15.2 The cross-axis adapter ------------------------------------------- */

describe("content cross axis", () => {
	const axis = createContentCrossAxis({ trackFlags: () => TRACK_FLAGS, laneCount: () => 2 });

	test("unmeasured, a lane's height follows its group, and rows stack cumulatively", () => {
		/* TRACK_FLAGS declares lane 0 text and lane 1 audio. */
		expect(axis.heightOf("scene")).toBe(LANE_HEIGHT_FALLBACK_PX.scene);
		expect(axis.heightOf("lane-0")).toBe(LANE_HEIGHT_FALLBACK_PX.short);
		expect(axis.heightOf("lane-1")).toBe(LANE_HEIGHT_FALLBACK_PX.audio);
		const { scene, short, audio } = LANE_HEIGHT_FALLBACK_PX;
		expect(scene).toBeGreaterThan(LANE_HEIGHT_FALLBACK_PX.visual);
		expect(LANE_HEIGHT_FALLBACK_PX.visual).toBeGreaterThan(audio);
		expect(audio).toBeGreaterThan(short);

		expect(axis.rowAt(0)).toBe("scene");
		expect(axis.rowAt(scene - 1)).toBe("scene");
		expect(axis.rowAt(scene)).toBe("lane-0");
		expect(axis.rowAt(scene + short)).toBe("lane-1");
		expect(axis.rowAt(scene + short + audio)).toBeUndefined();
	});

	test("measured heights win, per row, so a drag resolves to the lane drawn under the pointer", () => {
		const measured = createContentCrossAxis({
			trackFlags: () => TRACK_FLAGS,
			laneCount: () => 2,
			rowHeightsPx: () => [58, 26, 32],
		});
		expect(measured.heightOf("scene")).toBe(58);
		expect(measured.heightOf("lane-0")).toBe(26);
		expect(measured.heightOf("lane-1")).toBe(32);
		expect(measured.rowAt(57)).toBe("scene");
		expect(measured.rowAt(58)).toBe("lane-0");
		expect(measured.rowAt(58 + 25)).toBe("lane-0");
		expect(measured.rowAt(58 + 26)).toBe("lane-1");
		expect(measured.rowAt(58 + 26 + 31)).toBe("lane-1");
		expect(measured.rowAt(58 + 26 + 32)).toBeUndefined();
	});

	test("a missing or zero measurement falls back to the group height", () => {
		const partial = createContentCrossAxis({
			trackFlags: () => TRACK_FLAGS,
			laneCount: () => 2,
			rowHeightsPx: () => [58, 0],
		});
		expect(partial.heightOf("scene")).toBe(58);
		expect(partial.heightOf("lane-0")).toBe(LANE_HEIGHT_FALLBACK_PX.short);
		expect(partial.heightOf("lane-1")).toBe(LANE_HEIGHT_FALLBACK_PX.audio);
	});

	test("every lane group accepts exactly the clip kinds it is for", () => {
		for (const entry of LANE_ACCEPTANCE) {
			for (const kind of entry.accepts) {
				expect(
					groupAccepts(entry.group, kind),
					`${String(entry.group)} should accept ${kind}`,
				).toBe(true);
			}
			for (const kind of entry.refuses) {
				expect(
					groupAccepts(entry.group, kind),
					`${String(entry.group)} should refuse ${kind}`,
				).toBe(false);
			}
		}
		/* The table covers every group the vocabulary has, so a new group added
		 * without a row here fails rather than being silently unenumerated. */
		expect(
			LANE_ACCEPTANCE.filter((entry) => entry.group !== undefined)
				.map((entry) => entry.group)
				.sort((a, b) => (a ?? "").localeCompare(b ?? "")),
		).toEqual(["audio", "caption", "data", "effect", "text", "visual"]);
	});

	test("the scene row takes scenes and refuses overlay kinds", () => {
		const item = (kind: string): TimelineItem => ({
			id: `x-${kind}`,
			kind,
			start: projectTime(0),
			duration: projectTime(frames(30)),
		});
		expect(axis.accepts("scene", item("image"))).toBe(true);
		expect(axis.accepts("scene", item("video"))).toBe(true);
		expect(axis.accepts("scene", item("text"))).toBe(false);
		expect(axis.accepts("scene", item("audio"))).toBe(false);
		/* And a scene is refused by every free lane: it belongs to the render's
		 * spine, not to an overlay row. */
		expect(axis.accepts("lane-0", item("scene"))).toBe(false);
		expect(axis.accepts("lane-0", item("text"))).toBe(true);
		expect(axis.accepts("lane-1", item("text"))).toBe(false);
		expect(axis.accepts("lane-1", item("audio"))).toBe(true);
	});

	test("adding a lane is followed on the next lookup, with nothing to invalidate", () => {
		let lanes = 2;
		const growing = createContentCrossAxis({
			trackFlags: () => TRACK_FLAGS,
			laneCount: () => lanes,
		});
		const bottom =
			LANE_HEIGHT_FALLBACK_PX.scene + LANE_HEIGHT_FALLBACK_PX.short + LANE_HEIGHT_FALLBACK_PX.audio;
		expect(growing.rowAt(bottom)).toBeUndefined();
		lanes = 3;
		expect(growing.rowAt(bottom)).toBe("lane-2");
	});

	test("a refusing lane reroutes, the way the editor's own router does", () => {
		/* The editor relocates a clip dropped on a lane that does not take it to the
		 * nearest lane of its group. The adapter says the same thing, so the
		 * destination the projection reports is the one the drop uses — two rules
		 * for one question is what this migration exists to end. */
		expect(axis.refusal).toBe("reroute");
		const text: TimelineItem = {
			id: "text:9",
			kind: "text",
			start: projectTime(0),
			duration: projectTime(frames(30)),
		};
		/* Lane 1 is declared `audio`; the nearest `text` lane is lane 0. */
		expect(axis.accepts("lane-1", text)).toBe(false);
		expect(axis.reroute(text, "lane-1")).toBe("lane-0");
		/* And an UNDECLARED lane takes it, so a reroute never fires there. */
		const untyped = createContentCrossAxis({ trackFlags: () => ({}), laneCount: () => 2 });
		expect(untyped.accepts("lane-1", text)).toBe(true);
		/* And a clip whose group has no lane at all is not sent anywhere. */
		const effect: TimelineItem = {
			id: "effect:1",
			kind: "effect",
			start: projectTime(0),
			duration: projectTime(frames(30)),
		};
		expect(axis.reroute(effect, "lane-1")).toBeUndefined();
	});
});

describe("the ruler marks chapters, not scenes", () => {
	/* Two chapters over four scenes. The scene track is magnetic, so the clips are
	 * contiguous and each chapter's span is its own scenes' span. */
	function chapteredDoc(): EditorDoc {
		const s = (id: number, name: string, start: number, dur: number, sectionId: string): Clip =>
			clip(`scene-${id}`, "image", -1, start, dur, {
				scene: { ...scene(id, name, dur), sectionId },
				markerId: id,
			});
		return {
			schemaVersion: 2,
			clips: [
				s(1, "Opening", 0, 3, "s-a"),
				s(2, "Middle", 3, 4, "s-a"),
				s(3, "Turn", 7, 2, "s-b"),
				s(4, "Close", 9, 5, "s-b"),
			],
			markers: [1, 2, 3, 4].map((id) => ({
				id,
				title: `Scene ${id}`,
				clipIds: [`scene-${id}`],
				startSec: 0,
				endSec: 1,
			})),
			chapters: [
				{ id: "s-a", title: "Intro" },
				{ id: "s-b", title: "The Turn" },
			],
		};
	}

	const rulerOf = (doc: EditorDoc): Array<{ label: string; sec: number }> => {
		const adapter = createContentDocumentAdapter({ read: () => doc });
		return adapter.read().markers.map((m) => ({
			label: m.label ?? "",
			sec: m.at.ticks / (CONTENT_TIMEBASE.ticksPerFrame * 30),
		}));
	};

	test("one marker per chapter, at the start of its earliest scene", () => {
		expect(rulerOf(chapteredDoc())).toEqual([
			{ label: "Intro", sec: 0 },
			{ label: "The Turn", sec: 7 },
		]);
	});

	test("scenes in a single chapter give one marker, not one per scene", () => {
		const doc = chapteredDoc();
		const oneChapter: EditorDoc = {
			...doc,
			clips: doc.clips.map((c) => ({ ...c, scene: { ...c.scene!, sectionId: "s-a" } })),
			chapters: [{ id: "s-a", title: "Intro" }],
		};
		expect(rulerOf(oneChapter)).toEqual([{ label: "Intro", sec: 0 }]);
	});

	test("dragging a chapter marker writes nothing", () => {
		/* A chapter sits where its earliest scene sits, so a dragged position is one
		 * the next read recomputes away. Accepting the write would dirty the editor
		 * for an edit that cannot survive a reload. */
		const doc = chapteredDoc();
		const drag: Operation = {
			type: "marker",
			entries: [{ id: "chapter-s-b", fromTicks: frames(210), toTicks: frames(600) }],
		};
		/* No write at all: the editor turns a committed operation into writes, and
		 * a marker operation yields none, so nothing dirties the editor. */
		expect(contentEditsOf(drag)).toEqual([]);
		expect(rulerOf(doc)).toEqual([
			{ label: "Intro", sec: 0 },
			{ label: "The Turn", sec: 7 },
		]);
	});

	test("retiming a chapter's earliest scene moves its marker", () => {
		const doc = chapteredDoc();
		const later: EditorDoc = {
			...doc,
			// Both of the chapter's scenes move, so its EARLIEST is still scene-3.
			clips: doc.clips.map((c) =>
				c.id === "scene-3"
					? { ...c, startSec: 20 }
					: c.id === "scene-4"
						? { ...c, startSec: 22 }
						: c,
			),
		};
		expect(rulerOf(later).find((m) => m.label === "The Turn")?.sec).toBe(20);
	});

	test("a chapter with no scenes has no ruler marker", () => {
		/* It still exists — the script view renders it so an operator can write into
		 * a chapter before putting anything in it — but it has no position. */
		const doc = chapteredDoc();
		const withEmpty: EditorDoc = {
			...doc,
			chapters: [...doc.chapters!, { id: "s-c", title: "Unwritten" }],
		};
		expect(rulerOf(withEmpty).map((m) => m.label)).toEqual(["Intro", "The Turn"]);
	});
});

describe("dragging a scene's edge pins its duration", () => {
	test("a duration change pins the scene", () => {
		/* The operator saying how long the shot is means it stops following its
		 * speech — the same move as dragging a flex item to a fixed size. */
		expect(sceneEditPatch({ durSec: 6 }, { start: 0, dur: 4 })).toEqual({
			dur: 6,
			durMode: "pinned",
		});
	});

	test("a move does not pin", () => {
		// Where a scene sits says nothing about how long it should run.
		expect(sceneEditPatch({ startSec: 9 }, { start: 0, dur: 4 })).toEqual({ start: 9 });
	});

	test("a drag that resolves to no change pins nothing", () => {
		/* Writing an unchanged duration would pin a scene the operator only
		 * nudged, and an auto scene would silently stop following its speech. */
		expect(sceneEditPatch({ startSec: 0, durSec: 4 }, { start: 0, dur: 4 })).toEqual({});
	});

	test("a move and a resize together pin, and carry both", () => {
		expect(sceneEditPatch({ startSec: 2, durSec: 6 }, { start: 0, dur: 4 })).toEqual({
			start: 2,
			dur: 6,
			durMode: "pinned",
		});
	});
});
