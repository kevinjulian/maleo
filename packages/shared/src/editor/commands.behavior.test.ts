import { describe, expect, test } from "vite-plus/test";
import type { Clip, SceneMarker } from "../timeline-doc.ts";
import type { EditorDoc, EditScope } from "./scope.ts";
import {
	batch,
	insertClip,
	insertPost,
	insertSlide,
	moveClip,
	removeClip,
	removeMarker,
	removePost,
	removeSlide,
	replaceScope,
	resizeClip,
	setCaptions,
	updateClip,
	updateMarker,
	updatePost,
	updateSlide,
	upsertMarker,
	trimClipAtPlayhead,
} from "./commands.ts";
import { invertCommand, applyCommand } from "./engine-registry.ts";

const clip = (id: string, over: Partial<Clip> = {}): Clip => ({
	id,
	type: "text",
	startSec: 0,
	durationSec: 2,
	track: 0,
	...over,
});
const marker = (id: number, over: Partial<SceneMarker> = {}): SceneMarker => ({
	id,
	title: `M${id}`,
	clipIds: [],
	startSec: 0,
	endSec: 1,
	...over,
});
const doc = (clips: Clip[] = [], markers: SceneMarker[] = []): EditorDoc => ({
	schemaVersion: 2,
	clips,
	markers,
});
const scope = (over: Partial<EditScope> = {}): EditScope => ({
	doc: doc(),
	slides: [],
	posts: [],
	mediaAssets: [],
	...over,
});

// Round-trip: apply then invert must restore the exact prior scope (deep-equal).
function roundTrip(before: EditScope, cmd: ReturnType<typeof insertClip>): void {
	const after = applyCommand(before, cmd);
	const restored = applyCommand(after, invertCommand(before, cmd));
	expect(restored).toEqual(before);
}

describe("clip commands", () => {
	test("resize commands share measured media bounds and restore exact source timing", () => {
		for (const reverse of [false, true])
			for (const rate of [0.25, 1, 4]) {
				const before = scope({
					mediaAssets: [
						{
							id: "measured",
							kind: "video",
							label: "Source",
							source: "upload",
							url: "source.mp4",
							metadata: {
								kind: "video",
								originalFilename: "source.mp4",
								byteSize: 40,
								duration: 20,
							},
						},
					],
					doc: doc([
						clip("video:1", {
							type: "video",
							startSec: 2,
							durationSec: 4,
							video: {
								id: 1,
								mediaAssetId: "measured",
								kind: "video",
								url: "source.mp4",
								start: 2,
								dur: 4,
								mediaStartSec: 3,
								layout: {
									xPct: 0,
									yPct: 0,
									widthPct: 100,
									fit: "contain",
									playbackRate: rate,
									reverse,
								},
							},
						}),
					]),
				});
				const command = resizeClip("video:1", { durationSec: 100 }),
					after = applyCommand(before, command),
					result = after.doc.clips[0]!;
				expect(result.durationSec).toBeCloseTo(reverse ? 4 + 3 / rate : 17 / rate, 8);
				expect(result.video?.mediaStartSec).toBe(reverse ? 0 : 3);
				expect(applyCommand(after, invertCommand(before, command))).toEqual(before);
				expect(applyCommand(before, resizeClip("video:1", { durationSec: 0 }))).toBe(before);
			}
	});
	test("playhead trims retain source interval at rate/direction, fix neighbors and undo exactly", () => {
		for (const reverse of [false, true])
			for (const side of ["before", "after"] as const) {
				const before = scope({
					doc: doc([
						clip("video:1", {
							type: "video",
							startSec: 2,
							durationSec: 4,
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
									playbackRate: 2,
									reverse,
								},
							},
						}),
						clip("text:2", { startSec: 8 }),
					]),
				});
				const command = trimClipAtPlayhead("video:1", 3, side),
					after = applyCommand(before, command);
				expect(after.doc.clips[0]).toMatchObject({
					startSec: side === "before" ? 3 : 2,
					durationSec: side === "before" ? 3 : 1,
				});
				expect(after.doc.clips[0]?.video?.mediaStartSec).toBe(
					reverse ? (side === "before" ? 3 : 9) : side === "before" ? 5 : 3,
				);
				expect(after.doc.clips[1]).toBe(before.doc.clips[1]);
				expect(applyCommand(after, invertCommand(before, command))).toEqual(before);
				for (const at of [0, 2, 6, 8])
					expect(applyCommand(before, trimClipAtPlayhead("video:1", at, side))).toBe(before);
				const snapshot = JSON.stringify(before);
				expect(() => applyCommand(before, trimClipAtPlayhead("video:1", NaN, side))).toThrow(
					"InvalidInput",
				);
				expect(JSON.stringify(before)).toBe(snapshot);
				const locked = { ...before, doc: { ...before.doc, trackFlags: { 0: { locked: true } } } };
				expect(applyCommand(locked, command)).toBe(locked);
			}
	});
	test("apply returns a new scope and does not mutate the input", () => {
		const before = scope({ doc: doc([clip("text:1")]) });
		const frozenClips = before.doc.clips;
		const after = applyCommand(before, insertClip(clip("text:2")));
		expect(after).not.toBe(before);
		expect(after.doc.clips).toHaveLength(2);
		expect(before.doc.clips).toBe(frozenClips); // untouched
		expect(before.doc.clips).toHaveLength(1);
	});

	test("insert / remove / update / move / resize invert losslessly", () => {
		const before = scope({ doc: doc([clip("text:1"), clip("text:2", { startSec: 5, track: 1 })]) });
		roundTrip(before, insertClip(clip("text:9")));
		roundTrip(before, insertClip(clip("text:9"), 1));
		roundTrip(before, removeClip("text:2"));
		roundTrip(before, updateClip("text:1", { durationSec: 9, track: 3 }));
		roundTrip(before, moveClip("text:2", { startSec: 12, track: 2 }));
		roundTrip(before, resizeClip("text:1", { durationSec: 7, startSec: 1 }));
	});

	test("move updates timing; invert restores it exactly", () => {
		const before = scope({ doc: doc([clip("text:1", { startSec: 3, track: 0 })]) });
		const cmd = moveClip("text:1", { startSec: 10, track: 2 });
		const after = applyCommand(before, cmd);
		expect(after.doc.clips[0]).toMatchObject({ startSec: 10, track: 2 });
		expect(applyCommand(after, invertCommand(before, cmd)).doc.clips[0]).toMatchObject({
			startSec: 3,
			track: 0,
		});
	});
});

