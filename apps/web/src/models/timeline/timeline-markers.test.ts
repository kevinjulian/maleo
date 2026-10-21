import { describe, expect, test } from "vite-plus/test";
import { mergeMarkerMetadata, parseMarkers, toTimelineDoc } from "@maleo/shared";
import type { SceneMarker, Scene } from "@maleo/shared";
import { applyCommand, updateMarker } from "@maleo/shared/editor";
import type { EditScope } from "@maleo/shared/editor";
import { storyboardJson } from "@models/storyboard/document-wire.ts";

const scene = (id: number, over: Partial<Scene> = {}): Scene =>
	({ id, name: `Scene ${id}`, dur: 5, vis: "", vo: "", ...over }) as Scene;
const marker = (id: number, over: Partial<SceneMarker> = {}): SceneMarker => ({
	id,
	title: `Scene ${id}`,
	clipIds: [],
	startSec: 0,
	endSec: 5,
	...over,
});

describe("parseMarkers", () => {
	test("parses valid markers and drops malformed entries", () => {
		const parsed = parseMarkers([
			{
				id: 1,
				title: "Hook",
				clipIds: ["scene:1"],
				startSec: 0,
				endSec: 4,
				beat: "hook",
				voiceoverText: "hi",
			},
			{ id: "bad" }, // non-numeric id → dropped
			null, // dropped
			{ id: 2 }, // sparse → defaults
		]);
		expect(parsed).toHaveLength(2);
		expect(parsed[0]).toEqual({
			id: 1,
			title: "Hook",
			clipIds: ["scene:1"],
			startSec: 0,
			endSec: 4,
			beat: "hook",
			voiceoverText: "hi",
		});
		expect(parsed[1]).toMatchObject({
			id: 2,
			title: "Scene 2",
			clipIds: [],
			startSec: 0,
			endSec: 0,
		});
	});
	test("non-array input yields empty", () => {
		expect(parseMarkers(undefined)).toEqual([]);
		expect(parseMarkers(null)).toEqual([]);
		expect(parseMarkers({})).toEqual([]);
	});
});

describe("mergeMarkerMetadata", () => {
	test("overlays persisted title/beat/vo but keeps derived clipIds + range", () => {
		const derived = [
			marker(1, {
				clipIds: ["scene:1"],
				startSec: 10,
				endSec: 15,
				title: "Scene 1",
				beat: undefined,
			}),
		];
		const persisted = [
			marker(1, {
				clipIds: ["stale"],
				startSec: 0,
				endSec: 99,
				title: "Renamed",
				beat: "hook",
				voiceoverText: "vo",
			}),
		];
		const merged = mergeMarkerMetadata(derived, persisted);
		expect(merged[0]).toEqual({
			id: 1,
			title: "Renamed",
			clipIds: ["scene:1"],
			startSec: 10,
			endSec: 15,
			beat: "hook",
			voiceoverText: "vo",
		});
	});
	test("unmatched derived markers pass through; empty persisted is identity", () => {
		const derived = [marker(1), marker(2)];
		expect(mergeMarkerMetadata(derived, [])).toBe(derived);
		expect(mergeMarkerMetadata(derived, [marker(3, { title: "X" })])).toEqual(derived);
	});
});

describe("marker range is derived annotation (D3)", () => {
	test("moving a scene shifts the marker range; marker never retimes clips", () => {
		const at0 = toTimelineDoc([scene(1, { start: 0, dur: 5 })]);
		expect(at0.markers[0]).toMatchObject({ startSec: 0, endSec: 5 });
		const at10 = toTimelineDoc([scene(1, { start: 10, dur: 5 })]);
		expect(at10.markers[0]).toMatchObject({ startSec: 10, endSec: 15 });

		// Editing marker metadata leaves every clip's timing untouched.
		const scope: EditScope = { doc: at10, slides: [], posts: [], mediaAssets: [] };
		const after = applyCommand(scope, updateMarker(1, { title: "Renamed", beat: "hook" }));
		expect(after.doc.clips).toEqual(scope.doc.clips); // clips identical
		expect(after.doc.markers[0]).toMatchObject({
			title: "Renamed",
			beat: "hook",
			startSec: 10,
			endSec: 15,
		});
	});
});

describe("marker load / save round-trip (D3)", () => {
	test("storyboardJson persists provided markers; parseMarkers reads them back", () => {
		const markers = [
			marker(1, {
				title: "Hook",
				clipIds: ["scene:1"],
				startSec: 0,
				endSec: 5,
				beat: "hook",
				voiceoverText: "vo",
			}),
		];
		const json = storyboardJson("video", { scenes: [scene(1)] }, { markers });
		expect(json.markers).toEqual(markers); // persisted, not regenerated
		expect(parseMarkers(json.markers)).toEqual(markers); // loads back identically
	});
	test("absent markers fall back to scene-derived", () => {
		const json = storyboardJson("video", { scenes: [scene(1, { start: 0, dur: 5 })] }, {});
		expect((json.markers as SceneMarker[])[0]).toMatchObject({ id: 1, startSec: 0, endSec: 5 });
	});
});

describe("markers are not chapters", () => {
	test("a document with chapters still carries one marker per scene", () => {
		// Regrouping markers into chapters would change what the vui ruler renders
		// for every existing project. Chapters are their own record; markers are
		// left exactly as they were.
		const scenes = [
			scene(1, { sectionId: "s-a" }),
			scene(2, { sectionId: "s-a" }),
			scene(3, { sectionId: "s-b" }),
		];
		const json = storyboardJson("video", { scenes }, {});
		expect((json.markers as SceneMarker[]).map((m) => m.id)).toEqual([1, 2, 3]);
	});
});

describe("chapters survive the editor's autosave", () => {
	test("a document's chapters are written, not resolved to null", () => {
		/* The write distinguishes "never had chapters" (null, seed them on read)
		 * from "the operator deleted them all" (empty). An omission at a call site
		 * reads as the FIRST — so a caller that forgets to pass them does not write
		 * an empty list, it wipes them and they silently regrow as something else
		 * on the next load. */
		const chapters = [{ id: "s-a", title: "Intro", brief: "Sets the cost." }];
		const json = storyboardJson("video", { scenes: [scene(1)] }, { chapters });
		expect(json.chapters).toEqual(chapters);
	});

	test("a project that never had chapters writes none at all", () => {
		const json = storyboardJson("video", { scenes: [scene(1)] }, { chapters: null });
		expect("chapters" in json).toBe(false);
	});

	test("chapters the operator emptied are written as empty, not omitted", () => {
		const json = storyboardJson("video", { scenes: [scene(1)] }, { chapters: [] });
		expect(json.chapters).toEqual([]);
	});
});
