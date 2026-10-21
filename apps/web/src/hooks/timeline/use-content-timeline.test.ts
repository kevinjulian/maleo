/* The content editor's gesture policy, as policy rather than as a hook.
 *
 * Everything asserted here is what the editor owns: the engagement rule, the
 * snap candidates, the resize quantum, and how a committed operation from the
 * engine's edit policies becomes the editor's writes.
 */
import { describe, expect, test } from "vite-plus/test";
import { observe, type GestureSample } from "@models/timeline-view/engagement.ts";
import { testEngine } from "@models/editor-engine/engine-fixture.ts";
import {
	openPolicyGesture,
	snapTicks,
	type TrimIntent,
} from "@models/editor-engine/policy-gesture.ts";
import { contentEditsOf } from "@models/timeline/content-edits.ts";
import type { Clip } from "@maleo/shared";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";
import {
	CONTENT_TIMEBASE,
	createContentDocumentAdapter,
} from "@models/timeline/content-document-adapter.ts";
import type { TimelineClip } from "@models/timeline/timeline-clips.ts";
import {
	COARSE_ENGAGEMENT,
	contentRecognizer,
	contentSnapCandidates,
	DRAG_QUANTUM_SEC,
	FINE_ENGAGEMENT,
	quantizeSeconds,
} from "./use-content-timeline.ts";

const ticks = (seconds: number): number =>
	Math.round(seconds * 30) * CONTENT_TIMEBASE.ticksPerFrame;

function samples(
	entries: ReadonlyArray<[elapsedMs: number, distancePx: number]>,
	coarse: boolean,
): GestureSample[] {
	return entries.map(([elapsedMs, distancePx]) => ({ elapsedMs, distancePx, coarse }));
}

/* ---- 15.4 One engagement rule ---------------------------------------------- */

describe("engagement", () => {
	test("a wobble never engages, on either pointer", () => {
		const wobble = samples(
			[
				[0, 0],
				[30, 2],
				[60, 3],
			],
			false,
		);
		expect(contentRecognizer(observe(wobble))).toBe(false);
		expect(
			contentRecognizer(
				observe(
					samples(
						wobble.map((sample) => [sample.elapsedMs, sample.distancePx!]),
						true,
					),
				),
			),
		).toBe(false);
	});

	test("a fast flick on a finger does not move a clip", () => {
		/* Twelve pixels inside ninety milliseconds is a flick, which on a timeline
		 * means throw the view — not move this clip by a frame. */
		const flick = observe(
			samples(
				[
					[0, 0],
					[40, 30],
				],
				true,
			),
		);
		expect(contentRecognizer(flick)).toBe(false);
		/* The same travel, held past the hold, is a deliberate drag. */
		const held = observe(
			samples(
				[
					[0, 0],
					[40, 30],
					[120, 32],
				],
				true,
			),
		);
		expect(contentRecognizer(held)).toBe(true);
	});

	test("a mouse that moves four pixels while held down meant to", () => {
		expect(
			contentRecognizer(
				observe(
					samples(
						[
							[0, 0],
							[16, 4],
						],
						false,
					),
				),
			),
		).toBe(true);
		expect(
			contentRecognizer(
				observe(
					samples(
						[
							[0, 0],
							[16, 3],
						],
						false,
					),
				),
			),
		).toBe(false);
	});

	test("there is exactly one engagement rule, and these are its thresholds", () => {
		/* The AND is the part that could not be expressed before, and is why there
		 * were two gates — the library's looser one in front of this one. */
		expect(FINE_ENGAGEMENT).toEqual({ distancePx: 4, holdMs: 0 });
		expect(COARSE_ENGAGEMENT).toEqual({ distancePx: 12, holdMs: 90 });
		/* A coarse press that is far enough but not old enough is refused, which a
		 * distance-OR-hold rule would have accepted. */
		expect(
			contentRecognizer(
				observe(
					samples(
						[
							[0, 0],
							[50, 40],
						],
						true,
					),
				),
			),
		).toBe(false);
	});

	test("a sample carrying no pixel evidence engages nothing", () => {
		/* The library folds this rule in one place, and the editor inherits it: a
		 * threshold inferred from elapsed time would vary with the current zoom. */
		expect(contentRecognizer(observe([{ elapsedMs: 500, coarse: true }]))).toBe(false);
	});
});

/* ---- Snap candidates ------------------------------------------------------- */

