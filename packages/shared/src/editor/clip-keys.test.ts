import { expect, test } from "vite-plus/test";
import {
	clipKeyError,
	clipTrack,
	keyTarget,
	nearKeyIndex,
	setClipKeys,
	upsertKey,
} from "./clip-keys.ts";
import { setKeys } from "./commands.ts";
import { applyCommand, execute } from "./engine-registry.ts";
import { sampleScope } from "./sample-scope.ts";
import type { EditorDoc } from "./scope.ts";
import type { Clip } from "../timeline-doc.ts";

const scene = (visualClips?: unknown[]): Clip => ({
	id: "scene:1",
	type: "image",
	startSec: 0,
	durationSec: 5,
	track: 0,
	scene: {
		id: 1,
		name: "S",
		shot: "",
		move: "Static",
		vis: "",
		vo: "",
		img: true,
		src: "a.png",
		dur: 5,
		...(visualClips ? { visualClips } : {}),
	} as Clip["scene"],
});
const docWith = (...clips: Clip[]): EditorDoc => ({ ...sampleScope().doc, clips, trackFlags: {} });

test("refusals name the problem and leave the document untouched", () => {
	const doc = sampleScope().doc;
	expect(clipKeyError(doc, "nope", "scale", [])).toContain("unavailable");
	expect(clipKeyError(doc, "video:1", "warp", [{ t: 0, v: 1 }])).toContain(
		"Unknown animatable property",
	);
	expect(clipKeyError(doc, "video:1", "scale", [{ t: 4.5, v: 1 }])).toContain(
		"outside the clip (0–4s)",
	);
	expect(clipKeyError(doc, "video:1", "scale", [{ t: 0, v: 50 }])).toContain(
		"not valid for this video clip",
	);
	expect(clipKeyError(doc, "video:1", "fontSize", [{ t: 0, v: 40 }])).toContain("not valid");
	const locked = { ...doc, trackFlags: { 0: { locked: true } } };
	expect(clipKeyError(locked, "video:1", "scale", [{ t: 0, v: 1 }])).toContain("locked");
	expect(setClipKeys(locked, "video:1", "scale", [{ t: 0, v: 1 }])).toBe(locked);
	const image = docWith({ ...doc.clips[0]!, video: { ...doc.clips[0]!.video!, kind: "image" } });
	expect(clipKeyError(image, "video:1", "volume", [{ t: 0, v: 0.5 }])).toContain(
		"not valid for this image clip",
	);
});

test("an unchanged track returns the same scope, so nothing is recorded", () => {
	const keyed = applyCommand(sampleScope(), setKeys("video:1", "scale", [{ t: 0, v: 1 }]));
	expect(applyCommand(keyed, setKeys("video:1", "scale", [{ t: 0, v: 1 }]))).toBe(keyed);
	expect(applyCommand(sampleScope(), setKeys("video:1", "scale", []))).toEqual(sampleScope());
});

test("a scene clip keys its primary visual, materializing a legacy src visual, and undo restores exactly", () => {
	const doc = docWith(scene());
	expect(keyTarget(doc, "scene:1")?.duration).toBe(5);
	const scope = { ...sampleScope(), doc };
	const { scope: next, inverse } = execute(
		scope,
		setKeys("scene:1", "opacity", [
			{ t: 0, v: 0 },
			{ t: 5, v: 1 },
		]),
	);
	expect(next.doc.clips[0]!.scene!.visualClips![0]!.layout?.animation?.tracks.opacity).toHaveLength(
		2,
	);
	expect(clipTrack(next.doc, "scene:1", "opacity")).toHaveLength(2);
	expect(applyCommand(next, inverse)).toEqual(scope);
});

test("a multi-visual scene uses the primary visual's own duration, and vis clips key their visual", () => {
	const primary = {
		id: "p",
		kind: "image",
		url: "a.png",
		label: "A",
		startSec: 0,
		durationSec: 2,
		primary: true,
	};
	const other = { id: "o", kind: "video", url: "b.mp4", label: "B", startSec: 2, durationSec: 3 };
	const vis: Clip = {
		id: "vis:1:o",
		type: "video",
		startSec: 2,
		durationSec: 3,
		track: 0,
		markerId: 1,
		vis: { sceneId: 1, vclip: other as never },
	};
	const doc = docWith(scene([primary]), vis);
	expect(keyTarget(doc, "scene:1")?.duration).toBe(2);
	expect(clipKeyError(doc, "scene:1", "xPct", [{ t: 3, v: 0 }])).toContain("outside");
	const next = setClipKeys(doc, "vis:1:o", "volume", [
		{ t: 0, v: 1 },
		{ t: 3, v: 0 },
	]);
	expect(next.clips[1]!.vis!.vclip.layout?.animation?.tracks.volume).toHaveLength(2);
	expect(keyTarget(doc, "vis:1:o")?.kind).toBe("video");
});

test("audio keeps gain keys on the payload, text keeps colour keys in its layout", () => {
	const audio: Clip = {
		id: "audio:3",
		type: "audio",
		startSec: 0,
		durationSec: 4,
		track: 2,
		audio: { id: 3, kind: "music", content: "Bed", start: 0, dur: 4 } as Clip["audio"],
	};
	const text: Clip = {
		id: "text:4",
		type: "text",
		startSec: 0,
		durationSec: 2,
		track: 1,
		text: { id: 4, content: "Hi", start: 0, dur: 2, preset: "plain" },
	};
	const doc = setClipKeys(
		setClipKeys(docWith(audio, text), "audio:3", "volume", [{ t: 1, v: 0.2 }]),
		"text:4",
		"fill",
		[{ t: 0, v: "#fff" }],
	);
	expect(doc.clips[0]!.audio!.animation).toEqual({ tracks: { volume: [{ t: 1, v: 0.2 }] } });
	expect(doc.clips[1]!.text!.layout?.animation).toEqual({
		tracks: {},
		colorTracks: { fill: [{ t: 0, v: "#fff" }] },
	});
	expect(clipKeyError(doc, "audio:3", "xPct", [{ t: 0, v: 0 }])).toContain(
		"not valid for this audio clip",
	);
});

test("an edit within the snap window updates the nearest key; outside it adds one", () => {
	const keys = [
		{ t: 0, v: 0 },
		{ t: 2, v: 1, easing: "in" as const },
	];
	expect(nearKeyIndex(keys, 2.05)).toBe(1);
	expect(nearKeyIndex(keys, 2.2)).toBe(-1);
	expect(upsertKey(keys, 2.05, 0.4)).toEqual([
		{ t: 0, v: 0 },
		{ t: 2, v: 0.4, easing: "in" },
	]);
	expect(upsertKey(keys, 2.05, 0.4, "hold")).toEqual([
		{ t: 0, v: 0 },
		{ t: 2, v: 0.4, easing: "hold" },
	]);
	expect(upsertKey(keys, 2.2, 0.4)).toEqual([
		{ t: 0, v: 0 },
		{ t: 2, v: 1, easing: "in" },
		{ t: 2.2, v: 0.4, easing: "linear" },
	]);
	expect(upsertKey(keys, 1, 0.5)).toHaveLength(3);
	expect(
		upsertKey(
			[
				{ t: 1.95, v: 0 },
				{ t: 2.08, v: 1 },
			],
			2.05,
			9,
		),
	).toEqual([
		{ t: 1.95, v: 0 },
		{ t: 2.08, v: 9 },
	]);
});
