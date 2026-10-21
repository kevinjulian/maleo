import { expect, test } from "vite-plus/test";
import { readStoryboardDocument, toTimelineDoc, type ClipLayout } from "@maleo/shared";
import {
	patchCanvasLayout,
	resizeCanvasLayout,
	resizeLayoutValue,
	canvasClipLayout,
	canvasEditCommand,
	sampledCanvasLayout,
} from "./canvas-transform.ts";
import { diffScopeToCommand } from "@maleo/shared/editor";
import { createCommandLedger } from "@models/chat/command-ledger.ts";
import { applyCommand, invertCommand, type EditScope } from "@maleo/shared/editor";
import { editorExecutor } from "@maleo/shared/editor";

test("rotated resize keeps opposite corner fixed and aspect lock preserves ratio", () => {
	const initial: ClipLayout = {
		xPct: 10,
		yPct: 20,
		widthPct: 40,
		heightPct: 30,
		fit: "contain",
		rotationDeg: 90,
		aspectLocked: true,
	};
	const canvas = { w: 800, h: 450 };
	const resized = { ...initial, ...resizeCanvasLayout(initial, "se", -20, 40, canvas, true) };
	const corner = (l: ClipLayout): number[] => {
		const w = (l.widthPct * canvas.w) / 100,
			h = (l.heightPct! * canvas.h) / 100;
		return [(l.xPct * canvas.w) / 100 + w / 2 + h / 2, (l.yPct * canvas.h) / 100 + h / 2 - w / 2];
	};
	const before = corner(initial),
		after = corner(resized);
	expect(after[0]).toBeCloseTo(before[0]!, 8);
	expect(after[1]).toBeCloseTo(before[1]!, 8);
	expect(resized.widthPct / resized.heightPct!).toBeCloseTo(
		initial.widthPct / initial.heightPct!,
		8,
	);
	expect(resizeLayoutValue(initial, "widthPct", 80)).toEqual({ widthPct: 80, heightPct: 60 });
	const minimum = resizeCanvasLayout(initial, "nw", 10000, -10000, canvas, true);
	expect(minimum.widthPct).toBeGreaterThanOrEqual(2);
	expect(minimum.heightPct).toBeGreaterThanOrEqual(2);
});

test("transient transform is immutable; commit merges live data, undoes once, and refuses locks", () => {
	const doc = toTimelineDoc(
		[],
		[{ id: 2, start: 0, dur: 4, kind: "image", url: "/api/media/source", track: 1 }],
		[{ id: 1, start: 0, dur: 4, content: "Before", preset: "title", track: 0 }],
	);
	const original = structuredClone(doc);
	const target = { source: "text" as const, id: 1 };
	const preview = patchCanvasLayout(doc, target, { rotationDeg: 45, aspectLocked: true });
	expect(doc).toEqual(original);
	expect(preview.clips.find((c) => c.text)?.text?.layout?.rotationDeg).toBe(45);
	const live = {
		...doc,
		clips: doc.clips.map((c) =>
			c.text ? { ...c, text: { ...c.text, content: "Agent update" } } : c,
		),
	};
	const before: EditScope = { doc: live, slides: [], posts: [], mediaAssets: [] };
	const after = {
		...before,
		doc: patchCanvasLayout(live, target, { rotationDeg: 60, aspectLocked: true }),
	};
	expect(after.doc.clips.find((c) => c.text)?.text?.content).toBe("Agent update");
	expect(after.doc.clips.find((c) => c.video)).toEqual(live.clips.find((c) => c.video));
	const ledger = createCommandLedger(editorExecutor);
	ledger.record(diffScopeToCommand(before, after), before);
	expect(ledger.depths()).toEqual({ undo: 1, redo: 0 });
	expect(ledger.undo(after)).toEqual(before);
	expect(ledger.redo(before)).toEqual(after);
	const locked = { ...doc, trackFlags: { 0: { locked: true } } };
	expect(patchCanvasLayout(locked, target, { rotationDeg: 90 })).toBe(locked);
	expect(patchCanvasLayout(doc, { source: "text", id: 99 }, { rotationDeg: 90 })).toBe(doc);
});

