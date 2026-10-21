import { describe, expect, test } from "vite-plus/test";
import {
	applyStoryboardCommand,
	approveStoryDraft,
	canonicalizeLegacyStoryPlan,
	readLegacyStoryDraft,
	storyboardGenerationStateSchema,
	recordMaterializedReference,
	materializedEntityId,
	validateStoryApproval,
	type StoryboardGenerationState,
} from "./storyboard-generation.ts";

const state = (): StoryboardGenerationState =>
	storyboardGenerationStateSchema.parse({
		planId: "plan-1",
		draft: {
			revisionId: "rev-1",
			sections: [
				{
					id: "section-a",
					title: "A",
					beats: [
						{ id: "beat-a", title: "A", narration: "One.", visualPrompt: "One" },
						{ id: "beat-b", title: "B", narration: "Two.", visualPrompt: "Two" },
					],
				},
				{
					id: "section-b",
					title: "B",
					beats: [{ id: "beat-c", title: "C", narration: "Three.", visualPrompt: "Three" }],
				},
			],
		},
	});

function apply(
	current: StoryboardGenerationState,
	command: Parameters<typeof applyStoryboardCommand>[2],
	revision = "next",
) {
	const result = applyStoryboardCommand(current, current.draft.revisionId, command, revision);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(result.message);
	return result.state;
}

describe("storyboard commands", () => {
	test("adds, updates, removes, and reorders sections and beats by stable id", () => {
		let next = apply(state(), {
			type: "add_section",
			afterSectionId: "section-a",
			section: {
				id: "section-new",
				title: "New",
				beats: [{ id: "beat-new", title: "New", narration: "N", visualPrompt: "N" }],
			},
		});
		next = apply(next, {
			type: "update_section",
			sectionId: "section-new",
			fields: { title: "Renamed" },
		});
		next = apply(next, { type: "reorder_section", sectionId: "section-new", afterSectionId: null });
		next = apply(next, {
			type: "add_beat",
			sectionId: "section-a",
			afterBeatId: "beat-a",
			beat: { id: "beat-added", title: "Added", narration: "A", visualPrompt: "A" },
		});
		next = apply(next, {
			type: "update_beat",
			beatId: "beat-added",
			fields: { narration: "Changed" },
		});
		next = apply(next, {
			type: "reorder_beat",
			beatId: "beat-added",
			sectionId: "section-a",
			afterBeatId: null,
		});
		next = apply(next, { type: "remove_beat", beatId: "beat-b" });
		next = apply(next, { type: "remove_section", sectionId: "section-b" });
		expect(next.draft.sections.map((section) => section.id)).toEqual(["section-new", "section-a"]);
		expect(next.draft.sections[1]!.beats.map((beat) => [beat.id, beat.narration])).toEqual([
			["beat-added", "Changed"],
			["beat-a", "One."],
		]);
	});

	test("split keeps first id; merge keeps first id; references deduplicate", () => {
		let next = apply(state(), {
			type: "split_beat",
			beatId: "beat-a",
			first: { narration: "First." },
			second: { id: "beat-split", title: "Split", narration: "Second.", visualPrompt: "Second" },
		});
		next = apply(next, {
			type: "attach_reference",
			beatId: "beat-a",
			referenceId: "ref-1",
			referenceKind: "entity",
		});
		next = apply(next, {
			type: "attach_reference",
			beatId: "beat-a",
			referenceId: "ref-1",
			referenceKind: "entity",
		});
		next = apply(next, { type: "merge_beats", firstBeatId: "beat-a", secondBeatId: "beat-split" });
		expect(next.draft.sections[0]!.beats[0]).toMatchObject({
			id: "beat-a",
			narration: "First. Second.",
			refIds: ["ref-1"],
		});
	});

	test("merge orders adjacent beats by position even when arguments are reversed", () => {
		const next = apply(state(), {
			type: "merge_beats",
			firstBeatId: "beat-b",
			secondBeatId: "beat-a",
		});
		expect(next.draft.sections[0]!.beats[0]).toMatchObject({
			id: "beat-a",
			narration: "One. Two.",
			visualPrompt: "One; Two",
		});
	});

	test("locks reject authored mutation and stale revisions never overwrite", () => {
		const locked = apply(state(), { type: "lock_beat", beatId: "beat-a" });
		expect(
			applyStoryboardCommand(locked, locked.draft.revisionId, {
				type: "update_beat",
				beatId: "beat-a",
				fields: { narration: "No" },
			}),
		).toMatchObject({ ok: false, reason: "locked" });
		expect(
			applyStoryboardCommand(locked, "rev-1", { type: "unlock_beat", beatId: "beat-a" }),
		).toMatchObject({ ok: false, reason: "conflict", currentRevisionId: "next" });
		const unlocked = apply(locked, { type: "unlock_beat", beatId: "beat-a" });
		expect(unlocked.draft.sections[0]!.beats[0]!.locked).toBeUndefined();
	});
});

