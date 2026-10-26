/* The read absorbs everything on disk and never throws.
 *
 * Documents written by three generations are in production and the write path
 * swallows its own failures, so a malformed document can reach storage with no
 * signal. These run against the real corpus in `fixtures/` — redacted documents
 * sampled from a development database — plus the degradation cases the
 * requirement names. */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { EMPTY_PROJECT_MATERIALS } from "./project-materials.ts";
import {
	readStoryboardDocument,
	writeStoryboardDocument,
	SCENE_TEXT_CLIP_MIGRATION_VERSION,
	type StoryboardDocument,
} from "./storyboard-document.ts";

const corpus = JSON.parse(
	readFileSync(new URL("../../../fixtures/persisted-storyboards.json", import.meta.url), "utf8"),
) as Record<string, Record<string, unknown>>;

describe("reading the corpus", () => {
	test("legacy source in-points load explicitly while absent fields keep forward 1x compatibility", () => {
		const { legacyArrays } = readStoryboardDocument({
			video_overlays: [
				{
					url: "source.mp4",
					kind: "video",
					media_start_sec: 3,
					layout: { playbackRate: 0.25, reverse: true },
				},
				{
					url: "legacy.mp4",
					kind: "video",
				},
			],
			audio_overlays: [{ url: "voice.m4a", kind: "voiceover", media_start_sec: 2 }],
		});
		expect(legacyArrays.videoOverlays[0]?.mediaStartSec).toBe(3);
		expect(legacyArrays.videoOverlays[0]?.layout).toMatchObject({
			playbackRate: 0.25,
			reverse: true,
		});
		expect(legacyArrays.videoOverlays[1]?.mediaStartSec).toBeUndefined();
		expect(legacyArrays.videoOverlays[1]?.layout).toBeUndefined();
		expect(legacyArrays.audioOverlays[0]?.mediaStartSec).toBe(2);
	});
	for (const name of Object.keys(corpus)) {
		test(`${name} reads without throwing`, () => {
			expect(() => readStoryboardDocument(corpus[name]!)).not.toThrow();
		});
	}

	test("a clip-first document keeps its clips and markers", () => {
		const { doc, diagnostic } = readStoryboardDocument(corpus.v2!);
		expect(doc.schemaVersion).toBe(2);
		// The corpus predates the infographic removal; the read drops those clips.
		const stored = corpus.v2!.clips as Array<{ type?: string }>;
		expect(doc.clips.length).toBe(stored.filter((clip) => clip.type !== "infographic").length);
		expect(diagnostic.legacy).toBe(false);
	});

	/* The corpus's flat document happens to carry an empty selection, so assert the
	 * decode rule rather than the fixture's contents: the flat shape is read as
	 * itself, and a populated one keeps its ids and its prompt. */
	test("a flat selection is read as a selection", () => {
		const { doc } = readStoryboardDocument(corpus.v2Flat!);
		expect(doc.projectReferences).toEqual({ prompt: "", entityIds: [] });
	});

	test("a populated selection keeps its ids and prompt", () => {
		const { doc } = readStoryboardDocument({
			...corpus.v2Flat!,
			projectReferences: { prompt: "a look", entityIds: ["anna", "anna", "mug"] },
		});
		expect(doc.projectReferences).toEqual({ prompt: "a look", entityIds: ["anna", "mug"] });
	});

	test("a legacy document reports itself and decodes its arrays", () => {
		const { doc, legacyArrays, diagnostic } = readStoryboardDocument(corpus.preV2Full!);
		expect(diagnostic.legacy).toBe(true);
		expect(doc.clips).toEqual([]);
		expect(legacyArrays.scenes.length).toBeGreaterThan(0);
	});

	/* The corpus carries `media_assets` and `chat` from when editor state lived in
	 * the storyboard. They are known input, not junk — reporting them as unknown
	 * would train the reader to ignore the diagnostic. */
	test("nothing in the corpus is reported as an unknown key", () => {
		for (const name of Object.keys(corpus)) {
			expect({ [name]: readStoryboardDocument(corpus[name]!).diagnostic.unknownKeys }).toEqual({
				[name]: [],
			});
		}
	});

	test("a key the document does not declare is named", () => {
		const { diagnostic } = readStoryboardDocument({ ...corpus.v2!, somethingNew: 1 });
		expect(diagnostic.unknownKeys).toEqual(["somethingNew"]);
	});
});

