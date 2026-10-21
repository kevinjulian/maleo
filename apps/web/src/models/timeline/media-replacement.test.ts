import { applyCommand, invertCommand } from "@maleo/shared/editor";
import { expect, test } from "vite-plus/test";
import { ImportedMediaSourceSchema, sourceTime, type ReadyImportedMedia } from "@maleo/shared";
import { createCommandLedger } from "@models/chat/command-ledger.ts";
import { mediaSourceIdentity, replaceProjectMedia } from "./media-replacement.ts";
import type { MediaAsset } from "./editor-media.ts";
import type { EditScope } from "@maleo/shared/editor";
import { editorExecutor } from "@maleo/shared/editor";

const asset: MediaAsset = {
	id: "logical",
	label: "My take",
	url: "",
	kind: "video",
	source: "reference",
	favorite: true,
	provenance: { copiedFromGlobalRefId: "reference" },
};
const ready: ReadyImportedMedia = {
	id: "new-admission",
	label: "replacement.mp4",
	url: "/api/media/00000000-0000-0000-0000-000000000001",
	kind: "video",
	source: "upload",
	dur: 8,
	metadata: { kind: "video", originalFilename: "replacement.mp4", byteSize: 42, duration: 8 },
	compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
	importedSource: { revision: "new", fingerprint: "a".repeat(64), originalMediaId: "immutable" },
};
const scope: EditScope = {
	doc: {
		schemaVersion: 2,
		markers: [],
		clips: [1, 2, 3].map((id) => ({
			id: `video:${id}`,
			type: "video",
			track: 0,
			startSec: id * 2,
			durationSec: 2,
			video: {
				id,
				kind: "video",
				url: "",
				mediaAssetId: asset.id,
				start: id * 2,
				dur: 2,
				mediaStartSec: id,
				layout: {
					xPct: 50,
					yPct: 50,
					widthPct: 100,
					fit: "contain",
					playbackRate: 2,
					reverse: true,
					animation: {
						tracks: {
							xPct: [
								{ t: 0, v: 0 },
								{ t: 2, v: 20 },
							],
						},
					},
				},
			},
		})),
	},
	mediaAssets: [asset],
	slides: [],
	posts: [],
};

test("missing source relinks three reversed clips atomically, preserving identity/provenance and exact undo", () => {
	const command = replaceProjectMedia(scope, asset.id, mediaSourceIdentity(asset), ready),
		ledger = createCommandLedger(editorExecutor);
	const next = applyCommand(scope, command);
	ledger.record(command, scope);
	expect(next.doc.clips.every((clip) => clip.video?.url === ready.url)).toBe(true);
	expect(next.doc.clips[2]?.video?.mediaStartSec).toBe(3);
	expect(next.doc.clips.map((c) => c.video?.layout?.animation)).toEqual(
		scope.doc.clips.map((c) => c.video?.layout?.animation),
	);
	expect(next.mediaAssets[0]).toMatchObject({
		id: "logical",
		label: "My take",
		source: "reference",
		favorite: true,
		provenance: asset.provenance,
		url: ready.url,
	});
	expect(ImportedMediaSourceSchema.parse(next.mediaAssets[0]!.importedSource).history).toEqual([
		{ url: "" },
	]);
	expect(ledger.undo(next)).toEqual(scope);
	expect(ledger.redo(scope)).toEqual(next);
	const otherProject = { ...scope, mediaAssets: [...scope.mediaAssets] };
	expect(otherProject.mediaAssets[0]?.url).toBe("");
	expect(otherProject.doc.clips[0]?.video?.url).toBe("");
	const second = applyCommand(
		next,
		replaceProjectMedia(next, asset.id, mediaSourceIdentity(next.mediaAssets[0]!), {
			...ready,
			url: "/api/media/00000000-0000-0000-0000-000000000002",
			importedSource: { ...ready.importedSource, revision: "second" },
		}),
	);
	expect(
		ImportedMediaSourceSchema.parse(second.mediaAssets[0]!.importedSource).history?.[1]?.source
			?.revision,
	).toBe("new");
});

test("replacement rejects type, short retimed/reversed ranges, stale completion and live locks without mutation", () => {
	const expected = mediaSourceIdentity(asset);
	expect(() => replaceProjectMedia(scope, asset.id, expected, { ...ready, kind: "audio" })).toThrow(
		"same media type",
	);
	expect(() =>
		replaceProjectMedia(scope, asset.id, expected, {
			...ready,
			metadata: { ...ready.metadata, duration: 6.9 },
		}),
	).toThrow("too short");
	expect(() =>
		replaceProjectMedia(
			{ ...scope, mediaAssets: [{ ...asset, url: "changed" }] },
			asset.id,
			expected,
			ready,
		),
	).toThrow("Source changed");
	expect(() =>
		replaceProjectMedia(
			{ ...scope, doc: { ...scope.doc, trackFlags: { 0: { locked: true } } } },
			asset.id,
			expected,
			ready,
		),
	).toThrow("locked track");
	expect(scope.mediaAssets).toEqual([asset]);
	expect(scope.doc.clips.every((clip) => clip.video?.url === "")).toBe(true);
	for (const rate of [0.25, 1, 4]) {
		expect(sourceTime(2, 2, rate, false, 1)).toBe(2 + rate);
		expect(sourceTime(2, 2, rate, true, 1)).toBe(2 + rate);
	}
	expect(sourceTime(2, 2, 4, true, 0)).toBe(10);
	expect(sourceTime(2, 2, 4, true, 2)).toBe(2);
});

