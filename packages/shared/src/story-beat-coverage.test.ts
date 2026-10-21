import { describe, expect, it } from "vite-plus/test";
import { storyBeatCoverageError, storyBeatCoverageViolations } from "./story-beat-coverage.ts";
import { beatVisualIntentSchema, type BeatVisualIntent } from "./beat-visual-intent.ts";
import { storyBibleSchema } from "./story-bible.ts";

const BIBLE = storyBibleSchema.parse({
	subjects: [
		{ id: "worker-bee", label: "worker bee", aliases: ["lebah pekerja", "aku"] },
		{ id: "queen", label: "queen bee", aliases: ["ratu"] },
	],
	locations: [{ id: "hive", label: "honeycomb interior" }],
});

const intent = (over: Record<string, unknown> = {}): BeatVisualIntent =>
	beatVisualIntentSchema.parse({
		beatIndex: 0,
		subjectIds: ["worker-bee"],
		locationId: "hive",
		visualMoment: "the wax cap lifting",
		shotType: "extreme macro",
		...over,
	});

const beat = (over: Record<string, unknown> = {}, text = "") => ({ intent: intent(over), text });

describe("invariant 1: cast is a subset of the bible", () => {
	it("reports a subject id the bible never declared", () => {
		const violations = storyBeatCoverageViolations({
			bible: BIBLE,
			beats: [
				beat(),
				beat({ beatIndex: 1, visualMoment: "a drone arrives", subjectIds: ["drone"] }),
			],
		});
		expect(violations.map((v) => v.invariant)).toEqual(["cast_in_bible"]);
		expect(violations[0]!.detail).toContain("drone");
	});

	it("passes when every subject is declared", () => {
		expect(
			storyBeatCoverageViolations({
				bible: BIBLE,
				beats: [
					beat(),
					beat({ beatIndex: 1, visualMoment: "the queen turns", subjectIds: ["queen"] }),
				],
			}),
		).toEqual([]);
	});

	it("is not applicable without a bible", () => {
		expect(
			storyBeatCoverageViolations({
				beats: [beat({ subjectIds: ["anything"] })],
			}),
		).toEqual([]);
	});
});

describe("invariant 2: adjacent beats differ", () => {
	it("reports two beats that would render the same picture", () => {
		const violations = storyBeatCoverageViolations({
			bible: BIBLE,
			beats: [beat(), beat({ beatIndex: 1 })],
		});
		expect(violations.map((v) => v.invariant)).toEqual(["adjacent_differ"]);
		expect(violations[0]!.detail).toContain("0/1");
	});

	it("passes when the camera alone changes", () => {
		expect(
			storyBeatCoverageViolations({
				bible: BIBLE,
				beats: [beat(), beat({ beatIndex: 1, shotType: "wide establishing" })],
			}),
		).toEqual([]);
	});

	it("is not fooled by a differing mood, which does not change the picture", () => {
		const violations = storyBeatCoverageViolations({
			bible: BIBLE,
			beats: [beat(), beat({ beatIndex: 1, mood: "tense" })],
		});
		expect(violations.map((v) => v.invariant)).toEqual(["adjacent_differ"]);
	});
});