describe("the read degrades rather than raising", () => {
	const empty = { schemaVersion: 2, clips: [], markers: [] };

	for (const [label, input] of [
		["null", null],
		["undefined", undefined],
		["a string", "not a document"],
		["a number", 42],
		["an array", [1, 2, 3]],
		["an empty object", {}],
		["clips that are not an array", { schemaVersion: 2, clips: "nope" }],
		["markers that are not an array", { schemaVersion: 2, clips: [], markers: 7 }],
		["a null projectReferences", { schemaVersion: 2, clips: [], projectReferences: null }],
		["captions of the wrong type", { schemaVersion: 2, clips: [], captions: "big" }],
	] as Array<[string, unknown]>) {
		test(`${label} reads to a usable document`, () => {
			const { doc } = readStoryboardDocument(input);
			expect(doc.schemaVersion).toBe(2);
			expect(Array.isArray(doc.clips)).toBe(true);
			expect(Array.isArray(doc.markers)).toBe(true);
			expect(doc.projectReferences.entityIds).toEqual([]);
			// Null, not a default: the document stores what was persisted.
			expect(doc.captions).toBeNull();
		});
	}

	test("a document with no schemaVersion still reads", () => {
		const { doc } = readStoryboardDocument({ scenes: [], outline: "x" });
		expect(doc.schemaVersion).toBe(2);
	});

	test("what fell back to a default is named", () => {
		expect(readStoryboardDocument({}).diagnostic.defaulted).toContain("clips");
		expect(readStoryboardDocument(empty).diagnostic.defaulted).not.toContain("clips");
	});
});

