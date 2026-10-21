/* The reconciler is a net, not the mechanism.
 *
 * Each of these drives a writer and then asserts `planMediaReconcile` finds
 * nothing. That turns "the reconciler repaired something" — which is silent,
 * because self-repair is what it is for — into a failing test naming the writer
 * that forgot. Both fail against the pre-change ops: `setSceneVisual` took no
 * asset id at all.
 *
 * `useVisualClipOps` is a plain factory over injected setters, so it runs
 * outside React. */
import { describe, expect, test } from "vite-plus/test";
import { useVisualClipOps } from "./use-visual-clip-ops.ts";
import { admitMediaAsset, type MediaAssetSeed } from "@models/timeline/media-admission.ts";
import { planMediaReconcile } from "@models/timeline/media-reconcile.ts";
import type { MediaAsset } from "@models/timeline/editor-media.ts";
import type { Scene } from "@maleo/shared";

const scene = (over: Partial<Scene> = {}): Scene => ({
	id: 1,
	dur: 3,
	name: "Beat",
	shot: "Medium Shot",
	move: "Static",
	vis: "",
	vo: "",
	img: false,
	...over,
});

/** The editor's state, as much of it as these ops touch: a scene list a setter
 *  writes through, and a media record admission accumulates into. */
function editor(initial: Scene[]) {
	let scenes = initial;
	let assets: MediaAsset[] = [];
	const setScenes = (next: Scene[] | ((prev: Scene[]) => Scene[])): void => {
		scenes = typeof next === "function" ? next(scenes) : next;
	};
	const ensureMediaAsset = (seed: MediaAssetSeed): string => {
		const r = admitMediaAsset(assets, seed);
		assets = r.assets;
		return r.id;
	};
	return {
		ops: useVisualClipOps(setScenes, ensureMediaAsset),
		ensureMediaAsset,
		scenes: () => scenes,
		assets: () => assets,
		plan: () => planMediaReconcile({ scenes, videoOverlays: [], audioOverlays: [], assets }),
	};
}

describe("visual clip ops leave nothing for the reconciler", () => {
	test("setSceneVisual admits the frame and records it on the scene and its primary clip", () => {
		const e = editor([scene()]);
		e.ops.setSceneVisual(1, "/uploads/frame.png");

		expect(e.assets()).toHaveLength(1);
		expect(e.scenes()[0]!.mediaAssetId).toBe(e.assets()[0]!.id);
		expect(e.scenes()[0]!.visualClips![0]!.mediaAssetId).toBe(e.assets()[0]!.id);
		expect(e.plan()).toBeNull();
	});

	test("setting the same frame on two scenes admits one asset", () => {
		const e = editor([scene({ id: 1 }), scene({ id: 2 })]);
		e.ops.setSceneVisual(1, "/uploads/frame.png");
		e.ops.setSceneVisual(2, "/uploads/frame.png");

		expect(e.assets()).toHaveLength(1);
		expect(e.scenes()[0]!.mediaAssetId).toBe(e.scenes()[1]!.mediaAssetId!);
		expect(e.plan()).toBeNull();
	});

	test("addVisualClip records the identity its caller admitted", () => {
		const e = editor([scene({ id: 1, src: "/uploads/a.png" })]);
		const primary = e.ensureMediaAsset({
			label: "A",
			url: "/uploads/a.png",
			kind: "image",
			source: "stock",
		});
		e.ops.setSceneVisual(1, "/uploads/a.png");
		expect(e.scenes()[0]!.mediaAssetId).toBe(primary);

		const extra = e.ensureMediaAsset({
			label: "B",
			url: "/uploads/b.mp4",
			kind: "video",
			source: "stock",
		});
		e.ops.addVisualClip(1, "/uploads/b.mp4", "video", extra);

		expect(e.scenes()[0]!.visualClips!.map((v) => v.mediaAssetId)).toEqual([primary, extra]);
		expect(e.plan()).toBeNull();
	});
});
