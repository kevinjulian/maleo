import { describe, expect, test } from "vite-plus/test";
import {
	previewMediaDependencies,
	type PreviewMediaDependencyInput,
} from "./preview-media-dependencies.ts";
import { toTimelineDoc } from "./timeline-doc.ts";
import type { MediaAsset } from "./editor/scope.ts";
import type { Scene } from "./timeline-model.ts";
import { processedAudioSource } from "./processed-audio.ts";
import { buildRenderStoryboardFromDoc } from "./render-storyboard.ts";

const url = "/api/media/00000000-0000-4000-8000-000000000001";
const derivative = "/api/media/00000000-0000-4000-8000-000000000002";
const source: MediaAsset = {
	id: "source",
	label: "Video",
	url,
	kind: "video",
	source: "upload",
	importedSource: {
		revision: "r1",
		fingerprint: "a".repeat(64),
		originalMediaId: "00000000-0000-4000-8000-000000000003",
	},
};
const scene: Scene = {
	id: 1,
	dur: 3,
	name: "Scene",
	shot: "",
	move: "",
	vis: "",
	vo: "",
	img: true,
	src: "/frame.png",
	endSrc: "/end.png",
};
const base: PreviewMediaDependencyInput = {
	workspaceId: "workspace",
	projectId: "project",
	legacyGeneration: "1",
	doc: toTimelineDoc(
		[],
		[{ id: 1, kind: "video", url, start: 6, dur: 2, track: 1, mediaAssetId: source.id }],
	),
	mediaAssets: [source],
	refs: { images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } },
};

