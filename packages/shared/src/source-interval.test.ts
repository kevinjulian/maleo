import { expect, test } from "vite-plus/test";
import {
	assertSourceInterval,
	heldVideoFrame,
	canRetainClipWindow,
	clipSourceRange,
	clipsPastSource,
	retainClipWindow,
	sliceSourceInterval,
	sourceTime,
	trimMediaTiming,
} from "./source-interval.ts";
import { fromTimelineDoc, toTimelineDoc } from "./timeline-doc.ts";
import type { Scene } from "./timeline-model.ts";
import { sampleClipProperty, type ClipAnimation } from "./clip-animation.ts";

test("split and trim retain source samples at nonzero in-point for every rate and direction", () => {
	for (const rate of [0.25, 1, 4])
		for (const reverse of [false, true]) {
			const left = sliceSourceInterval(3, 4, rate, reverse, 0, 1.5);
			const right = sliceSourceInterval(3, 4, rate, reverse, 1.5, 4);
			expect(sourceTime(left.start, 1.5, rate, reverse, 1.5)).toBe(
				sourceTime(right.start, 2.5, rate, reverse, 0),
			);
			const retained = sliceSourceInterval(3, 4, rate, reverse, 0.5, 3.5);
			for (const at of [0, 0.75, 2.999])
				expect(sourceTime(retained.start, 3, rate, reverse, at)).toBeCloseTo(
					sourceTime(3, 4, rate, reverse, at + 0.5),
					10,
				);
		}
	expect(() => assertSourceInterval(2, 2, 4, 9.99)).toThrow("too short");
	expect(() => sliceSourceInterval(0, 2, 1, false, -1, 2)).toThrow("Invalid source interval");
	expect(() => sliceSourceInterval(2, 2, 1, false, 1, 1)).toThrow("retained timeline");
});

test("numeric source trims stop at measured bounds without looping or losing frame precision", () => {
	const source = {
		start: 2,
		dur: 4,
		mediaStartSec: 1,
		layout: { xPct: 50, yPct: 50, widthPct: 100, fit: "contain" as const, playbackRate: 2 },
	};
	expect(trimMediaTiming(source, { start: 0, dur: 6 }, 10)).toEqual({
		start: 1.5,
		dur: 4.5,
		mediaStartSec: 0,
	});
	expect(trimMediaTiming(source, { dur: 20 }, 10)).toEqual({
		start: 2,
		dur: 4.5,
		mediaStartSec: 1,
	});
	expect(
		trimMediaTiming({ ...source, layout: { ...source.layout, reverse: true } }, { dur: 20 }, 10),
	).toEqual({ start: 2, dur: 4.5, mediaStartSec: 0 });
	expect(trimMediaTiming(source, { start: 3, dur: 3 }, 10)).toEqual({
		start: 3,
		dur: 3,
		mediaStartSec: 3,
	});
	expect(trimMediaTiming(source, { dur: 0.001 }, 10)).toBeUndefined();
	expect(
		trimMediaTiming(source, { start: 2 + 1 / 30, dur: 4 - 1 / 30 }, 10)?.mediaStartSec,
	).toBeCloseTo(1 + 2 / 30, 12);
});

test("scene and extra video cuts retain source windows through legacy and canonical readers", () => {
	for (const rate of [0.25, 1, 4])
		for (const reverse of [false, true]) {
			const scene = {
				id: 1,
				name: "Video plate",
				dur: 4,
				visualClips: [
					{
						id: "plate",
						kind: "video",
						label: "Plate",
						url: "/api/media/plate",
						startSec: 0,
						durationSec: 4,
						mediaStartSec: 3,
						primary: true,
						layout: {
							xPct: 0,
							yPct: 0,
							widthPct: 100,
							fit: "contain",
							playbackRate: rate,
							reverse,
						},
					},
				],
			} as Scene;
			const doc = toTimelineDoc([scene]);
			const original = doc.clips[0]!;
			const left = retainClipWindow(original, 0, 1.5),
				right = retainClipWindow(original, 1.5, 4);
			const l = clipSourceRange(left)!,
				r = clipSourceRange(right)!;
			expect(sourceTime(l.start, 1.5, rate, reverse, 1.5)).toBe(
				sourceTime(r.start, 2.5, rate, reverse, 0),
			);
			const saved = JSON.parse(JSON.stringify({ ...doc, clips: [right] }));
			const loaded = toTimelineDoc(fromTimelineDoc(saved).scenes);
			expect(loaded.clips[0]?.scene?.visualClips?.[0]?.mediaStartSec).toBe(r.start);
			const visual = scene.visualClips![0]!;
			const extra = retainClipWindow(
				{
					id: "vis:1:extra",
					type: "video",
					startSec: 2,
					durationSec: 4,
					track: -1,
					vis: { sceneId: 1, vclip: { ...visual, id: "extra" } },
				},
				1,
				3,
			);
			expect(extra.vis?.vclip.mediaStartSec).toBe(
				sliceSourceInterval(3, 4, rate, reverse, 1, 3).start,
			);
		}
});