test("source crop and flips persist without replacing source, reject invalid windows and reset in one undo", () => {
	const doc = toTimelineDoc(
		[
			{
				id: 1,
				name: "Scene",
				shot: "Wide",
				move: "Static",
				vis: "",
				vo: "",
				img: true,
				dur: 4,
				src: "/api/media/scene",
			},
		],
		[{ id: 2, start: 0, dur: 4, kind: "image", url: "/api/media/source", track: 1 }],
	);
	for (const target of [
		{ source: "video", id: 2 },
		{ source: "scene", id: 1 },
	] as const) {
		const crop = { xPct: 25, yPct: 0, widthPct: 50, heightPct: 100 };
		const edited = patchCanvasLayout(doc, target, { crop, flipX: true, flipY: true });
		const decoded = readStoryboardDocument(JSON.parse(JSON.stringify(edited))).doc;
		const loaded = { ...edited, clips: decoded.clips };
		const clip = loaded.clips.find((clip) =>
			target.source === "scene" ? clip.scene?.id === target.id : clip.video?.id === target.id,
		)!;
		expect((clip.scene ?? clip.video)?.layout).toMatchObject({ crop, flipX: true, flipY: true });
		expect(clip.scene?.src ?? clip.video?.url).toBe(
			target.source === "scene" ? "/api/media/scene" : "/api/media/source",
		);
		expect(patchCanvasLayout(loaded, target, { crop: { ...crop, widthPct: 90 } })).toBe(loaded);
		const locked = {
			...loaded,
			trackFlags: { [target.source === "scene" ? -1 : 1]: { locked: true } },
		};
		expect(patchCanvasLayout(locked, target, { flipX: false })).toBe(locked);
		const before: EditScope = { doc: loaded, slides: [], posts: [], mediaAssets: [] };
		const after = {
			...before,
			doc: patchCanvasLayout(loaded, target, { crop: undefined, flipX: false, flipY: false }),
		};
		const ledger = createCommandLedger(editorExecutor);
		ledger.record(diffScopeToCommand(before, after), before);
		expect(ledger.depths()).toEqual({ undo: 1, redo: 0 });
		expect(ledger.undo(after)).toEqual(before);
		expect(ledger.redo(before)).toEqual(after);
	}
});

test("animated boxes sample clip-local position/scale and canvas edits key the current frame without changing endpoints", () => {
	const layout = {
		xPct: 0,
		yPct: 0,
		widthPct: 50,
		heightPct: 50,
		fit: "contain" as const,
		animation: {
			tracks: {
				xPct: [
					{ t: 0, v: 0 },
					{ t: 4, v: 40 },
				],
				scale: [
					{ t: 0, v: 1 },
					{ t: 4, v: 2 },
				],
			},
		},
	};
	const keyed = toTimelineDoc(
		[
			{
				id: 1,
				name: "Scene",
				shot: "Wide",
				move: "Static",
				vis: "",
				vo: "",
				img: true,
				src: "image.png",
				dur: 4,
				visualClips: [
					{
						id: "primary",
						kind: "image",
						label: "Image",
						url: "image.png",
						startSec: 0,
						durationSec: 4,
						layout,
					},
				],
			},
		],
		[{ id: 2, kind: "image", url: "image.png", start: 8, dur: 4, layout }],
	);
	for (const target of [
		{ source: "scene", id: 1 },
		{ source: "video", id: 2 },
	] as const) {
		const read = canvasClipLayout(keyed, target),
			at = read.start + 2;
		const sampled = sampledCanvasLayout(read.layout, "image", 2);
		expect(sampled.layout.xPct).toBe(20);
		expect(sampled.scale).toBe(1.5);
		const scope: EditScope = { doc: keyed, slides: [], posts: [], mediaAssets: [] };
		const next = applyCommand(
				scope,
				canvasEditCommand(scope, target, { xPct: 25, yPct: 15 }, at),
			).doc,
			result = canvasClipLayout(next, target);
		expect(result.layout?.xPct).toBe(0);
		expect(result.layout?.yPct).toBe(15);
		expect(result.layout?.animation?.tracks.xPct).toEqual([
			{ t: 0, v: 0 },
			{ t: 2, v: 25, easing: "linear" },
			{ t: 4, v: 40 },
		]);
		expect(result.layout?.animation?.tracks.scale).toEqual(layout.animation.tracks.scale);
		expect(canvasEditCommand(scope, target, { xPct: 25 }, read.start + 5)).toEqual({
			type: "noop",
		});
	}
	const initial = { ...layout, xPct: 10, yPct: 20 };
	const resized = resizeCanvasLayout(initial, "se", 20, 20, { w: 100, h: 100 }, false, false, 2);
	// Scaled upper-left corner stays fixed while the dragged corner moves 20px.
	expect(resized.widthPct).toBe(60);
	expect(resized.heightPct).toBe(60);
	expect(resized.xPct).toBe(15);
	expect(resized.yPct).toBe(25);
});