describe("complete preview dependency inventory", () => {
	test("retimed and reversed sound uses contained derivative offsets without applying authored rate twice", () => {
		for (const rate of [0.25, 0.5, 1, 2, 4])
			for (const reverse of [false, true]) {
				if (rate === 1 && !reverse) continue;
				const duration = 1,
					start = 2;
				const audio = {
					id: 9,
					kind: "voiceover" as const,
					content: "",
					url,
					start: 0,
					dur: duration,
					mediaStartSec: start,
					mediaAssetId: source.id,
					playbackRate: rate,
					preservePitch: true,
					reverse,
					audioMedia: {
						url: derivative,
						sourceUrl: url,
						sourceRevision: "r1",
						startSec: 1,
						durationSec: 8,
						playbackRate: rate,
						preservePitch: true,
						reverse,
					},
				};
				const mapped = processedAudioSource(url, start, duration, audio);
				const expected = (reverse ? 9 - (start + duration * rate) : start - 1) / rate;
				expect(mapped).toEqual({ url: derivative, mediaStartSec: expected });
				const doc = toTimelineDoc([], [], [], [audio]);
				const input = { ...base, doc, mediaAssets: [{ ...source, kind: "audio" as const }] };
				const ready = previewMediaDependencies(input);
				expect(ready.clips[0]?.blockers).toEqual([]);
				expect(ready.sources.map((source) => source.url)).toContain(derivative);
				const render = buildRenderStoryboardFromDoc(
					{ format: "9:16", length: "2" },
					base.refs,
					doc,
				).storyboard;
				expect(render.audioOverlays?.[0]).toMatchObject({
					url: derivative,
					mediaStartSec: expected,
				});
				expect(render.audioOverlays?.[0]).not.toHaveProperty("playbackRate");
				for (const change of [
					{ sourceRevision: "old" },
					{ sourceUrl: "other.wav" },
					{ preservePitch: false },
					{ durationSec: 0.5 },
				]) {
					const stale = structuredClone(doc);
					stale.clips[0]!.audio!.audioMedia = { ...audio.audioMedia, ...change };
					const blocked = previewMediaDependencies({ ...input, doc: stale });
					expect(blocked.clips[0]?.blockers).toHaveLength(1);
					expect(blocked.sources.map((source) => source.url)).not.toContain(derivative);
				}
			}
	});
	test("one file used by video and audio keeps both required tracks and one revision", () => {
		const doc = structuredClone(base.doc);
		doc.clips.push({
			id: "audio:2",
			type: "audio",
			startSec: 0,
			durationSec: 1,
			track: 0,
			audio: { id: 2, kind: "sfx", content: "", start: 0, dur: 1, url, mediaAssetId: source.id },
		});
		const result = previewMediaDependencies({ ...base, doc });
		expect(result.sources.find((source) => source.url === url)?.kinds).toEqual(["audio", "video"]);
		const reversed = previewMediaDependencies({
			...base,
			doc: { ...doc, clips: [...doc.clips].reverse() },
		});
		expect(reversed.sources.map(({ clipIds: _clipIds, ...source }) => source)).toEqual(
			result.sources.map(({ clipIds: _clipIds, ...source }) => source),
		);
	});
	test("loads duplicate placed sources once, including originals, excluding unused assets", () => {
		const doc = structuredClone(base.doc);
		doc.clips.push({ ...doc.clips[0]!, id: "copy" });
		const result = previewMediaDependencies({
			...base,
			doc,
			mediaAssets: [...base.mediaAssets, { ...source, id: "unused", url: "/unused.mp4" }],
		});
		expect(result.sources).toHaveLength(2);
		for (const item of result.sources) expect(item.clipIds).toEqual(["video:1", "copy"]);
		expect(result.sources.map((item) => item.url)).not.toContain("/unused.mp4");
	});
	test("track visibility, mute, placement, selection and layout do not change dependencies", () => {
		const doc = { ...base.doc, trackFlags: { 1: { hidden: true, muted: true } } };
		doc.clips = doc.clips.map((clip) => ({
			...clip,
			startSec: 900,
			video: { ...clip.video!, volume: 0 },
		}));
		expect(previewMediaDependencies({ ...base, doc })).toEqual(previewMediaDependencies(base));
	});
	test("text and shapes need no media while scenes retain all visual sources", () => {
		const doc = toTimelineDoc(
			[scene],
			[],
			[{ id: 7, preset: "plain", content: "Text", start: 0, dur: 2 }],
		);
		const result = previewMediaDependencies({ ...base, doc });
		expect(result.sources.map((item) => item.url).sort()).toEqual(["/end.png", "/frame.png"]);
		expect(result.clips.find((clip) => clip.id === "text:7")).toBeUndefined();
		const withoutText = previewMediaDependencies({ ...base, doc: toTimelineDoc([scene]) });
		expect(result).toEqual(withoutText);
	});
	test("includes scene visuals, promoted visuals and reference fallback without thumbnails", () => {
		const doc = toTimelineDoc([
			{
				...scene,
				visualClips: [
					{ id: "primary", kind: "video", label: "Video", url, startSec: 0, durationSec: 3 },
					{
						id: "extra",
						kind: "image",
						label: "Image",
						url: "/extra.png",
						startSec: 1,
						durationSec: 1,
					},
				],
			},
		]);
		const result = previewMediaDependencies({ ...base, doc });
		expect(result.sources.find((item) => item.url === "/extra.png")?.clipIds).toEqual([
			"vis:1:extra",
		]);
		expect(result.sources.some((item) => item.url === "/frame.png")).toBe(false);
		const fallback = toTimelineDoc([{ ...scene, src: undefined, endSrc: undefined }]);
		expect(
			previewMediaDependencies({
				...base,
				doc: fallback,
				refs: {
					...base.refs,
					images: [{ id: "ref", primary: true, label: "Reference", seed: 0, imageUrl: "/ref.png" }],
				},
			}).sources[0]?.url,
		).toBe("/ref.png");
	});
	test("pending files keep stable managed identities before uploaded metadata exists", () => {
		const result = previewMediaDependencies({
			...base,
			mediaAssets: [{ ...source, importedSource: undefined }],
		});
		expect(result.sources).toHaveLength(1);
		expect(result.sources[0]?.url).toBe(url);
		expect(result.clips[0]?.blockers).toEqual([]);
	});
	test("valid reverse derivative loads alongside original; stale revision or interval blocks", () => {
		const doc = structuredClone(base.doc);
		doc.clips[0]!.video!.layout = {
			xPct: 0,
			yPct: 0,
			widthPct: 100,
			heightPct: 100,
			fit: "cover",
			reverse: true,
			reverseMedia: {
				url: derivative,
				sourceUrl: url,
				sourceRevision: "r1",
				startSec: 0,
				durationSec: 2,
			},
		};
		expect(previewMediaDependencies({ ...base, doc }).sources.map((item) => item.url)).toContain(
			derivative,
		);
		doc.clips[0]!.video!.layout.reverseMedia!.sourceRevision = "old";
		const stale = previewMediaDependencies({ ...base, doc });
		expect(stale.clips[0]?.blockers).toHaveLength(1);
		expect(stale.sources.map((item) => item.url)).not.toContain(derivative);
	});
	test("muted retimed audio still needs its valid derivative", () => {
		const audioAsset: MediaAsset = { ...source, kind: "audio" };
		const doc = toTimelineDoc(
			[],
			[],
			[],
			[
				{
					id: 2,
					kind: "voiceover",
					content: "",
					url,
					start: 0,
					dur: 1,
					volume: 0,
					mediaAssetId: source.id,
					playbackRate: 2,
					preservePitch: true,
					audioMedia: {
						url: derivative,
						sourceUrl: url,
						sourceRevision: "r1",
						startSec: 0,
						durationSec: 2,
						playbackRate: 2,
						preservePitch: true,
						reverse: false,
					},
				},
			],
		);
		const result = previewMediaDependencies({ ...base, doc, mediaAssets: [audioAsset] });
		expect(result.sources.map((item) => item.url)).toContain(derivative);
		expect(result.clips[0]?.blockers).toEqual([]);
		doc.clips[0]!.audio!.audioMedia!.sourceRevision = "old";
		expect(
			previewMediaDependencies({ ...base, doc, mediaAssets: [audioAsset] }).clips[0]?.blockers,
		).toHaveLength(1);
	});
	test("pending File replacement revises only its source, without depending on upload progress", () => {
		const first = previewMediaDependencies({
			...base,
			pendingRevision: (item) => (item === url ? "file-lease-1" : undefined),
		});
		const second = previewMediaDependencies({
			...base,
			pendingRevision: (item) => (item === url ? "file-lease-2" : undefined),
		});
		expect(first.sources.find((source) => source.url === url)?.revision).toBe("file-lease-1");
		expect(second.sources.find((source) => source.url === url)?.revision).toBe("file-lease-2");
		expect(
			previewMediaDependencies({
				...base,
				pendingRevision: (item) => (item === url ? "file-lease-2" : undefined),
			}),
		).toEqual(second);
	});
});
