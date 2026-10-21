import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { toTimelineDoc, mergeMarkerMetadata } from "@maleo/shared";
import {
	parseLoadedProject,
	parseProjectRefs,
	parseProjectSpeakers,
	type LoadedProjectDetail,
} from "./parse-loaded-project.ts";
import { baseDetail } from "./parse-loaded-project.fixtures.ts";

describe("parseLoadedProject · references", () => {
	it("reads the library from entities and the notes from the note table", () => {
		const p = parseLoadedProject({
			...baseDetail({ type: "video" }, { scenes: [] }),
			entities: [
				{
					id: "i1",
					role: "character",
					label: "Hero",
					description: "",
					canonical_image_url: "h.png",
					tags_json: null,
					origin: "generated",
				},
			],
			notes: [{ id: "n1", label: "Tone", body: "warm", tags: [], is_default: 0 }],
		} as never);
		expect(p.projImages.map((i) => i.id)).toEqual(["i1"]);
		expect(p.projImages[0].generated).toBe(true);
		expect(p.projNotes.map((n) => n.id)).toEqual(["n1"]);
		expect(p.projNotes[0].body).toBe("warm");
	});
});

describe("parseProjectRefs · entity model", () => {
	const entities: NonNullable<LoadedProjectDetail["entities"]> = [
		{
			id: "anna",
			role: "character",
			label: "Anna",
			description: "a woman in a red coat",
			imageUrl: "/api/image-gen/files/anna.png",
			tags: ["character"],
			origin: "linked",
			primary: true,
		},
		{
			id: "cafe",
			role: "location",
			label: "Cafe",
			description: "a corner cafe",
			imageUrl: "/api/image-gen/files/cafe.png",
			tags: ["location"],
			origin: "generated",
			primary: false,
		},
	];
	const noteRows: NonNullable<LoadedProjectDetail["notes"]> = [
		{ id: "n1", label: "Tone", body: "warm", tags: ["tone"], isDefault: true },
	];

	it("takes role from the entity column, not from tags or kind", () => {
		const { projImages } = parseProjectRefs(entities, []);
		expect(projImages.map((i) => i.role)).toEqual(["character", "location"]);
	});

	it("carries the description as the ref note", () => {
		expect(parseProjectRefs(entities, []).projImages[0].description).toBe("a woman in a red coat");
	});

	it("maps origin=generated to gen and the lead subject to default", () => {
		const { projImages } = parseProjectRefs(entities, []);
		expect(projImages[0].primary).toBe(true);
		expect(projImages[0].generated).toBe(false);
		expect(projImages[1].generated).toBe(true);
		expect(projImages[1].primary).toBe(false);
	});

	it("carries the entity's tags through unchanged", () => {
		// The role fallback for an entity with no tags now happens once, server-side
		// (see apps/api/src/lib/wire/reference-entity.bun.test.ts).
		const { projImages } = parseProjectRefs(entities, []);
		expect(projImages[0].tags).toEqual(["character"]);
		expect(projImages[1].tags).toEqual(["location"]);
	});

	it("reads notes from the notes table", () => {
		expect(parseProjectRefs(entities, noteRows).projNotes).toEqual([
			{ id: "n1", label: "Tone", body: "warm", tags: ["tone"], default: true },
		]);
	});

	it("returns empty for a project with no entities", () => {
		// There is no legacy fallback any more: content_references is gone, and a
		// project with no selected entities simply has an empty library.
		expect(parseProjectRefs([], [])).toEqual({ projImages: [], projNotes: [] });
		expect(parseProjectRefs(undefined, undefined)).toEqual({ projImages: [], projNotes: [] });
	});

	it("cannot surface a non-castable row — castability is the entity's role", () => {
		// The old reader carried a per-consumer exclusion list for note/audio/research
		// rows. Those kinds cannot exist here: an entity's role is constrained, and
		// notes live in their own table.
		const { projImages } = parseProjectRefs(entities, noteRows);
		expect(
			projImages.every((i) =>
				["style", "character", "location", "product", "prop"].includes(i.role!),
			),
		).toBe(true);
	});
});

