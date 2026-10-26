import { expect, test } from "vite-plus/test";
import { animationFromLegacyText, renderedSpanSec } from "./legacy-text-animation.ts";
import { readStoryboardDocument, writeStoryboardDocument } from "./storyboard-document.ts";
import { RENDER_FPS } from "./render-fps.ts";

const layout = { xPct: 10, yPct: 70, widthPct: 80, heightPct: 20, rotationDeg: 5, opacity: 0.5 };

test("key times scale by the rendered frame span, not the stored duration", () => {
	expect(renderedSpanSec(2.71)).toBe(81 / RENDER_FPS);
	expect(renderedSpanSec(1)).toBe(1);
	expect(renderedSpanSec(0)).toBe(1 / RENDER_FPS);
	const { animation } = animationFromLegacyText(
		{
			tracks: {
				blur: [
					{ t: 0, v: 8 },
					{ t: 0.5, v: 0, easing: "out" },
				],
			},
		},
		layout,
		2.71,
	);
	expect(animation?.tracks.blur).toEqual([
		{ t: 0, v: 8 },
		{ t: (0.5 * 81) / 30, v: 0, easing: "out" },
	]);
});

test("content motion folds into box properties", () => {
	const { animation, dropped } = animationFromLegacyText(
		{
			tracks: {
				x: [
					{ t: 0, v: 0 },
					{ t: 1, v: 20 },
				],
				y: [{ t: 0, v: -5 }],
				scale: [{ t: 0, v: 0.8 }],
				rotate: [{ t: 0, v: 15 }],
				opacity: [{ t: 0, v: 0.4 }],
			},
		},
		layout,
		2,
	);
	expect(dropped).toEqual([]);
	expect(animation?.tracks.xPct).toEqual([
		{ t: 0, v: 10 },
		{ t: 2, v: 10 + (20 * 80) / 100 },
	]);
	expect(animation?.tracks.yPct).toEqual([{ t: 0, v: 70 - (5 * 20) / 100 }]);
	expect(animation?.tracks.scale).toEqual([{ t: 0, v: 0.8 }]);
	expect(animation?.tracks.rotationDeg).toEqual([{ t: 0, v: 20 }]);
	expect(animation?.tracks.opacity).toEqual([{ t: 0, v: 0.2 }]);
});

test("offsets use the box size sampled at each key when width or height animate", () => {
	const { animation } = animationFromLegacyText(
		{
			tracks: {
				width: [
					{ t: 0, v: 40 },
					{ t: 1, v: 80 },
				],
				x: [{ t: 0.5, v: 10 }],
			},
		},
		{ xPct: 0, yPct: 0, widthPct: 50 },
		1,
	);
	expect(animation?.tracks.widthPct).toEqual([
		{ t: 0, v: 40 },
		{ t: 1, v: 80 },
	]);
	expect(animation?.tracks.xPct).toEqual([{ t: 0.5, v: (10 * 60) / 100 }]);
});

test("style and colour tracks map by name and keep easing", () => {
	const { animation } = animationFromLegacyText(
		{
			tracks: {
				height: [{ t: 0, v: 20 }],
				bgOpacity: [
					{ t: 0, v: 0 },
					{ t: 1, v: 0.8, easing: "bezier" },
				],
				fontSize: [{ t: 0, v: 48 }],
				letterSpacing: [{ t: 0, v: 1 }],
				lineHeight: [{ t: 0, v: 1.2 }],
			},
			colorTracks: {
				fill: [
					{ t: 0, v: "#fff" },
					{ t: 1, v: "red", easing: "in" },
				],
			},
		},
		undefined,
		1,
	);
	expect(animation?.tracks.heightPct).toEqual([{ t: 0, v: 20 }]);
	expect(animation?.tracks.bgOpacity?.[1]).toEqual({ t: 1, v: 0.8, easing: "bezier" });
	expect(animation?.tracks.fontSize?.[0]?.v).toBe(48);
	expect(animation?.tracks.letterSpacing?.[0]?.v).toBe(1);
	expect(animation?.tracks.lineHeight?.[0]?.v).toBe(1.2);
	expect(animation?.colorTracks?.fill).toEqual([
		{ t: 0, v: "#fff" },
		{ t: 1, v: "red", easing: "in" },
	]);
});