describe("snap candidates", () => {
	const clips: TimelineClip[] = [
		{
			id: "text:1",
			source: "text",
			refId: 1,
			start: 2,
			dur: 3,
			track: 0,
			label: "Title",
		} as TimelineClip,
		{
			id: "audio:2",
			source: "audio",
			refId: 2,
			start: 6,
			dur: 4,
			track: 1,
			label: "VO",
		} as TimelineClip,
	];

	test("everything a cut can land on is offered, and each says what it is", () => {
		const candidates = contentSnapCandidates({
			totalSec: 12,
			playheadSec: 5,
			sceneBoundaries: [0, 4, 9],
			beatTimes: [1, 2, 3],
			clips,
		});
		const kinds = new Set(candidates.map((candidate) => candidate.kind));
		expect([...kinds].sort()).toEqual([
			"beat",
			"clip-end",
			"clip-start",
			"playhead",
			"project-end",
			"project-start",
			"scene-boundary",
		]);
		expect(candidates.find((candidate) => candidate.kind === "playhead")!.ticks).toBe(ticks(5));
		expect(candidates.filter((candidate) => candidate.kind === "beat").length).toBe(3);
	});

	test("a clip's own edges carry its identity, so a group cannot snap to itself", () => {
		const candidates = contentSnapCandidates({
			totalSec: 12,
			playheadSec: 5,
			sceneBoundaries: [],
			beatTimes: [],
			clips,
		});
		const own = candidates.filter((candidate) => candidate.itemId === "text:1");
		expect(own.map((candidate) => candidate.ticks)).toEqual([ticks(2), ticks(5)]);

		/* The exclusion is the engine's, applied to the candidates supplied here.
		 * Dragging `text:1` to 6s finds the audio clip's start, not its own edge. */
		const result = snapTicks(testEngine, ticks(5.9), candidates, {
			thresholdPx: 8,
			scale: 60 / (30 * CONTENT_TIMEBASE.ticksPerFrame),
			moving: ["text:1"],
		});
		expect(result.candidate?.itemId).toBe("audio:2");
		expect(result.ticks).toBe(ticks(6));
	});

	test("the beat grid contributes only when the editor supplies beats", () => {
		const off = contentSnapCandidates({
			totalSec: 12,
			playheadSec: 0,
			sceneBoundaries: [],
			beatTimes: [],
			clips: [],
		});
		expect(off.some((candidate) => candidate.kind === "beat")).toBe(false);
	});
});

/* ---- The resize quantum ---------------------------------------------------- */

describe("resize quantum", () => {
	test("a resize lands on the editor's grid, and Alt bypasses it", () => {
		expect(DRAG_QUANTUM_SEC).toBe(0.1);
		expect(quantizeSeconds(1.24, false)).toBeCloseTo(1.2, 6);
		expect(quantizeSeconds(1.26, false)).toBeCloseTo(1.3, 6);
		expect(quantizeSeconds(1.2345, true)).toBe(1.2345);
	});
});

/* ---- Ripple editing ---------------------------------------------------------- */

describe("ripple trim reaches the document whole", () => {
	const textClip = (
		id: string,
		track: number,
		startSec: number,
		durationSec: number,
		ref: number,
	): Clip => ({
		id,
		type: "text",
		track,
		startSec,
		durationSec,
		text: { id: ref, content: id, start: startSec, dur: durationSec, preset: "lower-third" },
	});
	/* Three clips on lane 0 with gaps, and one on lane 1 level with the second. */
	const doc: EditorDoc = {
		schemaVersion: 2,
		clips: [
			textClip("text:1", 0, 0, 2, 1),
			textClip("text:2", 0, 3, 2, 2),
			textClip("text:3", 0, 6, 2, 3),
			textClip("text:4", 1, 3, 2, 4),
		],
		markers: [],
	};
	const state = () => createContentDocumentAdapter({ read: () => doc }).read();
	/* Through the engine's edit policies, as the editor runs a trim. */
	const editsFor = (kind: TrimIntent["kind"]) => {
		const gesture = openPolicyGesture(
			testEngine,
			"t",
			state(),
			{ policy: "trim", id: "text:1", edge: "end", kind },
			undefined,
		);
		gesture.update({ deltaTicks: -ticks(1) });
		const result = gesture.commit();
		if (!result.ok || !result.operation) throw new Error("the trim did not commit");
		return new Map(contentEditsOf(result.operation).map((edit) => [edit.clipId, edit]));
	};

	test("a ripple trim shifts every later clip on its lane by the applied delta, and nothing else", () => {
		const edits = editsFor("ripple");
		expect(edits.get("text:1")?.durSec).toBe(1);
		expect(edits.get("text:2")?.startSec).toBe(2);
		expect(edits.get("text:3")?.startSec).toBe(5);
		expect(edits.has("text:4")).toBe(false);
	});

	test("a plain trim moves only the trimmed clip", () => {
		const edits = editsFor("trim");
		expect(edits.get("text:1")?.durSec).toBe(1);
		expect([...edits.keys()]).toEqual(["text:1"]);
	});
});