describe("parseLoadedProject · clip-native seed (5.3)", () => {
	// The load now hands the store ready-to-seed `clips` + merged `markers` (parse is the
	// single load-time array→clip boundary). Prove that seed is BYTE-IDENTICAL to the
	// prior CreateContent `toTimelineDoc(...) + mergeMarkerMetadata` projection.
	const v2Storyboard = {
		schemaVersion: 2,
		sceneTextClipMigrationVersion: 5,
		clips: [
			{
				id: "scene:1",
				type: "image",
				startSec: 0,
				durationSec: 4,
				track: 0,
				markerId: 1,
				customField: "keep-me",
				scene: {
					id: 1,
					dur: 4,
					name: "Open",
					shot: "Medium Shot",
					move: "Static",
					transition: "fade",
					vis: "desk",
					vo: "hello",
					src: "a.png",
					img: true,
				},
			},
			{
				id: "scene:2",
				type: "image",
				startSec: 4,
				durationSec: 3,
				track: 0,
				markerId: 2,
				scene: {
					id: 2,
					dur: 3,
					name: "Beat",
					shot: "Wide Shot",
					move: "Static",
					transition: "cut",
					vis: "sky",
					vo: "world",
					src: "b.png",
					img: true,
				},
			},
			{
				id: "audio:9",
				type: "audio",
				startSec: 1,
				durationSec: 2,
				track: 1,
				audio: { id: 9, kind: "music", url: "m.mp3", start: 1, dur: 2, content: "" },
			},
			{
				id: "text:5",
				type: "text",
				startSec: 0,
				durationSec: 2,
				track: 2,
				text: { id: 5, content: "Title", start: 0, dur: 2, preset: "title", track: 2 },
			},
		],
		markers: [
			{
				id: 1,
				title: "Custom title",
				clipIds: ["scene:1"],
				startSec: 0,
				endSec: 4,
				beat: "hook",
				voiceoverText: "hello",
			},
		],
	};

	it("v2 load seeds canonical clips verbatim from the persisted doc (no lossy round-trip)", () => {
		const p = parseLoadedProject(baseDetail({ type: "video" }, v2Storyboard));
		// Canonical-doc load parity: clips are the PERSISTED doc, NOT a re-projection
		// through the legacy scene/overlay arrays (which would drop clip-native fields).
		expect(p.clips).toEqual(v2Storyboard.clips as unknown as typeof p.clips);
		// A clip field the legacy Scene shape doesn't model survives the load.
		const scene1 = p.clips.find((c) => c.id === "scene:1") as Record<string, unknown> | undefined;
		expect(scene1?.customField).toBe("keep-me");
		// Persisted marker metadata is preserved (parsed straight from the doc).
		expect(p.markers[0]).toMatchObject({
			id: 1,
			title: "Custom title",
			beat: "hook",
			voiceoverText: "hello",
		});
	});

	it("legacy V1 seed clips equal the toTimelineDoc reference", () => {
		const p = parseLoadedProject(
			baseDetail(
				{ type: "video" },
				{
					scenes: [
						{
							key: "s1",
							name: "One",
							duration_sec: 5,
							image: "x.png",
							shot: "Medium Shot",
							movement: "Static",
							transition: "fade",
							voiceover: "hi",
						},
						{
							key: "s2",
							name: "Two",
							duration_sec: 4,
							image: "y.png",
							shot: "Wide Shot",
							movement: "Static",
							transition: "cut",
							voiceover: "yo",
						},
					],
				},
			),
		);
		const reference = toTimelineDoc(
			p.scenes,
			p.videoOverlays,
			p.overlays,
			p.audioOverlays,
			p.effects,
			p.transitions,
			p.projectReferences,
			p.infographicOverlays,
		);
		expect(p.clips).toEqual(reference.clips);
		expect(p.markers).toEqual(mergeMarkerMetadata(reference.markers, []));
	});
});

describe("parseProjectSpeakers (speaker store, not reference rows)", () => {
	it("reads the project's speakers, default first flagged", () => {
		const speakers = parseProjectSpeakers([
			{ voiceKey: "Kore", name: "Narrator", hue: 210, isDefault: true },
			{ voiceKey: "Puck", name: "Guest", hue: null, isDefault: false },
		]);
		expect(speakers).toEqual([
			{ id: "Kore", name: "Narrator", voiceId: "Kore", hue: 210, default: true },
			{ id: "Puck", name: "Guest", voiceId: "Puck", hue: undefined, default: false },
		]);
	});
	it("returns empty when a project has no speakers", () => {
		expect(parseProjectSpeakers(undefined)).toEqual([]);
		expect(parseProjectSpeakers([])).toEqual([]);
	});
});

describe("a loaded project's own notes and speakers replace the starter set", () => {
	// INIT_REFS seeds four notes (n-tone / n-pal / n-music / n-hook) for a blank
	// project. The entity migration re-keyed the persisted copies with UUIDs, so a
	// merge-by-id could no longer collide them and every note rendered twice.
	it("keeps the seed only when the project has none of its own", () => {
		// The merge moved out of the container with the reference group; the rule it
		// encodes did not.
		const source = readFileSync(
			`${import.meta.dirname}/../../hooks/editor/use-reference-library.ts`,
			"utf8",
		);
		expect(source).toContain("notes: loaded.projNotes.length ? loaded.projNotes : prev.notes");
		expect(source).toContain(
			"speakers: loaded.projSpeakers.length ? loaded.projSpeakers : prev.speakers",
		);
		expect(source).not.toContain("mergeById(prev.notes, loaded.projNotes)");
	});
});

/* The placement test, applied to the two fields that failed it.
 *
 * Track visibility and the render-affecting settings decide what a render
 * CONTAINS, but they lived only in `editor_state_json` -- one overwritten cell
 * with no history -- while the render filtered clips by them. So restoring
 * storyboard version N rendered differently depending on WHEN it was restored:
 * whatever the desk happened to hold at that moment won. */
