import { expect, test } from "vite-plus/test";
import {
	fromTimelineDoc,
	toTimelineDoc,
	rebuildDocWith,
	readStoryboardDocument,
	processedAudioSource,
	sourceInterval,
	sampleClipProperty,
	type ClipAnimation,
} from "@maleo/shared";
import {
	setSourceRate,
	sourceEditInfo,
	applySourceAudioResult,
	applySourcePlayback,
	type SourceEditTarget,
} from "./source-audio-edit.ts";
import { diffScopeToCommand, execute, applyCommand } from "@maleo/shared/editor";
import { createCommandLedger } from "@models/chat/command-ledger.ts";
import type { EditScope } from "@maleo/shared/editor";
import { editorExecutor } from "@maleo/shared/editor";

const url = "/api/media/11111111-1111-4111-8111-111111111111",
	audioUrl = "/api/media/22222222-2222-4222-8222-222222222222";
const assets = ["video", "audio"].map((kind) => ({
	id: kind,
	kind: kind === "audio" ? ("audio" as const) : ("video" as const),
	source: "upload" as const,
	label: kind,
	url: kind === "audio" ? audioUrl : url,
	metadata: {
		originalFilename: kind,
		kind: kind === "audio" ? ("audio" as const) : ("video" as const),
		byteSize: 100,
		duration: 6,
		hasAudio: true,
	},
}));
const visual = {
	id: "v",
	kind: "video" as const,
	url,
	label: "Source",
	mediaAssetId: "video",
	startSec: 0,
	durationSec: 4,
	mediaStartSec: 1,
};
const scenes = [1, 2].map((id) => ({
	id,
	name: "Scene",
	shot: "Wide",
	move: "Static",
	vis: "",
	vo: "Unchanged narration",
	img: true,
	dur: 4,
	src: url,
	visualClips: [visual],
}));
const doc = toTimelineDoc(
	scenes,
	[
		{
			id: 3,
			kind: "video",
			url,
			mediaAssetId: "video",
			start: 9,
			dur: 4,
			mediaStartSec: 1,
			volume: 0.5,
		},
	],
	[],
	[
		{
			id: 4,
			kind: "voiceover",
			content: "Unchanged words",
			url: audioUrl,
			mediaAssetId: "audio",
			start: 13,
			dur: 4,
			mediaStartSec: 1,
			volume: 0.7,
		},
	],
);

test("source playback helper uses canonical caption owner and retains atomic undo", () => {
	const linked = {
		...doc,
		captionSet: {
			initialized: true as const,
			language: "en",
			revision: 0,
			deletedRanges: [],
			appliedRunIds: [],
		},
		clips: [
			...doc.clips,
			{
				id: "caption:audio",
				type: "caption" as const,
				startSec: 14,
				durationSec: 1,
				track: 2,
				caption: {
					text: "Corrected words",
					words: [],
					provenance: { origin: "manual" as const, wordTimingOrigin: "estimated" as const },
					sources: [
						{
							clipId: "audio:4",
							mediaId: "audio",
							mediaRevision: "r1",
							sourceStartSec: 2,
							sourceEndSec: 3,
						},
					],
					protection: { text: true, timing: false, segmentation: false, style: false },
					revision: 0,
					groupId: "g",
					status: "current" as const,
				},
			},
		],
	};
	const after = setSourceRate(linked, { source: "audio", id: 4 }, assets, 0.5, true);
	const cue = after.clips.find((clip) => clip.type === "caption")!;
	expect(cue.startSec).toBe(15);
	expect(cue.durationSec).toBe(2);
	expect(cue.caption?.text).toBe("Corrected words");
	expect(cue.caption?.status).toBe("current");
	const scope = { doc: linked, mediaAssets: assets, slides: [], posts: [] };
	const applied = execute(scope, diffScopeToCommand(scope, { ...scope, doc: after }));
	expect(applied.scope.doc).toEqual(after);
	expect(applyCommand(applied.scope, applied.inverse)).toEqual(scope);
	expect(() =>
		setSourceRate(
			{ ...linked, trackFlags: { 2: { locked: true } } },
			{ source: "audio", id: 4 },
			assets,
			0.5,
			true,
		),
	).toThrow("locked");
});