test("canvas edits key what is already keyed, keep the rest static, and undo in one step", () => {
	const anim = {
		tracks: {
			xPct: [
				{ t: 0, v: 0 },
				{ t: 4, v: 40 },
			],
			yPct: [{ t: 0, v: 10 }],
		},
	};
	const doc = toTimelineDoc(
		[],
		[
			{
				id: 2,
				kind: "image",
				url: "image.png",
				start: 8,
				dur: 4,
				layout: { xPct: 0, yPct: 10, widthPct: 50, heightPct: 50, fit: "contain", animation: anim },
			},
		],
	);
	const scope: EditScope = { doc, slides: [], posts: [], mediaAssets: [] },
		target = { source: "video", id: 2 } as const;
	const command = canvasEditCommand(scope, target, { xPct: 30, yPct: 20 }, 11);
	const next = applyCommand(scope, command),
		result = canvasClipLayout(next.doc, target).layout!;
	expect(result.animation?.tracks.xPct).toEqual([
		{ t: 0, v: 0 },
		{ t: 3, v: 30, easing: "linear" },
		{ t: 4, v: 40 },
	]);
	expect(result.animation?.tracks.yPct).toEqual([
		{ t: 0, v: 10 },
		{ t: 3, v: 20, easing: "linear" },
	]);
	expect(applyCommand(next, invertCommand(scope, command))).toEqual(scope);
});

test("dragging an unkeyed property on an animated clip changes the static value only", () => {
	const doc = toTimelineDoc(
		[],
		[
			{
				id: 2,
				kind: "image",
				url: "image.png",
				start: 0,
				dur: 4,
				layout: {
					xPct: 5,
					yPct: 0,
					widthPct: 50,
					heightPct: 50,
					fit: "contain",
					animation: {
						tracks: {
							opacity: [
								{ t: 0, v: 0 },
								{ t: 2, v: 1 },
							],
						},
					},
				},
			},
		],
	);
	const scope: EditScope = { doc, slides: [], posts: [], mediaAssets: [] },
		target = { source: "video", id: 2 } as const;
	const command = canvasEditCommand(scope, target, { xPct: 25 }, 1);
	expect(command.type).toBe("clip.replace");
	const result = canvasClipLayout(applyCommand(scope, command).doc, target).layout!;
	expect(result.xPct).toBe(25);
	expect(result.animation?.tracks.xPct).toBeUndefined();
	expect(result.animation?.tracks.opacity).toHaveLength(2);
});

test("a proportional corner resize of a scale-keyed text overlay keys scale and keeps its size and centre", () => {
	const doc = toTimelineDoc(
		[],
		[],
		[
			{
				id: 5,
				content: "T",
				start: 0,
				dur: 4,
				preset: "title",
				layout: {
					xPct: 10,
					yPct: 10,
					widthPct: 40,
					heightPct: 20,
					fit: "contain",
					animation: {
						tracks: {
							scale: [
								{ t: 0, v: 1 },
								{ t: 4, v: 1 },
							],
						},
					},
				},
			},
		],
	);
	const scope: EditScope = { doc, slides: [], posts: [], mediaAssets: [] },
		target = { source: "text", id: 5 } as const;
	const command = canvasEditCommand(
		scope,
		target,
		{ xPct: 10, yPct: 10, widthPct: 60, heightPct: 30 },
		2,
	);
	const result = canvasClipLayout(applyCommand(scope, command).doc, target).layout!;
	expect(result.animation?.tracks.scale).toEqual([
		{ t: 0, v: 1 },
		{ t: 2, v: 1.5, easing: "linear" },
		{ t: 4, v: 1 },
	]);
	expect([result.widthPct, result.heightPct]).toEqual([40, 20]);
	// The resized box spanned 10..70 × 10..40, centre (40, 25); the unscaled box keeps that centre.
	expect((result.xPct ?? 0) + (result.widthPct ?? 0) / 2).toBeCloseTo(40, 9);
	expect((result.yPct ?? 0) + (result.heightPct ?? 0) / 2).toBeCloseTo(25, 9);
});

test("a locked track refuses canvas edits", () => {
	const doc = toTimelineDoc(
		[],
		[
			{
				id: 2,
				kind: "image",
				url: "image.png",
				start: 0,
				dur: 4,
				track: 1,
				layout: {
					xPct: 0,
					yPct: 0,
					widthPct: 50,
					fit: "contain",
					animation: { tracks: { xPct: [{ t: 0, v: 0 }] } },
				},
			},
		],
	);
	const scope: EditScope = {
		doc: { ...doc, trackFlags: { 1: { locked: true } } },
		slides: [],
		posts: [],
		mediaAssets: [],
	};
	expect(canvasEditCommand(scope, { source: "video", id: 2 }, { xPct: 30 }, 1)).toEqual({
		type: "noop",
	});
	expect(
		applyCommand(scope, canvasEditCommand(scope, { source: "video", id: 2 }, { yPct: 30 })).doc,
	).toEqual(scope.doc);
});
