import { expect, test } from "vite-plus/test";
import { placeProjectMedia, removeUnusedProjectMedia } from "./media-library.ts";
import { admitMediaCommand } from "./media-admission.ts";
import { mediaUrl, mintMediaId } from "@maleo/shared";
import { pendingMediaAsset } from "./pending-media-asset.ts";
import {
	commandLabel,
	invertCommand,
	applyCommand,
	insertClip,
	batch,
	type EditScope,
} from "@maleo/shared/editor";
import { createCommandLedger } from "@models/chat/command-ledger.ts";
import { diffScopeToCommand } from "@maleo/shared/editor";
import { applyTouchedResult } from "./agent-result-scope.ts";
import type { MediaAsset } from "./editor-media.ts";
import { editorExecutor } from "@maleo/shared/editor";

const asset: MediaAsset = {
	id: "imported",
	label: "Original footage",
	kind: "video",
	source: "upload",
	url: "/api/media/00000000-0000-0000-0000-000000000001",
	dur: 4,
	metadata: { originalFilename: "original.mov", kind: "video", byteSize: 42, duration: 4 },
	importedSource: { revision: "revision", fingerprint: "a".repeat(64), originalMediaId: "source" },
};
const before: EditScope = {
	doc: { schemaVersion: 2, clips: [], markers: [] },
	slides: [],
	posts: [],
	mediaAssets: [],
};

test("import admission plus placement undoes and redoes complete media/document scope with stable identity", () => {
	const command = batch(
		[
			admitMediaCommand(asset),
			insertClip({
				id: "video:1",
				type: "video",
				track: 0,
				startSec: 2,
				durationSec: 4,
				video: {
					id: 1,
					kind: "video",
					label: asset.label,
					url: asset.url,
					mediaAssetId: asset.id,
					start: 2,
					dur: 4,
					track: 0,
				},
			}),
		],
		"media.import-and-place",
	);
	const ledger = createCommandLedger(editorExecutor);
	const after = applyCommand(before, command);
	ledger.record(command, before);
	expect(after.mediaAssets).toEqual([asset]);
	expect(after.doc.clips[0]!.video!.mediaAssetId).toBe(asset.id);
	expect(ledger.undo(after)).toEqual(before);
	expect(ledger.redo(before)).toEqual(after);
	expect(before.mediaAssets).toEqual([]);
});

test("media-only scope changes are commands; unrelated agent result retains imported metadata", () => {
	const after = { ...before, mediaAssets: [asset] };
	const command = diffScopeToCommand(before, after);
	expect(commandLabel(command)).toBe("media.update");
	expect(applyCommand(before, command)).toEqual(after);
	expect(applyCommand(after, invertCommand(before, command))).toEqual(before);
	const applied = applyTouchedResult(after, before, [{ kind: "clip", id: "removed" }]);
	expect(applied.mediaAssets).toBe(after.mediaAssets);
});

test("unnamed admission keeps identity across repeated application and redo", () => {
	const { id: _id, ...seed } = asset;
	const command = admitMediaCommand(seed);
	const after = applyCommand(before, command);
	expect(applyCommand(before, command)).toEqual(after);
	expect(applyCommand(applyCommand(after, invertCommand(before, command)), command)).toEqual(after);
});

test("collapsed import-and-place undo/redo retains unrelated later staging and metadata", () => {
	const ledger = createCommandLedger(editorExecutor);
	const admission = admitMediaCommand(asset),
		admitted = applyCommand(before, admission);
	ledger.record(admission, before, "drop");
	const placement = insertClip({
		id: "video:1",
		type: "video",
		track: 0,
		startSec: 0,
		durationSec: 4,
		video: {
			id: 1,
			kind: "video",
			url: asset.url,
			mediaAssetId: asset.id,
			start: 0,
			dur: 4,
			track: 0,
		},
	});
	ledger.record(placement, admitted, "drop");
	const staged = { ...asset, id: "later", url: "/api/media/later", label: "Later import" };
	const current = {
		...applyCommand(admitted, placement),
		mediaAssets: [staged, ...admitted.mediaAssets],
	};
	const undone = ledger.undo(current)!;
	expect(undone.doc).toEqual(before.doc);
	expect(undone.mediaAssets).toEqual([staged]);
	expect(ledger.redo(undone)).toEqual(current);
});

test("mixed media places in displayed order with one undo; used removal protects every carrier", () => {
	const sound: MediaAsset = { ...asset, id: "sound", kind: "audio", label: "Sound", dur: 2 };
	const image: MediaAsset = { ...asset, id: "image", kind: "image", label: "Still" };
	const scope = { ...before, mediaAssets: [asset, sound, image] };
	const doc = placeProjectMedia(
		scope.doc,
		scope.mediaAssets,
		[sound.id, asset.id, image.id],
		2,
		10,
	);
	expect(doc.clips.map((clip) => clip.startSec)).toEqual([2, 4, 8]);
	expect(doc.clips.map((clip) => clip.video?.mediaAssetId ?? clip.audio?.mediaAssetId)).toEqual([
		"sound",
		"imported",
		"image",
	]);
	const command = diffScopeToCommand(scope, { ...scope, doc }),
		ledger = createCommandLedger(editorExecutor);
	ledger.record(command, scope);
	expect(ledger.undo(applyCommand(scope, command))).toEqual(scope);
	expect(ledger.redo(scope)?.doc).toEqual(doc);
	const removed = removeUnusedProjectMedia(scope.mediaAssets, [asset.id, sound.id], {
		scenes: [],
		videoOverlays: [doc.clips[1]!.video!],
		audioOverlays: [],
	});
	expect(removed.map((media) => media.id)).toEqual(["imported", "image"]);
	const removal = diffScopeToCommand(scope, { ...scope, mediaAssets: removed });
	expect(applyCommand(applyCommand(scope, removal), invertCommand(scope, removal))).toEqual(scope);
	const otherProject = { ...scope, mediaAssets: [...scope.mediaAssets] };
	expect(otherProject.mediaAssets[1]).toBe(sound);
	expect(() =>
		placeProjectMedia(
			{ ...scope.doc, trackFlags: { 0: { locked: true } } },
			scope.mediaAssets,
			[sound.id, asset.id],
			0,
			10,
		),
	).toThrow("Destination track locked");
	expect(scope.doc.clips).toEqual([]);
});

test("a pending asset is admitted and placed as one undo step under its minted identity", () => {
	const id = mintMediaId();
	const pending = pendingMediaAsset(id, new File(["abcd"], "beach.mov"), "video", {
		duration: 4,
		decodable: true,
	});
	const command = batch(
		[
			admitMediaCommand(pending),
			insertClip({
				id: "video:1",
				type: "video",
				track: 0,
				startSec: 0,
				durationSec: 4,
				video: {
					id: 1,
					kind: "video",
					url: pending.url,
					mediaAssetId: pending.id,
					start: 0,
					dur: 4,
					track: 0,
				},
			}),
		],
		"media.import-and-place",
	);
	const ledger = createCommandLedger(editorExecutor);
	const after = applyCommand(before, command);
	ledger.record(command, before);
	expect(after.mediaAssets.map((a) => [a.id, a.url])).toEqual([[id, mediaUrl(id)]]);
	expect(after.doc.clips[0]!.video!.url).toBe(mediaUrl(id));
	expect(ledger.undo(after)).toEqual(before);
});
