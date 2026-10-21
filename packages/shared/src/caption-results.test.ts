import { expect, test } from "vite-plus/test";
import { captureCaptionResult } from "./caption-results.ts";
import type { Clip } from "./timeline-doc.ts";
import { execute, applyCommand, editCaptions, type EditScope } from "./editor/index.ts";
import { sampleScope } from "./editor/sample-scope.ts";

function cue(id: string, startSec: number, durationSec: number, text: string): Clip {
	return {
		id,
		type: "caption",
		startSec,
		durationSec,
		track: 2,
		caption: {
			text,
			words: [],
			provenance: { origin: "recognized", wordTimingOrigin: "recognized" },
			sources: [
				{
					clipId: "video:1",
					mediaId: "asset-video",
					mediaRevision: "r1",
					sourceStartSec: startSec + 1,
					sourceEndSec: startSec + durationSec + 1,
				},
			],
			protection: { text: false, timing: false, segmentation: false, style: false },
			revision: 0,
			groupId: "g",
			status: "current",
		},
	};
}
function scope(): EditScope {
	const before = sampleScope();
	const corrected = cue("caption:corrected", 3, 2, "Keep\ncorrection");
	corrected.caption!.protection.text = true;
	const outside = cue("caption:outside", 10, 1, "Other caption");
	outside.caption!.sources = [];
	return {
		...before,
		doc: {
			...before.doc,
			clips: [...before.doc.clips, corrected, outside],
			captionSet: {
				initialized: true,
				language: "en",
				revision: 2,
				appliedRunIds: [],
				deletedRanges: [
					{
						id: "deleted",
						groupId: "g",
						startSec: 5,
						endSec: 6,
						sources: [
							{
								clipId: "video:1",
								mediaId: "asset-video",
								mediaRevision: "r1",
								sourceStartSec: 6,
								sourceEndSec: 7,
							},
						],
					},
				],
			},
		},
	};
}
function command(before: EditScope, replaceEdited = false) {
	return editCaptions({
		action: "apply-result",
		...captureCaptionResult(before.doc, {
			startSec: 2,
			endSec: 6,
			sources: [
				{
					clipId: "video:1",
					mediaId: "asset-video",
					mediaRevision: "r1",
					sourceStartSec: 3,
					sourceEndSec: 7,
				},
			],
		}),
		candidates: [
			cue("caption:new-before", 2, 1, "Fresh before"),
			cue("caption:new-overlap", 3, 2, "Recognized correction"),
			cue("caption:new-deleted", 5, 1, "Deleted words"),
		],
		runId: "job:1",
		language: "en",
		replaceEdited,
	});
}

test("preserve edited captions excludes protected ranges and deletions; unrelated edits survive", () => {
	const before = scope();
	const ready = command(before);
	const live = {
		...before,
		doc: {
			...before.doc,
			captionSet: { ...before.doc.captionSet!, revision: 9 },
			clips: before.doc.clips.map((clip) =>
				clip.id === "caption:outside"
					? {
							...clip,
							caption: { ...clip.caption!, text: "Later unrelated correction", revision: 3 },
						}
					: clip,
			),
		},
	};
	const result = execute(live, ready);
	expect(result.scope.doc.clips.find((clip) => clip.id === "caption:corrected")).toEqual(
		before.doc.clips.find((clip) => clip.id === "caption:corrected"),
	);
	expect(result.scope.doc.clips.find((clip) => clip.id === "caption:outside")?.caption?.text).toBe(
		"Later unrelated correction",
	);
	expect(
		result.scope.doc.clips
			.filter((clip) => clip.id.startsWith("caption:new"))
			.map((clip) => clip.id),
	).toEqual(["caption:new-before"]);
	expect(result.scope.doc.captionSet?.deletedRanges).toEqual(before.doc.captionSet?.deletedRanges);
	expect(applyCommand(result.scope, result.inverse)).toEqual(live);
	expect(execute(result.scope, ready).inverse).toEqual({ type: "noop" });
	expect(applyCommand(result.scope, ready)).toBe(result.scope);
});

