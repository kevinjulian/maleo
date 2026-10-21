import { describe, expect, test } from "vite-plus/test";
import {
	bindingIdentity,
	collapsePlannedReferenceToRoster,
	storyPlannedShotDirectionSchema,
	storyReferenceBindingSchema,
	storyVisualDirectionViolations,
	type StoryPlannedShotDirection,
	type StoryVisualDirectionRosterEntry,
} from "./story-visual-direction.ts";
import { storyEditorialDecisionSchema } from "./story-sequence-direction.ts";

const shot = (over: Partial<StoryPlannedShotDirection> = {}): StoryPlannedShotDirection =>
	storyPlannedShotDirectionSchema.parse({
		index: 0,
		visualIntent: "Hands lift a wax comb",
		role: "novelty",
		rationale: "Bee is the recurring subject",
		bindings: [{ entityId: "e-bee" }],
		...over,
	});

const roster: StoryVisualDirectionRosterEntry[] = [
	{ id: "e-bee", role: "character", label: "Lebah POV" },
	{ id: "e-hive", role: "location", label: "Sarang" },
	{ id: "e-jar", role: "product", label: "Jar" },
];

describe("a binding names exactly one reference", () => {
	test("either source parses, both or neither is rejected", () => {
		expect(storyReferenceBindingSchema.parse({ entityId: "e-bee" })).toEqual({ entityId: "e-bee" });
		expect(storyReferenceBindingSchema.parse({ plannedKey: "hive" })).toEqual({
			plannedKey: "hive",
		});
		expect(
			storyReferenceBindingSchema.safeParse({ entityId: "e-bee", plannedKey: "hive" }).success,
		).toBe(false);
		expect(storyReferenceBindingSchema.safeParse({}).success).toBe(false);
	});

	test("identity is stable and distinguishes the two sources", () => {
		expect(bindingIdentity({ entityId: "e-bee" })).toBe("entity:e-bee");
		expect(bindingIdentity({ plannedKey: "e-bee" })).toBe("planned:e-bee");
	});
});

describe("planned-shot direction", () => {
	test("rejects blank and over-length rationale", () => {
		expect(storyPlannedShotDirectionSchema.safeParse({ ...shot(), rationale: "  " }).success).toBe(
			false,
		);
		expect(
			storyPlannedShotDirectionSchema.safeParse({ ...shot(), rationale: "x".repeat(161) }).success,
		).toBe(false);
		expect(
			storyPlannedShotDirectionSchema.parse({ ...shot(), rationale: "x".repeat(160) }).rationale
				.length,
		).toBe(160);
	});

	test("a shot needing no reference is valid", () => {
		expect(storyPlannedShotDirectionSchema.parse({ ...shot(), bindings: [] }).bindings).toEqual([]);
	});

	test("editorial carries ordered shot direction and still parses without it", () => {
		const editorial = {
			purpose: "establish",
			presentation: "narrative",
			visualConcept: "Hive interior",
			noveltyKey: "wax",
			sfxCue: null,
		};
		expect(storyEditorialDecisionSchema.parse(editorial).shots).toBeUndefined();
		const directed = storyEditorialDecisionSchema.parse({
			...editorial,
			shots: [shot(), shot({ index: 1 })],
		});
		expect(directed.shots?.map((s) => s.index)).toEqual([0, 1]);
	});
});