describe("marker commands", () => {
	test("upsert inserts then updates; invert restores", () => {
		const empty = scope({ doc: doc([], []) });
		roundTrip(empty, upsertMarker(marker(1)));
		const withOne = scope({ doc: doc([], [marker(1, { title: "old" })]) });
		roundTrip(withOne, upsertMarker(marker(1, { title: "new" })));
		roundTrip(withOne, updateMarker(1, { title: "renamed" }));
		roundTrip(withOne, removeMarker(1));
	});
	test("undoing a removal puts the marker back where it was", () => {
		const three = scope({ doc: doc([], [marker(1), marker(2), marker(3)]) });
		roundTrip(three, removeMarker(1));
		roundTrip(three, removeMarker(2));
	});
	test("an upsert index places a new marker and is ignored for an existing one", () => {
		const two = scope({ doc: doc([], [marker(1), marker(2)]) });
		expect(applyCommand(two, upsertMarker(marker(9), 0)).doc.markers.map((m) => m.id)).toEqual([
			9, 1, 2,
		]);
		expect(
			applyCommand(two, upsertMarker(marker(2, { title: "x" }), 0)).doc.markers.map((m) => m.id),
		).toEqual([1, 2]);
	});
});

describe("doc-field commands", () => {
	test("setCaptions invert restores prior (incl. undefined)", () => {
		const before = scope();
		const cmd = setCaptions({ enabled: true } as never);
		const after = applyCommand(before, cmd);
		expect(after.doc.captions).toEqual({ enabled: true } as never);
		expect(applyCommand(after, invertCommand(before, cmd)).doc.captions).toBeUndefined();
	});
});

describe("slide / post twins", () => {
	const s = (id: number) => ({ key: `slide_${id}`, id, cap: "c", vis: "v", img: false });
	const p = (id: number) => ({ key: `post_${id}`, id, body: "b", img: false });
	test("slide insert/remove/update invert losslessly", () => {
		const before = scope({ slides: [s(1), s(2)] });
		roundTrip(before, insertSlide(s(9)));
		roundTrip(before, removeSlide(1));
		roundTrip(before, updateSlide(2, { cap: "x" }));
	});
	test("post insert/remove/update invert losslessly", () => {
		const before = scope({ posts: [p(1), p(2)] });
		roundTrip(before, insertPost(p(9)));
		roundTrip(before, removePost(1));
		roundTrip(before, updatePost(2, { body: "x" }));
	});
	test("update inverses remove a field the patch added", () => {
		roundTrip(scope({ slides: [s(1), s(2)] }), updateSlide(2, { name: "added" }));
		roundTrip(scope({ posts: [p(1), p(2)] }), updatePost(2, { seed: 7 }));
	});
});

describe("batch", () => {
	test("applies in order and inverts as one reversed unit", () => {
		const before = scope({ doc: doc([clip("text:1")]) });
		const cmd = batch([
			insertClip(clip("text:2")),
			updateClip("text:1", { durationSec: 8 }),
			removeClip("text:1"),
		]);
		const after = applyCommand(before, cmd);
		expect(after.doc.clips.map((c) => c.id)).toEqual(["text:2"]);
		expect(applyCommand(after, invertCommand(before, cmd))).toEqual(before);
	});
});

describe("replaceScope", () => {
	test("replaces wholesale and inverts to the prior scope", () => {
		const before = scope({ doc: doc([clip("text:1")]) });
		const next = scope({ doc: doc([clip("video:1", { type: "video" })]) });
		const cmd = replaceScope(next);
		expect(applyCommand(before, cmd)).toBe(next);
		expect(applyCommand(next, invertCommand(before, cmd))).toEqual(before);
	});
});
