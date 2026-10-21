import { applyCommand, invertCommand } from "@maleo/shared/editor";
import { expect, test } from "vite-plus/test";
import {
	fromTimelineDoc,
	toTimelineDoc,
	readStoryboardDocument,
	withMirroredTiming,
	buildRenderStoryboardFromDoc,
} from "@maleo/shared";
import { createCommandLedger } from "@models/chat/command-ledger.ts";
import {
	extractSourceAudio,
	recoverSourceAudio,
	sourceAudioRecovery,
} from "./source-audio-extraction.ts";
import { clipAnimationInfo, editClipKey } from "./clip-animation-edit.ts";
import { sourceEditInfo } from "./source-audio-edit.ts";
import type { ReverseTarget } from "./video-reverse.ts";
import type { EditScope } from "@maleo/shared/editor";
import { editorExecutor } from "@maleo/shared/editor";

const url = "/api/media/11111111-1111-4111-8111-111111111111",
	output = "/api/media/22222222-2222-4222-8222-222222222222";
const asset = {
	id: "video",
	kind: "video" as const,
	url,
	source: "upload" as const,
	label: "Camera",
	metadata: {
		kind: "video" as const,
		originalFilename: "Camera.mp4",
		byteSize: 100,
		duration: 8,
		hasAudio: true,
	},
};
const layout = {
	xPct: 0,
	yPct: 0,
	widthPct: 100,
	fit: "contain" as const,
	playbackRate: 0.5,
	preservePitch: true,
	reverse: true,
};
const scope: EditScope = {
	doc: toTimelineDoc(
		[
			{
				id: 1,
				name: "Scene",
				shot: "Wide",
				move: "Static",
				vis: "",
				vo: "Narration",
				img: true,
				src: "",
				start: 3,
				dur: 8,
				visualClips: [
					{
						id: "v",
						kind: "video",
						url,
						mediaAssetId: asset.id,
						label: "Camera",
						startSec: 0,
						durationSec: 8,
						mediaStartSec: 1,
						volume: 0.6,
						layout,
					},
				],
			},
		],
		[
			{
				id: 2,
				kind: "video",
				url,
				mediaAssetId: asset.id,
				start: 12,
				dur: 8,
				mediaStartSec: 1,
				volume: 0.7,
				layout,
			},
		],
	),
	mediaAssets: [asset],
	slides: [],
	posts: [],
};
const result = {
	id: "job",
	status: "ready" as const,
	sourceMediaId: url.split("/").at(-1)!,
	sourceRevision: url.split("/").at(-1)!,
	operation: {
		type: "audio" as const,
		startSec: 1,
		durationSec: 4,
		playbackRate: 0.5,
		preservePitch: true,
		reverse: true,
	},
	url: output,
	metadata: {
		kind: "audio" as const,
		originalFilename: "Extracted.m4a",
		byteSize: 200,
		duration: 8,
		hasAudio: true,
	},
	error: null,
};