test("explicit replacement clears only scoped protection and deletion ranges", () => {
	const before = scope();
	const result = execute(before, command(before, true));
	expect(result.scope.doc.clips.filter((clip) => clip.id.startsWith("caption:new"))).toHaveLength(
		3,
	);
	expect(result.scope.doc.clips.some((clip) => clip.id === "caption:corrected")).toBe(false);
	expect(result.scope.doc.clips.find((clip) => clip.id === "caption:outside")).toEqual(
		before.doc.clips.find((clip) => clip.id === "caption:outside"),
	);
	expect(result.scope.doc.captionSet?.deletedRanges).toEqual([]);
	expect(applyCommand(result.scope, result.inverse)).toEqual(before);
});

test("style-only protection transfers override while allowing fresh recognition", () => {
	const before = scope();
	const styled = before.doc.clips.find((clip) => clip.id === "caption:corrected")!;
	styled.caption = {
		...styled.caption!,
		protection: { text: false, timing: false, segmentation: false, style: true },
		style: { fill: "#123456", fontSize: 48 },
	};
	const result = execute(before, command(before));
	expect(
		result.scope.doc.clips.find((clip) => clip.id === "caption:new-overlap")?.caption,
	).toMatchObject({
		text: "Recognized correction",
		style: { fill: "#123456", fontSize: 48 },
		protection: { style: true },
	});
	expect(result.scope.doc.clips.some((clip) => clip.id === "caption:corrected")).toBe(false);
});

test("affected cue/source/deletion changes hold results; visual-only source edits remain valid", () => {
	const before = scope();
	const ready = command(before);
	const correction = {
		...before,
		doc: {
			...before.doc,
			clips: before.doc.clips.map((clip) =>
				clip.id === "caption:corrected"
					? { ...clip, caption: { ...clip.caption!, text: "Newer edit" } }
					: clip,
			),
		},
	};
	expect(() => execute(correction, ready)).toThrow("affected captions changed");
	const deletion = {
		...before,
		doc: { ...before.doc, captionSet: { ...before.doc.captionSet!, deletedRanges: [] } },
	};
	expect(() => execute(deletion, ready)).toThrow("caption scope changed");
	const gain = {
		...before,
		doc: {
			...before.doc,
			clips: before.doc.clips.map((clip) =>
				clip.video ? { ...clip, video: { ...clip.video, volume: 0.3 } } : clip,
			),
		},
	};
	expect(() => execute(gain, ready)).toThrow("source changed");
	const visual = {
		...before,
		doc: {
			...before.doc,
			clips: before.doc.clips.map((clip) =>
				clip.video
					? { ...clip, video: { ...clip.video, layout: { ...clip.video.layout!, xPct: 10 } } }
					: clip,
			),
		},
	};
	expect(execute(visual, ready).scope.doc.captionSet?.appliedRunIds).toContain("job:1");
	const locked = { ...before, doc: { ...before.doc, trackFlags: { 2: { locked: true } } } };
	expect(() => execute(locked, ready)).toThrow("locked");
});

test("no speech preserves state; invalid ranges and out-of-scope candidates cannot mutate", () => {
	const before = scope();
	const ready = command(before);
	if (ready.type !== "caption.edit" || ready.edit.action !== "apply-result")
		throw new Error("Expected result command");
	const edit = ready.edit;
	expect(applyCommand(before, { ...ready, edit: { ...edit, candidates: [] } })).toBe(before);
	expect(() => captureCaptionResult(before.doc, { startSec: 2, endSec: 2, sources: [] })).toThrow(
		"Invalid caption regeneration range",
	);
	expect(() =>
		execute(before, {
			...ready,
			edit: { ...edit, candidates: [cue("caption:bad", 20, 1, "Outside")] },
		}),
	).toThrow("scope");
	expect(() => execute(before, { ...ready, edit: { ...edit, language: "id" } })).toThrow(
		"complete caption set",
	);
});

test("recognized language persists and candidates cannot escape selected original-source intervals", () => {
	const before = scope();
	const ready = command(before);
	if (ready.type !== "caption.edit" || ready.edit.action !== "apply-result")
		throw new Error("Expected result command");
	const edit = ready.edit;
	const result = execute(before, { ...ready, edit: { ...edit, detectedLanguage: "en" } });
	expect(result.scope.doc.captionSet?.detectedLanguage).toBe("en");
	expect(applyCommand(result.scope, result.inverse)).toEqual(before);
	const candidate = structuredClone(edit.candidates[0]!);
	candidate.caption!.sources[0]!.sourceEndSec = 9;
	expect(() => execute(before, { ...ready, edit: { ...edit, candidates: [candidate] } })).toThrow(
		"source leaves regeneration scope",
	);
});