test("relink covers scene frame/end/extra visuals and source audio without losing authored settings", () => {
	const image: MediaAsset = { ...asset, kind: "image" };
	const scene = {
		id: 1,
		name: "Scene",
		dur: 4,
		shot: "Wide",
		move: "Static",
		vis: "",
		vo: "Keep narration",
		img: true,
		src: "",
		mediaAssetId: image.id,
		endSrc: "",
		endMediaAssetId: image.id,
		visualClips: [
			{
				id: "extra",
				kind: "image" as const,
				label: "Extra",
				url: "",
				mediaAssetId: image.id,
				startSec: 1,
				durationSec: 2,
			},
		],
	};
	const images: EditScope = {
		...scope,
		mediaAssets: [image],
		doc: {
			...scope.doc,
			clips: [
				{ id: "scene:1", type: "image", track: 0, startSec: 0, durationSec: 4, scene },
				{
					id: "visual:extra",
					type: "image",
					track: 1,
					startSec: 1,
					durationSec: 2,
					vis: { sceneId: 1, vclip: scene.visualClips[0]! },
				},
			],
		},
	};
	const repaired = applyCommand(
		images,
		replaceProjectMedia(images, image.id, mediaSourceIdentity(image), {
			...ready,
			kind: "image",
			metadata: { kind: "image", byteSize: 42, originalFilename: "replacement.png" },
		}),
	);
	expect(repaired.doc.clips[0]?.scene).toMatchObject({
		src: ready.url,
		endSrc: ready.url,
		vo: "Keep narration",
		visualClips: [{ url: ready.url }],
	});
	expect(repaired.doc.clips[1]?.vis?.vclip.url).toBe(ready.url);
	const sound: MediaAsset = { ...asset, kind: "audio" };
	const audio: EditScope = {
		...scope,
		mediaAssets: [sound],
		doc: {
			...scope.doc,
			clips: [
				{
					id: "audio:1",
					type: "audio",
					track: 2,
					startSec: 4,
					durationSec: 2,
					audio: {
						id: 1,
						kind: "music",
						mediaAssetId: sound.id,
						url: "",
						start: 4,
						dur: 2,
						mediaStartSec: 3,
						fadeIn: 0.5,
						duckUnderVoice: 0.3,
						content: "Music",
					},
				},
			],
		},
	};
	const next = applyCommand(
		audio,
		replaceProjectMedia(audio, sound.id, mediaSourceIdentity(sound), {
			...ready,
			kind: "audio",
			metadata: { ...ready.metadata, kind: "audio" },
		}),
	);
	expect(next.doc.clips[0]?.audio).toMatchObject({
		url: ready.url,
		mediaStartSec: 3,
		originalDur: 8,
		fadeIn: 0.5,
		duckUnderVoice: 0.3,
	});
	expect(() =>
		replaceProjectMedia(audio, sound.id, mediaSourceIdentity(sound), {
			...ready,
			kind: "audio",
			metadata: { ...ready.metadata, kind: "audio", duration: 4 },
		}),
	).toThrow("too short");
});

test("retimed audio relink validates original seconds and retains authored processing settings", () => {
	const sound: MediaAsset = { ...asset, kind: "audio" };
	const before: EditScope = {
		...scope,
		mediaAssets: [sound],
		doc: {
			schemaVersion: 2,
			markers: [],
			clips: [
				{
					id: "audio:1",
					type: "audio",
					track: 0,
					startSec: 10,
					durationSec: 8,
					audio: {
						id: 1,
						kind: "voiceover",
						url: "",
						mediaAssetId: sound.id,
						content: "Speech",
						start: 10,
						dur: 8,
						mediaStartSec: 1,
						playbackRate: 0.5,
						preservePitch: true,
						reverse: true,
						fadeIn: 0.2,
						volume: 0.7,
						animation: {
							tracks: {
								volume: [
									{ t: 0, v: 0.3 },
									{ t: 8, v: 0.7 },
								],
							},
						},
					},
				},
			],
		},
	};
	const replacement = {
		...ready,
		kind: "audio" as const,
		metadata: { ...ready.metadata, kind: "audio" as const, duration: 5 },
	};
	const command = replaceProjectMedia(before, sound.id, mediaSourceIdentity(sound), replacement),
		after = applyCommand(before, command);
	expect(after.doc.clips[0]?.audio).toMatchObject({
		url: ready.url,
		playbackRate: 0.5,
		preservePitch: true,
		reverse: true,
		mediaStartSec: 1,
		dur: 8,
		start: 10,
		fadeIn: 0.2,
		volume: 0.7,
	});
	expect(after.doc.clips[0]?.audio?.animation).toEqual(before.doc.clips[0]?.audio?.animation);
	expect(applyCommand(after, invertCommand(before, command))).toEqual(before);
	expect(() =>
		replaceProjectMedia(before, sound.id, mediaSourceIdentity(sound), {
			...replacement,
			metadata: { ...replacement.metadata, duration: 4 },
		}),
	).toThrow("too short");
});

test("replacing video source clears its old poster and undo restores it", () => {
	const original = { ...scope, mediaAssets: [{ ...asset, poster: "/api/media/old-poster" }] };
	const command = replaceProjectMedia(original, asset.id, mediaSourceIdentity(asset), ready);
	const next = applyCommand(original, command);
	expect(next.mediaAssets[0]?.poster).toBeUndefined();
	expect(applyCommand(next, invertCommand(original, command))).toEqual(original);
});