test("canonical cuts preserve eased visual/audio samples, including inherited scene keys and repeated trims", () => {
	const animation: ClipAnimation = {
		tracks: {
			volume: [
				{ t: 0, v: 0.2 },
				{ t: 4, v: 0.8, easing: "in-out" },
			],
			xPct: [
				{ t: 0, v: 0 },
				{ t: 4, v: 60, easing: "out" },
			],
		},
	};
	const scene: Scene = {
		id: 1,
		name: "Plate",
		shot: "Wide",
		move: "Static",
		vis: "",
		vo: "Narration",
		img: true,
		src: "v.mp4",
		dur: 4,
		layout: { xPct: 0, yPct: 0, widthPct: 100, fit: "cover", animation },
		visualClips: [
			{
				id: "v",
				kind: "video",
				label: "Video",
				url: "v.mp4",
				startSec: 0,
				durationSec: 4,
				mediaStartSec: 1,
				layout: { xPct: 0, yPct: 0, widthPct: 100, fit: "cover", playbackRate: 2 },
			},
		],
	};
	const doc = toTimelineDoc(
		[scene],
		[
			{
				id: 2,
				kind: "video",
				url: "v.mp4",
				start: 8,
				dur: 4,
				mediaStartSec: 1,
				layout: { xPct: 0, yPct: 0, widthPct: 100, fit: "cover", playbackRate: 2, animation },
			},
		],
		[],
		[
			{
				id: 3,
				kind: "sfx",
				content: "Source",
				url: "a.wav",
				start: 12,
				dur: 4,
				animation: { tracks: { volume: animation.tracks.volume } },
			},
		],
	);
	const readKeys = (c: (typeof doc.clips)[number]) =>
		c.audio?.animation ??
		c.video?.layout?.animation ??
		c.scene?.visualClips?.[0]?.layout?.animation ??
		c.vis?.vclip.layout?.animation;
	for (const clip of doc.clips) {
		const retained = retainClipWindow(clip, 0.5, 3.5),
			twice = retainClipWindow(retained, 0.25, 2.75);
		const split = [retainClipWindow(clip, 0, 1.5), retainClipWindow(clip, 1.5, 4)];
		for (const [next, offset] of [
			[retained, 0.5],
			[twice, 0.75],
			[split[0]!, 0],
			[split[1]!, 1.5],
		] as const)
			for (const property of clip.audio ? (["volume"] as const) : (["volume", "xPct"] as const))
				for (const time of [0, next.durationSec / 3, next.durationSec]) {
					expect(sampleClipProperty(readKeys(next), property, time, 1)).toBeCloseTo(
						sampleClipProperty(animation, property, time + offset, 1),
						10,
					);
				}
		expect(twice.startSec).toBe(clip.startSec + 0.75);
		expect(twice.durationSec).toBe(2.5);
		if (clip.scene) expect(twice.scene?.vo).toBe("Narration");
	}
});

test("numeric trim keeps local keys and original audio samples at authored rate/direction", () => {
	const animation: ClipAnimation = {
		tracks: {
			volume: [
				{ t: 0, v: 0.2 },
				{ t: 4, v: 0.8, easing: "out" },
			],
		},
	};
	for (const reverse of [false, true]) {
		const audio = { start: 8, dur: 4, mediaStartSec: 1, playbackRate: 2, reverse, animation };
		const next = trimMediaTiming(audio, { start: 9, dur: 2 }, 9)!;
		for (const time of [0, 0.5, 1.9]) {
			expect(sourceTime(next.mediaStartSec, next.dur, 2, reverse, time)).toBeCloseTo(
				sourceTime(1, 4, 2, reverse, time + 1),
				10,
			);
			expect(sampleClipProperty(next.animation, "volume", time, 1)).toBeCloseTo(
				sampleClipProperty(animation, "volume", time + 1, 1),
				10,
			);
		}
		const visual = trimMediaTiming(
			{ start: 8, dur: 4, layout: { xPct: 0, yPct: 0, widthPct: 100, fit: "contain", animation } },
			{ start: 9, dur: 2 },
		);
		expect(sampleClipProperty(visual?.layout?.animation, "volume", 1, 1)).toBeCloseTo(
			sampleClipProperty(animation, "volume", 2, 1),
			10,
		);
	}
});

test("narration-only tail cannot split into a new footage source or change selection", () => {
	const doc = toTimelineDoc([
		{
			id: 1,
			name: "Hold",
			shot: "Wide",
			move: "Static",
			vis: "",
			vo: "Long narration",
			img: true,
			dur: 8,
			visualClips: [
				{
					id: "v",
					kind: "video",
					label: "Footage",
					url: "v.mp4",
					startSec: 0,
					durationSec: 4,
					layout: { xPct: 0, yPct: 0, widthPct: 100, fit: "cover", preservePitch: true },
				},
			],
		},
	]);
	const clip = doc.clips[0]!;
	expect(canRetainClipWindow(clip, 4, 8)).toBe(false);
	expect(canRetainClipWindow(clip, 3, 8)).toBe(true);
	expect(canRetainClipWindow(clip, 2, 2)).toBe(false);
	expect(canRetainClipWindow(clip, NaN, 8)).toBe(false);
	expect(() => retainClipWindow(clip, 4, 8)).toThrow("no selected source");
});

