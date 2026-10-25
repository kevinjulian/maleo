import { applyCommand, invertCommand } from "@maleo/shared/editor";
import { expect, test } from "vite-plus/test";
import { toTimelineDoc } from "@maleo/shared";
import { createCommandLedger } from "@models/chat/command-ledger.ts";
import {
	clipAnimationInfo,
	editClipKey,
	keyMoments,
	momentKeyEasings,
	moveClipKey,
	moveMoment,
	moveMoments,
	removeClipKey,
	copyClipKeys,
	pasteClipKeys,
	setMomentEasing,
	setMomentsEasing,
	type ClipAnimationTarget,
} from "./clip-animation-edit.ts";
import { canvasEditOf } from "@models/editor-engine/canvas-document.ts";
import type { EditScope } from "@maleo/shared/editor";
import { editorExecutor } from "@maleo/shared/editor";

const doc = toTimelineDoc(
	[
		{
			id: 1,
			name: "Scene",
			shot: "Wide",
			move: "Static",
			vis: "",
			vo: "Narration stays",
			img: true,
			src: "image.png",
			dur: 4,
			visualClips: [
				{
					id: "image",
					kind: "image",
					label: "Image",
					url: "image.png",
					startSec: 0,
					durationSec: 4,
				},
			],
		},
	],
	[{ id: 2, kind: "video", url: "video.mp4", start: 8, dur: 4, volume: 0.7 }],
	[],
	[{ id: 3, kind: "voiceover", content: "Voice", start: 12, dur: 4, volume: 0.8 }],
);
const scope: EditScope = { doc, slides: [], posts: [], mediaAssets: [] };

test("visual/audio keys edit, move, remove and compatible paste through one reversible command", () => {
	for (const target of [
		{ source: "scene", id: 1, visualId: "image" },
		{ source: "video", id: 2 },
		{ source: "audio", id: 3 },
	] satisfies ClipAnimationTarget[]) {
		const property = target.source === "audio" ? "volume" : "xPct";
		const ledger = createCommandLedger(editorExecutor),
			first = editClipKey(scope, target, property, 0, 0.2),
			seeded = applyCommand(scope, first);
		ledger.record(first, scope);
		expect(ledger.undo(seeded)).toEqual(scope);
		expect(ledger.redo(scope)).toEqual(seeded);
		const end = applyCommand(seeded, editClipKey(seeded, target, property, 4, 0.8, "in-out"));
		expect(clipAnimationInfo(end.doc, target)?.animation?.tracks[property]).toEqual([
			{ t: 0, v: 0.2, easing: "linear" },
			{ t: 4, v: 0.8, easing: "in-out" },
		]);
		const moved = applyCommand(end, moveClipKey(end, target, property, 1, 3));
		expect(clipAnimationInfo(moved.doc, target)?.animation?.tracks[property]?.[1]?.t).toBe(3);
		// The whole-clip clipboard pastes back onto a cleared clip, and undoes in one step.
		const clipboard = copyClipKeys(moved.doc, target)!;
		const one = applyCommand(moved, removeClipKey(moved, target, property, 1)),
			bare = applyCommand(one, removeClipKey(one, target, property, 0));
		const pasted = applyCommand(bare, pasteClipKeys(bare, target, clipboard));
		expect(clipAnimationInfo(pasted.doc, target)?.animation?.tracks[property]).toEqual(
			clipboard.tracks[property],
		);
		expect(
			applyCommand(pasted, invertCommand(bare, pasteClipKeys(bare, target, clipboard))),
		).toEqual(bare);
		const removed = applyCommand(moved, removeClipKey(moved, target, property, 1));
		expect(clipAnimationInfo(removed.doc, target)?.animation?.tracks[property]).toHaveLength(1);
		expect(scope.doc).toEqual(doc);
		expect(pasted.mediaAssets).toEqual(scope.mediaAssets);
		expect(pasted.doc.clips.map((c) => [c.id, c.startSec, c.durationSec])).toEqual(
			doc.clips.map((c) => [c.id, c.startSec, c.durationSec]),
		);
	}
});

