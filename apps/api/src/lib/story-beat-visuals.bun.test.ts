/* Per-beat visual authoring: the counted invariants.
 *
 * Nothing here checks whether a visual is GOOD — that stays a human judgement in
 * the script view. What it checks is arithmetic and set membership the pipeline
 * cannot recover from: one intent per beat, every beat index present exactly once,
 * cast drawn from the story bible's closed list, and no two adjacent beats that
 * would render the same picture. A violation retries once and then throws, so the
 * owning section fails visibly instead of shipping a repeated image. */
import { afterEach, describe, expect, test } from "bun:test";
import {
	authorStoryBeatVisuals,
	setStoryBeatVisualAuthorForTests,
	type StoryBeatVisual,
} from "./story/image-director.ts";
import { storyBibleSchema } from "@maleo/shared";

const SECTION = { title: "Born into wax", narration: "You wake inside a narrow wax cell." };
const BEATS = [
	{ text: "You wake inside a narrow wax cell.", durationSec: 4 },
	{ text: "The queen's scent arrives first.", durationSec: 3.5 },
	{ text: "Your first task is to clean it.", durationSec: 4.2 },
];

const BIBLE = storyBibleSchema.parse({
	subjects: [
		{ id: "worker-bee", label: "worker bee" },
		{ id: "queen", label: "queen bee" },
	],
	locations: [{ id: "hive", label: "honeycomb interior" }],
});

afterEach(() => setStoryBeatVisualAuthorForTests(null));

/** An author that answers differently on each attempt, so a test can pin how many
 *  times the call was made as well as what it did with the answers. */
function authorReturning(...responses: unknown[][]): () => number {
	let calls = 0;
	setStoryBeatVisualAuthorForTests(async () => {
		const response = responses[Math.min(calls, responses.length - 1)]!;
		calls++;
		return response;
	});
	return () => calls;
}

function goodVisuals(count = BEATS.length): StoryBeatVisual[] {
	return Array.from({ length: count }, (_, index) => ({
		beatIndex: index,
		subjectIds: [],
		visualMoment: `distinct visual ${index + 1}`,
		mustInclude: [],
		mustAvoid: [],
	}));
}