test("an image scene without visual clips re-bases its own scene-level keys on split", () => {
	const animation: ClipAnimation = {
		tracks: {
			opacity: [
				{ t: 1, v: 0 },
				{ t: 3, v: 1 },
			],
		},
	};
	const scene: Scene = {
		id: 1,
		name: "Still",
		shot: "Wide",
		move: "Static",
		vis: "",
		vo: "",
		img: true,
		src: "/still.png",
		dur: 4,
		layout: { xPct: 0, yPct: 0, widthPct: 100, fit: "cover", animation },
	};
	const clip = toTimelineDoc([scene]).clips[0]!;
	expect(clip.scene?.visualClips?.length ?? 0).toBe(0);
	const right = retainClipWindow(clip, 2, 4);
	const keys = right.scene?.layout?.animation?.tracks.opacity;
	expect(keys?.[0]).toMatchObject({ t: 0, v: 0.5 });
	expect(keys?.at(-1)?.t).toBe(2);
	expect(sampleClipProperty(right.scene!.layout!.animation!, "opacity", 1, 1)).toBeCloseTo(
		sampleClipProperty(animation, "opacity", 3, 1),
		10,
	);
});

test("a legacy clip whose stored rate is outside the editable range still splits, using the editor's clamped rate", () => {
	const clip = {
		id: "video:1",
		type: "video" as const,
		startSec: 0,
		durationSec: 4,
		track: 0,
		video: {
			id: 1,
			kind: "video" as const,
			url: "/v.mp4",
			start: 0,
			dur: 4,
			track: 0,
			mediaStartSec: 1,
			layout: { xPct: 0, yPct: 0, widthPct: 100, fit: "cover" as const, playbackRate: 8 },
		},
	};
	expect(clipSourceRange(clip as never)?.rate).toBe(4);
	expect(() => retainClipWindow(clip as never, 0, 2)).not.toThrow();
	expect(
		trimMediaTiming({ start: 0, dur: 4, mediaStartSec: 1, playbackRate: 0.1 }, { dur: 2 })?.dur,
	).toBe(2);
});

test("clips placed past their source's measured length need a trim; scene plates may hold", () => {
	const doc = toTimelineDoc(
		[
			{
				id: 1,
				name: "Plate",
				shot: "",
				move: "",
				vis: "",
				vo: "",
				img: true,
				dur: 9,
				src: "/v.mp4",
				mediaAssetId: "v",
				visualClips: [
					{ id: "a", kind: "video", url: "/v.mp4", mediaAssetId: "v", startSec: 0, durationSec: 9 },
				],
			} as Scene,
		],
		[
			{
				id: 2,
				kind: "video",
				url: "/v.mp4",
				mediaAssetId: "v",
				start: 0,
				dur: 4.6,
				mediaStartSec: 0.5,
				track: 0,
			},
			{ id: 3, kind: "video", url: "/v.mp4", mediaAssetId: "v", start: 5, dur: 4, track: 0 },
		],
		[],
		[
			{
				id: 4,
				kind: "music",
				content: "",
				url: "/a.m4a",
				mediaAssetId: "a",
				start: 0,
				dur: 2,
				mediaStartSec: 0,
				volume: 1,
			},
		],
	);
	const assets = [
		{ id: "v", label: "beach.mov", metadata: { duration: 5 } },
		{ id: "a", label: "bed.m4a", metadata: { duration: 3 } },
	];
	expect([...clipsPastSource(doc.clips, assets)]).toEqual([
		["video:2", "beach.mov: the clip runs past the end of its source. Trim it before export."],
	]);
	expect(clipsPastSource(doc.clips, [{ id: "v", label: "beach.mov" }]).size).toBe(0);
	expect(
		clipsPastSource(doc.clips, [
			{ id: "v", label: "beach.mov audio", source: "generated", metadata: { duration: 5 } },
		]).size,
	).toBe(0);
});

test("export SourceVideo hold is identical to the pre-preview inline rule", () => {
	// The former SourceVideo body: Freeze at `end`, active and muted past it.
	const legacy = (duration: number, rate: number, fps: number, frame: number) => {
		const end = Math.max(0, Math.floor(duration * fps - Math.max(1, 1 / rate)));
		return { freezeAt: end, active: frame > end };
	};
	for (const duration of [0, 0.01, 1 / 30, 1, 2.5, 7.333, 60])
		for (const rate of [0.1, 0.25, 0.5, 1, 1.5, 2, 4, 16])
			for (const fps of [24, 25, 30, 60])
				for (let frame = 0; frame < duration * fps + 40; frame++) {
					const [held, frozen] = heldVideoFrame(duration, rate, fps, frame);
					const before = legacy(duration, rate, fps, frame);
					expect(frozen).toBe(before.active);
					// Freeze reads its frame only while active.
					if (frozen) expect(held).toBe(before.freezeAt);
				}
});
