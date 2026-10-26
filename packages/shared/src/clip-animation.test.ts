import { expect, test } from "vite-plus/test";
import {
	clipAnimationSchema,
	audioAnimationSchema,
	textAnimationSchema,
	sampleClipProperty,
	retainClipAnimation,
	retimeClipAnimation,
	clipAnimationBlockers,
} from "./clip-animation.ts";
import { evaluateColorTrack } from "./keyframe-evaluation.ts";
import { toTimelineDoc, fromTimelineDoc } from "./timeline-doc.ts";
import { readStoryboardDocument, writeStoryboardDocument } from "./storyboard-document.ts";

test("clip-local keys share easing and endpoint rules, with strict property/time/gain validation", () => {
	for (const [easing, sample] of [
		["linear", 25],
		["in", 6.25],
		["out", 43.75],
		["in-out", 12.5],
	] as const) {
		const animation = clipAnimationSchema.parse({
			tracks: {
				xPct: [
					{ t: 2, v: 0 },
					{ t: 6, v: 100, easing },
				],
			},
		});
		expect(sampleClipProperty(animation, "xPct", 3, 0)).toBe(sample);
		expect(sampleClipProperty(animation, "xPct", -1, 0)).toBe(0);
		expect(sampleClipProperty(animation, "xPct", 8, 0)).toBe(100);
		expect(sampleClipProperty(animation, "opacity", 3, 0.8)).toBe(0.8);
	}
	for (const value of [NaN, Infinity, -1, 2])
		expect(
			audioAnimationSchema.safeParse({ tracks: { volume: [{ t: 0, v: value }] } }).success,
		).toBe(false);
	for (const times of [
		[2, 1],
		[1, 1],
		[-1, 2],
	])
		expect(
			clipAnimationSchema.safeParse({ tracks: { xPct: times.map((t) => ({ t, v: 0 })) } }).success,
		).toBe(false);
	expect(audioAnimationSchema.safeParse({ tracks: { xPct: [{ t: 0, v: 0 }] } }).success).toBe(
		false,
	);
	expect(clipAnimationSchema.safeParse({ tracks: { mystery: [] } }).success).toBe(false);
	expect(sampleClipProperty(undefined, "volume", 10, 0.7)).toBe(0.7);
});

test("optional visual/audio animation round-trips, scene camera is unchanged, and legacy text keys upgrade", () => {
	const animation = clipAnimationSchema.parse({
		tracks: {
			scale: [
				{ t: 0, v: 1 },
				{ t: 4, v: 1.5 },
			],
			volume: [
				{ t: 0, v: 0.7 },
				{ t: 2, v: 0.3 },
			],
		},
	});
	const layout = { xPct: 0, yPct: 0, widthPct: 100, fit: "contain" as const, animation };
	const motion = {
		keyframes: [
			{ t: 0, x: 0, y: 0, scale: 1 },
			{ t: 1, x: 20, y: 10, scale: 1.2, easing: "bezier" as const },
		],
	};
	const scenes = [
		{
			id: 1,
			name: "Base",
			shot: "Wide",
			move: "Static",
			vis: "",
			vo: "",
			img: true,
			src: "base.png",
			dur: 4,
			motion,
			visualClips: [
				{
					id: "v",
					kind: "image" as const,
					url: "base.png",
					label: "Image",
					startSec: 0,
					durationSec: 4,
					layout,
				},
			],
		},
	];
	const text = [
		{
			id: 3,
			content: "Old studio",
			start: 0,
			dur: 4,
			preset: "plain" as const,
			anim: {
				tracks: {
					x: [
						{ t: 0, v: 0 },
						{ t: 1, v: 20, easing: "bezier" as const },
					],
				},
			},
		},
	];
	const doc = toTimelineDoc(
		scenes,
		[{ id: 2, kind: "video", url: "video.mp4", start: 0, dur: 4, layout }],
		text,
		[
			{
				id: 4,
				kind: "voiceover",
				content: "Voice",
				url: "voice.wav",
				start: 0,
				dur: 4,
				animation: audioAnimationSchema.parse({ tracks: { volume: animation.tracks.volume } }),
			},
		],
	);
	const views = fromTimelineDoc({
		...doc,
		clips: readStoryboardDocument(JSON.parse(JSON.stringify(doc))).doc.clips,
	});
	expect(views.scenes[0]?.visualClips?.[0]?.layout?.animation).toEqual(animation);
	expect(views.videoOverlays[0]?.layout?.animation).toEqual(animation);
	expect(views.audioOverlays[0]?.animation?.tracks.volume).toEqual(animation.tracks.volume);
	expect(views.scenes[0]?.motion).toEqual(motion);
	// Legacy text `anim` is upgraded on read: normalized time over the rendered span, offset folded into box position.
	expect(views.textOverlays[0]).not.toHaveProperty("anim");
	expect(views.textOverlays[0]?.layout?.animation).toEqual({
		tracks: {
			xPct: [
				{ t: 0, v: 0 },
				{ t: 4, v: 20, easing: "bezier" },
			],
		},
	});
	const legacy = fromTimelineDoc(
		toTimelineDoc(
			[{ ...scenes[0]!, visualClips: [] }],
			[{ id: 2, kind: "image", url: "old.png", start: 0, dur: 4 }],
		),
	);
	expect(legacy.videoOverlays[0]?.layout?.animation).toBeUndefined();
});