test("key commands reject locked tracks, invalid gains/times, collisions and incompatible clipboard units atomically", () => {
	const target: ClipAnimationTarget = { source: "video", id: 2 };
	const keyed = applyCommand(scope, editClipKey(scope, target, "volume", 0, 0.7));
	for (const time of [-1, 5, NaN])
		expect(() => editClipKey(keyed, target, "volume", time, 0.5)).toThrow();
	expect(() => editClipKey(keyed, target, "volume", 1, 2)).toThrow();
	expect(() =>
		editClipKey(
			{ ...keyed, doc: { ...keyed.doc, trackFlags: { 0: { locked: true } } } },
			target,
			"volume",
			1,
			0.5,
		),
	).toThrow("locked");
	const two = applyCommand(keyed, editClipKey(keyed, target, "volume", 4, 0.3));
	expect(() => moveClipKey(two, target, "volume", 1, 0)).toThrow("increase");
	expect(() =>
		pasteClipKeys(two, { source: "audio", id: 3 }, { tracks: { xPct: [{ t: 0, v: 0 }] } }),
	).toThrow("Nothing copied applies");
	expect(() =>
		editClipKey(scope, { source: "scene", id: 1, visualId: "image" }, "volume", 1, 0.5),
	).toThrow("no source volume");
	expect(() => editClipKey(scope, { source: "audio", id: 3 }, "xPct", 1, 0.5)).toThrow();
	expect(clipAnimationInfo(two.doc, target)?.animation?.tracks.volume).toHaveLength(2);
});

test("every key builder constructs clip.setKeys at the call site", () => {
	const target: ClipAnimationTarget = { source: "video", id: 2 };
	const first = editClipKey(scope, target, "xPct", 0, 10),
		seeded = applyCommand(scope, first);
	const second = editClipKey(seeded, target, "xPct", 4, 30),
		two = applyCommand(seeded, second);
	for (const command of [
		first,
		second,
		moveClipKey(two, target, "xPct", 1, 3),
		removeClipKey(two, target, "xPct", 0),
	]) {
		expect(command.type).toBe("clip.setKeys");
		if (command.type === "clip.setKeys") expect(command.id).toBe("video:2");
	}
	expect(pasteClipKeys(scope, target, { tracks: { opacity: [{ t: 0, v: 0.5 }] } }).type).toBe(
		"clip.setKeys",
	);
});

test("text overlays key through the same builders", () => {
	const withOverlays = toTimelineDoc(
		[],
		[],
		[
			{
				id: 5,
				content: "Title",
				start: 1,
				dur: 3,
				preset: "title",
				style: { fontFamily: "Inter", fontSize: 48, weight: 800, fill: "#ffffff", align: "center" },
			},
		],
	);
	const textScope: EditScope = {
		doc: withOverlays,
		slides: [],
		posts: [],
		mediaAssets: [],
	};
	const text: ClipAnimationTarget = { source: "text", id: 5 };
	const sized = applyCommand(textScope, editClipKey(textScope, text, "fontSize", 2));
	expect(clipAnimationInfo(sized.doc, text)?.animation?.tracks.fontSize).toEqual([
		{ t: 2, v: 48, easing: "linear" },
	]);
	expect(clipAnimationInfo(sized.doc, text)?.properties).toContain("letterSpacing");
	expect(() => editClipKey(textScope, text, "volume", 0, 1)).toThrow("no source volume");
});

test("row and canvas edits near an existing key update it instead of adding one", () => {
	const target: ClipAnimationTarget = { source: "video", id: 2 };
	const keyed = applyCommand(
		applyCommand(scope, editClipKey(scope, target, "opacity", 0, 0)),
		editClipKey(
			applyCommand(scope, editClipKey(scope, target, "opacity", 0, 0)),
			target,
			"opacity",
			2,
			1,
		),
	);
	const near = applyCommand(keyed, editClipKey(keyed, target, "opacity", 2.05, 0.5));
	expect(clipAnimationInfo(near.doc, target)?.animation?.tracks.opacity).toEqual([
		{ t: 0, v: 0, easing: "linear" },
		{ t: 2, v: 0.5, easing: "linear" },
	]);
	const far = applyCommand(keyed, editClipKey(keyed, target, "opacity", 2.2, 0.5));
	expect(clipAnimationInfo(far.doc, target)?.animation?.tracks.opacity).toHaveLength(3);
	const canvas = applyCommand(
		keyed,
		canvasEditOf(keyed.doc, { source: "video", id: 2 }, { opacity: 0.3 }, 8 + 2.05),
	);
	expect(clipAnimationInfo(canvas.doc, target)?.animation?.tracks.opacity).toEqual([
		{ t: 0, v: 0, easing: "linear" },
		{ t: 2, v: 0.3, easing: "linear" },
	]);
});