describe("authorStoryBeatVisuals", () => {
	test("carries approved sequence direction into measured-beat authoring", async () => {
		let seen: unknown;
		setStoryBeatVisualAuthorForTests(async (_section, _beats, opts) => {
			seen = opts?.editorial;
			return goodVisuals();
		});
		const editorial = {
			purpose: "explain" as const,
			presentation: "explainer" as const,
			visualConcept: "cutaway mechanism",
			noveltyKey: "cutaway",
			onScreenText: "Heat moves",
			sfxCue: null,
		};
		await authorStoryBeatVisuals(SECTION, BEATS, { editorial });
		expect(seen).toEqual(editorial);
	});

	test("returns exactly one intent per supplied beat, indexed 0..n-1", async () => {
		// Answered out of order on purpose: the beat index is the identity, not the
		// position in the response array.
		authorReturning([
			{ beatIndex: 2, visualMoment: "hive entrance in hard light" },
			{ beatIndex: 0, visualMoment: "wax cell wall from inside" },
			{ beatIndex: 1, visualMoment: "antennae reading a scent trail" },
		]);
		const visuals = await authorStoryBeatVisuals(SECTION, BEATS);
		expect(visuals.map((entry) => entry.beatIndex)).toEqual([0, 1, 2]);
		expect(visuals.map((entry) => entry.visualMoment)).toEqual([
			"wax cell wall from inside",
			"antennae reading a scent trail",
			"hive entrance in hard light",
		]);
	});

	test("projects two approved bindings across four measured beats without position coupling", async () => {
		const approvedBindings = [{ entityId: "bee" }, { plannedKey: "hive" }];
		const beats = [...BEATS, { text: "The chamber opens.", durationSec: 2 }];
		authorReturning([
			{ beatIndex: 0, visualMoment: "bee enters", referenceBindings: [approvedBindings[0]] },
			{ beatIndex: 1, visualMoment: "bee turns", referenceBindings: [approvedBindings[0]] },
			{ beatIndex: 2, visualMoment: "hive opens", referenceBindings: [approvedBindings[1]] },
			{ beatIndex: 3, visualMoment: "bee in hive", referenceBindings: approvedBindings },
		]);
		const visuals = await authorStoryBeatVisuals(SECTION, beats, { approvedBindings });
		expect(visuals.map((visual) => visual.referenceBindings)).toEqual([
			[approvedBindings[0]],
			[approvedBindings[0]],
			[approvedBindings[1]],
			approvedBindings,
		]);
	});

	test("merges four approved bindings into two measured beats", async () => {
		const approvedBindings = [
			{ entityId: "a" },
			{ entityId: "b" },
			{ plannedKey: "c" },
			{ plannedKey: "d" },
		];
		authorReturning([
			{
				beatIndex: 0,
				visualMoment: "first group",
				referenceBindings: approvedBindings.slice(0, 2),
			},
			{ beatIndex: 1, visualMoment: "second group", referenceBindings: approvedBindings.slice(2) },
		]);
		const visuals = await authorStoryBeatVisuals(SECTION, BEATS.slice(0, 2), { approvedBindings });
		expect(visuals.flatMap((visual) => visual.referenceBindings ?? [])).toEqual(approvedBindings);
	});

	test("rejects measured-beat bindings outside approved section set", async () => {
		const calls = authorReturning(
			goodVisuals().map((visual, index) => ({
				...visual,
				referenceBindings: index === 1 ? [{ entityId: "intruder" }] : [],
			})),
		);
		await expect(
			authorStoryBeatVisuals(SECTION, BEATS, { approvedBindings: [{ entityId: "bee" }] }),
		).rejects.toThrow(/not approved.*entity:intruder/);
		expect(calls()).toBe(2);
	});

	test("keeps the structured camera and cast fields", async () => {
		authorReturning([
			{
				beatIndex: 0,
				visualMoment: "wax cap lifting",
				subjectIds: ["worker-bee"],
				locationId: "hive",
				shotType: "extreme macro",
				cameraAngle: "first-person",
				endState: "cap lifted",
			},
			{
				beatIndex: 1,
				visualMoment: "scent arriving",
				subjectIds: ["worker-bee", "queen"],
				shotType: "wide",
			},
			{
				beatIndex: 2,
				visualMoment: "cleaning the cell",
				subjectIds: ["worker-bee"],
				shotType: "close",
			},
		]);
		const visuals = await authorStoryBeatVisuals(SECTION, BEATS, { bible: BIBLE });
		expect(visuals[0]!.shotType).toBe("extreme macro");
		expect(visuals[0]!.cameraAngle).toBe("first-person");
		expect(visuals[0]!.locationId).toBe("hive");
		expect(visuals[0]!.endState).toBe("cap lifted");
		expect(visuals[1]!.subjectIds).toEqual(["worker-bee", "queen"]);
	});

	test("rejects a result that restates the story's style", async () => {
		const calls = authorReturning([
			{ beatIndex: 0, visualMoment: "a", medium: "watercolor" },
			{ beatIndex: 1, visualMoment: "b" },
			{ beatIndex: 2, visualMoment: "c" },
		]);
		await expect(authorStoryBeatVisuals(SECTION, BEATS)).rejects.toThrow();
		expect(calls()).toBe(2);
	});

	test("no beats means no call and no visuals", async () => {
		const calls = authorReturning(goodVisuals());
		expect(await authorStoryBeatVisuals(SECTION, [])).toEqual([]);
		expect(calls()).toBe(0);
	});

	test("retries once, then throws naming a wrong visual count", async () => {
		const calls = authorReturning(goodVisuals(2));
		await expect(authorStoryBeatVisuals(SECTION, BEATS)).rejects.toThrow(
			/expected one visual per beat \(3\), received 2/,
		);
		expect(calls()).toBe(2);
	});

	test("retries once, then throws naming a missing or repeated beat index", async () => {
		const calls = authorReturning([
			{ beatIndex: 0, visualMoment: "wax cell wall from inside" },
			{ beatIndex: 0, visualMoment: "antennae reading a scent trail" },
			{ beatIndex: 2, visualMoment: "hive entrance in hard light" },
		]);
		await expect(authorStoryBeatVisuals(SECTION, BEATS)).rejects.toThrow(
			/every beat index 0\.\.2 must appear exactly once/,
		);
		expect(calls()).toBe(2);
	});

	test("retries once, then throws naming adjacent beats that repeat a visual", async () => {
		const calls = authorReturning([
			{ beatIndex: 0, visualMoment: "wax cell wall from inside" },
			{ beatIndex: 1, visualMoment: "wax cell wall from inside" },
			{ beatIndex: 2, visualMoment: "hive entrance in hard light" },
		]);
		await expect(authorStoryBeatVisuals(SECTION, BEATS)).rejects.toThrow(
			/adjacent beats 0\/1 repeat the same visual/,
		);
		expect(calls()).toBe(2);
	});

	test("adjacent beats sharing a moment but differing on camera are not duplicates", async () => {
		authorReturning([
			{ beatIndex: 0, visualMoment: "the wax cell", shotType: "extreme macro" },
			{ beatIndex: 1, visualMoment: "the wax cell", shotType: "wide establishing" },
			{ beatIndex: 2, visualMoment: "hive entrance in hard light" },
		]);
		const visuals = await authorStoryBeatVisuals(SECTION, BEATS);
		expect(visuals).toHaveLength(3);
	});

	test("retries once, then throws naming a subject id outside the bible", async () => {
		const calls = authorReturning([
			{ beatIndex: 0, visualMoment: "a", subjectIds: ["worker-bee"] },
			{ beatIndex: 1, visualMoment: "b", subjectIds: ["drone"] },
			{ beatIndex: 2, visualMoment: "c", subjectIds: ["queen"] },
		]);
		await expect(authorStoryBeatVisuals(SECTION, BEATS, { bible: BIBLE })).rejects.toThrow(
			/subject id\(s\) not in the story bible: drone/,
		);
		expect(calls()).toBe(2);
	});

	test("retries once, then throws naming a location id outside the bible", async () => {
		authorReturning([
			{ beatIndex: 0, visualMoment: "a", locationId: "hive" },
			{ beatIndex: 1, visualMoment: "b", locationId: "moon" },
			{ beatIndex: 2, visualMoment: "c" },
		]);
		await expect(authorStoryBeatVisuals(SECTION, BEATS, { bible: BIBLE })).rejects.toThrow(
			/location id\(s\) not in the story bible: moon/,
		);
	});

	test("a plan with no bible is not failed for its cast", async () => {
		// A legacy plan has no closed list to be a subset of. Failing it would refuse
		// work that used to run.
		authorReturning([
			{ beatIndex: 0, visualMoment: "a", subjectIds: ["anything"] },
			{ beatIndex: 1, visualMoment: "b" },
			{ beatIndex: 2, visualMoment: "c" },
		]);
		expect(await authorStoryBeatVisuals(SECTION, BEATS)).toHaveLength(3);
	});

	test("a retry that answers correctly is accepted", async () => {
		const calls = authorReturning(goodVisuals(2), goodVisuals());
		const visuals = await authorStoryBeatVisuals(SECTION, BEATS);
		expect(visuals).toHaveLength(3);
		expect(calls()).toBe(2);
	});
});
