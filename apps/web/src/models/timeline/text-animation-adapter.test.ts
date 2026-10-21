import { expect, test } from "vite-plus/test";
import { readStoryboardDocument, type OverlayAnim, type TextOverlay } from "@maleo/shared";
import {
	animationToOverlayAnim,
	compositionLayerOf,
	overlayAnimToAnimation,
	withTextAnimation,
} from "./text-animation-adapter.ts";

const layout = {
	xPct: 10,
	yPct: 60,
	widthPct: 80,
	heightPct: 25,
	rotationDeg: 4,
	opacity: 0.8,
	fit: "contain" as const,
};
const legacy: OverlayAnim = {
	tracks: {
		x: [
			{ t: 0, v: -10 },
			{ t: 0.6, v: 15, easing: "in-out" },
		],
		y: [{ t: 0.2, v: 5 }],
		scale: [
			{ t: 0, v: 0.9 },
			{ t: 1, v: 1.1, easing: "hold" },
		],
		rotate: [{ t: 0, v: 3 }],
		opacity: [
			{ t: 0, v: 0 },
			{ t: 0.3, v: 1, easing: "out" },
		],
		blur: [{ t: 0, v: 6 }],
		bgOpacity: [{ t: 0, v: 0.2 }],
		fontSize: [{ t: 0, v: 40 }],
		letterSpacing: [{ t: 0, v: 2 }],
		lineHeight: [{ t: 0, v: 1.3 }],
	},
	colorTracks: {
		fill: [
			{ t: 0, v: "#ffffff" },
			{ t: 1, v: "#ff0000", easing: "in" },
		],
		accent: [{ t: 0.5, v: "red" }],
	},
};

function expectSameAnim(got: OverlayAnim | null, want: OverlayAnim) {
	expect(Object.keys(got?.tracks ?? {}).sort()).toEqual(Object.keys(want.tracks).sort());
	for (const [name, keys] of Object.entries(want.tracks))
		keys!.forEach((k, i) => {
			const g = got!.tracks[name as keyof OverlayAnim["tracks"]]![i]!;
			expect(g.t).toBeCloseTo(k.t, 12);
			expect(g.v).toBeCloseTo(k.v, 12);
			expect(g.easing).toBe(k.easing);
		});
	expect(got?.colorTracks?.fill?.map((k) => k.v)).toEqual(want.colorTracks?.fill?.map((k) => k.v));
	expect(got?.colorTracks?.accent?.[0]?.t).toBeCloseTo(want.colorTracks!.accent![0]!.t, 12);
}

test("normalized → seconds → normalized round-trips every property", () => {
	for (const dur of [3, 2.71, 1])
		expectSameAnim(
			animationToOverlayAnim(overlayAnimToAnimation(legacy, layout, dur), layout, dur),
			legacy,
		);
	expect(animationToOverlayAnim(undefined, layout, 2)).toBeNull();
	expect(overlayAnimToAnimation(null, layout, 2)).toBeUndefined();
});

test("offsets become absolute box positions and back", () => {
	const seconds = overlayAnimToAnimation(
		{ tracks: { x: [{ t: 0, v: 25 }], y: [{ t: 0, v: -20 }] } },
		layout,
		2,
	)!;
	expect(seconds.tracks.xPct).toEqual([{ t: 0, v: 10 + 25 * 0.8 }]);
	expect(seconds.tracks.yPct).toEqual([{ t: 0, v: 60 - 20 * 0.25 }]);
	const back = animationToOverlayAnim({ tracks: { xPct: [{ t: 1, v: 50 }] } }, layout, 2)!;
	expect(back.tracks.x![0]!.v).toBeCloseTo(((50 - 10) * 100) / 80, 12);
	expect(back.tracks.x![0]!.t).toBeCloseTo(0.5, 12);
});

test("save as motion carries the same normalized keys a legacy overlay had", () => {
	const raw = {
		schemaVersion: 2,
		sceneTextClipMigrationVersion: 5,
		markers: [],
		clips: [
			{
				id: "text:1",
				type: "text",
				startSec: 0,
				durationSec: 2.71,
				track: 0,
				text: { id: 1, content: "Hi", start: 0, dur: 2.71, preset: "title", layout, anim: legacy },
			},
		],
	};
	const overlay = readStoryboardDocument(raw).doc.clips[0]!.text!;
	expect(overlay.layout?.animation).toBeDefined();
	const layer = compositionLayerOf(overlay);
	expect(layer.layout).not.toHaveProperty("animation");
	expectSameAnim(layer.anim ?? null, legacy);
	const plain: TextOverlay = { id: 2, content: "No motion", start: 0, dur: 1, preset: "title" };
	expect(compositionLayerOf(plain)).toEqual({ ...plain, anim: null });
});

test("writing animation into an overlay keeps its box, and a missing box takes render defaults", () => {
	expect(withTextAnimation({ layout }, { tracks: { opacity: [{ t: 0, v: 1 }] } })).toEqual({
		...layout,
		animation: { tracks: { opacity: [{ t: 0, v: 1 }] } },
	});
	expect(
		withTextAnimation({ layout: { ...layout, animation: { tracks: {} } } }, undefined),
	).toEqual(layout);
	expect(withTextAnimation({}, undefined)).toBeUndefined();
	expect(withTextAnimation({}, { tracks: { blur: [{ t: 0, v: 1 }] } })).toEqual({
		xPct: 0,
		yPct: 0,
		widthPct: 100,
		fit: "contain",
		animation: { tracks: { blur: [{ t: 0, v: 1 }] } },
	});
});
