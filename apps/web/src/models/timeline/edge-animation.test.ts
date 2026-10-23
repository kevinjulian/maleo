import { expect, test } from "vite-plus/test";
import {
	edgeAnimation,
	edgeAnimationState,
	sampleClipProperty,
	toTimelineDoc,
	pruneBrokenTransitions,
	withoutTransitions,
} from "@maleo/shared";
import { applyCommand, invertCommand, type EditScope } from "@maleo/shared/editor";
import {
	applyEdgePreset,
	animationTargetForId,
	clipAnimationInfo,
	type ClipAnimationTarget,
} from "./clip-animation-edit.ts";

const doc = toTimelineDoc(
	[
		{
			id: 1,
			name: "Base",
			shot: "Wide",
			move: "Static",
			vis: "",
			vo: "",
			img: true,
			dur: 4,
			src: "base.png",
		},
	],
	[
		{ id: 2, kind: "image", url: "a.png", start: 0, dur: 4, track: 0 },
		{ id: 3, kind: "video", url: "b.mp4", start: 4, dur: 4, track: 0 },
	],
	[{ id: 4, content: "Title", start: 0, dur: 4, preset: "title" }],
	[{ id: 5, kind: "music", content: "", start: 0, dur: 4, volume: 0.6 }],
	[],
	[],
);
const scope: EditScope = { doc, slides: [], posts: [], mediaAssets: [] };

test("edge presets use reversible ordinary tracks on scene, media, text and audio", () => {
	for (const target of [
		{ source: "scene", id: 1, visualId: "visual:1" },
		{ source: "video", id: 2 },
		{ source: "video", id: 3 },
		{ source: "text", id: 4 },
		{ source: "audio", id: 5 },
	] satisfies ClipAnimationTarget[]) {
		for (const preset of target.source === "audio"
			? (["fade"] as const)
			: (["fade", "slide", "zoom"] as const)) {
			const command = applyEdgePreset(scope, target, "in", preset, 0.4),
				entered = applyCommand(scope, command);
			const exited = applyCommand(entered, applyEdgePreset(entered, target, "out", "fade", 0.5));
			const info = clipAnimationInfo(exited.doc, target)!;
			expect(
				edgeAnimation(info.animation, "in", info.duration, info.values, info.audio)?.preset,
			).toBe(preset);
			expect(
				edgeAnimation(info.animation, "out", info.duration, info.values, info.audio)?.duration,
			).toBe(0.5);
			const property = info.audio ? "volume" : "opacity";
			expect(sampleClipProperty(info.animation, property, 3.75, 1)).toBeCloseTo(
				(info.values[property] ?? 1) / 2,
			);
			expect(applyCommand(entered, invertCommand(scope, command))).toEqual(scope);
			const removed = applyCommand(exited, applyEdgePreset(exited, target, "out", "none", 0.4));
			expect(
				edgeAnimation(
					clipAnimationInfo(removed.doc, target)?.animation,
					"in",
					4,
					info.values,
					info.audio,
				)?.preset,
			).toBe(preset);
			expect(
				edgeAnimation(
					clipAnimationInfo(removed.doc, target)?.animation,
					"out",
					4,
					info.values,
					info.audio,
				),
			).toBeUndefined();
		}
	}
});

test("duration clamps, unrelated keys survive, and locked edits refuse", () => {
	const target: ClipAnimationTarget = { source: "video", id: 2 };
	const seeded: EditScope = {
		...scope,
		doc: {
			...doc,
			clips: doc.clips.map((c) =>
				c.id === "video:2"
					? {
							...c,
							video: {
								...c.video!,
								layout: {
									xPct: 0,
									yPct: 0,
									widthPct: 100,
									fit: "cover" as const,
									animation: {
										tracks: { rotationDeg: [{ t: 1, v: 30 }], opacity: [{ t: 2, v: 1 }] },
									},
								},
							},
						}
					: c,
			),
		},
	};
	const edited = applyCommand(seeded, applyEdgePreset(seeded, target, "out", "fade", 20));
	const info = clipAnimationInfo(edited.doc, target)!;
	const ramp = edgeAnimation(info.animation, "out", 4, info.values)!;
	expect(ramp.duration).toBe(2);
	expect(info.animation?.tracks.rotationDeg).toEqual([{ t: 1, v: 30 }]);
	expect(() =>
		applyEdgePreset(
			{ ...scope, doc: { ...doc, trackFlags: { 0: { locked: true } } } },
			target,
			"out",
			"fade",
			0.4,
		),
	).toThrow("locked");
});