test("moments merge keys within a frame across properties and edit as one batch", () => {
	const target: ClipAnimationTarget = { source: "video", id: 2 };
	let s = scope;
	for (const [p, t, v] of [
		["xPct", 2, 10],
		["scale", 2.01, 1.2],
		["opacity", 3, 0.5],
	] as const)
		s = applyCommand(s, editClipKey(s, target, p, t, v));
	const animation = clipAnimationInfo(s.doc, target)?.animation;
	expect(keyMoments(animation)).toEqual([
		{ time: 2, properties: ["xPct", "scale"] },
		{ time: 3, properties: ["opacity"] },
	]);
	const move = moveMoment(s, target, 2, 2.5),
		moved = applyCommand(s, move);
	expect(move.type).toBe("batch");
	const after = clipAnimationInfo(moved.doc, target)?.animation;
	expect(after?.tracks.xPct?.[0]?.t).toBe(2.5);
	expect(after?.tracks.scale?.[0]?.t).toBe(2.5);
	expect(after?.tracks.opacity?.[0]?.t).toBe(3);
	expect(applyCommand(moved, invertCommand(s, move))).toEqual(s);
	const removed = applyCommand(s, moveMoment(s, target, 2));
	expect(keyMoments(clipAnimationInfo(removed.doc, target)?.animation)).toEqual([
		{ time: 3, properties: ["opacity"] },
	]);
	const eased = applyCommand(s, setMomentEasing(s, target, 2, "hold"));
	expect(momentKeyEasings(clipAnimationInfo(eased.doc, target)?.animation, 2)).toEqual([
		"hold",
		"hold",
	]);
	const withSecond = applyCommand(s, editClipKey(s, target, "xPct", 3, 40));
	expect(() => moveMoment(withSecond, target, 2, 3)).toThrow("increase");
});

test("a multi-moment selection moves, deletes and eases together as one batch", () => {
	const target: ClipAnimationTarget = { source: "video", id: 2 };
	let s = scope;
	for (const [p, t, v] of [
		["xPct", 1, 10],
		["scale", 1, 1.2],
		["opacity", 2, 0.5],
	] as const)
		s = applyCommand(s, editClipKey(s, target, p, t, v));
	const move = moveMoments(s, target, [1, 2], 0.5),
		moved = applyCommand(s, move);
	const after = clipAnimationInfo(moved.doc, target)?.animation;
	expect([
		after?.tracks.xPct?.[0]?.t,
		after?.tracks.scale?.[0]?.t,
		after?.tracks.opacity?.[0]?.t,
	]).toEqual([1.5, 1.5, 2.5]);
	expect(applyCommand(moved, invertCommand(s, move))).toEqual(s);
	// The clip is 4 s: a shift past its end is clamped so the selection keeps its spacing.
	const clamped = clipAnimationInfo(
		applyCommand(s, moveMoments(s, target, [1, 2], 5)).doc,
		target,
	)?.animation;
	expect([clamped?.tracks.xPct?.[0]?.t, clamped?.tracks.opacity?.[0]?.t]).toEqual([3, 4]);
	expect(
		keyMoments(
			clipAnimationInfo(applyCommand(s, moveMoments(s, target, [1, 2])).doc, target)?.animation,
		),
	).toEqual([]);
	const eased = applyCommand(s, setMomentsEasing(s, target, [1, 2], "hold"));
	expect([
		...momentKeyEasings(clipAnimationInfo(eased.doc, target)?.animation, 1),
		...momentKeyEasings(clipAnimationInfo(eased.doc, target)?.animation, 2),
	]).toEqual(["hold", "hold", "hold"]);
	expect(() => moveMoments(s, target, [])).toThrow("No keys selected");
});

test("property selection eases only selected keys and preserves neighboring tracks in one undo", () => {
	const target: ClipAnimationTarget = { source: "video", id: 2 };
	let s = scope;
	for (const [p, t, v] of [
		["xPct", 1, 10],
		["xPct", 2, 20],
		["opacity", 1, 0.5],
	] as const)
		s = applyCommand(s, editClipKey(s, target, p, t, v));
	const command = setMomentsEasing(s, target, [1], "out", "xPct"),
		after = applyCommand(s, command);
	const animation = clipAnimationInfo(after.doc, target)?.animation;
	expect(animation?.tracks.xPct?.map((k) => k.easing)).toEqual(["out", "linear"]);
	expect(animation?.tracks.opacity).toEqual(
		clipAnimationInfo(s.doc, target)?.animation?.tracks.opacity,
	);
	expect(applyCommand(after, invertCommand(s, command))).toEqual(s);
});