describe("validation names the offending beat and shot", () => {
	const beat = (shots: StoryPlannedShotDirection[]) => ({
		id: "beat-a",
		plannedShotCount: shots.length,
		shots,
	});
	const check = (
		shots: StoryPlannedShotDirection[],
		over: Partial<Parameters<typeof storyVisualDirectionViolations>[1]> = {},
	) =>
		storyVisualDirectionViolations([beat(shots)], {
			roster,
			plannedKeys: ["hive"],
			aliasedIdentities: ["entity:e-bee", "planned:hive"],
			...over,
		});

	test("accepts a valid beat", () => {
		expect(check([shot()])).toEqual([]);
	});

	test("rejects an unknown entity id or planned key", () => {
		expect(check([shot({ bindings: [{ entityId: "e-ghost" }] })])[0]).toMatchObject({
			invariant: "unknown_entity",
			beatId: "beat-a",
			shotIndex: 0,
		});
		expect(check([shot({ bindings: [{ plannedKey: "ghost" }] })])[0]).toMatchObject({
			invariant: "unknown_planned_key",
			shotIndex: 0,
		});
	});

	test("rejects duplicate bindings within one shot", () => {
		expect(
			check([shot({ bindings: [{ entityId: "e-bee" }, { entityId: "e-bee" }] })])[0],
		).toMatchObject({ invariant: "duplicate_binding" });
	});

	test("rejects a missing or extra shot index", () => {
		const violations = storyVisualDirectionViolations(
			[{ id: "beat-a", plannedShotCount: 2, shots: [shot()] }],
			{ roster, plannedKeys: [], aliasedIdentities: ["entity:e-bee"] },
		);
		expect(violations[0]).toMatchObject({ invariant: "shot_coverage", beatId: "beat-a" });
		expect(check([shot(), shot({ index: 2 })])[0]).toMatchObject({ invariant: "shot_coverage" });
	});

	test("rejects a bound identity with no alias entry", () => {
		expect(check([shot()], { aliasedIdentities: [] })[0]).toMatchObject({
			invariant: "missing_alias",
			detail: expect.stringContaining("entity:e-bee"),
		});
	});

	test("rejects an unbound operator-required reference", () => {
		expect(
			check([shot()], { requiredByBeat: { "beat-a": [{ entityId: "e-hive" }] } })[0],
		).toMatchObject({ invariant: "unbound_required_reference" });
		expect(
			check([shot({ bindings: [{ entityId: "e-bee" }, { entityId: "e-hive" }] })], {
				requiredByBeat: { "beat-a": [{ entityId: "e-hive" }] },
				aliasedIdentities: ["entity:e-bee", "entity:e-hive"],
			}),
		).toEqual([]);
	});

	test("rejects a shot over either existing reference cap", () => {
		const subjects: StoryVisualDirectionRosterEntry[] = [
			...roster,
			{ id: "e-b", role: "character", label: "B" },
			{ id: "e-c", role: "character", label: "C" },
			{ id: "e-d", role: "character", label: "D" },
		];
		const aliasedIdentities = [
			"entity:e-bee",
			"entity:e-b",
			"entity:e-c",
			"entity:e-d",
			"entity:e-hive",
			"entity:e-jar",
		];
		const fourSubjects = check(
			[
				shot({
					bindings: [
						{ entityId: "e-bee" },
						{ entityId: "e-b" },
						{ entityId: "e-c" },
						{ entityId: "e-d" },
					],
				}),
			],
			{ roster: subjects, aliasedIdentities },
		);
		expect(fourSubjects[0]).toMatchObject({ invariant: "subject_cap_exceeded", shotIndex: 0 });
		// Three subjects plus two non-subject refs: under the subject cap, over the image cap.
		const fiveTotal = check(
			[
				shot({
					bindings: [
						{ entityId: "e-bee" },
						{ entityId: "e-b" },
						{ entityId: "e-c" },
						{ entityId: "e-hive" },
						{ entityId: "e-jar" },
					],
				}),
			],
			{ roster: subjects, aliasedIdentities },
		);
		expect(fiveTotal.some((v) => v.invariant === "reference_cap_exceeded")).toBe(true);
	});

	test("rejects a planned product reference", () => {
		const violations = storyVisualDirectionViolations(
			[beat([shot({ bindings: [{ plannedKey: "new-jar" }] })])],
			{
				roster,
				plannedKeys: ["new-jar"],
				plannedRoles: { "new-jar": "product" },
				aliasedIdentities: ["planned:new-jar"],
			},
		);
		expect(violations[0]).toMatchObject({ invariant: "planned_product" });
	});
});

describe("an exact roster match collapses a planned reference", () => {
	const dupes: StoryVisualDirectionRosterEntry[] = [
		{ id: "e-old", role: "character", label: "Lebah POV", updatedAt: 1 },
		{ id: "e-new", role: "character", label: " lebah  pov ", updatedAt: 9 },
	];
	test("exact normalized label and role collapse", () => {
		expect(
			collapsePlannedReferenceToRoster({ role: "character", label: "Lebah POV" }, roster),
		).toBe("e-bee");
	});
	test("role mismatch, unrelated label, and empty roster do not collapse", () => {
		expect(
			collapsePlannedReferenceToRoster({ role: "location", label: "Lebah POV" }, roster),
		).toBeUndefined();
		expect(
			collapsePlannedReferenceToRoster({ role: "character", label: "Beruang" }, roster),
		).toBeUndefined();
		expect(
			collapsePlannedReferenceToRoster({ role: "character", label: "Lebah POV" }, []),
		).toBeUndefined();
	});
	test("duplicate roster labels resolve deterministically: primary, then newest, then lowest id", () => {
		expect(collapsePlannedReferenceToRoster({ role: "character", label: "Lebah POV" }, dupes)).toBe(
			"e-new",
		);
		const withPrimary = dupes.map((entry) =>
			entry.id === "e-old" ? { ...entry, primary: true } : entry,
		);
		expect(
			collapsePlannedReferenceToRoster({ role: "character", label: "Lebah POV" }, withPrimary),
		).toBe("e-old");
		const tied = dupes.map((entry) => ({ ...entry, updatedAt: 5 }));
		expect(collapsePlannedReferenceToRoster({ role: "character", label: "Lebah POV" }, tied)).toBe(
			"e-new",
		);
		expect(
			collapsePlannedReferenceToRoster(
				{ role: "character", label: "Lebah POV" },
				[...tied].reverse(),
			),
		).toBe("e-new");
	});
});
