import { describe, expect, test } from "vite-plus/test";
import {
	storyArcCoverageViolations,
	type StoryArcCoverageInput,
	type StoryArcInvariant,
} from "./story-arc-coverage.ts";
import { storyArcFunctionSlots } from "./story-arc.ts";

/* A clean six-section three_act plan: one slot per arc function, in order, with a
 * moving emotional arc. Every case below breaks exactly one thing about it. */
function cleanPlan(overrides: Partial<StoryArcCoverageInput> = {}): StoryArcCoverageInput {
	const slots = storyArcFunctionSlots("three_act", 6);
	return {
		arc: "three_act",
		sections: slots.map((fn, index) => ({
			chapterFunction: fn.key,
			emotion: fn.defaultEmotion,
			estimatedDurationSec: 30,
			narration: `Section ${index + 1} narration.`,
		})),
		engagement: { turn: "The rescue was the trap." },
		...overrides,
	};
}

function invariants(input: StoryArcCoverageInput): StoryArcInvariant[] {
	return storyArcCoverageViolations(input).map((violation) => violation.invariant);
}

describe("storyArcCoverageViolations", () => {
	test("a plan matching its arc reports nothing", () => {
		expect(storyArcCoverageViolations(cleanPlan())).toEqual([]);
	});

	test("a plan carrying no arc yields no violations", () => {
		const plan = cleanPlan();
		expect(storyArcCoverageViolations({ ...plan, arc: undefined })).toEqual([]);
		// Not even when every other thing about it is broken.
		expect(
			storyArcCoverageViolations({
				arc: undefined,
				sections: [{ emotion: "calm" }, { emotion: "calm" }, { emotion: "calm" }],
			}),
		).toEqual([]);
	});

	test("a missing function is reported by name", () => {
		const plan = cleanPlan();
		const sections = plan.sections.map((section, index) =>
			index === 3 ? { ...section, chapterFunction: undefined } : section,
		);
		const violations = storyArcCoverageViolations({ ...plan, sections });
		expect(violations.map((v) => v.invariant)).toContain("functions_present");
		expect(violations.find((v) => v.invariant === "functions_present")!.detail).toContain(
			"midpoint_turn",
		);
	});

	test("out-of-order functions are reported", () => {
		const plan = cleanPlan();
		const sections = [...plan.sections];
		const first = sections[1]!;
		sections[1] = sections[4]!;
		sections[4] = first;
		expect(invariants({ ...plan, sections })).toContain("functions_ordered");
	});

	test("a function the arc does not define is reported", () => {
		const plan = cleanPlan();
		const sections = plan.sections.map((section, index) =>
			index === 2 ? { ...section, chapterFunction: "erasure" } : section,
		);
		const detail = storyArcCoverageViolations({ ...plan, sections }).find(
			(v) => v.invariant === "functions_ordered",
		)!.detail;
		expect(detail).toContain("erasure");
	});

	test("a misplaced midpoint is reported with the observed fraction", () => {
		const plan = cleanPlan();
		// Front-load every other section so the midpoint slot lands near the very end.
		const sections = plan.sections.map((section, index) => ({
			...section,
			estimatedDurationSec: index < 3 ? 300 : 5,
		}));
		const violation = storyArcCoverageViolations({ ...plan, sections }).find(
			(v) => v.invariant === "midpoint_position",
		);
		expect(violation).toBeDefined();
		expect(violation!.detail).toMatch(/0\.\d\d of estimated runtime/);
	});

	test("an unfulfilled turn is reported", () => {
		const plan = cleanPlan();
		// The plan states a turn, but nothing carries the arc's turn function.
		const noTurnFunction = plan.sections.map((section) =>
			section.chapterFunction === "midpoint_turn"
				? { ...section, chapterFunction: undefined }
				: section,
		);
		expect(invariants({ ...plan, sections: noTurnFunction })).toContain("turn_fulfilled");

		// The plan maps the turn to a section other than the turn-function section.
		expect(invariants({ ...plan, turnSectionIndex: 0 })).toContain("turn_fulfilled");

		// The turn-function section exists but was never drafted.
		const undrafted = plan.sections.map((section) =>
			section.chapterFunction === "midpoint_turn" ? { ...section, narration: "" } : section,
		);
		expect(invariants({ ...plan, sections: undrafted })).toContain("turn_fulfilled");
	});

	test("a plan that states no turn is not checked for one", () => {
		const plan = cleanPlan({ engagement: { turn: "  " } });
		const sections = plan.sections.map((section) =>
			section.chapterFunction === "midpoint_turn"
				? { ...section, chapterFunction: undefined }
				: section,
		);
		expect(invariants({ ...plan, sections })).not.toContain("turn_fulfilled");
	});

	test("a flat emotional arc is reported", () => {
		const plan = cleanPlan();
		const sections = plan.sections.map((section) => ({ ...section, emotion: "calm" }));
		const violation = storyArcCoverageViolations({ ...plan, sections }).find(
			(v) => v.invariant === "emotion_not_flat",
		);
		expect(violation).toBeDefined();
		expect(violation!.detail).toContain("1 distinct emotion(s)");
	});

	test("a compressed short plan is judged against the slots it actually earned", () => {
		const slots = storyArcFunctionSlots("pov_lifecycle", 4);
		const plan: StoryArcCoverageInput = {
			arc: "pov_lifecycle",
			sections: slots.map((fn, index) => ({
				chapterFunction: fn.key,
				emotion: fn.defaultEmotion,
				narration: `Beat ${index + 1}.`,
			})),
			engagement: { turn: "The hive stops needing you." },
		};
		// Four sections cannot carry nine functions; compressing is not a violation.
		expect(storyArcCoverageViolations(plan)).toEqual([]);
	});
});
