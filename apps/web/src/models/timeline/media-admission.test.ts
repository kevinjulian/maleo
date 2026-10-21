import { describe, expect, test } from "vite-plus/test";
import { admitMediaAsset, type MediaAssetSeed } from "./media-admission.ts";

const seed = (over: Partial<MediaAssetSeed> = {}): MediaAssetSeed => ({
	label: "Clip",
	url: "https://cdn.example/a.mp4",
	kind: "video",
	source: "stock",
	...over,
});

describe("admitMediaAsset", () => {
	test("a new URL is admitted and answers with an identity", () => {
		const { assets, id, added } = admitMediaAsset([], seed());
		expect(added).toBe(true);
		expect(assets).toHaveLength(1);
		expect(assets[0]!.id).toBe(id);
	});

	test("the same URL admitted twice yields one asset and the same identity", () => {
		const first = admitMediaAsset([], seed());
		const second = admitMediaAsset(first.assets, seed({ label: "Same file, different search" }));
		expect(second.added).toBe(false);
		expect(second.id).toBe(first.id);
		expect(second.assets).toHaveLength(1);
	});

	test("a surface's proposed id is honoured for a new URL", () => {
		const { id } = admitMediaAsset([], seed({ id: "stock-771" }));
		expect(id).toBe("stock-771");
	});

	test("a proposed id does not override an already-admitted URL", () => {
		const first = admitMediaAsset([], seed({ id: "stock-771" }));
		const second = admitMediaAsset(first.assets, seed({ id: "pexels-771" }));
		expect(second.id).toBe("stock-771");
		expect(second.assets).toHaveLength(1);
	});

	test("two different URLs get distinct identities", () => {
		const first = admitMediaAsset([], seed({ url: "https://cdn.example/a.mp4" }));
		const second = admitMediaAsset(first.assets, seed({ url: "https://cdn.example/b.mp4" }));
		expect(second.id).not.toBe(first.id);
		expect(second.assets).toHaveLength(2);
	});

	test("admission does not mutate the list it was given", () => {
		const before: never[] = [];
		admitMediaAsset(before, seed());
		expect(before).toHaveLength(0);
	});
});