describe("invariant 3: approved intent reaches the beats", () => {
	it("uses exact binding coverage for directed plans", () => {
		const violations = storyBeatCoverageViolations({
			bible: BIBLE,
			approvedBindings: [{ entityId: "bee" }, { plannedKey: "hive-ref" }],
			beats: [beat({ referenceBindings: [{ entityId: "bee" }] })],
		});
		expect(violations.map((v) => v.invariant)).toContain("reference_binding_coverage");
		expect(violations.find((v) => v.invariant === "reference_binding_coverage")?.detail).toContain(
			"planned:hive-ref",
		);
	});

	it("rejects a beat binding outside the approved set", () => {
		const violations = storyBeatCoverageViolations({
			approvedBindings: [{ entityId: "bee" }],
			beats: [beat({ referenceBindings: [{ entityId: "intruder" }] })],
		});
		expect(violations.map((v) => v.invariant)).toEqual([
			"reference_binding_subset",
			"reference_binding_coverage",
		]);
	});

	it("resolves planned keys through materialization and catches detached entities", () => {
		const base = {
			beats: [beat({ referenceBindings: [{ plannedKey: "hive-ref" }] })],
			approvedBindings: [{ plannedKey: "hive-ref" }],
			materializedByKey: { "hive-ref": "entity-hive" },
		};
		expect(storyBeatCoverageViolations({ ...base, rosterEntityIds: ["entity-hive"] })).toEqual([]);
		expect(
			storyBeatCoverageViolations({ ...base, rosterEntityIds: [] }).map((v) => v.invariant),
		).toEqual(["reference_detached"]);
	});

	it("catches a detached direct binding before measured beats exist", () => {
		const violations = storyBeatCoverageViolations({
			beats: [],
			approvedBindings: [{ entityId: "detached" }],
			rosterEntityIds: [],
		});
		expect(violations.map((v) => v.invariant)).toEqual(["reference_detached"]);
	});

	it("reports a subject an approved shot names that no beat carries", () => {
		const violations = storyBeatCoverageViolations({
			bible: BIBLE,
			beats: [beat()],
			plannedShots: ["Ratu menunggu di ruang dalam"],
		});
		expect(violations.map((v) => v.invariant)).toEqual(["planned_shot_coverage"]);
		expect(violations[0]!.detail).toContain("queen");
	});

	// The case the old count check failed on: measured audio yields fewer beats than
	// the planner approved shots, and authoring merged the intent across them.
	it("passes with more approved shots than beats when their subjects are covered", () => {
		expect(
			storyBeatCoverageViolations({
				bible: BIBLE,
				beats: [beat()],
				plannedShots: [
					"Aku merayap ke sel lilin",
					"aku mendekati tutupnya",
					"lebah pekerja di tepi sarang",
				],
			}),
		).toEqual([]);
	});

	it("passes with fewer approved shots than beats", () => {
		expect(
			storyBeatCoverageViolations({
				bible: BIBLE,
				beats: [beat(), beat({ beatIndex: 1, visualMoment: "antennae meeting" })],
				plannedShots: ["Aku merayap ke sel lilin"],
			}),
		).toEqual([]);
	});

	it("requires nothing of a shot that names no bible subject", () => {
		expect(
			storyBeatCoverageViolations({
				bible: BIBLE,
				beats: [beat()],
				plannedShots: ["a wide field of clover at dawn", "   ", ""],
			}),
		).toEqual([]);
	});

	it("is not applicable without a bible", () => {
		expect(
			storyBeatCoverageViolations({
				beats: [beat()],
				plannedShots: ["Ratu menunggu", "shot two", "shot three", "shot four"],
			}),
		).toEqual([]);
	});
});

describe("invariant 4: narration names a subject the beat casts", () => {
	it("reports a beat whose narration names a subject its cast omits", () => {
		const violations = storyBeatCoverageViolations({
			bible: BIBLE,
			beats: [
				beat({}, "Aku mendekat."),
				beat({ beatIndex: 1, visualMoment: "the chamber beyond" }, "Ratu menunggu di dalam."),
			],
		});
		expect(violations.map((v) => v.invariant)).toEqual(["narration_names_subject"]);
		expect(violations[0]!.detail).toContain("1");
	});

	it("passes when the named subject is cast", () => {
		expect(
			storyBeatCoverageViolations({
				bible: BIBLE,
				beats: [
					beat({}, "Aku mendekat."),
					beat(
						{ beatIndex: 1, visualMoment: "the chamber beyond", subjectIds: ["queen"] },
						"Ratu menunggu di dalam.",
					),
				],
			}),
		).toEqual([]);
	});

	it("does not skip a section whose author omitted every subject", () => {
		const violations = storyBeatCoverageViolations({
			bible: BIBLE,
			beats: [beat({ subjectIds: [] }, "Ratu menunggu di dalam.")],
		});
		expect(violations.map((violation) => violation.invariant)).toEqual(["narration_names_subject"]);
	});

	it("passes when the narration names no subject at all", () => {
		expect(
			storyBeatCoverageViolations({
				bible: BIBLE,
				beats: [beat({}, "Cahaya pagi masuk perlahan.")],
			}),
		).toEqual([]);
	});
});

describe("reporting", () => {
	it("names every violated invariant in one line", () => {
		const violations = storyBeatCoverageViolations({
			bible: BIBLE,
			beats: [beat({ subjectIds: ["drone"] }), beat({ beatIndex: 1, subjectIds: ["drone"] })],
			plannedShots: ["Ratu menunggu di ruang dalam"],
		});
		const line = storyBeatCoverageError(violations);
		expect(line).toContain("cast_in_bible");
		expect(line).toContain("adjacent_differ");
		expect(line).toContain("planned_shot_coverage");
	});

	it("reports nothing for an empty section", () => {
		expect(storyBeatCoverageViolations({ bible: BIBLE, beats: [] })).toEqual([]);
	});
});
