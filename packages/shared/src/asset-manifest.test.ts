import { expect, test } from "vite-plus/test";
import { collectAssetReferences, referencesPendingMedia } from "./asset-manifest.ts";
import { mediaUrl, mintMediaId } from "./media-id.ts";

const id = mintMediaId();

test("a clip and a library entry naming one file are one reference, used and named", () => {
	const refs = collectAssetReferences(
		{ clips: [{ id: "video:1", video: { url: mediaUrl(id), thumb: mediaUrl(id) } }] },
		[{ id, label: "My clip", url: mediaUrl(id), metadata: { originalFilename: "clip.mov" } }],
	);
	expect(refs).toEqual([{ type: "managed", id, url: mediaUrl(id), label: "clip.mov", used: true }]);
});

test("an unplaced library upload is listed but not used", () => {
	expect(
		collectAssetReferences({ clips: [] }, [{ label: "spare.png", url: mediaUrl(id) }]),
	).toEqual([{ type: "managed", id, url: mediaUrl(id), label: "spare.png", used: false }]);
});

test("small inline images are skipped; other URLs are external; text is not media", () => {
	const refs = collectAssetReferences(
		{
			scenes: [
				{ image: "data:image/png;base64,AAAA", vo: "https://not-a-media-field.example" },
				{ src: "https://cdn.example/stock.mp4" },
				{ src: "https://cdn.example/stock.mp4" },
				{ image: "a prompt, not a URL" },
			],
		},
		[],
	);
	expect(refs).toEqual([{ type: "external", url: "https://cdn.example/stock.mp4", used: true }]);
});

test("pending media is a listed unfinished identity", () => {
	const clip = { video: { url: mediaUrl(id) } };
	expect(referencesPendingMedia(clip, [id])).toBe(true);
	expect(referencesPendingMedia(clip)).toBe(false);
	expect(referencesPendingMedia({ url: "pending:k" })).toBe(false);
	expect(referencesPendingMedia({ url: "https://cdn.example/a.mp4" }, [id])).toBe(false);
});
