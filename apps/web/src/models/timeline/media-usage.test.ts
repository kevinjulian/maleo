import { describe, expect, test } from "vite-plus/test";
import { usedMediaAssetIds, mediaUsages } from "./media-usage.ts";
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
	url: "u",
	kind: "image",
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
const empty = { scenes: [], videoOverlays: [], audioOverlays: [] };

describe("usedMediaAssetIds", () => {
	test("an asset placed by each of the four paths is reported in use", () => {
		const used = usedMediaAssetIds({
			scenes: [
				scene({ id: 1, mediaAssetId: "beat-frame" }),
				scene({
					id: 2,
					visualClips: [
						{
							id: "v1",
							kind: "image",
							label: "x",
							url: "u",
							startSec: 0,
							durationSec: 1,
							mediaAssetId: "extra-visual",
						},
					],
				}),
			],
			videoOverlays: [video({ mediaAssetId: "overlay" })],
			audioOverlays: [audio({ mediaAssetId: "bed" })],
		});
		expect([...used].sort()).toEqual(["beat-frame", "bed", "extra-visual", "overlay"]);
	});

	test("an asset placed by none is not reported", () => {
		expect(usedMediaAssetIds(empty).has("nothing")).toBe(false);
	});

	test("removing the last clip referencing an asset removes it from the set", () => {
		const before = usedMediaAssetIds({
			...empty,
			videoOverlays: [video({ mediaAssetId: "only" })],
		});
		expect(before.has("only")).toBe(true);
		expect(usedMediaAssetIds(empty).has("only")).toBe(false);
	});

	test("an asset referenced by two clips is reported once", () => {
		const used = usedMediaAssetIds({
			...empty,
			videoOverlays: [
				video({ id: 1, mediaAssetId: "same" }),
				video({ id: 2, mediaAssetId: "same" }),
			],
		});
		expect([...used]).toEqual(["same"]);
	});

	test("a clip that predates the recording contributes nothing rather than throwing", () => {
		const used = usedMediaAssetIds({
			scenes: [
				scene({
					visualClips: [
						{ id: "v1", kind: "image", label: "x", url: "u", startSec: 0, durationSec: 1 },
					],
				}),
			],
			videoOverlays: [video()],
			audioOverlays: [audio()],
		});
		expect(used.size).toBe(0);
	});
});

test("usage lists each carrier and skips the primary visual alias of a scene frame", () => {
	const usages = mediaUsages("same", {
		scenes: [
			scene({
				src: "u",
				mediaAssetId: "same",
				endMediaAssetId: "same",
				visualClips: [
					{
						id: "primary",
						kind: "image",
						label: "Primary",
						url: "u",
						mediaAssetId: "same",
						primary: true,
						startSec: 0,
						durationSec: 3,
					},
					{
						id: "extra",
						kind: "image",
						label: "Extra",
						url: "v",
						mediaAssetId: "same",
						startSec: 1.5,
						durationSec: 1,
					},
				],
			}),
		],
		videoOverlays: [video({ mediaAssetId: "same" })],
		audioOverlays: [audio({ mediaAssetId: "same" })],
	});
	expect(usages.map((usage) => usage.key)).toEqual([
		"scene:1:frame",
		"scene:1:end",
		"scene:1:extra",
		"video:1",
		"audio:1",
	]);
	expect(usages[2]!.offset).toBe(1.5);
	expect(usages.map((usage) => usage.ref.type)).toEqual([
		"scene",
		"scene",
		"scene",
		"broll",
		"audio",
	]);
});
