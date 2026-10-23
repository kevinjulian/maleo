import { expect, test } from "vite-plus/test";
import { readStoryboardDocument, writeStoryboardDocument } from "./storyboard-document.ts";
import {
	fromTimelineDoc,
	rebuildDocWith,
	toTimelineDoc,
	type TimelineDoc,
} from "./timeline-doc.ts";
import type { CaptionSet } from "./caption-cues.ts";

const captionSet: CaptionSet = {
	initialized: true,
	language: "id",
	detectedLanguage: "id",
	revision: 4,
	appliedRunIds: ["run-1"],
	deletedRanges: [{ id: "deleted-1", groupId: "g1", startSec: 5, endSec: 6, sources: [] }],
};
const doc: TimelineDoc = {
	schemaVersion: 2,
	markers: [],
	captionSet,
	clips: [
		{
			id: "caption:1",
			type: "caption",
			startSec: 1.234,
			durationSec: 2.345,
			track: 1,
			caption: {
				text: "Selamat\npagi!",
				words: [
					{ text: "Selamat", startSec: 0, endSec: 1 },
					{ text: "pagi!", startSec: 1.2, endSec: 2 },
				],
				provenance: { origin: "imported", wordTimingOrigin: "estimated" },
				sources: [],
				protection: { text: true, timing: true, segmentation: true, style: true },
				revision: 2,
				groupId: "g1",
				status: "current",
				style: { fontSize: 48 },
			},
		},
	],
};

test("initialized caption clips and metadata round trip through the total writer", () => {
	const first = readStoryboardDocument(doc).doc;
	const output = writeStoryboardDocument(first);
	const second = readStoryboardDocument(JSON.parse(JSON.stringify(output))).doc;
	expect(second.clips).toEqual(doc.clips);
	expect(second.captionSet).toEqual(captionSet);
	expect(writeStoryboardDocument(second)).toEqual(output);
	expect(readStoryboardDocument(output).diagnostic.unknownKeys).not.toContain("captionSet");
});

test("family projections and unrelated rebuilds preserve canonical caption clips", () => {
	const views = fromTimelineDoc(doc);
	const projected = toTimelineDoc(
		views.scenes,
		views.videoOverlays,
		views.textOverlays,
		views.audioOverlays,
		views.effects,
		views.transitions,
		views.projectReferences,
		views,
	);
	expect(projected.clips).toEqual(doc.clips);
	expect(projected.captionSet).toEqual(captionSet);
	expect(rebuildDocWith(doc, { scenes: [], textOverlays: [] })).toEqual({
		...doc,
		projectReferences: undefined,
	});
});

test("explicit empty caption sets survive read, write and rebuild", () => {
	const empty = { ...doc, clips: [] };
	expect(
		readStoryboardDocument(writeStoryboardDocument(readStoryboardDocument(empty).doc)).doc
			.captionSet,
	).toEqual(captionSet);
	expect(rebuildDocWith(empty, { scenes: [] }).clips).toEqual([]);
	expect(rebuildDocWith(empty, { scenes: [] }).captionSet).toEqual(captionSet);
});

test("malformed stored cue is diagnosed without clearing initialization", () => {
	const malformed = { ...doc, clips: [{ ...doc.clips[0], durationSec: 0 }] };
	const result = readStoryboardDocument(malformed);
	expect(result.doc.clips).toEqual([]);
	expect(result.doc.captionSet).toEqual(captionSet);
	expect(result.diagnostic.defaulted).toContain("clips[]");
});

test("corrupt or missing caption sets are diagnosed without implicit initialization", () => {
	for (const captionSet of [undefined, { initialized: false }, "bad"]) {
		const result = readStoryboardDocument({ ...doc, captionSet });
		expect(result.doc.captionSet).toBeNull();
		expect(result.diagnostic.defaulted).toContain("captionSet");
	}
	expect(
		readStoryboardDocument({ schemaVersion: 2, clips: [], markers: [] }).doc.captionSet,
	).toBeNull();
});

test("missing stored source retains authored cue and requires refresh", () => {
	const cue = doc.clips[0]!;
	const sources = [
		{
			clipId: "video:missing",
			mediaId: "m1",
			mediaRevision: "r1",
			sourceStartSec: 0,
			sourceEndSec: 2,
		},
	];
	const result = readStoryboardDocument({
		...doc,
		clips: [{ ...cue, caption: { ...cue.caption, sources } }],
	});
	expect(result.doc.clips[0]?.caption).toEqual({
		...cue.caption,
		sources,
		status: "needs-refresh",
	});
	expect(result.diagnostic.defaulted).toContain("clips[].caption.sources");
	expect(() => writeStoryboardDocument(result.doc)).not.toThrow();
});

test("strict writer refuses invalid new cues, missing sets and dangling current bindings", () => {
	const valid = readStoryboardDocument(doc).doc;
	expect(() => writeStoryboardDocument({ ...valid, captionSet: null })).toThrow();
	expect(() =>
		writeStoryboardDocument({ ...valid, clips: [{ ...doc.clips[0]!, durationSec: 0 }] }),
	).toThrow();
	const cue = doc.clips[0]!;
	expect(() =>
		writeStoryboardDocument({
			...valid,
			clips: [
				{
					...cue,
					caption: {
						...cue.caption!,
						sources: [
							{
								clipId: "missing",
								mediaId: "m1",
								mediaRevision: "r1",
								sourceStartSec: 0,
								sourceEndSec: 2,
							},
						],
					},
				},
			],
		}),
	).toThrow();
});

test("voiceover words never initialize or repopulate canonical caption sets", () => {
	const audio = {
		id: "audio:1",
		type: "audio",
		startSec: 0,
		durationSec: 2,
		track: 0,
		audio: {
			id: 1,
			kind: "voiceover",
			content: "",
			start: 0,
			dur: 2,
			words: [{ text: "Stored words", startSec: 0, endSec: 2 }],
		},
	};
	for (const set of [undefined, { ...captionSet, deletedRanges: [] }]) {
		const original = { schemaVersion: 2, clips: [audio], markers: [], captionSet: set };
		const loaded = readStoryboardDocument(original).doc;
		expect(loaded.clips).toEqual([audio]);
		expect(loaded.captionSet).toEqual(set ?? null);
		const saved = writeStoryboardDocument(loaded);
		const restored = readStoryboardDocument(JSON.parse(JSON.stringify(saved))).doc;
		expect(restored.clips).toEqual([audio]);
		expect(restored.captionSet).toEqual(set ?? null);
		expect(restored.clips.some((clip) => clip.type === "caption")).toBe(false);
	}
});

test("caption-set-only edits are not lost by scope diff", async () => {
	const { diffScopeToCommand } = await import("./editor/scope-diff.ts");
	const { applyCommand } = await import("./editor/engine-registry.ts");
	const before = { doc: { ...doc, clips: [] }, mediaAssets: [], slides: [], posts: [] };
	const after = { ...before, doc: { ...before.doc, captionSet: { ...captionSet, revision: 5 } } };
	const command = diffScopeToCommand(before, after);
	expect(command.type).not.toBe("noop");
	expect(applyCommand(before, command)).toEqual(after);
});
