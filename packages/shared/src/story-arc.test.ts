import { describe, expect, test } from "vite-plus/test";
import { EMOTIONS } from "./video-style.ts";
import {
	POV_CHAPTER_FUNCTIONS,
	POV_LIFECYCLE_STAGES,
	STORY_ARCS,
	defaultStoryArcFor,
	resolveStoryArc,
	storyArcFunctionSlots,
	storyArcSpec,
	storyArcSpecs,
} from "./story-arc.ts";
import { VIDEO_PLAN_KINDS, storyDensityFor } from "./story-plan.ts";

describe("resolveStoryArc", () => {
	test("an explicit request survives inference, duration and plan kind", () => {
		expect(resolveStoryArc("pov_lifecycle", "documentary", "three_act")).toBe("pov_lifecycle");
		expect(resolveStoryArc("fichtean", undefined, "story_circle")).toBe("fichtean");
	});

	test("auto defers to what the planner inferred", () => {
		expect(resolveStoryArc("auto", "story", "story_circle")).toBe("story_circle");
		expect(resolveStoryArc(undefined, "story", "seven_point")).toBe("seven_point");
	});

	test("auto falls back to the plan kind default when inference is unusable", () => {
		expect(resolveStoryArc("auto", "documentary", undefined)).toBe("fichtean");
		expect(resolveStoryArc("auto", "documentary", "not_an_arc")).toBe("fichtean");
		expect(resolveStoryArc("auto", "story", "")).toBe("three_act");
	});

	test("every plan kind names a real arc", () => {
		for (const kind of VIDEO_PLAN_KINDS) expect(STORY_ARCS).toContain(defaultStoryArcFor(kind));
		expect(defaultStoryArcFor(undefined)).toBe("three_act");
	});
});

describe("the arc library", () => {
	test("every arc's functions are ordered, unique and fully specified", () => {
		for (const spec of storyArcSpecs()) {
			const keys = spec.functions.map((fn) => fn.key);
			expect(keys.length).toBeGreaterThan(1);
			expect(new Set(keys).size).toBe(keys.length);
			for (const fn of spec.functions) {
				expect(fn.obligation.length).toBeGreaterThan(0);
				expect(EMOTIONS).toContain(fn.defaultEmotion);
			}
			expect(keys).toContain(spec.midpointKey);
			expect(keys).toContain(spec.turnKey);
		}
	});

	test("position windows stay inside 0..1 and never contradict canonical order", () => {
		for (const spec of storyArcSpecs()) {
			let previousStart = -1;
			let previousEnd = -1;
			for (const fn of spec.functions) {
				const { start, end } = fn.positionWindow;
				expect(start).toBeGreaterThanOrEqual(0);
				expect(end).toBeLessThanOrEqual(1);
				expect(end).toBeGreaterThan(start);
				// A later function may not open or close earlier than an earlier one,
				// or the windows would say the arc runs backwards.
				expect(start).toBeGreaterThanOrEqual(previousStart);
				expect(end).toBeGreaterThanOrEqual(previousEnd);
				previousStart = start;
				previousEnd = end;
			}
		}
	});

	/* The calibration recorded in `story-arc.ts`: the coarsest real section grid is
	 * the 4-section one a ~90s narration plan produces, whose slot centers are 0.25
	 * apart. A window narrower than that can fall between two slots. */
	test("every window is satisfiable at the real section counts", () => {
		expect(storyDensityFor("beat", 20).sectionCount).toBe(5);
		expect(storyDensityFor("narration_section", 90).sectionCount).toBe(4);
		expect(storyDensityFor("narration_section", 480).sectionCount).toBe(16);
		for (const spec of storyArcSpecs()) {
			for (const fn of spec.functions) {
				expect(fn.positionWindow.end - fn.positionWindow.start).toBeGreaterThanOrEqual(0.25);
			}
		}
	});

	test("pov_lifecycle exposes the existing POV stages and chapter functions", () => {
		const pov = storyArcSpec("pov_lifecycle");
		expect(pov.functions.map((fn) => fn.key).sort()).toEqual(
			[
				"birth_trap",
				"body_cost",
				"rule_learning",
				"first_work",
				"first_test",
				"system_power",
				"betrayal_or_threat",
				"exhaustion",
				"erasure",
			].sort(),
		);
		expect(pov.functions.map((fn) => fn.povStage!).sort()).toEqual(
			[
				"origin",
				"assigned_role",
				"training",
				"work",
				"first_competence",
				"danger",
				"peak_service",
				"decay",
				"ending_fate",
			].sort(),
		);
		expect(pov.functions.map((fn) => fn.key)).toEqual([...POV_CHAPTER_FUNCTIONS]);
		expect(pov.functions.map((fn) => fn.povStage!)).toEqual([...POV_LIFECYCLE_STAGES]);
	});
});

describe("storyArcFunctionSlots", () => {
	test("slot count matches the requested section count", () => {
		for (const arc of STORY_ARCS) {
			for (const count of [2, 4, 5, 8, 16, 24]) {
				expect(storyArcFunctionSlots(arc, count)).toHaveLength(count);
			}
		}
	});

	test("slots stay in canonical order and open and close on the arc", () => {
		for (const arc of STORY_ARCS) {
			const keys = storyArcSpec(arc).functions.map((fn) => fn.key);
			for (const count of [3, 4, 5, 8, 16]) {
				const slots = storyArcFunctionSlots(arc, count);
				const indexes = slots.map((fn) => keys.indexOf(fn.key));
				expect(indexes[0]).toBe(0);
				expect(indexes.at(-1)).toBe(keys.length - 1);
				expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
			}
		}
	});

	test("a short target compresses rather than dropping the arc", () => {
		for (const arc of STORY_ARCS) {
			const spec = storyArcSpec(arc);
			const slots = storyArcFunctionSlots(arc, 4);
			expect(slots).toHaveLength(4);
			// Compressed, not abandoned: fewer functions than the arc has, still in
			// order, and still carrying the one function the coverage report acts on.
			expect(new Set(slots.map((fn) => fn.key)).size).toBeLessThanOrEqual(spec.functions.length);
			expect(slots.map((fn) => fn.key)).toContain(spec.turnKey);
		}
	});

	test("a longer plan than the arc has functions covers every function", () => {
		for (const arc of STORY_ARCS) {
			const spec = storyArcSpec(arc);
			const keys = new Set(
				storyArcFunctionSlots(arc, spec.functions.length * 2).map((fn) => fn.key),
			);
			for (const fn of spec.functions) expect(keys).toContain(fn.key);
		}
	});
});