describe("the write emits the whole document", () => {
	test("every declared field is present", () => {
		const { doc } = readStoryboardDocument(corpus.v2!);
		const written = writeStoryboardDocument(doc);

		for (const key of [
			"schemaVersion",
			"clips",
			"markers",
			"projectReferences",
			"captions",
			"pacingDevices",
			"sceneTextClipMigrationVersion",
			"trackFlags",
			"presentation",
		]) {
			expect({ key, present: key in written }).toEqual({ key, present: true });
		}
	});

	/* The bookkeeping the agent owns has to survive a writer that does not own it —
	 * that is the whole point of a total write, and the exact thing the two
	 * hand-maintained carry-forwards were doing by hand. */
	test("agent bookkeeping is carried through, not dropped", () => {
		const generationState = {
			planId: "plan-opaque",
			draft: {
				revisionId: "draft-2",
				sections: [
					{
						id: "section-opaque",
						title: "One",
						beats: [
							{ id: "beat-opaque", title: "One", narration: "Draft", visualPrompt: "Draft visual" },
						],
					},
				],
			},
			approvedSnapshot: {
				revisionId: "approved-1",
				sections: [
					{
						id: "section-opaque",
						title: "One",
						beats: [
							{
								id: "beat-opaque",
								title: "One",
								narration: "Approved",
								visualPrompt: "Approved visual",
							},
						],
					},
				],
				approvalMode: "explicit",
				extensionPolicy: "review_additions",
				approvedAt: "2026-09-11T00:00:00.000Z",
			},
		};
		const { doc } = readStoryboardDocument({
			...corpus.v2!,
			unit_lifecycle: { a: 1 },
			artifacts: [{ kind: "story_plan", generationState }],
		});
		const before = JSON.stringify(doc.artifacts);
		doc.clips[0]!.startSec += 7;
		const written = writeStoryboardDocument(doc) as Record<string, unknown>;

		expect(written.unit_lifecycle).toEqual({ a: 1 });
		expect(JSON.stringify(written.artifacts)).toBe(before);
		expect(readStoryboardDocument(written).doc.artifacts).toEqual([
			{ kind: "story_plan", generationState },
		]);
	});

	test("absent bookkeeping is omitted rather than written as null", () => {
		const written = writeStoryboardDocument(readStoryboardDocument(corpus.v2Flat!).doc);
		expect("unit_lifecycle" in written).toBe(false);
	});

	/* Lane groups are the one part of `trackFlags` that decides LAYOUT rather than
	 * render content, and a document that loses them cannot describe its own
	 * timeline. The flags travel as an opaque object, so this asserts the property
	 * that makes that safe rather than a shape the writer restates. */
	test("lane groups round-trip with the document", () => {
		const trackFlags = {
			"-1": { hidden: true },
			0: { group: "visual" as const },
			1: { muted: true, group: "audio" as const },
		};
		const { doc } = readStoryboardDocument({ ...corpus.v2!, trackFlags });
		expect(doc.trackFlags).toEqual(trackFlags);
		const reread = readStoryboardDocument(writeStoryboardDocument(doc));
		expect(reread.doc.trackFlags).toEqual(trackFlags);
	});

	test("visual reveal metadata round-trips with clips and Auto omits duration", () => {
		const { doc } = readStoryboardDocument({
			schemaVersion: 2,
			clips: [
				{
					id: "video:10",
					type: "image",
					startSec: 0,
					durationSec: 5,
					track: 0,
					video: {
						id: 10,
						url: "board.png",
						kind: "image",
						start: 0,
						dur: 5,
						reveal: {
							type: "wipe",
							direction: "left",
							phase: "dark_pixels_first",
							texture: "paper",
							colorBuild: "muted_to_full",
						},
					},
				},
			],
			markers: [],
		});
		const reveal = doc.clips[0]?.video?.reveal;
		expect(reveal).toEqual({
			type: "wipe",
			direction: "left",
			phase: "dark_pixels_first",
			texture: "paper",
			colorBuild: "muted_to_full",
		});
		expect(reveal).not.toHaveProperty("durationSec");
		const reread = readStoryboardDocument(writeStoryboardDocument(doc));
		expect(reread.doc.clips[0]?.video?.reveal).toEqual({
			type: "wipe",
			direction: "left",
			phase: "dark_pixels_first",
			texture: "paper",
			colorBuild: "muted_to_full",
		});
	});

	test("historical clips default to no reveal metadata", () => {
		const { doc } = readStoryboardDocument({
			schemaVersion: 2,
			clips: [
				{
					id: "video:10",
					type: "image",
					startSec: 0,
					durationSec: 5,
					track: 0,
					video: { id: 10, url: "plain.png", kind: "image", start: 0, dur: 5 },
				},
			],
			markers: [],
		});
		expect(doc.clips[0]?.video?.reveal).toBeUndefined();
	});

	test("reading what was written changes nothing", () => {
		for (const name of Object.keys(corpus)) {
			const once = writeStoryboardDocument(readStoryboardDocument(corpus[name]!).doc);
			const twice = writeStoryboardDocument(readStoryboardDocument(once).doc);
			expect({ [name]: twice }).toEqual({ [name]: once });
		}
	});
});

/* The defect this contract exists to kill.
 *
 * Two writers each patched around fields they did not hold — the agent spread four
 * named keys off the previous document, the save route re-attached artifacts —
 * and neither knew about the other. A field added on one side was dropped by the
 * other's next write, with no type error and no failing test.
 *
 * A total write makes that a compile error instead. This is asserted at the type
 * level rather than described in a comment, because a comment would not have
 * caught it either. */