test("rate commands keep source endpoints and neighbors, record one undo, reload and reject locks/bounds", () => {
	for (const target of [
		{ source: "scene", id: 1, visualId: "v" },
		{ source: "video", id: 3 },
		{ source: "audio", id: 4 },
	] satisfies SourceEditTarget[]) {
		const before: EditScope = { doc, slides: [], posts: [], mediaAssets: assets };
		const after = { ...before, doc: setSourceRate(doc, target, assets, 0.5, true) };
		const source = sourceEditInfo(after.doc, target, assets)!;
		expect(source.duration).toBe(8);
		expect(source.start).toBe(1);
		expect(source.settings.playbackRate).toBe(0.5);
		expect(sourceInterval(source.start, source.duration, 0.5)).toEqual({ start: 1, end: 5 });
		const views = fromTimelineDoc(after.doc);
		expect(views.scenes[1]?.start).toBe(4);
		expect(views.videoOverlays[0]?.start).toBe(9);
		expect(views.audioOverlays[0]?.start).toBe(13);
		expect(views.audioOverlays[0]?.volume).toBe(0.7);
		expect(views.scenes[0]?.vo).toBe("Unchanged narration");
		const ledger = createCommandLedger(editorExecutor);
		ledger.record(diffScopeToCommand(before, after), before);
		expect(ledger.depths()).toEqual({ undo: 1, redo: 0 });
		expect(ledger.undo(after)).toEqual(before);
		expect(ledger.redo(before)).toEqual(after);
		expect(
			sourceEditInfo(
				{
					...after.doc,
					clips: readStoryboardDocument(JSON.parse(JSON.stringify(after.doc))).doc.clips,
				},
				target,
				assets,
			)?.settings.playbackRate,
		).toBe(0.5);
		for (const rate of [0, 5, NaN, Infinity])
			expect(setSourceRate(doc, target, assets, rate, true)).toBe(doc);
		expect(
			setSourceRate(
				{ ...doc, trackFlags: { [-1]: { locked: true }, 0: { locked: true } } },
				target,
				assets,
				0.5,
				true,
			).clips,
		).toEqual(doc.clips);
		expect(
			setSourceRate(
				doc,
				target,
				assets.map((a) => ({ ...a, metadata: { ...a.metadata, duration: 3 } })),
				0.5,
				true,
			),
		).toBe(doc);
	}
});

test("ready source audio validates exact interval/revision and maps contained trims forward once", () => {
	const target: SourceEditTarget = { source: "audio", id: 4 },
		source = sourceEditInfo(doc, target, assets)!;
	const result = {
		id: "job",
		status: "ready" as const,
		sourceMediaId: audioUrl.split("/").at(-1)!,
		sourceRevision: audioUrl.split("/").at(-1)!,
		error: null,
		operation: {
			type: "audio" as const,
			startSec: 1,
			durationSec: 4,
			playbackRate: 0.5,
			preservePitch: true,
			reverse: false,
		},
		url: "/api/media/33333333-3333-4333-8333-333333333333",
		metadata: {
			kind: "audio" as const,
			originalFilename: "Audio",
			byteSize: 100,
			duration: 8,
			hasAudio: true,
		},
	};
	const updated = applySourceAudioResult(doc, target, assets, source.fingerprint, result),
		settings = sourceEditInfo(updated, target, assets)!.settings;
	const loaded = readStoryboardDocument(JSON.parse(JSON.stringify(updated))).doc.clips.find(
		(c) => c.audio,
	)!.audio!;
	expect(loaded.audioMedia).toEqual(settings.audioMedia);
	expect(processedAudioSource(audioUrl, 1, 8, settings)).toEqual({
		url: result.url,
		mediaStartSec: 0,
	});
	expect(processedAudioSource(audioUrl, 2, 4, settings)).toEqual({
		url: result.url,
		mediaStartSec: 2,
	});
	expect(processedAudioSource(audioUrl, 0, 8, settings)).toBeUndefined();
	expect(processedAudioSource("/changed.m4a", 1, 8, settings)).toBeUndefined();
	expect(
		processedAudioSource(audioUrl, 1, 8, { ...settings, preservePitch: false }),
	).toBeUndefined();
	expect(processedAudioSource(audioUrl, 1, 8, { ...settings, reverse: true })).toBeUndefined();
	expect(() => applySourceAudioResult(doc, target, assets, "stale", result)).toThrow("changed");
	expect(() =>
		applySourceAudioResult(doc, target, assets, source.fingerprint, {
			...result,
			operation: { ...result.operation, startSec: 2 },
		}),
	).toThrow("does not match");
});