test("trim/split preserve eased project-time samples and retime follows original source window", () => {
	for (const easing of ["linear", "in", "out", "in-out"] as const) {
		const original = clipAnimationSchema.parse({
			tracks: {
				volume: [
					{ t: 0, v: 0.1 },
					{ t: 4, v: 0.9, easing },
					{ t: 8, v: 0.4, easing },
				],
			},
		});
		const cut = retainClipAnimation(original, 1.25, 5.5)!;
		const secondCut = retainClipAnimation(cut, 0.5, 3)!;
		for (let time = 0; time <= 4.25; time += 0.125)
			expect(sampleClipProperty(cut, "volume", time, 0)).toBeCloseTo(
				sampleClipProperty(original, "volume", time + 1.25, 0),
				8,
			);
		for (let time = 0; time <= 2.5; time += 0.125)
			expect(sampleClipProperty(secondCut, "volume", time, 0)).toBeCloseTo(
				sampleClipProperty(original, "volume", time + 1.75, 0),
				8,
			);
		for (const ratio of [0.25, 0.5, 2, 4]) {
			const changed = retimeClipAnimation(cut, ratio)!;
			for (const time of [0, 0.25, 1.5, 3.75, 4.25])
				expect(sampleClipProperty(changed, "volume", time * ratio, 0)).toBeCloseTo(
					sampleClipProperty(cut, "volume", time, 0),
					8,
				);
		}
		expect(clipAnimationSchema.safeParse(cut).success).toBe(true);
		expect(clipAnimationSchema.safeParse(secondCut).success).toBe(true);
	}
	expect(retainClipAnimation(undefined, 1, 2)).toBeUndefined();
});

test("save boundary validates authored keys and round-trips audio without touching studio tracks", () => {
	const animation = {
		tracks: {
			volume: [
				{ t: 0, v: 0.2 },
				{ t: 4, v: 0.8 },
			],
		},
	};
	const timeline = toTimelineDoc(
		[],
		[],
		[],
		[{ id: 1, kind: "music", content: "Bed", start: 0, dur: 4, animation }],
	);
	const doc = readStoryboardDocument(timeline).doc;
	const stored = writeStoryboardDocument(doc);
	expect(
		fromTimelineDoc({ ...timeline, clips: readStoryboardDocument(stored).doc.clips })
			.audioOverlays[0]?.animation,
	).toEqual(animation);
	const bad = structuredClone(doc);
	bad.clips[0]!.audio!.animation!.tracks.volume![1]!.t = 5;
	expect(clipAnimationBlockers(bad)).toHaveLength(1);
	expect(() => writeStoryboardDocument(bad)).toThrow("outside the clip");
	bad.clips[0]!.audio!.animation!.tracks.volume![1]!.v = 2;
	expect(clipAnimationBlockers(bad)).toHaveLength(1);
	expect(clipAnimationBlockers({ kind: "image", dur: 4, layout: { animation } })).toHaveLength(1);
	expect(
		clipAnimationBlockers({
			kind: "video",
			dur: 4,
			layout: { animation },
			motion: { keyframes: [{ t: 1, x: 2 }] },
		}),
	).toEqual([]);
});

test("hold keeps the previous value until its key, then steps, and survives splits", () => {
	const animation = clipAnimationSchema.parse({
		tracks: {
			opacity: [
				{ t: 0, v: 1 },
				{ t: 2, v: 0, easing: "hold" },
				{ t: 4, v: 0.5, easing: "linear" },
			],
		},
	});
	expect(sampleClipProperty(animation, "opacity", 0, 0)).toBe(1);
	expect(sampleClipProperty(animation, "opacity", 1.99, 0)).toBe(1);
	expect(sampleClipProperty(animation, "opacity", 2, 0)).toBe(0);
	expect(sampleClipProperty(animation, "opacity", 3, 0)).toBe(0.25);
	expect(sampleClipProperty(animation, "opacity", 9, 0)).toBe(0.5);
	for (const [from, to] of [
		[1, 3],
		[0.5, 1.5],
		[2, 4],
		[1.999, 2.5],
	] as const) {
		const cut = retainClipAnimation(animation, from, to)!;
		expect(cut.tracks.opacity!.every((k) => !(k.easing === "hold" && k.easingRange))).toBe(true);
		for (let time = 0; time <= to - from + 1e-9; time += 0.0625)
			expect(sampleClipProperty(cut, "opacity", time, 0)).toBeCloseTo(
				sampleClipProperty(animation, "opacity", time + from, 0),
				10,
			);
		expect(clipAnimationSchema.safeParse(cut).success).toBe(true);
	}
	for (const ratio of [0.5, 2]) {
		const changed = retimeClipAnimation(animation, ratio)!;
		expect(sampleClipProperty(changed, "opacity", 2 * ratio - 0.001, 0)).toBe(1);
		expect(sampleClipProperty(changed, "opacity", 2 * ratio, 0)).toBe(0);
	}
});