describe("a writer cannot silently omit a field", () => {
	test("the document type has no optional fields", () => {
		// Every key is required, so `writeStoryboardDocument({...})` fails to compile
		// for a writer that leaves one out. If a field is ever made optional, absence
		// starts meaning "not mine" again and the drop comes back.
		type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];
		type OptionalOnDocument = RequiredKeys<StoryboardDocument>;

		// `never` means nothing is optional. This line stops compiling if one is added.
		const noOptionalFields: OptionalOnDocument extends never ? true : false = true;
		expect(noOptionalFields).toBe(true);
	});

	test("a document assembled by hand carries every field the writer emits", () => {
		const doc: StoryboardDocument = {
			schemaVersion: 2,
			clips: [],
			markers: [],
			chapters: null,
			bookmarks: null,
			projectReferences: { prompt: "", entityIds: [] },
			materials: EMPTY_PROJECT_MATERIALS,
			captions: null,
			captionSet: null,
			pacingDevices: null,
			sceneTextClipMigrationVersion: SCENE_TEXT_CLIP_MIGRATION_VERSION,
			trackFlags: null,
			presentation: null,
			unitLifecycle: null,
			artifacts: [],
		};
		const written = writeStoryboardDocument(doc);

		// The editor-owned fields are written even when null, so "absent" is a
		// recorded decision rather than a field the next writer has to guess at.
		expect("captions" in written).toBe(true);
		expect("pacingDevices" in written).toBe(true);
		// Same for the render-affecting presentation: a version that rendered with no
		// hidden tracks says so, rather than leaving the next reader to infer it.
		expect("trackFlags" in written).toBe(true);
		expect("presentation" in written).toBe(true);
	});
});

describe("the read drops stored infographic content", () => {
	const empty = { schemaVersion: 2, clips: [], markers: [] };
	const textClip = {
		id: "text:1",
		type: "text",
		startSec: 0,
		durationSec: 2,
		track: 0,
		text: { id: 1, content: "Hello", start: 0, dur: 2, preset: "plain", track: 0 },
	};
	const infographicClip = (id: number, track: number) => ({
		id: `infographic:${id}`,
		type: "infographic",
		startSec: id,
		durationSec: 2,
		track,
		infographic: {
			id,
			start: id,
			dur: 2,
			payload: { type: "stat_reveal", title: "T", value: "4" },
		},
	});
	const stored = {
		...empty,
		clips: [textClip, infographicClip(7, 1), infographicClip(8, 1)],
		infographicStyle: { bgColor: "#000000" },
		infographicOverlays: [],
		trackFlags: { 0: { group: "text" }, 1: { group: "data" } },
	};

	test("a stored document reads without its infographic clips and style", () => {
		const { doc, diagnostic } = readStoryboardDocument(stored);

		expect(doc.clips.map((clip) => clip.id)).toEqual(["text:1"]);
		expect(doc.clips[0]).toEqual(textClip);
		expect(doc).not.toHaveProperty("infographicStyle");
		expect(doc.trackFlags).toEqual({ 0: { group: "text" } });
		expect(diagnostic.dropped).toEqual(
			expect.arrayContaining([
				"clips[infographic:7]",
				"clips[infographic:8]",
				"infographicStyle",
				"infographicOverlays",
				"trackFlags[1]",
			]),
		);
		expect(diagnostic.unknownKeys).toEqual([]);
	});

	test("the write of that read emits no infographic content", () => {
		const written = writeStoryboardDocument(readStoryboardDocument(stored).doc);

		expect(JSON.stringify(written)).not.toMatch(/infographic/i);
		expect(written.trackFlags).toEqual({ 0: { group: "text" } });
	});

	test("a stored scene drops its motion-graphic decision", () => {
		const sceneClip = {
			id: "scene:1",
			type: "image",
			startSec: 0,
			durationSec: 3,
			track: -1,
			scene: { id: 1, name: "One", motionGraphic: { needed: true, kind: "stat_reveal" } },
		};
		const { doc, diagnostic } = readStoryboardDocument({ ...empty, clips: [sceneClip] });

		expect(doc.clips[0]?.scene).not.toHaveProperty("motionGraphic");
		expect(diagnostic.dropped).toEqual(["clips[scene:1].scene.motionGraphic"]);
	});
});