test("broken pair cleanup preserves a group move and leaves original document unchanged", () => {
	const paired = {
		...doc,
		clips: [
			...doc.clips,
			{
				id: "trans:9",
				type: "transition" as const,
				track: 0,
				startSec: 0,
				durationSec: 0.4,
				transition: {
					id: 9,
					fromClipId: "video:2",
					toClipId: "video:3",
					type: "fade" as const,
					dur: 0.4,
				},
			},
		],
	};
	expect(pruneBrokenTransitions(paired)).toBe(paired);
	const both = {
		...paired,
		clips: paired.clips.map((c) => (c.video ? { ...c, startSec: c.startSec + 2 } : c)),
	};
	expect(pruneBrokenTransitions(both)).toBe(both);
	const moved = {
		...paired,
		clips: paired.clips.map((c) => (c.id === "video:3" ? { ...c, startSec: 5 } : c)),
	};
	expect(pruneBrokenTransitions(moved).clips.some((c) => c.transition)).toBe(false);
	expect(withoutTransitions(paired, new Set([9])).clips.some((c) => c.transition)).toBe(false);
	expect(paired.clips.some((c) => c.transition)).toBe(true);
});

test("None preserves opposite ramp when maximum edge durations share midpoint", () => {
	const target: ClipAnimationTarget = { source: "video", id: 2 };
	const entered = applyCommand(scope, applyEdgePreset(scope, target, "in", "fade", 2));
	const exited = applyCommand(entered, applyEdgePreset(entered, target, "out", "fade", 2));
	const removed = applyCommand(exited, applyEdgePreset(exited, target, "out", "none", 2));
	const info = clipAnimationInfo(removed.doc, target)!;
	expect(edgeAnimation(info.animation, "in", info.duration, info.values)?.duration).toBe(2);
	expect(edgeAnimation(info.animation, "out", info.duration, info.values)).toBeUndefined();
});

test("custom edge keys never present as None, and opposite presets do not count as custom", () => {
	const target: ClipAnimationTarget = { source: "video", id: 2 };
	const exited = applyCommand(scope, applyEdgePreset(scope, target, "out", "fade", 2));
	const info = clipAnimationInfo(exited.doc, target)!;
	expect(edgeAnimationState(info.animation, "in", 4, info.values)).toBe("none");
	expect(
		edgeAnimationState(
			{
				tracks: {
					opacity: [
						{ t: 0, v: 0.3 },
						{ t: 0.7, v: 1 },
					],
				},
			},
			"in",
			4,
			info.values,
		),
	).toBe("custom");
});

test("an extra scene visual is the exact target, preserving primary animation", () => {
	const multi = toTimelineDoc([
		{
			id: 1,
			name: "Beat",
			shot: "Wide",
			move: "Static",
			vis: "",
			vo: "",
			img: true,
			dur: 8,
			visualClips: [
				{
					id: "primary",
					kind: "image",
					label: "First",
					url: "a.png",
					startSec: 0,
					durationSec: 4,
					primary: true,
				},
				{ id: "extra", kind: "image", label: "Second", url: "b.png", startSec: 4, durationSec: 4 },
			],
		},
	]);
	const target = animationTargetForId(multi, "vis:1:extra")!;
	expect(target).toEqual({ source: "scene", id: 1, visualId: "extra" });
	const next = applyCommand(
		{ ...scope, doc: multi },
		applyEdgePreset({ ...scope, doc: multi }, target, "out", "fade", 0.4),
	);
	expect(clipAnimationInfo(next.doc, target)?.animation?.tracks.opacity?.[1]?.t).toBe(4);
	expect(
		clipAnimationInfo(next.doc, { source: "scene", id: 1, visualId: "primary" })?.animation,
	).toBeUndefined();
});

test("scene without visual source has no animation target", () => {
	const empty = toTimelineDoc([
		{ id: 1, name: "Empty", shot: "Wide", move: "Static", vis: "", vo: "", img: false, dur: 4 },
	]);
	expect(animationTargetForId(empty, "scene:1")).toBeUndefined();
});
