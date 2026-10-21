/* The property under test is convergence.
 *
 * Reconciliation is a document write triggered by a document change, which is
 * the exact shape of the autosave loop this codebase just fixed. What keeps it
 * from looping is that a second pass over a repaired document plans nothing —
 * so "plan, apply, re-plan, get null" is the assertion that matters, and the
 * rest of these tests exist to make its inputs believable. */
import { describe, expect, test } from "vite-plus/test";
import {
	applyAudioOverlayReconcile,
	applySceneReconcile,
	applyVideoOverlayReconcile,
	planMediaReconcile,
	type MediaReconcilePlan,
} from "./media-reconcile.ts";
import { admitMediaAsset } from "./media-admission.ts";
import type { MediaAsset } from "./editor-media.ts";
import type { AudioOverlay, Scene, VideoOverlay } from "@maleo/shared";

const scene = (over: Partial<Scene> = {}): Scene => ({
	id: 1,
	dur: 3,
	name: "Beat",
	shot: "Medium Shot",
	move: "Static",
	vis: "",
	vo: "",
	img: true,
	...over,
});
const video = (over: Partial<VideoOverlay> = {}): VideoOverlay => ({
	id: 1,
	url: "v.mp4",
	kind: "video",
	start: 0,
	dur: 3,
	...over,
});
const audio = (over: Partial<AudioOverlay> = {}): AudioOverlay => ({
	id: 1,
	kind: "music",
	content: "bed",
	start: 0,
	dur: 5,
	...over,
});
const nothing = { scenes: [], videoOverlays: [], audioOverlays: [], assets: [] };

/** Admission as the hook performs it: every seed through `admitMediaAsset`, the
 *  answers collected by URL. Shared with the applier so the convergence test
 *  exercises the real dedup rule rather than a stand-in. */
function admit(assets: MediaAsset[], plan: MediaReconcilePlan) {
	const ids = new Map<string, string>();
	let next = assets;
	for (const seed of plan.seeds) {
		const result = admitMediaAsset(next, seed);
		next = result.assets;
		ids.set(seed.url, result.id);
	}
	// Carriers may point at a URL already admitted before this pass, which needs
	// no seed but still needs an identity to write.
	for (const a of next) if (!ids.has(a.url)) ids.set(a.url, a.id);
	return { assets: next, ids };
}

