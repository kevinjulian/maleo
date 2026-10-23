import { expect, test } from "vite-plus/test";
import { mediaUrl, mintMediaId } from "@maleo/shared";
import {
	mediaUseReason,
	pendingMediaAsset,
	PREVIEW_AFTER_PROCESSING,
} from "./pending-media-asset.ts";
import { mediaDropReason } from "./media-placement.ts";

const file = new File(["abcd"], "beach.mov");
const [k1, k2, k3] = [mintMediaId(), mintMediaId(), mintMediaId()];

test("a pending asset carries its minted identity, its final URL and what the browser measured", () => {
	expect(
		pendingMediaAsset(k1, file, "video", {
			width: 1920,
			height: 1080,
			duration: 4,
			hasAudio: true,
			decodable: true,
		}),
	).toEqual({
		id: k1,
		label: "beach.mov",
		url: mediaUrl(k1),
		kind: "video",
		source: "upload",
		dur: 4,
		metadata: {
			originalFilename: "beach.mov",
			byteSize: 4,
			kind: "video",
			width: 1920,
			height: 1080,
			duration: 4,
			hasAudio: true,
		},
	});
});

test("an undecodable pending source still places; one with no length does not", () => {
	const undecodable = pendingMediaAsset(k1, file, "video", { duration: 4, decodable: false });
	expect(undecodable.compatibility?.preview.reason).toBe(PREVIEW_AFTER_PROCESSING);
	expect(mediaUseReason(undecodable)).toBeUndefined();
	expect(
		mediaDropReason({ url: mediaUrl(k1), kind: "video", mediaAssetId: k1 }, [undecodable]),
	).toBeUndefined();
	const unknown = pendingMediaAsset(k2, file, "video", { decodable: false, blocked: "x" });
	expect(mediaDropReason({ url: mediaUrl(k2), kind: "video", mediaAssetId: k2 }, [unknown])).toBe(
		"Length unknown until processing finishes",
	);
	expect(
		mediaUseReason(pendingMediaAsset(k3, new File(["x"], "a.png"), "image", { decodable: true })),
	).toBeUndefined();
});

test("a managed asset still needs both compatibility paths", () => {
	expect(
		mediaUseReason({
			url: "/api/media/x",
			kind: "video",
			compatibility: {
				preview: { status: "processing", reason: "Converting" },
				render: { status: "unknown" },
			},
		}),
	).toBe("Converting");
});

test("admitting a ready import's managed URL answers with the pending asset's identity", async () => {
	const { admitMediaAsset } = await import("./media-admission.ts");
	const { setPendingReady, clearPendingSources } =
		await import("@models/core/pending-media-sources.ts");
	const pending = pendingMediaAsset(k1, file, "video", { duration: 4, decodable: true });
	setPendingReady(k1, { url: mediaUrl(k1) } as never);
	try {
		expect(
			admitMediaAsset([pending], {
				label: "x",
				url: mediaUrl(k1),
				kind: "video",
				source: "upload",
			}),
		).toEqual({ assets: [pending], id: k1, added: false });
	} finally {
		clearPendingSources();
	}
});
