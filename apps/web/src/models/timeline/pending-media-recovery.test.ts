import { expect, test } from "vite-plus/test";
import { toTimelineDoc } from "@maleo/shared";
import { applyCommand, invertCommand, type EditScope } from "@maleo/shared/editor";
import { pendingMediaAsset } from "./pending-media-asset.ts";
import { chosenFileReason, removeMediaWithUses } from "./pending-media-recovery.ts";

const asset = pendingMediaAsset("k1", new File(["x"], "beach.mov"), "video", {
	duration: 6,
	decodable: true,
});
const other = {
	id: "o",
	label: "Other",
	url: "/api/media/o",
	kind: "image" as const,
	source: "upload" as const,
};
const doc = toTimelineDoc(
	[
		{
			id: 1,
			name: "Open",
			shot: "",
			move: "",
			vis: "",
			vo: "",
			img: true,
			dur: 4,
			src: "pending:k1",
			mediaAssetId: "k1",
		},
	],
	[
		{
			id: 2,
			kind: "video",
			url: "pending:k1",
			mediaAssetId: "k1",
			start: 0,
			dur: 4,
			mediaStartSec: 1,
			track: 0,
		},
		{ id: 3, kind: "image", url: "/api/media/o", mediaAssetId: "o", start: 0, dur: 2, track: 1 },
	],
);
const scope: EditScope = { doc, mediaAssets: [asset, other], slides: [], posts: [] };

test("a file chosen again must be the same kind and long enough for every use", () => {
	expect(chosenFileReason(scope, "k1", "video", 6)).toBeUndefined();
	expect(chosenFileReason(scope, "k1", "audio", 6)).toBe("Choose a video file");
	expect(chosenFileReason(scope, "k1", "video", 3)).toBe(
		"Replacement source is too short for selected clip range",
	);
	expect(chosenFileReason(scope, "k1", "video", undefined)).toBe(
		"Length unknown; choose another file",
	);
	// Resolving the asset edits no clip, so a locked track does not refuse the file.
	expect(
		chosenFileReason(
			{ ...scope, doc: { ...doc, trackFlags: { 0: { locked: true } } } },
			"k1",
			"video",
			6,
		),
	).toBeUndefined();
});

test("removing a pending asset removes its clips and clears its scene frame in one undo step", () => {
	const command = removeMediaWithUses(scope, "k1");
	const after = applyCommand(scope, command);
	expect(after.mediaAssets).toEqual([other]);
	expect(after.doc.clips.map((clip) => clip.id).sort()).toEqual(["scene:1", "video:3"]);
	expect(after.doc.clips.find((clip) => clip.id === "scene:1")!.scene).toMatchObject({
		img: false,
	});
	expect(after.doc.clips.find((clip) => clip.id === "scene:1")!.scene!.src).toBeUndefined();
	expect(applyCommand(after, invertCommand(scope, command))).toEqual(scope);
	expect(() =>
		removeMediaWithUses({ ...scope, doc: { ...doc, trackFlags: { 0: { locked: true } } } }, "k1"),
	).toThrow("Used media is on a locked track");
});