test("reverse plus retimed sound finishes together and validates requested settings against late responses", () => {
	const target: SourceEditTarget = { source: "video", id: 3 },
		original = sourceEditInfo(doc, target, assets)!;
	const audio = {
		id: "audio-job",
		status: "ready" as const,
		sourceMediaId: url.split("/").at(-1)!,
		sourceRevision: url.split("/").at(-1)!,
		error: null,
		operation: {
			type: "audio" as const,
			startSec: 1,
			durationSec: 4,
			playbackRate: 0.5,
			preservePitch: true,
			reverse: true,
		},
		url: "/api/media/33333333-3333-4333-8333-333333333333",
		metadata: {
			kind: "audio" as const,
			originalFilename: "Audio",
			byteSize: 100,
			duration: 8,
			hasAudio: true,
		},
	};
	const reverse = {
		...audio,
		id: "reverse-job",
		operation: { type: "reverse" as const, startSec: 1, durationSec: 4 },
		url: "/api/media/44444444-4444-4444-8444-444444444444",
		metadata: { ...audio.metadata, kind: "video" as const, duration: 4 },
	};
	const changedGain = {
		...doc,
		clips: doc.clips.map((c) => (c.video ? { ...c, video: { ...c.video, volume: 0.8 } } : c)),
	};
	const next = applySourcePlayback(
		changedGain,
		target,
		assets,
		original.fingerprint,
		0.5,
		true,
		true,
		[reverse, audio],
	);
	const finished = sourceEditInfo(next, target, assets)!;
	expect(finished.volume).toBe(0.8);
	expect(finished.settings.reverse).toBe(true);
	expect(finished.duration).toBe(8);
	expect(finished.settings.audioMedia?.url).toBe(audio.url);
	expect(processedAudioSource(url, 1, 8, finished.settings)).toEqual({
		url: audio.url,
		mediaStartSec: 0,
	});
	const before: EditScope = { doc: changedGain, slides: [], posts: [], mediaAssets: assets },
		after = { ...before, doc: next };
	const ledger = createCommandLedger(editorExecutor);
	ledger.record(diffScopeToCommand(before, after), before);
	expect(ledger.undo(after)).toEqual(before);
	expect(ledger.redo(before)).toEqual(after);
	expect(() =>
		applySourcePlayback(doc, target, assets, original.fingerprint, 0.5, true, true, [
			reverse,
			{ ...audio, operation: { ...audio.operation, preservePitch: false } },
		]),
	).toThrow("differ");
	expect(() =>
		applySourcePlayback(next, target, assets, original.fingerprint, 0.5, true, true, [
			reverse,
			audio,
		]),
	).toThrow("changed");
	expect(() =>
		applySourcePlayback(
			{ ...doc, trackFlags: { 0: { locked: true } } },
			target,
			assets,
			original.fingerprint,
			0.5,
			true,
			true,
			[reverse, audio],
		),
	).toThrow("locked");
});

test("retime preserves canonical word gaps and mix settings; reverse requires refresh", () => {
	const target: SourceEditTarget = { source: "audio", id: 4 };
	const voiced = {
		...doc,
		captionSet: {
			initialized: true as const,
			language: "en",
			revision: 0,
			deletedRanges: [],
			appliedRunIds: [],
		},
		clips: [
			...doc.clips.map((clip) =>
				clip.audio
					? { ...clip, audio: { ...clip.audio, fadeIn: 0.2, fadeOut: 0.3, duckUnderVoice: 0.4 } }
					: clip,
			),
			{
				id: "caption:words",
				type: "caption" as const,
				startSec: 13,
				durationSec: 4,
				track: 2,
				caption: {
					text: "First Second",
					words: [
						{ text: "First", startSec: 0.2, endSec: 0.5 },
						{ text: "Second", startSec: 1.1, endSec: 1.9 },
					],
					sources: [
						{
							clipId: "audio:4",
							mediaId: "audio",
							mediaRevision: "r1",
							sourceStartSec: 1,
							sourceEndSec: 5,
						},
					],
					provenance: { origin: "recognized" as const, wordTimingOrigin: "recognized" as const },
					protection: { text: false, timing: false, segmentation: false, style: false },
					revision: 0,
					groupId: "g",
					status: "current" as const,
				},
			},
		],
	};
	const slowed = setSourceRate(voiced, target, assets, 0.5, true);
	const cue = slowed.clips.find((clip) => clip.type === "caption")!;
	expect(cue.startSec).toBe(13);
	expect(cue.caption?.words[0]?.startSec).toBeCloseTo(0.4);
	expect(cue.caption?.words[0]?.endSec).toBeCloseTo(1);
	expect(cue.caption?.words[1]?.startSec).toBeCloseTo(2.2);
	expect(cue.caption!.words[1]!.startSec - cue.caption!.words[0]!.endSec).toBeCloseTo(1.2);
	expect(fromTimelineDoc(slowed).audioOverlays[0]).toMatchObject({
		fadeIn: 0.2,
		fadeOut: 0.3,
		duckUnderVoice: 0.4,
		content: "Unchanged words",
	});
	const settings = sourceEditInfo(slowed, target, assets)!;
	const mirrored = applySourcePlayback(
		slowed,
		target,
		assets,
		settings.fingerprint,
		0.5,
		true,
		true,
	);
	const stale = mirrored.clips.find((clip) => clip.type === "caption")!;
	expect(stale.caption?.status).toBe("needs-refresh");
	expect(stale.caption?.text).toBe("First Second");
	expect(stale.caption?.words).toEqual(cue.caption?.words);
});

