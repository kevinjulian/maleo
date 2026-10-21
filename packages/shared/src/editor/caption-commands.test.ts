import { expect, test } from "vite-plus/test";
import { readFileSync, readdirSync } from "node:fs";
import { sampleScope } from "./sample-scope.ts";
import { editCaptions, batch, commandLabel, type EditorCommand } from "./commands.ts";
import { execute, applyCommand } from "./engine-registry.ts";
import { diffScopeToCommand } from "./scope-diff.ts";
import { commandClipIds, commandInsertedClipIds } from "./command-targets.ts";
import { clipFingerprint } from "../entity-fingerprint.ts";
import type { Clip } from "../timeline-doc.ts";

const cue: Clip = {
	id: "caption:1",
	type: "caption",
	startSec: 3,
	durationSec: 2,
	track: 2,
	caption: {
		text: "Hello world",
		words: [
			{ text: "Hello", startSec: 0, endSec: 0.8 },
			{ text: "world", startSec: 1, endSec: 2 },
		],
		provenance: { origin: "recognized", wordTimingOrigin: "recognized" },
		sources: [
			{
				clipId: "video:1",
				mediaId: "asset-video",
				mediaRevision: "r1",
				sourceStartSec: 4,
				sourceEndSec: 6,
			},
		],
		protection: { text: false, timing: false, segmentation: false, style: false },
		revision: 0,
		groupId: "g",
		status: "current",
	},
};
function scope() {
	const before = sampleScope();
	return {
		...before,
		doc: {
			...before.doc,
			clips: [...before.doc.clips, cue],
			captionSet: {
				initialized: true as const,
				language: "en",
				revision: 0,
				deletedRanges: [],
				appliedRunIds: [],
			},
		},
	};
}

test("caption edit targets include creations, splits, result replacements and inverses", () => {
	const folder = new URL("./fixtures/caption.edit/", import.meta.url);
	for (const name of readdirSync(folder)) {
		// SAFETY: golden commands are validated by native and WASM fixture suites.
		const fixture = JSON.parse(readFileSync(new URL(name, folder), "utf8")) as {
			command: EditorCommand;
			expectedInverse: EditorCommand;
		};
		expect(commandClipIds([fixture.command])).toContain("caption:1");
		expect(commandClipIds([fixture.expectedInverse])).toContain("caption:1");
	}
	const create = editCaptions({ action: "create", clip: cue });
	const split = editCaptions({ action: "split", id: cue.id, at: 4, newId: "caption:2" });
	const result = editCaptions({
		action: "apply-result",
		ids: [cue.id],
		candidates: [cue, { ...cue, id: "caption:new" }],
		runId: "r",
		language: "en",
		startSec: 0,
		endSec: 10,
		sources: [],
		snapshot: { sourceClips: [], cues: [], deletedRanges: [] },
		replaceEdited: false,
	});
	const commands = [
		batch([create, batch([split, result, editCaptions({ action: "delete", ids: [cue.id] })])]),
		{ type: "noop" } as const,
	];
	const inserted = commandInsertedClipIds(commands);
	expect(inserted).toEqual([cue.id, "caption:2", "caption:new"]);
	expect(commandClipIds(commands)).toEqual([cue.id, "caption:2", "caption:new"]);
	expect(
		commandInsertedClipIds([
			editCaptions({ action: "style", ids: [cue.id], style: null }),
			{ type: "clip.insert", clip: { ...cue, id: "caption:generic" } },
		]),
	).toEqual(["caption:generic"]);
	expect(commandLabel(create)).toBe("caption.edit");
});

test("source targets include linked cues even if user deleted them during run", () => {
	const before = scope();
	const captured = before.doc.clips.map(clipFingerprint);
	const move: EditorCommand = { type: "clip.move", id: "video:1", patch: { startSec: 6 } };
	expect(commandClipIds([move], before.doc.clips)).toEqual(["video:1", cue.id]);
	expect(
		commandClipIds(
			[move],
			before.doc.clips.filter((clip) => clip.id !== cue.id),
			captured,
		),
	).toEqual(["video:1", cue.id]);
	expect(
		commandClipIds(
			[{ type: "doc.setTrackFlags", trackFlags: { 0: { muted: true } } }],
			before.doc.clips,
			captured,
		),
	).toEqual(["video:1", cue.id]);
	expect(
		commandClipIds([{ type: "marker.remove", id: 1 }, { type: "noop" }], before.doc.clips),
	).toEqual([]);
});

test("source recipes retain dependent Rust cue changes and exact one-step undo", () => {
	const before = scope();
	const recipe = {
		...before,
		doc: {
			...before.doc,
			clips: before.doc.clips.map((clip) =>
				clip.id === "video:1"
					? { ...clip, startSec: 6, video: { ...clip.video!, start: 6 } }
					: clip,
			),
		},
	};
	const command = diffScopeToCommand(before, recipe);
	expect(command.type).not.toBe("scope.replace");
	const result = execute(before, command);
	expect(result.scope.doc.clips.find((clip) => clip.id === cue.id)?.startSec).toBe(7);
	expect(result.scope.doc.clips.find((clip) => clip.id === "text:2")).toBe(before.doc.clips[1]);
	expect(applyCommand(result.scope, result.inverse)).toEqual(before);
	const changedSet = {
		...before,
		doc: { ...before.doc, captionSet: { ...before.doc.captionSet, revision: 1 } },
	};
	expect(applyCommand(before, diffScopeToCommand(before, changedSet))).toEqual(changedSet);
	const absent = {
		...before,
		doc: {
			...before.doc,
			clips: before.doc.clips.filter((clip) => clip.type !== "caption"),
			captionSet: undefined,
		},
	};
	const initialized = { ...absent, doc: { ...absent.doc, captionSet: before.doc.captionSet } };
	expect(applyCommand(initialized, diffScopeToCommand(initialized, absent))).toEqual(absent);
});
