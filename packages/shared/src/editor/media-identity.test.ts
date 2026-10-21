import { describe, expect, test } from "vite-plus/test";
import { mediaAssetOf } from "./media-identity.ts";
import type { MediaAsset } from "./scope.ts";

const asset = (id: string, url: string, kind: MediaAsset["kind"] = "video"): MediaAsset => ({
	id,
	url,
	kind,
	label: id,
	source: "upload",
});

describe("mediaAssetOf: the asset a clip refers to", () => {
	const relinked = asset("a1", "/api/media/new");
	const other = asset("a2", "/api/media/old");
	const assets = [relinked, other];

	test("is the asset its id names, whatever URL the clip still carries", () => {
		/* After a relink or a pending upload's completion the clip's URL is not the
		 * asset's; the id is what the clip means. */
		expect(mediaAssetOf(assets, { mediaAssetId: "a1", url: "/api/media/old" })).toBe(relinked);
		expect(mediaAssetOf(assets, { mediaAssetId: "a1", url: "pending:key-1" })).toBe(relinked);
	});

	test("respects the kind it is asked for", () => {
		expect(
			mediaAssetOf(assets, { mediaAssetId: "a1", url: "/api/media/new" }, "audio"),
		).toBeUndefined();
	});

	test("falls back to the URL only for a legacy reference: no id, or an id the library does not hold", () => {
		expect(mediaAssetOf(assets, { url: "/api/media/old" })).toBe(other);
		expect(mediaAssetOf(assets, { mediaAssetId: "gone", url: "/api/media/old" })).toBe(other);
		expect(mediaAssetOf(assets, { url: "/api/media/none" })).toBeUndefined();
		expect(mediaAssetOf(assets, {})).toBeUndefined();
	});
});