test("narration growth does not extend or shorten independently authored source selection", () => {
	const target: SourceEditTarget = { source: "scene", id: 1, visualId: "v" };
	const slowed = setSourceRate(doc, target, assets, 0.5, true);
	const grown = {
		...slowed,
		clips: slowed.clips.map((c) =>
			c.id === "scene:1"
				? { ...c, durationSec: 10, scene: c.scene ? { ...c.scene, dur: 10 } : undefined }
				: c,
		),
	};
	expect(sourceEditInfo(grown, target, assets)?.duration).toBe(8);
	const sped = setSourceRate(grown, target, assets, 2, true);
	expect(sourceEditInfo(sped, target, assets)?.duration).toBe(2);
	expect(fromTimelineDoc(sped).scenes[0]?.dur).toBe(10);
	expect(fromTimelineDoc(sped).scenes[0]?.vo).toBe("Unchanged narration");
});

test("rate changes scale inherited visual and audio key times without changing source-relative samples", () => {
	const animation: ClipAnimation = {
		tracks: {
			volume: [
				{ t: 0, v: 0.2 },
				{ t: 4, v: 0.9, easing: "in-out" },
			],
		},
	};
	const keyed = rebuildDocWith(
		{
			...doc,
			clips: doc.clips.map((c) => ({
				...c,
				...(c.scene
					? {
							scene: {
								...c.scene,
								layout: {
									xPct: 0,
									yPct: 0,
									widthPct: 100,
									fit: "contain" as const,
									...c.scene.layout,
									animation,
								},
							},
						}
					: {}),
				...(c.video
					? {
							video: {
								...c.video,
								layout: {
									xPct: 0,
									yPct: 0,
									widthPct: 100,
									fit: "contain" as const,
									...c.video.layout,
									animation,
								},
							},
						}
					: {}),
				...(c.audio
					? {
							audio: {
								...c.audio,
								animation,
							},
						}
					: {}),
			})),
		},
		{},
	);
	for (const target of [
		{ source: "scene", id: 1, visualId: "v" },
		{ source: "video", id: 3 },
		{ source: "audio", id: 4 },
	] satisfies SourceEditTarget[])
		for (const rate of [0.25, 0.5, 2, 4]) {
			const changed = setSourceRate(keyed, target, assets, rate, true),
				views = fromTimelineDoc(changed);
			const next =
				target.source === "scene"
					? views.scenes[0]!.visualClips![0]!.layout?.animation
					: target.source === "video"
						? views.videoOverlays[0]!.layout?.animation
						: views.audioOverlays[0]!.animation;
			for (const time of [0, 0.75, 2, 3.5, 4])
				expect(sampleClipProperty(next, "volume", time / rate, 1)).toBeCloseTo(
					sampleClipProperty(animation, "volume", time, 1),
					10,
				);
			expect(sourceEditInfo(changed, target, assets)?.start).toBe(1);
			expect(
				changed.clips.filter(
					(c) => c.id !== (target.source === "scene" ? "scene:1" : `${target.source}:${target.id}`),
				),
			).toEqual(
				keyed.clips.filter(
					(c) => c.id !== (target.source === "scene" ? "scene:1" : `${target.source}:${target.id}`),
				),
			);
		}
});