test("malformed legacy tracks are dropped and named, never thrown", () => {
	const { animation, dropped } = animationFromLegacyText(
		{
			tracks: {
				opacity: [{ t: 0, v: "high" }],
				fontSize: [
					{ t: 1, v: 40 },
					{ t: 0, v: 50 },
				],
				mystery: [{ t: 0, v: 1 }],
				blur: [{ t: 0, v: 2 }],
			},
			colorTracks: { fill: "red" },
		},
		layout,
		1,
	);
	expect(dropped.sort()).toEqual(["fill", "fontSize", "mystery", "opacity"]);
	expect(animation).toEqual({ tracks: { blur: [{ t: 0, v: 2 }] } });
	for (const junk of [null, "x", 3, { tracks: null }, { tracks: { x: null } }])
		expect(() => animationFromLegacyText(junk, layout, 1)).not.toThrow();
	expect(animationFromLegacyText({ tracks: {} }, layout, 1)).toEqual({ dropped: [] });
});

test("the storyboard read upgrades text anim, reports drops, writes no legacy field, and leaves camera motion alone", () => {
	const motion = {
		keyframes: [
			{ t: 0, x: 0, y: 0, scale: 1 },
			{ t: 1, x: 20, y: 10, scale: 1.2, easing: "bezier" as const },
		],
	};
	const raw = {
		schemaVersion: 2,
		sceneTextClipMigrationVersion: 5,
		markers: [],
		clips: [
			{
				id: "text:1",
				type: "text",
				startSec: 0,
				durationSec: 2,
				track: 0,
				text: {
					id: 1,
					content: "Hi",
					start: 0,
					dur: 2,
					preset: "plain",
					layout,
					anim: {
						tracks: {
							opacity: [
								{ t: 0, v: 0 },
								{ t: 1, v: 1 },
							],
							rotate: "bad",
						},
					},
				},
			},
			{
				id: "text:2",
				type: "text",
				startSec: 0,
				durationSec: 2,
				track: 1,
				text: {
					id: 2,
					content: "Kept",
					start: 0,
					dur: 2,
					preset: "plain",
					layout: { ...layout, animation: { tracks: { opacity: [{ t: 1, v: 1 }] } } },
					anim: { tracks: { opacity: [{ t: 0, v: 0 }] } },
				},
			},
			{
				id: "scene:1",
				type: "image",
				startSec: 0,
				durationSec: 4,
				track: -1,
				scene: {
					id: 1,
					name: "S",
					shot: "",
					move: "Static",
					vis: "",
					vo: "",
					img: true,
					dur: 4,
					motion,
				},
			},
		],
	};
	const read = readStoryboardDocument(raw);
	expect(read.diagnostic.defaulted).toEqual(["clips[].text.anim.rotate"]);
	const [first, second, scene] = read.doc.clips;
	expect(first!.text).not.toHaveProperty("anim");
	expect(first!.text!.layout?.animation).toEqual({
		tracks: {
			opacity: [
				{ t: 0, v: 0 },
				{ t: 2, v: 0.5 },
			],
		},
	});
	expect(second!.text!.layout?.animation).toEqual({ tracks: { opacity: [{ t: 1, v: 1 }] } });
	expect(second!.text).not.toHaveProperty("anim");
	expect(scene!.scene?.motion).toEqual(motion);
	const written = JSON.parse(JSON.stringify(writeStoryboardDocument(read.doc)));
	expect(JSON.stringify(written)).not.toContain('"anim"');
	const reread = readStoryboardDocument(written);
	expect(reread.doc.clips).toEqual(read.doc.clips);
	expect(reread.diagnostic.defaulted).toEqual([]);
});