test("existing easings sample exactly as before hold was added", () => {
	const expected = {
		linear: [0, 25, 50, 75, 100],
		in: [0, 6.25, 25, 56.25, 100],
		out: [0, 43.75, 75, 93.75, 100],
		"in-out": [0, 12.5, 50, 87.5, 100],
	} as const;
	for (const [easing, samples] of Object.entries(expected)) {
		const animation = clipAnimationSchema.parse({
			tracks: {
				xPct: [
					{ t: 0, v: 0 },
					{ t: 4, v: 100, easing },
				],
			},
		});
		expect([0, 1, 2, 3, 4].map((t) => sampleClipProperty(animation, "xPct", t, 0))).toEqual([
			...samples,
		]);
	}
});

test("text style and colour tracks trim, split and retime like box tracks", () => {
	const animation = textAnimationSchema.parse({
		tracks: {
			fontSize: [
				{ t: 0, v: 40 },
				{ t: 3, v: 70, easing: "in-out" },
			],
		},
		colorTracks: {
			fill: [
				{ t: 0, v: "#000000" },
				{ t: 4, v: "#ffffff", easing: "out" },
			],
		},
	});
	const cut = retainClipAnimation(animation, 1, 3.5)!;
	expect(textAnimationSchema.safeParse(cut).success).toBe(true);
	for (let time = 0; time <= 2.5; time += 0.125) {
		expect(sampleClipProperty(cut, "fontSize", time, 0)).toBeCloseTo(
			sampleClipProperty(animation, "fontSize", time + 1, 0),
			8,
		);
		const channels = (c: string) => c.match(/\d+/g)!.map(Number);
		const [got, want] = [
			evaluateColorTrack(cut.colorTracks!.fill, time, ""),
			evaluateColorTrack(animation.colorTracks!.fill, time + 1, ""),
		].map(channels);
		got!.forEach((value, i) => expect(Math.abs(value - want![i]!)).toBeLessThanOrEqual(1));
	}
	const slower = retimeClipAnimation(animation, 2)!;
	expect(slower.colorTracks!.fill!.map((k) => k.t)).toEqual([0, 8]);
	expect(slower.tracks.fontSize!.map((k) => k.t)).toEqual([0, 6]);
	expect(retimeClipAnimation({ tracks: { opacity: [{ t: 1, v: 0 }] } }, 2)).toEqual({
		tracks: { opacity: [{ t: 2, v: 0 }] },
	});
});

test("blockers validate each element kind against its own registry entries", () => {
	const textClip = (animation: unknown, dur = 4) => ({
		clips: [
			{
				id: "t",
				type: "text",
				startSec: 0,
				durationSec: dur,
				track: 0,
				text: { id: 1, content: "T", start: 0, dur, preset: "plain", layout: { animation } },
			},
		],
	});
	expect(
		clipAnimationBlockers(
			textClip({
				tracks: { fontSize: [{ t: 0, v: 40 }] },
				colorTracks: { fill: [{ t: 1, v: "#fff" }] },
			}),
		),
	).toEqual([]);
	expect(clipAnimationBlockers(textClip({ tracks: { volume: [{ t: 0, v: 1 }] } }))).toHaveLength(1);
	expect(
		clipAnimationBlockers(textClip({ tracks: {}, colorTracks: { fill: [{ t: 5, v: "#fff" }] } })),
	).toHaveLength(1);
	expect(
		clipAnimationBlockers({
			kind: "video",
			dur: 4,
			layout: { animation: { tracks: { fontSize: [{ t: 0, v: 40 }] } } },
		}),
	).toHaveLength(1);
	expect(
		clipAnimationBlockers({
			kind: "voiceover",
			dur: 4,
			animation: { tracks: { volume: [{ t: 1, v: 0.5 }] } },
		}),
	).toEqual([]);
});

test("export collections retain their animation kinds and reject invalid keys", () => {
	const text = {
		dur: 4.1,
		layout: {
			animation: {
				tracks: {
					fontSize: [
						{ t: 0.9, v: 64 },
						{ t: 3.533333333333333, v: 92 },
					],
				},
				colorTracks: { fill: [{ t: 1, v: "#ffffff" }] },
			},
		},
	};
	expect(clipAnimationBlockers({ textOverlays: [text] })).toEqual([]);
	expect(clipAnimationBlockers({ textOverlays: [{ ...text, dur: 3 }] })).toHaveLength(1);
	expect(
		clipAnimationBlockers({
			textOverlays: [{ dur: 4, layout: { animation: { tracks: { volume: [{ t: 0, v: 1 }] } } } }],
		}),
	).toHaveLength(1);
	expect(
		clipAnimationBlockers({
			audioOverlays: [{ dur: 4, animation: { tracks: { xPct: [{ t: 0, v: 1 }] } } }],
		}),
	).toHaveLength(1);
	expect(
		clipAnimationBlockers({
			audioOverlays: [{ dur: 4, animation: { tracks: { volume: [{ t: 0, v: 1 }] } } }],
		}),
	).toEqual([]);
});
