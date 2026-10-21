/* A clip's media is the asset its id names (`migrate-editor-to-shared-rust-core`
 * 4.8): through a pending upload's completion, a relink, undo and redo, and a
 * save and reload, the clip keeps referring to the same asset, and no
 * browser-local URL is ever written. Runs on the editor's own executor. */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { localMediaUrlIssues, pendingMediaUrl, type ReadyImportedMedia } from "@maleo/shared";
import { engineExecutor, type EditScope } from "@maleo/shared/editor";
import { createCommandLedger } from "@models/chat/command-ledger.ts";
import { testEngine } from "@models/editor-engine/engine-fixture.ts";
import {
	clearPendingSources,
	resolvePendingAsset,
	setPendingLocalUrl,
	setPendingReady,
	withReadyPending,
} from "@models/core/pending-media-sources.ts";
import { parseLoadedProject } from "@models/storyboard/parse-loaded-project.ts";
import { mediaSourceIdentity, replaceProjectMedia } from "./media-replacement.ts";
import { sourceEditInfo } from "./source-audio-edit.ts";
import { reverseTargetSource } from "./video-reverse.ts";
import type { MediaAsset } from "./editor-media.ts";

afterEach(() => {
	clearPendingSources();
});

const KEY = "upload-k1";
const ready = (url: string, revision: string): ReadyImportedMedia => ({
	id: `import-${revision}`,
	label: "take.mp4",
	url,
	kind: "video",
	source: "upload",
	dur: 8,
	metadata: {
		kind: "video",
		originalFilename: "take.mp4",
		byteSize: 42,
		duration: 8,
		hasAudio: true,
	},
	compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
	importedSource: {
		revision,
		fingerprint: revision.padEnd(64, "0"),
		originalMediaId: `media-${revision}`,
	},
});

/* A clip placed while its file uploaded: it and its asset say `pending:<key>`. */
const pendingAsset: MediaAsset = {
	id: KEY,
	label: "take.mp4",
	url: pendingMediaUrl(KEY),
	kind: "video",
	source: "upload",
};
const neighbour: MediaAsset = {
	id: "other",
	label: "other.mp4",
	url: "/api/media/00000000-0000-0000-0000-00000000000f",
	kind: "video",
	source: "upload",
};
const placed: EditScope = {
	mediaAssets: [pendingAsset, neighbour],
	slides: [],
	posts: [],
	doc: {
		schemaVersion: 2,
		markers: [],
		clips: [
			{
				id: "video:1",
				type: "video",
				track: 0,
				startSec: 0,
				durationSec: 2,
				video: {
					id: 1,
					kind: "video",
					url: pendingMediaUrl(KEY),
					mediaAssetId: KEY,
					start: 0,
					dur: 2,
					mediaStartSec: 1,
					layout: { xPct: 50, yPct: 50, widthPct: 100, fit: "contain" },
				},
			},
		],
	},
};
const reverseAsset = (scope: EditScope, assets: MediaAsset[] = scope.mediaAssets) =>
	reverseTargetSource(scope.doc, { source: "video", id: 1 }, assets)?.asset;

describe("a clip's media through completion, relink, undo and reload", () => {
	test("once its upload is ready, the clip still resolves its own asset though its URL still says pending", () => {
		setPendingLocalUrl(KEY, "blob:http://local/1");
		setPendingReady(KEY, ready("/api/media/00000000-0000-0000-0000-000000000001", "r1"));
		/* The library shows assets resolved; the document keeps what was recorded. */
		const library = placed.mediaAssets.map(resolvePendingAsset);
		expect(library[0]?.url).toBe("/api/media/00000000-0000-0000-0000-000000000001");
		expect(placed.doc.clips[0]?.video?.url).toBe(pendingMediaUrl(KEY));
		expect(reverseAsset(placed, library)?.id).toBe(KEY);
		expect(sourceEditInfo(placed.doc, { source: "video", id: 1 }, library)?.asset?.id).toBe(KEY);
	});

	test("a relink keeps the id, and undo and redo move the location, never the identity", () => {
		const executor = engineExecutor(testEngine);
		const ledger = createCommandLedger(executor);
		const before: EditScope = {
			...placed,
			mediaAssets: [
				{ ...pendingAsset, url: "/api/media/00000000-0000-0000-0000-000000000001" },
				neighbour,
			],
			doc: {
				...placed.doc,
				clips: placed.doc.clips.map((clip) => ({
					...clip,
					video: { ...clip.video!, url: "/api/media/00000000-0000-0000-0000-000000000001" },
				})),
			},
		};
		const command = replaceProjectMedia(
			before,
			KEY,
			mediaSourceIdentity(before.mediaAssets[0]!),
			ready("/api/media/00000000-0000-0000-0000-000000000002", "r2"),
		);
		const executed = executor.execute(before, command);
		ledger.record(command, before, undefined, executed);
		const relinked = executed.scope;
		expect(relinked.mediaAssets[0]).toMatchObject({
			id: KEY,
			url: "/api/media/00000000-0000-0000-0000-000000000002",
		});
		expect(relinked.doc.clips[0]?.video).toMatchObject({
			mediaAssetId: KEY,
			url: "/api/media/00000000-0000-0000-0000-000000000002",
		});
		expect(reverseAsset(relinked)?.id).toBe(KEY);
		const undone = ledger.undo(relinked)!;
		expect(undone.doc.clips[0]?.video?.mediaAssetId).toBe(KEY);
		expect(reverseAsset(undone)?.id).toBe(KEY);
		/* An undo whose clip is back at the old location while the library already
		 * shows the asset relinked still resolves the clip's own asset. */
		expect(reverseAsset(undone, relinked.mediaAssets)?.id).toBe(KEY);
		expect(reverseAsset(ledger.redo(undone)!)?.id).toBe(KEY);
	});

	test("a save holds no browser-local URL, and a reload keeps every id", () => {
		setPendingLocalUrl(KEY, "blob:http://local/1");
		setPendingReady(KEY, ready("/api/media/00000000-0000-0000-0000-000000000001", "r1"));
		const storyboard = withReadyPending({ schemaVersion: 2, clips: placed.doc.clips, markers: [] });
		const mediaAssets = withReadyPending(placed.mediaAssets);
		expect(localMediaUrlIssues({ storyboard, mediaAssets })).toEqual([]);
		expect(JSON.stringify([storyboard, mediaAssets])).not.toContain("pending:");
		expect(JSON.stringify([storyboard, mediaAssets])).not.toContain("blob:");
		clearPendingSources();
		const reloaded = parseLoadedProject({
			project: {
				id: "p1",
				title: "T",
				type: "video",
				target_audience: null,
				target_duration_sec: null,
				target_format: null,
				target_platform: null,
				brief_json: null,
				editor_state_json: { media_assets: mediaAssets } as never,
			},
			storyboards: [{ storyboard_json: storyboard }],
		});
		expect(reloaded.mediaAssets.map((asset) => asset.id)).toEqual([KEY, "other"]);
		const scope: EditScope = {
			mediaAssets: reloaded.mediaAssets,
			doc: { schemaVersion: 2, clips: reloaded.clips, markers: [] },
			slides: [],
			posts: [],
		};
		expect(scope.doc.clips.find((clip) => clip.id === "video:1")?.video?.mediaAssetId).toBe(KEY);
		expect(reverseAsset(scope)?.id).toBe(KEY);
	});
});