describe("planMediaReconcile", () => {
	test("plans null when every media URL already carries an identity", () => {
		const plan = planMediaReconcile({
			scenes: [scene({ src: "a.png", mediaAssetId: "asset-a" })],
			videoOverlays: [video({ mediaAssetId: "asset-v" })],
			audioOverlays: [audio({ url: "bed.mp3", mediaAssetId: "asset-b" })],
			assets: [],
		});
		expect(plan).toBeNull();
	});

	test("plans null over an empty document", () => {
		expect(planMediaReconcile(nothing)).toBeNull();
	});

	test("a clip with a URL and no identity yields one seed and one patch", () => {
		const plan = planMediaReconcile({
			...nothing,
			audioOverlays: [audio({ id: 7, url: "vo.mp3" })],
		})!;
		expect(plan.seeds).toHaveLength(1);
		expect(plan.seeds[0]).toMatchObject({ url: "vo.mp3", kind: "audio", audioKind: "music" });
		expect(plan.patches.audioOverlays).toEqual([{ id: 7, url: "vo.mp3" }]);
	});

	test("two clips sharing a URL yield one seed and two patches", () => {
		const plan = planMediaReconcile({
			...nothing,
			audioOverlays: [audio({ id: 1, url: "same.mp3" }), audio({ id: 2, url: "same.mp3" })],
		})!;
		expect(plan.seeds).toHaveLength(1);
		expect(plan.patches.audioOverlays).toEqual([
			{ id: 1, url: "same.mp3" },
			{ id: 2, url: "same.mp3" },
		]);
	});

	test("a URL already admitted needs a patch but no second seed", () => {
		const plan = planMediaReconcile({
			...nothing,
			audioOverlays: [audio({ id: 3, url: "known.mp3" })],
			assets: [
				{ id: "asset-known", label: "Known", url: "known.mp3", kind: "audio", source: "stock" },
			],
		})!;
		expect(plan.seeds).toEqual([]);
		expect(plan.patches.audioOverlays).toEqual([{ id: 3, url: "known.mp3" }]);
	});

	test("every carrier is scanned, including a scene's end frame", () => {
		const plan = planMediaReconcile({
			scenes: [
				scene({
					id: 5,
					src: "start.png",
					endSrc: "end.png",
					visualClips: [
						{
							id: "v1",
							kind: "video",
							label: "Extra",
							url: "extra.mp4",
							startSec: 0,
							durationSec: 1,
						},
					],
				}),
			],
			videoOverlays: [video({ id: 9, url: "broll.mp4" })],
			audioOverlays: [audio({ id: 11, url: "sfx.mp3" })],
			assets: [],
		})!;
		expect(plan.patches.scenes).toEqual([
			{ id: 5, slot: "mediaAssetId", url: "start.png" },
			{ id: 5, slot: "endMediaAssetId", url: "end.png" },
		]);
		expect(plan.patches.visualClips).toEqual([{ sceneId: 5, clipId: "v1", url: "extra.mp4" }]);
		expect(plan.patches.videoOverlays).toEqual([{ id: 9, url: "broll.mp4" }]);
		expect(plan.patches.audioOverlays).toEqual([{ id: 11, url: "sfx.mp3" }]);
		expect(plan.seeds.map((s) => s.url).sort()).toEqual([
			"broll.mp4",
			"end.png",
			"extra.mp4",
			"sfx.mp3",
			"start.png",
		]);
	});
});

describe("applying a plan converges", () => {
	test("re-planning over the applied result yields null", () => {
		const scenes = [
			scene({
				id: 5,
				src: "start.png",
				endSrc: "end.png",
				visualClips: [
					{
						id: "v1",
						kind: "video",
						label: "Extra",
						url: "extra.mp4",
						startSec: 0,
						durationSec: 1,
					},
				],
			}),
		];
		const videoOverlays = [video({ id: 9, url: "broll.mp4" })];
		// Two clips on one URL: the case where a second admission could re-mint an
		// identity the first just minted and leave the pass with work to do forever.
		const audioOverlays = [audio({ id: 11, url: "sfx.mp3" }), audio({ id: 12, url: "sfx.mp3" })];

		const plan = planMediaReconcile({ scenes, videoOverlays, audioOverlays, assets: [] })!;
		const { assets, ids } = admit([], plan);
		const after = {
			scenes: applySceneReconcile(scenes, plan, ids),
			videoOverlays: applyVideoOverlayReconcile(videoOverlays, plan, ids),
			audioOverlays: applyAudioOverlayReconcile(audioOverlays, plan, ids),
			assets,
		};

		expect(after.scenes[0]!.mediaAssetId).toBeTruthy();
		expect(after.scenes[0]!.endMediaAssetId).toBeTruthy();
		expect(after.scenes[0]!.visualClips![0]!.mediaAssetId).toBeTruthy();
		expect(after.videoOverlays[0]!.mediaAssetId).toBeTruthy();
		// One asset for the shared URL, and both clips pointing at it.
		expect(after.audioOverlays[0]!.mediaAssetId).toBe(after.audioOverlays[1]!.mediaAssetId!);
		expect(assets).toHaveLength(5);

		expect(planMediaReconcile(after)).toBeNull();
	});

	test("applying leaves untouched carriers referentially identical", () => {
		const untouched = scene({ id: 2, src: "b.png", mediaAssetId: "asset-b" });
		const scenes = [scene({ id: 1, src: "a.png" }), untouched];
		const plan = planMediaReconcile({ ...nothing, scenes })!;
		const { ids } = admit([], plan);
		const next = applySceneReconcile(scenes, plan, ids);
		expect(next[1]).toBe(untouched);
	});
});