describe("legacy boundary and approval", () => {
	test("one approval validator gives both paths the same decision", () => {
		const fixtures = [
			{ directed: false, needsDirection: true },
			{ directed: true, needsDirection: true, directionErrors: ["invalid"] },
			{ directed: true, directionFingerprint: "old", currentDirectionFingerprint: "new" },
			{ directed: true, directionFingerprint: "same", currentDirectionFingerprint: "same" },
		];
		expect(fixtures.map((fixture) => validateStoryApproval(fixture))).toEqual([
			{ ok: true },
			{ ok: false, reason: "needs_direction", message: "invalid" },
			{
				ok: false,
				reason: "stale_direction",
				message: "Story visual direction inputs changed; run direction again before approval.",
			},
			{ ok: true },
		]);
	});

	/* The blocker is a flag the direction stage set, never a phrase parsed back out
	 * of its error text: a reference LABEL containing "operator" used to be enough
	 * to route a plan down the operator-action branch. */
	test("an operator-only blocker is read from the flag, not from message text", () => {
		expect(
			validateStoryApproval({
				directed: true,
				needsDirection: true,
				directionBlocked: true,
				directionErrors: ["planned_product: jar needs an operator-supplied reference"],
			}),
		).toMatchObject({ reason: "blocking_requirement" });
		expect(
			validateStoryApproval({
				directed: true,
				needsDirection: true,
				directionErrors: ["duplicate_binding: beat-a#0: entity:operator-console is bound twice"],
			}),
		).toMatchObject({ reason: "needs_direction" });
	});

	/* An extension is additions to an already approved plan, under a policy the
	 * operator chose. Its new sections necessarily change the direction inputs, so
	 * a stale check here refuses the approval that generation then dereferences. */
	test("an implicit extension approves past changed inputs but never past a blocker", () => {
		const extension = {
			directed: true,
			approvalMode: "implicit_extension" as const,
			directionFingerprint: "old",
			currentDirectionFingerprint: "new",
		};
		expect(validateStoryApproval(extension)).toEqual({ ok: true });
		expect(
			validateStoryApproval({ ...extension, needsDirection: true, directionErrors: ["invalid"] }),
		).toMatchObject({ reason: "needs_direction" });
		expect(
			validateStoryApproval({
				...extension,
				directionBlocked: true,
				directionErrors: ["missing product"],
			}),
		).toMatchObject({ reason: "blocking_requirement" });
		expect(
			validateStoryApproval({ ...extension, approvalMode: "explicit" as const }),
		).toMatchObject({ reason: "stale_direction" });
	});
	test("read view invents no persisted identity", () => {
		const legacy = [
			{ title: "Old", narration: "Words", visualPrompt: "Image", visualPrompts: ["A", "B"] },
		];
		const before = JSON.stringify(legacy);
		expect(readLegacyStoryDraft(legacy).sections[0]!.beats[0]!.narration).toBe("Words");
		expect(JSON.stringify(legacy)).toBe(before);
	});

	test("first mutation canonicalizes; approval freezes detached snapshot", () => {
		let n = 0;
		const canonical = canonicalizeLegacyStoryPlan(
			[{ title: "Old", narration: "Words", visualPrompt: "Image" }],
			() => `id-${++n}`,
		);
		const changed = apply(
			canonical,
			{
				type: "update_beat",
				beatId: canonical.draft.sections[0]!.beats[0]!.id,
				fields: { narration: "New" },
			},
			"rev-2",
		);
		const approved = approveStoryDraft(changed, "explicit");
		const later = apply(
			approved,
			{
				type: "update_beat",
				beatId: approved.draft.sections[0]!.beats[0]!.id,
				fields: { narration: "Later" },
			},
			"rev-3",
		);
		expect(approved.approvedSnapshot).toMatchObject({
			revisionId: "rev-2",
			approvalMode: "explicit",
			extensionPolicy: "review_additions",
		});
		expect(later.approvedSnapshot!.sections[0]!.beats[0]!.narration).toBe("New");
	});

	test("editorial edits create a revision and approval freezes direction", () => {
		const original = state();
		const directed = apply(
			original,
			{
				type: "update_beat",
				beatId: "beat-a",
				fields: {
					editorial: {
						purpose: "establish",
						presentation: "narrative",
						visualConcept: "Empty exchange lobby",
						noveltyKey: "empty-lobby",
						sfxCue: null,
					},
				},
			},
			"rev-directed",
		);
		const approved = approveStoryDraft(directed, "explicit");
		const changed = apply(
			approved,
			{
				type: "update_beat",
				beatId: "beat-a",
				fields: {
					editorial: {
						purpose: "reveal",
						presentation: "headline",
						visualConcept: "Closed courtroom door",
						noveltyKey: "court-door",
						onScreenText: "25 years",
						sfxCue: "door close",
					},
				},
			},
			"rev-changed",
		);
		expect(changed.draft.revisionId).toBe("rev-changed");
		expect(changed.draft.sections[0]!.beats[0]!.editorial?.noveltyKey).toBe("court-door");
		expect(changed.approvedSnapshot!.sections[0]!.beats[0]!.editorial?.noveltyKey).toBe(
			"empty-lobby",
		);
	});
});