test("source extraction admits aligned ready audio, links and mutes in one reversible edit", () => {
	for (const target of [
		{ source: "scene", id: 1, visualId: "v" },
		{ source: "video", id: 2 },
	] satisfies ReverseTarget[]) {
		const source = sourceEditInfo(scope.doc, target, scope.mediaAssets)!;
		const command = extractSourceAudio(scope, target, source.fingerprint, result),
			next = applyCommand(scope, command);
		const recovery = sourceAudioRecovery(next, target)!;
		expect(recovery.edited).toBe(false);
		expect(recovery.locked).toBe(false);
		expect(recovery.clip?.audio).toMatchObject({
			url: output,
			start: target.source === "scene" ? 3 : 12,
			dur: 8,
			mediaStartSec: 0,
			volume: source.volume,
			duckUnderVoice: 1,
		});
		expect(recovery.link.source).toEqual({
			url,
			startSec: 1,
			durationSec: 4,
			playbackRate: 0.5,
			preservePitch: true,
			reverse: true,
		});
		expect(sourceEditInfo(next.doc, target, next.mediaAssets)?.volume).toBe(0);
		expect(next.mediaAssets.find((a) => a.url === output)?.kind).toBe("audio");
		const ledger = createCommandLedger(editorExecutor);
		ledger.record(command, scope);
		expect(ledger.depths()).toEqual({ undo: 1, redo: 0 });
		expect(ledger.undo(next)).toEqual(scope);
		expect(ledger.redo(scope)).toEqual(next);
		const loaded = {
			...next,
			doc: {
				...next.doc,
				clips: readStoryboardDocument(JSON.parse(JSON.stringify(next.doc))).doc.clips,
			},
		};
		expect(sourceAudioRecovery(loaded, target)?.edited).toBe(false);
		const recovered = applyCommand(loaded, recoverSourceAudio(loaded, target));
		expect(recovered.doc.clips.find((c) => c.id === recovery.link.audioClipId)).toBeUndefined();
		expect(sourceEditInfo(recovered.doc, target, recovered.mediaAssets)?.volume).toBe(
			source.volume,
		);
		expect(sourceAudioRecovery(recovered, target)).toBeUndefined();
		expect(recovered.mediaAssets).toEqual(next.mediaAssets);
		expect(() => extractSourceAudio(next, target, source.fingerprint, result)).toThrow(
			"already extracted",
		);
		const built = buildRenderStoryboardFromDoc(
			{},
			{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } },
			next.doc,
		).storyboard;
		expect(built.audioOverlays?.filter((a) => a.url === output)).toHaveLength(1);
	}
});

test("recovery protects moved, trimmed or keyed independent audio and refuses locked tracks", () => {
	const target: ReverseTarget = { source: "video", id: 2 },
		source = sourceEditInfo(scope.doc, target, scope.mediaAssets)!;
	const next = applyCommand(scope, extractSourceAudio(scope, target, source.fingerprint, result)),
		recovery = sourceAudioRecovery(next, target)!;
	for (const patch of [
		{ start: 15 },
		{ dur: 7, mediaStartSec: 1 },
		{ fadeIn: 1 },
		{ volume: 0.2 },
		{ extraKeys: [{ t: 0, v: 0.2 }] },
	]) {
		const edited = {
			...next,
			doc: {
				...next.doc,
				clips: next.doc.clips.map((c) =>
					c.id === recovery.link.audioClipId
						? withMirroredTiming({
								...c,
								...("start" in patch ? { startSec: patch.start } : {}),
								...("dur" in patch ? { durationSec: patch.dur } : {}),
								audio: { ...c.audio!, ...patch },
							})
						: c,
				),
			},
		};
		expect(sourceAudioRecovery(edited, target)?.edited).toBe(true);
		expect(() => recoverSourceAudio(edited, target)).toThrow("choose keep or discard");
		const kept = applyCommand(edited, recoverSourceAudio(edited, target, "keep"));
		expect(kept.doc.clips.find((c) => c.id === recovery.link.audioClipId)).toEqual(
			edited.doc.clips.find((c) => c.id === recovery.link.audioClipId),
		);
		const discard = recoverSourceAudio(edited, target, "discard"),
			removed = applyCommand(edited, discard);
		expect(removed.doc.clips.find((c) => c.id === recovery.link.audioClipId)).toBeUndefined();
		expect(applyCommand(removed, invertCommand(edited, discard))).toEqual(edited);
	}
	const locked = {
		...next,
		doc: { ...next.doc, trackFlags: { [recovery.clip!.track]: { locked: true } } },
	};
	expect(() => recoverSourceAudio(locked, target, "discard")).toThrow("locked");
	for (const wrong of [
		{ ...result, status: "cancelled" as const },
		{ ...result, operation: { ...result.operation, startSec: 0 } },
		{ ...result, sourceRevision: "changed" },
	])
		expect(() => extractSourceAudio(scope, target, source.fingerprint, wrong)).toThrow();
	expect(() =>
		extractSourceAudio(
			{ ...scope, mediaAssets: [{ ...asset, metadata: { ...asset.metadata, hasAudio: false } }] },
			target,
			source.fingerprint,
			result,
		),
	).toThrow("no audio");
	expect(fromTimelineDoc(scope.doc).audioOverlays).toEqual([]);
});

