import { describe, expect, test } from "vite-plus/test";
import { contentOverflowSec, durationModeOf } from "./scene-duration.ts";
import { readStoryboardDocument, writeStoryboardDocument } from "./storyboard-document.ts";
import { toTimelineDoc } from "./timeline-doc.ts";
import { EMPTY_PROJECT_MATERIALS } from "./project-materials.ts";
import { EMPTY_PROJECT_SELECTION } from "./project-selection.ts";
import type { Scene } from "./timeline-model.ts";

const scene = (over: Partial<Scene> = {}): Scene =>
	({
		id: 1,
		name: "Scene 1",
		dur: 5,
		shot: "wide",
		move: "static",
		vis: "",
		vo: "",
		img: false,
		...over,
	}) as Scene;

/** A scene through the persisted document and back, as the editor stores it. */
function roundTrip(s: Scene): Scene {
	const written = writeStoryboardDocument({
		schemaVersion: 2,
		clips: toTimelineDoc([s]).clips,
		markers: [],
		chapters: null,
		bookmarks: null,
		projectReferences: EMPTY_PROJECT_SELECTION,
		materials: EMPTY_PROJECT_MATERIALS,
		captions: null,
		captionSet: null,
		pacingDevices: null,
		infographicStyle: null,
		sceneTextClipMigrationVersion: null,
		trackFlags: null,
		presentation: null,
		unitLifecycle: null,
		artifacts: [],
	});
	const read = readStoryboardDocument(JSON.parse(JSON.stringify(written)));
	return read.doc.clips.find((c) => c.scene)!.scene!;
}

describe("a scene's duration mode is persisted document state", () => {
	test("a pinned scene round-trips as pinned, with its duration", () => {
		const back = roundTrip(scene({ durMode: "pinned", dur: 4 }));
		expect(durationModeOf(back)).toBe("pinned");
		expect(back.dur).toBe(4);
	});

	test("an auto scene round-trips as auto", () => {
		expect(durationModeOf(roundTrip(scene({ durMode: "auto" })))).toBe("auto");
	});

	test("a document written before duration modes existed reads as pinned", () => {
		// Any other default would silently retime every project on its first read.
		const back = roundTrip(scene({ dur: 7 }));
		expect(back.durMode).toBeUndefined();
		expect(durationModeOf(back)).toBe("pinned");
		expect(back.dur).toBe(7);
	});
});

describe("overflow is what a pinned scene reports instead of retiming", () => {
	test("speech longer than a pinned scene overflows by the difference", () => {
		expect(contentOverflowSec(scene({ durMode: "pinned", dur: 4, contentDur: 5.2 }))).toBeCloseTo(
			1.2,
		);
	});

	test("speech that fits does not overflow", () => {
		expect(contentOverflowSec(scene({ durMode: "pinned", dur: 6, contentDur: 5.2 }))).toBe(0);
	});

	test("an auto scene never overflows", () => {
		// Its duration is derived from the content, so there is nothing to exceed.
		expect(contentOverflowSec(scene({ durMode: "auto", dur: 1, contentDur: 99 }))).toBe(0);
	});

	test("nothing measured means nothing to report", () => {
		expect(contentOverflowSec(scene({ durMode: "pinned", dur: 4 }))).toBe(0);
	});

	test("overflow survives the persisted document", () => {
		// The spec asks that it be derivable from what was written, not recomputed
		// from state the reader happens to still hold.
		expect(
			contentOverflowSec(roundTrip(scene({ durMode: "pinned", dur: 4, contentDur: 5.2 }))),
		).toBeCloseTo(1.2);
	});
});
describe("generated-asset input hashes are persisted document state", () => {
	test("both hashes round-trip unchanged", () => {
		const back = roundTrip(scene({ speechInputHash: "speech-abc", frameInputHash: "frame-def" }));
		expect(back.speechInputHash).toBe("speech-abc");
		expect(back.frameInputHash).toBe("frame-def");
	});

	test("a scene with no generated assets carries no hashes", () => {
		const back = roundTrip(scene());
		expect(back.speechInputHash).toBeUndefined();
		expect(back.frameInputHash).toBeUndefined();
	});
});
