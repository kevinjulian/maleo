import { expect, test } from "vite-plus/test";
import {
	DEFAULT_CAPTIONS,
	captionStateFingerprint,
	readStoryboardDocument,
	SCENE_TEXT_CLIP_MIGRATION_VERSION,
	type CaptionSet,
	type Clip,
} from "@maleo/shared";
import { parseLoadedProject } from "./parse-loaded-project.ts";
import { baseDetail } from "./parse-loaded-project.fixtures.ts";
import { storyboardJson } from "./document-wire.ts";

const captionSet: CaptionSet = {
	initialized: true,
	language: "auto",
	revision: 1,
	deletedRanges: [],
	appliedRunIds: ["run-1"],
};
const caption: Clip = {
	id: "caption:1",
	type: "caption",
	startSec: 1,
	durationSec: 2,
	track: 1,
	caption: {
		text: "Hello\nworld",
		words: [],
		sources: [],
		provenance: { origin: "manual", wordTimingOrigin: "estimated" },
		protection: { text: true, timing: true, segmentation: true, style: false },
		revision: 1,
		groupId: "g1",
		status: "current",
	},
};

test("autosave baseline uses stored captions before lane migration changes their tracks", () => {
	const stored = {
		schemaVersion: 2,
		sceneTextClipMigrationVersion: SCENE_TEXT_CLIP_MIGRATION_VERSION,
		clips: [{ ...caption, track: 6 }],
		markers: [],
		captionSet,
		trackFlags: { 6: { group: "caption" } },
	};
	const parsed = parseLoadedProject(baseDetail({}, stored));
	expect(parsed.clips[0]?.track).toBe(0);
	expect(parsed.persistedCaptionState).toBe(
		captionStateFingerprint(readStoryboardDocument(stored).doc),
	);
	expect(parsed.persistedCaptionState).not.toBe(captionStateFingerprint(parsed));
});

for (const version of [undefined, SCENE_TEXT_CLIP_MIGRATION_VERSION]) {
	test(`caption clips survive load/save/restore with scene migration ${version}`, () => {
		const input = {
			schemaVersion: 2,
			sceneTextClipMigrationVersion: version,
			clips: [caption],
			markers: [],
			trackFlags: { 0: { group: "audio" }, 1: { group: "caption" } },
			captionSet,
			captions: DEFAULT_CAPTIONS,
		};
		const parsed = parseLoadedProject(baseDetail({}, input));
		expect(parsed.clips.find((clip) => clip.id === caption.id)).toEqual(caption);
		expect(parsed.captionSet).toEqual(captionSet);
		const stored = storyboardJson(
			"video",
			{ scenes: parsed.scenes },
			{ ...parsed, captions: parsed.captions },
		);
		const restored = parseLoadedProject(baseDetail({}, stored));
		expect(restored.clips.find((clip) => clip.id === caption.id)).toEqual(caption);
		expect(restored.captionSet).toEqual(captionSet);
	});
}

test("explicit empty set remains empty through load and save", () => {
	const parsed = parseLoadedProject(
		baseDetail({}, { schemaVersion: 2, clips: [], markers: [], captionSet }),
	);
	const stored = storyboardJson("video", { scenes: [] }, { ...parsed, captions: parsed.captions });
	const restored = parseLoadedProject(baseDetail({}, stored));
	expect(restored.clips.filter((clip) => clip.type === "caption")).toEqual([]);
	expect(restored.captionSet).toEqual(captionSet);
});
