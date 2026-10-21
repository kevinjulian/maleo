/* The golden corpus: every persisted generation loads to what it loads to today.
 *
 * `declare-storyboard-document` moves the document readers out of this package and
 * into one owning module in `@maleo/shared`. The readers being moved encode
 * migration behaviour that no requirement documents — which spellings of the
 * legacy arrays are accepted, what a missing field falls back to, how scenes seed
 * clips — and the existing tests for this area lean on `readFileSync` source
 * assertions that pass on broken behaviour.
 *
 * So the refactor is gated on output, not on shape: these snapshots are taken
 * BEFORE anything moves, and the move is correct exactly when they do not change.
 * If one moves, the move was not verbatim. Fix the move; do not re-baseline.
 *
 * Fixtures are real documents from a development database, redacted. See
 * `fixtures/README.md`. */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { parseLoadedProject, type LoadedProjectDetail } from "./parse-loaded-project.ts";
import { storyboardJson } from "./document-wire.ts";

const corpus = JSON.parse(
	readFileSync(
		new URL("../../../../../fixtures/persisted-storyboards.json", import.meta.url),
		"utf8",
	),
) as Record<string, Record<string, unknown>>;

/** The smallest detail payload that carries one storyboard, so the snapshot is of
 *  the document readers rather than of the project row. */
function detailFor(storyboard: Record<string, unknown>): LoadedProjectDetail {
	return {
		project: {
			id: "corpus-project",
			title: "Corpus",
			type: "video",
			target_audience: null,
			target_duration_sec: 30,
			target_format: "9:16",
			target_platform: null,
			brief_json: { goal: "a goal", style_preset: null },
			reference_notes: null,
			editor_state_json: null,
		},
		storyboards: [{ storyboard_json: storyboard as never }],
		entities: [],
		notes: [],
		speakers: [],
	};
}

/* Snapshot the decoded document, not the whole ParsedProject: config and the
 * reference splits come from the project row and the entity tables, which this
 * change does not touch. */
function documentShapeOf(storyboard: Record<string, unknown>) {
	const parsed = parseLoadedProject(detailFor(storyboard));
	return {
		clips: parsed.clips,
		markers: parsed.markers,
		scenes: parsed.scenes,
		overlays: parsed.overlays,
		audioOverlays: parsed.audioOverlays,
		videoOverlays: parsed.videoOverlays,
		infographicOverlays: parsed.infographicOverlays,
		effects: parsed.effects,
		transitions: parsed.transitions,
		projectReferences: parsed.projectReferences,
		captions: parsed.captions,
		pacingDevices: parsed.pacingDevices,
		infographicStyle: parsed.infographicStyle,
		mediaAssets: parsed.mediaAssets,
	};
}

describe("every persisted generation loads unchanged", () => {
	test("the corpus covers the generations in the data", () => {
		expect(Object.keys(corpus).sort()).toEqual([
			"preV2Full",
			"preV2Minimal",
			"preV2Snake",
			"v2",
			"v2Flat",
		]);
	});

	for (const name of Object.keys(corpus)) {
		test(`${name} loads to its baseline`, () => {
			expect(documentShapeOf(corpus[name]!)).toMatchSnapshot();
		});
	}

	/* Properties worth stating outright, so a regression names itself rather than
	 * showing up as a diff in a large snapshot. */
	test("a clip-first document seeds clips directly", () => {
		const parsed = parseLoadedProject(detailFor(corpus.v2!));
		expect(parsed.clips.length).toBeGreaterThan(0);
	});

	test("a legacy document is migrated into clips rather than dropped", () => {
		const parsed = parseLoadedProject(detailFor(corpus.preV2Full!));
		expect(parsed.scenes.length).toBeGreaterThan(0);
	});

	test("a flat selection survives the load", () => {
		const parsed = parseLoadedProject(detailFor(corpus.v2Flat!));
		expect(Array.isArray(parsed.projectReferences.entityIds)).toBe(true);
	});

	test("the oldest shape loads to empty rather than throwing", () => {
		expect(() => parseLoadedProject(detailFor(corpus.preV2Minimal!))).not.toThrow();
	});
});

/* The write half of the same corpus.
 *
 * The spec requires the persisted payload to be byte-identical across this change,
 * so what the editor writes today is pinned here and compared after the writer
 * moves into the shared module. Loading and writing back is also the round trip
 * the document contract has to preserve: a document that survives one pass through
 * the editor without changing is the property that keeps the agent and the editor
 * agreeing about the same bytes. */
describe("what the editor writes for a loaded document", () => {
	for (const name of Object.keys(corpus)) {
		test(`${name} writes to its baseline`, () => {
			const parsed = parseLoadedProject(detailFor(corpus[name]!));
			const written = storyboardJson(
				"video",
				{ scenes: parsed.scenes },
				{
					clips: parsed.clips,
					markers: parsed.markers,
					overlays: parsed.overlays,
					audioOverlays: parsed.audioOverlays,
					videoOverlays: parsed.videoOverlays,
					infographicOverlays: parsed.infographicOverlays,
					effects: parsed.effects,
					transitions: parsed.transitions,
					captions: parsed.captions,
					pacingDevices: parsed.pacingDevices,
					infographicStyle: parsed.infographicStyle,
					projectReferences: parsed.projectReferences,
				},
			);
			expect(written).toMatchSnapshot();
		});
	}

	/* The first pass is NOT identity, and that is correct: loading fills in what an
	 * older writer omitted — a v2 clip from before markers were first-class comes
	 * back carrying `markerId`, `refIds` and `useGlobalReferences`. Asserting
	 * `write(load(x)) === x` would be asserting that the migration does nothing.
	 *
	 * The property that has to hold, and the one the document contract must keep,
	 * is that the SECOND pass changes nothing. A document that keeps growing on
	 * every save is how two writers drift apart. */
	test("writing a document is idempotent after the first load", () => {
		const roundTrip = (doc: Record<string, unknown>): Record<string, unknown> => {
			const parsed = parseLoadedProject(detailFor(doc));
			return storyboardJson(
				"video",
				{ scenes: parsed.scenes },
				{
					clips: parsed.clips,
					markers: parsed.markers,
					captions: parsed.captions,
					pacingDevices: parsed.pacingDevices,
					infographicStyle: parsed.infographicStyle,
					projectReferences: parsed.projectReferences,
				},
			) as Record<string, unknown>;
		};

		for (const name of Object.keys(corpus)) {
			const once = roundTrip(corpus[name]!);
			const twice = roundTrip(once);
			expect({ [name]: twice }).toEqual({ [name]: once });
		}
	});
});