test("recovery restores prior pitch and derivative while preserving detached edits when requested", () => {
	const target: ReverseTarget = { source: "video", id: 2 },
		source = sourceEditInfo(scope.doc, target, scope.mediaAssets)!;
	const next = applyCommand(scope, extractSourceAudio(scope, target, source.fingerprint, result));
	const changed = {
		...next,
		doc: {
			...next.doc,
			clips: next.doc.clips.map((c) =>
				c.video?.id === 2
					? {
							...c,
							video: {
								...c.video,
								layout: {
									...c.video.layout!,
									preservePitch: false,
									audioMedia: {
										url: output,
										sourceUrl: url,
										sourceRevision: result.sourceRevision,
										startSec: 1,
										durationSec: 4,
										playbackRate: 0.5,
										preservePitch: false,
										reverse: true,
									},
								},
							},
						}
					: c,
			),
		},
	};
	const recovered = applyCommand(changed, recoverSourceAudio(changed, target)),
		info = sourceEditInfo(recovered.doc, target, recovered.mediaAssets)!;
	expect(info.settings.preservePitch).toBe(true);
	expect(info.settings.audioMedia).toBeUndefined();
	expect(info.volume).toBe(0.7);
});

test("extraction carries gain keys; recovery restores their prior ride while preserving independent transforms", () => {
	for (const target of [
		{ source: "scene", id: 1, visualId: "v" },
		{ source: "video", id: 2 },
	] satisfies ReverseTarget[]) {
		const first = applyCommand(scope, editClipKey(scope, target, "volume", 0, 0.2));
		const keyed = applyCommand(first, editClipKey(first, target, "volume", 8, 0.8, "in-out"));
		const source = sourceEditInfo(keyed.doc, target, keyed.mediaAssets)!;
		const next = applyCommand(keyed, extractSourceAudio(keyed, target, source.fingerprint, result));
		const recovery = sourceAudioRecovery(next, target)!;
		expect(recovery.edited).toBe(false);
		const prior = clipAnimationInfo(keyed.doc, target)!.animation!.tracks.volume;
		expect(recovery.clip?.audio?.animation?.tracks.volume).toEqual(prior);
		const gain = applyCommand(next, editClipKey(next, target, "volume", 4, 0.1));
		const changed = applyCommand(gain, editClipKey(gain, target, "rotationDeg", 0, 90));
		const command = recoverSourceAudio(changed, target),
			restored = applyCommand(changed, command);
		expect(clipAnimationInfo(restored.doc, target)?.animation?.tracks.volume).toEqual(prior);
		expect(clipAnimationInfo(restored.doc, target)?.animation?.tracks.rotationDeg).toEqual([
			{ t: 0, v: 90, easing: "linear" },
		]);
		expect(applyCommand(restored, invertCommand(changed, command))).toEqual(changed);
		const audioTarget = { source: "audio" as const, id: recovery.clip!.audio!.id };
		const edited = applyCommand(next, editClipKey(next, audioTarget, "volume", 4, 0.1));
		expect(sourceAudioRecovery(edited, target)?.edited).toBe(true);
		expect(() => recoverSourceAudio(edited, target)).toThrow("choose keep or discard");
		const kept = applyCommand(edited, recoverSourceAudio(edited, target, "keep"));
		expect(clipAnimationInfo(kept.doc, audioTarget)?.animation).toEqual(
			clipAnimationInfo(edited.doc, audioTarget)?.animation,
		);
	}
});
