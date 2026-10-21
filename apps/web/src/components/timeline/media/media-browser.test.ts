import { describe, expect, test } from "vite-plus/test";
import { buildMediaManifestItems } from "./media-browser.tsx";
import type { Scene } from "@maleo/shared";
import type { MediaAsset } from "@models/timeline/editor-media.ts";

const asset = (over: Partial<MediaAsset> = {}): MediaAsset => ({
	id: "a1",
	label: "Stock clip",
	url: "https://cdn.example/a.mp4",
	kind: "video",
	source: "stock",
	...over,
});
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
const build = (mediaAssets: MediaAsset[], scenes: Scene[], used: string[]) =>
	buildMediaManifestItems({ mediaAssets, scenes, usedAssetIds: new Set(used) });

describe("All Media lists what the project holds, split by what the timeline references", () => {
	test("an asset saved but not placed is listed as unplaced", () => {
		const items = build([asset()], [], []);
		expect(items).toHaveLength(1);
		expect(items[0]!.id).toBe("a1");
		expect(items[0]!.placed).toBe(false);
	});

	test("the same asset once placed is listed as placed", () => {
		const items = build([asset()], [], ["a1"]);
		expect(items).toHaveLength(1);
		expect(items[0]!.id).toBe("a1");
		expect(items[0]!.placed).toBe(true);
	});

	test("an asset becomes unplaced when the last clip referencing it goes", () => {
		// It does not leave the project — it is still admitted, just no longer
		// positioned, so it stays available to drag back on.
		expect(build([asset()], [], ["a1"])[0]!.placed).toBe(true);
		const after = build([asset()], [], []);
		expect(after).toHaveLength(1);
		expect(after[0]!.placed).toBe(false);
	});

	test("an admitted asset is listed once, not in both halves", () => {
		const items = build([asset()], [], ["a1"]);
		expect(items.filter((i) => i.id === "a1")).toHaveLength(1);
	});

	test("a reference-library entity that was never admitted is not listed here", () => {
		// The panel's only source of assets is what the project has admitted, and
		// browsing the library does not admit. An entity image reaches this panel
		// by being placed, like anything else — never on the strength of existing.
		expect(build([], [], [])).toHaveLength(0);
	});

	test("a scene's frame is listed as placed without being an admitted asset", () => {
		// A scene IS a clip, so its frame is in use by definition — including one
		// generated straight into the beat, which has no asset id to be used by.
		const items = build([], [scene({ img: true, src: "https://cdn.example/frame.png" })], []);
		expect(items).toHaveLength(1);
		expect(items[0]!.assetBacked).toBe(false);
		expect(items[0]!.placed).toBe(true);
	});

	test("a scene's end frame is listed alongside its start frame", () => {
		const items = build(
			[],
			[scene({ img: true, src: "https://cdn.example/a.png", endSrc: "https://cdn.example/b.png" })],
			[],
		);
		expect(items.map((i) => i.url)).toEqual([
			"https://cdn.example/a.png",
			"https://cdn.example/b.png",
		]);
	});

	test("a placed asset and a scene frame sharing a URL are listed once, as the frame", () => {
		const items = build(
			[asset({ id: "a1", url: "https://cdn.example/same.png", kind: "image" })],
			[scene({ img: true, src: "https://cdn.example/same.png" })],
			["a1"],
		);
		expect(items).toHaveLength(1);
		expect(items[0]!.assetBacked).toBe(false);
		expect(items[0]!.placed).toBe(true);
	});

	test("an unplaced asset sharing a URL with a scene frame collapses to the frame", () => {
		// Without the frame winning the dedup this would read as "ready to place"
		// while the file is visibly on the timeline.
		const items = build(
			[asset({ id: "a1", url: "https://cdn.example/same.png", kind: "image" })],
			[scene({ img: true, src: "https://cdn.example/same.png" })],
			[],
		);
		expect(items).toHaveLength(1);
		expect(items[0]!.placed).toBe(true);
	});
	/* Scene frames were a special case only because generation admitted nothing.
	 * Now that it does, a frame is asset-backed and gains what backing carries:
	 * favourite, reveal, and a drag payload that names the asset instead of
	 * re-admitting the URL. */
	test("a scene frame whose scene carries an identity is asset-backed", () => {
		const items = build(
			[asset({ id: "a1", url: "https://cdn.example/frame.png", kind: "image", favorite: true })],
			[scene({ img: true, src: "https://cdn.example/frame.png", mediaAssetId: "a1" })],
			["a1"],
		);
		expect(items).toHaveLength(1);
		expect(items[0]!.assetBacked).toBe(true);
		expect(items[0]!.id).toBe("a1");
		expect(items[0]!.favorite).toBe(true);
		expect(items[0]!.placed).toBe(true);
	});

	test("an end frame carries its own identity, not the start frame's", () => {
		const items = build(
			[
				asset({ id: "start", url: "https://cdn.example/a.png", kind: "image" }),
				asset({ id: "end", url: "https://cdn.example/b.png", kind: "image" }),
			],
			[
				scene({
					img: true,
					src: "https://cdn.example/a.png",
					mediaAssetId: "start",
					endSrc: "https://cdn.example/b.png",
					endMediaAssetId: "end",
				}),
			],
			["start", "end"],
		);
		expect(items.map((i) => i.id)).toEqual(["start", "end"]);
		expect(items.every((i) => i.assetBacked && i.placed)).toBe(true);
	});

	test("a frame in a project not yet reconciled stays unbacked", () => {
		// Nothing admitted it, so there is no asset to name. The reconciler will
		// fix this on open; until it does the panel must not invent an identity.
		const items = build([], [scene({ img: true, src: "https://cdn.example/legacy.png" })], []);
		expect(items[0]!.assetBacked).toBe(false);
		expect(items[0]!.placed).toBe(true);
	});
});