describe("an approved snapshot freezes what generation reads", () => {
	const draft = {
		planId: "plan-a",
		draft: {
			revisionId: "rev-a",
			sections: [
				{
					id: "sec-a",
					title: "",
					beats: [{ id: "beat-a", title: "", narration: "n", visualPrompt: "v" }],
				},
			],
		},
	};
	const definitions = [
		{ key: "hive", role: "location" as const, label: "Sarang", description: "golden wax" },
	];
	const approve = () =>
		approveStoryDraft(
			storyboardGenerationStateSchema.parse(draft),
			"explicit",
			"review_additions",
			"2026-09-20T00:00:00.000Z",
			undefined,
			{
				plannedReferences: definitions,
				referenceAliases: [{ ref: "planned:hive", aliases: ["sarang"] }],
				directionFingerprint: "fp-1",
			},
		);

	test("definitions, aliases and fingerprint travel with the snapshot", () => {
		const state = approve();
		expect(state.approvedSnapshot?.plannedReferences).toEqual(definitions);
		expect(state.approvedSnapshot?.referenceAliases).toEqual([
			{ ref: "planned:hive", aliases: ["sarang"] },
		]);
		expect(state.approvedSnapshot?.directionFingerprint).toBe("fp-1");
	});

	test("an approval without direction stays valid and carries none", () => {
		const state = approveStoryDraft(storyboardGenerationStateSchema.parse(draft), "explicit");
		expect(state.approvedSnapshot?.plannedReferences).toBeUndefined();
	});

	test("materialization records the entity outside the snapshot", () => {
		const state = recordMaterializedReference(approve(), "hive", "entity-1");
		expect(materializedEntityId(state, "hive")).toBe("entity-1");
		expect(state.approvedSnapshot?.plannedReferences).toEqual(definitions);
		expect(JSON.stringify(state.approvedSnapshot)).not.toContain("entity-1");
	});

	test("the record is keyed by approved revision, so a new approval starts clean", () => {
		const recorded = recordMaterializedReference(approve(), "hive", "entity-1");
		const reapproved = approveStoryDraft(
			recorded,
			"explicit",
			"review_additions",
			"2026-09-20T01:00:00.000Z",
			undefined,
			{ plannedReferences: definitions },
		);
		expect(materializedEntityId(reapproved, "hive")).toBeUndefined();
		expect(materializedEntityId(recorded, "hive")).toBe("entity-1");
	});

	test("recording twice is idempotent", () => {
		const once = recordMaterializedReference(approve(), "hive", "entity-1");
		expect(recordMaterializedReference(once, "hive", "entity-1")).toEqual(once);
	});
});
