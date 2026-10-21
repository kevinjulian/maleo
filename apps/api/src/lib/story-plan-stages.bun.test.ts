/* The three planning stages: frame, skeleton, draft.
 *
 * Every case here drives the real `planStorySections` through the stage seams
 * rather than the whole-planner seam, because what these tests are about is what
 * happens BETWEEN the stages — retries, degradation, and slots surviving a failed
 * draft. Nothing here spawns a model process. */
import { afterEach, describe, expect, test } from "bun:test";
import { STORY_ARCS, storyArcSpec, storyArcFunctionSlots, resolveWriterStyle } from "@maleo/shared";
import {
	planStoryFrame,
	planStorySections,
	setStoryDrafterForTests,
	setStoryFramePlannerForTests,
	storySkeleton,
	type StorySlot,
} from "./content-generator.ts";
import {
	directStorySequence,
	setStorySequenceDirectorForTests,
} from "./story/creative-director.ts";
import { setTextRunnerForTests } from "./text-runner.ts";

afterEach(() => {
	setStoryFramePlannerForTests(null);
	setStoryDrafterForTests(null);
	setStorySequenceDirectorForTests(null);
	setTextRunnerForTests(null);
});

const directionSections = [
	{
		id: "section-1",
		semanticBeatId: "beat-1",
		title: "One",
		narration: "First fact.",
		visualPrompt: "First image",
	},
	{
		id: "section-2",
		semanticBeatId: "beat-2",
		title: "Two",
		narration: "Second fact.",
		visualPrompt: "Second image",
	},
];

function directionResponse(over: Record<string, unknown> = {}) {
	return {
		beats: directionSections.map((section, index) => ({
			beatId: section.semanticBeatId,
			editorial: {
				purpose: index ? "reveal" : "establish",
				presentation: "narrative",
				visualConcept: `Concept ${index}`,
				noveltyKey: `novel-${index}`,
				sfxCue: null,
				...over,
			},
		})),
	};
}

function fullDirectionResponse(
	over: { entityId?: string; plannedReferences?: unknown[]; shots?: unknown[] } = {},
) {
	return {
		plannedReferences: over.plannedReferences ?? [],
		referenceAliases: over.entityId
			? [{ ref: `entity:${over.entityId}`, aliases: ["subject"] }]
			: [],
		beats: directionSections.map((section, index) => ({
			beatId: section.semanticBeatId,
			editorial: {
				purpose: index ? "reveal" : "establish",
				presentation: "narrative",
				visualConcept: `Concept ${index}`,
				noveltyKey: `novel-${index}`,
				sfxCue: null,
				shots: over.shots ?? [
					{
						index: 0,
						visualIntent: `Shot ${index}`,
						role: index ? "novelty" : "continuity",
						bindings: over.entityId ? [{ entityId: over.entityId }] : [],
						rationale: "Matches the narration.",
					},
				],
			},
		})),
	};
}

describe("sequence direction stage", () => {
	test("adds editorial decisions without changing authored story fields", async () => {
		setStorySequenceDirectorForTests(async () => directionResponse());
		const result = await directStorySequence(directionSections);
		expect(result.needsDirection).toBeUndefined();
		expect(
			result.sections.map(
				({ editorial: _editorial, motionGraphic: _motionGraphic, ...section }) => section,
			),
		).toEqual(directionSections);
		expect(result.sections.map((section) => section.editorial?.noveltyKey)).toEqual([
			"novel-0",
			"novel-1",
		]);
	});

	test("retries once, then marks draft instead of approving invalid direction", async () => {
		let calls = 0;
		setStorySequenceDirectorForTests(async () => {
			calls++;
			return directionResponse({ noveltyKey: "same" });
		});
		const result = await directStorySequence(directionSections);
		expect(calls).toBe(2);
		expect(result.needsDirection).toBe(true);
		expect(result.directionErrors?.[0]).toContain("repeated_treatment");
		expect(result.sections.some((section) => section.editorial)).toBe(false);
	});

	test("does not let disabled timeline data block direction", async () => {
		setStorySequenceDirectorForTests(async () =>
			directionResponse({
				presentation: "infographic",
				motionGraphic: { needed: false, kind: "none", purpose: "none", reason: "No source data" },
			}),
		);
		const result = await directStorySequence(directionSections, { allowInfographics: false });
		expect(result.needsDirection).toBeUndefined();
		expect(result.sections.map((section) => section.editorial?.presentation)).toEqual([
			"explainer",
			"explainer",
		]);
		expect(result.sections.every((section) => section.motionGraphic === undefined)).toBe(true);
	});

	test("receives asset-free project inputs and returns complete shot direction", async () => {
		let seen: unknown;
		setStorySequenceDirectorForTests(async (_sections, options) => {
			seen = options;
			return fullDirectionResponse({ entityId: "entity-1" });
		});
		const result = await directStorySequence(directionSections, {
			authoritativeReferences: true,
			roster: [{ id: "entity-1", role: "character", label: "Subject", description: "Blue coat" }],
			plannedReferences: [
				{
					key: "unused",
					role: "location",
					label: "Room",
					description: "Stone room",
					status: "planned",
				},
			],
			visual: "ink drawing",
			rules: "no captions",
			templateConstraints: { useData: false, maxVisualBeatSec: 6 },
		});
		expect(result.needsDirection).toBeUndefined();
		expect(result.sections[0]?.editorial?.shots?.[0]?.bindings).toEqual([{ entityId: "entity-1" }]);
		const serialized = JSON.stringify(seen);
		expect(serialized).toContain("Blue coat");
		expect(serialized).toContain("ink drawing");
		expect(serialized).not.toContain("http");
		expect(serialized).not.toContain("bible");
	});

	test("rejects missing or extra planned-shot direction", async () => {
		setStorySequenceDirectorForTests(async () => fullDirectionResponse({ shots: [] }));
		const result = await directStorySequence(directionSections, { authoritativeReferences: true });
		expect(result.needsDirection).toBe(true);
		expect(result.directionErrors?.[0]).toContain("shot_coverage");
	});

	test("retries correctable reference errors and keeps only final planned references", async () => {
		let calls = 0;
		setStorySequenceDirectorForTests(async () => {
			calls++;
			return calls === 1
				? fullDirectionResponse({ entityId: "off-roster" })
				: fullDirectionResponse();
		});
		const result = await directStorySequence(directionSections, {
			authoritativeReferences: true,
			plannedReferences: [
				{
					key: "frame-candidate",
					role: "character",
					label: "Old",
					description: "Dropped",
					status: "planned",
				},
			],
		});
		expect(calls).toBe(2);
		expect(result.needsDirection).toBeUndefined();
		expect(result.plannedReferences).toEqual([]);
	});

	test("keeps continued off-roster direction blocked after one retry", async () => {
		let calls = 0;
		setStorySequenceDirectorForTests(async () => {
			calls++;
			return fullDirectionResponse({ entityId: "off-roster" });
		});
		const result = await directStorySequence(directionSections, { authoritativeReferences: true });
		expect(calls).toBe(2);
		expect(result.needsDirection).toBe(true);
		expect(result.directionErrors?.[0]).toContain("unknown_entity");
	});

	test("does not retry an operator-only planned product blocker", async () => {
		let calls = 0;
		setStorySequenceDirectorForTests(async () => {
			calls++;
			const result = fullDirectionResponse({
				plannedReferences: [
					{ key: "product", role: "product", label: "Bottle", description: "Exact bottle" },
				],
				shots: [
					{
						index: 0,
						visualIntent: "Bottle close-up",
						role: "continuity",
						bindings: [{ plannedKey: "product" }],
						rationale: "The product is visible.",
					},
				],
			});
			result.referenceAliases = [{ ref: "planned:product", aliases: ["bottle"] }];
			return result;
		});
		const result = await directStorySequence(directionSections, { authoritativeReferences: true });
		expect(calls).toBe(1);
		expect(result.needsDirection).toBe(true);
		expect(result.directionErrors?.[0]).toContain("planned_product");
	});

	test("uses a 300 second timeout for the existing direction call", async () => {
		let timeoutMs: number | undefined;
		setTextRunnerForTests(async (_prompt, options) => {
			timeoutMs = options?.timeoutMs;
			return { stdout: JSON.stringify(fullDirectionResponse()), stderr: "" };
		});
		const result = await directStorySequence(directionSections, { authoritativeReferences: true });
		expect(result.needsDirection).toBeUndefined();
		expect(timeoutMs).toBe(300_000);
	});
});

function frameResponse(over: Record<string, unknown> = {}) {
	return {
		planKind: "story",
		arc: "three_act",
		language: "en",
		engagement: {
			premise: "A premise.",
			hook: "A hook.",
			turn: "The turn.",
			resolution: "The end.",
		},
		...over,
	};
}

/** A drafter that fills every slot it is asked for. */
function fillingDrafter(
	skipped: readonly number[] = [],
	onCall?: (slots: readonly StorySlot[]) => void,
) {
	return async (_brief: string, slots: readonly StorySlot[]) => {
		onCall?.(slots);
		return {
			sections: slots
				.filter((slot) => !skipped.includes(slot.index))
				.map((slot) => ({
					slot: slot.index,
					title: `Slot ${slot.index}`,
					narration: `Narration for slot ${slot.index}.`,
					visualPrompt: `A picture for slot ${slot.index}`,
				})),
		};
	};
}

describe("the frame stage", () => {
	test("retries exactly once before degrading", async () => {
		let calls = 0;
		setStoryFramePlannerForTests(async () => {
			calls++;
			throw new Error("exit 143");
		});
		const frame = await planStoryFrame("a brief", 120, 4, { language: "en" });
		expect(calls).toBe(2);
		expect(frame.degraded).toBe(true);
	});

	test("a retry that succeeds is not a degraded frame", async () => {
		let calls = 0;
		setStoryFramePlannerForTests(async () => {
			calls++;
			if (calls === 1) throw new Error("timed out");
			return frameResponse({ arc: "fichtean" });
		});
		const frame = await planStoryFrame("a brief", 120, 4, { language: "en" });
		expect(calls).toBe(2);
		expect(frame.degraded).toBe(false);
		expect(frame.arc).toBe("fichtean");
	});

	test("post-retry failure falls back to the plan kind's default arc and the job language", async () => {
		setStoryFramePlannerForTests(async () => {
			throw new Error("killed after 45s");
		});
		const frame = await planStoryFrame("a brief about bees", 120, 4, {
			language: "id",
			planKind: "documentary",
		});
		expect(frame.arc).toBe("fichtean");
		expect(frame.language).toBe("id");
		expect(frame.planKind).toBe("documentary");
		expect(frame.degraded).toBe(true);
		// Degrading never fabricates a spine about a topic nobody asked for.
		expect(frame.engagement).toBeUndefined();
	});

	test("no usable frame and no configured language fails visibly with the underlying error", async () => {
		setStoryFramePlannerForTests(async () => {
			throw new Error("planner subprocess exited");
		});
		await expect(planStoryFrame("a brief", 120, 4, {})).rejects.toThrow(
			/planner subprocess exited/,
		);
	});

	test("planning emits no narration when the frame is unplannable", async () => {
		setStoryFramePlannerForTests(async () => {
			throw new Error("planner subprocess exited");
		});
		setStoryDrafterForTests(async () => {
			throw new Error("the drafter must never be reached");
		});
		await expect(planStorySections("a brief", 120, {})).rejects.toThrow(
			/planner subprocess exited/,
		);
	});

	test("an explicit arc request survives whatever the frame inferred", async () => {
		setStoryFramePlannerForTests(async () => frameResponse({ arc: "story_circle" }));
		const frame = await planStoryFrame("a brief", 120, 4, { arc: "pov_lifecycle", language: "en" });
		expect(frame.arc).toBe("pov_lifecycle");
	});

	test("an arc the model invented degrades to the plan kind default, not to a throw", async () => {
		setStoryFramePlannerForTests(async () => frameResponse({ arc: "heros_journey" }));
		const frame = await planStoryFrame("a brief", 120, 4, { language: "en" });
		expect(frame.arc).toBe("three_act");
		expect(frame.degraded).toBe(false);
	});

	test("the frame produces framing and no narration", async () => {
		setStoryFramePlannerForTests(async () => frameResponse());
		const frame = await planStoryFrame("a brief", 120, 4, {});
		expect(frame).toMatchObject({ planKind: "story", arc: "three_act", language: "en" });
		expect(frame.engagement?.hook).toBe("A hook.");
		expect(JSON.stringify(frame)).not.toContain("narration");
	});

	test("the frame carries the grounding decision and subject-fitting questions", async () => {
		setStoryFramePlannerForTests(async () =>
			frameResponse({
				planKind: "explainer",
				grounding: {
					needed: true,
					questions: [
						"how does a heat pump move heat against a gradient",
						"typical heat pump coefficient of performance",
					],
				},
			}),
		);
		const frame = await planStoryFrame("how a heat pump works", 120, 4, {});
		expect(frame.grounding.needed).toBe(true);
		expect(frame.grounding.questions).toHaveLength(2);
		// The questions are this subject's, not a fixed template's.
		expect(frame.grounding.questions.every((q) => /heat pump/.test(q))).toBe(true);
	});

	test("a brief with no factual keywords is still grounded when the frame says so", async () => {
		// The keyword heuristic this replaces matched none of these words.
		setStoryFramePlannerForTests(async () =>
			frameResponse({ grounding: { needed: true, questions: ["do octopuses dream"] } }),
		);
		const frame = await planStoryFrame("do octopuses dream", 120, 4, {});
		expect(frame.grounding.needed).toBe(true);
	});

	test("a degraded frame takes grounding from the plan kind, never from the brief", async () => {
		setStoryFramePlannerForTests(async () => {
			throw new Error("killed after 45s");
		});
		const documentary = await planStoryFrame("a brief about bees", 120, 4, {
			language: "id",
			planKind: "documentary",
		});
		expect(documentary.degraded).toBe(true);
		expect(documentary.grounding).toEqual({ needed: true, questions: [] });

		const story = await planStoryFrame("a brief about bees", 120, 4, {
			language: "id",
			planKind: "story",
		});
		expect(story.grounding.needed).toBe(false);
	});

	test("requireGrounding overrides a frame that asked for none, in that direction only", async () => {
		setStoryFramePlannerForTests(async () =>
			frameResponse({ grounding: { needed: false, questions: [] } }),
		);
		const forced = await planStoryFrame("a brief", 120, 4, { requireGrounding: true });
		expect(forced.grounding.needed).toBe(true);

		setStoryFramePlannerForTests(async () =>
			frameResponse({ grounding: { needed: true, questions: ["q"] } }),
		);
		const unforced = await planStoryFrame("a brief", 120, 4, {});
		expect(unforced.grounding.needed).toBe(true);
	});
});

describe("the skeleton stage", () => {
	test("derives one slot per resolved section, carrying function, obligation, emotion and budget", () => {
		let id = 0;
		const slots = storySkeleton("three_act", 6, 600, undefined, () => `stable-${++id}`);
		expect(slots).toHaveLength(6);
		for (const slot of slots) {
			expect(slot.chapterFunction.length).toBeGreaterThan(0);
			expect(slot.obligation.length).toBeGreaterThan(0);
			expect(slot.wordBudget).toBe(100);
			expect(slot.sectionId).toMatch(/^stable-/);
			expect(slot.semanticBeatId).toMatch(/^stable-/);
		}
	});

	test("slot functions are in the arc's canonical order", () => {
		for (const arc of STORY_ARCS) {
			const order = storyArcSpec(arc).functions.map((fn) => fn.key);
			const indexes = storySkeleton(arc, 8, 800).map((slot) => order.indexOf(slot.chapterFunction));
			expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
		}
	});

	test("a short target compresses the arc rather than dropping it", () => {
		const slots = storySkeleton("pov_lifecycle", 4, 200);
		expect(slots).toHaveLength(4);
		expect(slots.map((slot) => slot.chapterFunction)).toEqual(
			storyArcFunctionSlots("pov_lifecycle", 4).map((fn) => fn.key),
		);
		expect(slots.map((slot) => slot.chapterFunction)).toContain(
			storyArcSpec("pov_lifecycle").turnKey,
		);
		// The POV stage vocabulary rides along, from the arc rather than a second list.
		expect(slots.every((slot) => Boolean(slot.povStage))).toBe(true);
	});

	test("the writer style's opening move reaches the first slot and nothing else", () => {
		const style = resolveWriterStyle("second_person_immersive")!;
		const slots = storySkeleton("three_act", 5, 500, style);
		expect(slots[0]!.obligation).toContain(style.openingMove);
		for (const slot of slots.slice(1)) expect(slot.obligation).not.toContain(style.openingMove);
	});

	test("the skeleton calls no model", async () => {
		// Neither stage seam is installed; a skeleton that reached a model would have
		// to spawn the real text runner, and this returns synchronously instead.
		setStoryFramePlannerForTests(null);
		setStoryDrafterForTests(null);
		expect(storySkeleton("seven_point", 7, 700)).toHaveLength(7);
	});
});

describe("the draft stage", () => {
	test("section count and order match the skeleton", async () => {
		setStoryFramePlannerForTests(async () => frameResponse({ arc: "story_circle" }));
		setStoryDrafterForTests(fillingDrafter());
		const plan = await planStorySections("a brief", 240, { sectionCount: 8, wordBudget: 800 });
		expect(plan.sections).toHaveLength(8);
		expect(plan.arc).toBe("story_circle");
		expect(plan.sections.map((section) => section.chapterFunction)).toEqual(
			storyArcFunctionSlots("story_circle", 8).map((fn) => fn.key),
		);
		expect(plan.sections.every((section) => Boolean(section.chapterObligation))).toBe(true);
	});

	test("each section's emotion defaults from its arc function, and a deliberate choice survives", async () => {
		setStoryFramePlannerForTests(async () => frameResponse());
		setStoryDrafterForTests(async (_brief, slots: readonly StorySlot[]) => ({
			sections: slots.map((slot) => ({
				slot: slot.index,
				title: `Slot ${slot.index}`,
				narration: `Narration ${slot.index}.`,
				visualPrompt: `Picture ${slot.index}`,
				// Only the second section makes a deliberate choice.
				...(slot.index === 1 ? { emotion: "victory" } : {}),
			})),
		}));
		const plan = await planStorySections("a brief", 180, { sectionCount: 6, wordBudget: 600 });
		const defaults = storyArcFunctionSlots("three_act", 6).map((fn) => fn.defaultEmotion);
		expect(plan.sections[1]!.emotion).toBe("victory");
		expect(plan.sections[0]!.emotion).toBe(defaults[0]!);
		expect(plan.sections[5]!.emotion).toBe(defaults[5]!);
	});

	test("a failed slot is retried on its own, without recomputing the frame or the skeleton", async () => {
		let frameCalls = 0;
		setStoryFramePlannerForTests(async () => {
			frameCalls++;
			return frameResponse();
		});
		const asked: number[][] = [];
		const identities: string[][] = [];
		let attempts = 0;
		setStoryDrafterForTests(async (_brief, slots: readonly StorySlot[]) => {
			asked.push(slots.map((slot) => slot.index));
			identities.push(slots.map((slot) => `${slot.sectionId}/${slot.semanticBeatId}`));
			attempts++;
			// Slot 2 is missing from the first, whole-skeleton answer only.
			const skipped = attempts === 1 ? [2] : [];
			return fillingDrafter(skipped)(_brief, slots);
		});
		const plan = await planStorySections("a brief", 180, { sectionCount: 6, wordBudget: 600 });
		expect(frameCalls).toBe(1);
		// The retry asked for exactly one slot, against the skeleton that still existed.
		expect(asked).toEqual([[0, 1, 2, 3, 4, 5], [2]]);
		expect(identities[1]).toEqual([identities[0]![2]!]);
		expect(plan.sections).toHaveLength(6);
		expect(plan.sections[2]!.narration).toBe("Narration for slot 2.");
		expect(plan.sections[2]!.needsDrafting).toBeUndefined();
		expect(plan.sections[2]!.id).toBeTruthy();
		expect(plan.sections[2]!.semanticBeatId).toBeTruthy();
	});

	test("a permanently failed slot is kept, empty and marked — never dropped or substituted", async () => {
		setStoryFramePlannerForTests(async () => frameResponse());
		setStoryDrafterForTests(async (brief, slots: readonly StorySlot[]) =>
			fillingDrafter([3])(brief, slots),
		);
		const plan = await planStorySections("a brief", 180, { sectionCount: 6, wordBudget: 600 });
		expect(plan.sections).toHaveLength(6);
		const undrafted = plan.sections[3]!;
		expect(undrafted.needsDrafting).toBe(true);
		expect(undrafted.narration).toBe("");
		expect(undrafted.chapterFunction).toBe(storyArcFunctionSlots("three_act", 6)[3]!.key);
		// Every other slot still drafted, so one bad slot does not cost the plan.
		expect(plan.sections.filter((section) => section.needsDrafting)).toHaveLength(1);
	});

	test("a drafter that dies entirely leaves every slot marked rather than losing the plan", async () => {
		setStoryFramePlannerForTests(async () => frameResponse());
		setStoryDrafterForTests(async () => {
			throw new Error("exit 143");
		});
		const plan = await planStorySections("a brief", 180, { sectionCount: 5, wordBudget: 500 });
		expect(plan.sections).toHaveLength(5);
		expect(plan.sections.every((section) => section.needsDrafting === true)).toBe(true);
		expect(plan.sections.every((section) => section.narration === "")).toBe(true);
	});

	test("a degraded frame is recorded on the plan", async () => {
		setStoryFramePlannerForTests(async () => {
			throw new Error("timed out");
		});
		setStoryDrafterForTests(fillingDrafter());
		const plan = await planStorySections("a brief", 180, {
			sectionCount: 4,
			wordBudget: 400,
			language: "en",
		});
		expect(plan.frameDegraded).toBe(true);
		expect(plan.arc).toBe("three_act");
		expect(plan.language).toBe("en");
	});
});

/* Why a slot is empty, not just that it is.
 *
 * Both drafting failure paths used to swallow the cause, so every undrafted section
 * carried the same sentence whether the retry had timed out, returned unparseable
 * JSON, or answered with an empty narration. Reported on a real run: a ten-section
 * plan lost section 4 and nothing recorded which of those had happened, so the only
 * way to tell a transient outage from a slot the model keeps refusing was to read
 * the planner source. */
describe("an undrafted section records why it failed", () => {
	test("a drafter that never answers for the slot says so", async () => {
		setStoryFramePlannerForTests(async () => frameResponse());
		setStoryDrafterForTests(async (brief, slots: readonly StorySlot[]) =>
			fillingDrafter([3])(brief, slots),
		);
		const plan = await planStorySections("a brief", 180, { sectionCount: 6, wordBudget: 600 });

		expect(plan.sections[3]!.notes).toContain("returned no section for this slot");
		expect(plan.sections[3]!.notes).toContain("Re-run planning or edit it by hand");
	});

	test("an empty narration is named as such, not reported as a missing answer", async () => {
		setStoryFramePlannerForTests(async () => frameResponse());
		setStoryDrafterForTests(async (_brief, slots: readonly StorySlot[]) => ({
			sections: slots.map((slot) => ({
				slot: slot.index,
				title: `Slot ${slot.index}`,
				narration: slot.index === 2 ? "   " : `Narration for slot ${slot.index}.`,
				visualPrompt: `A picture for slot ${slot.index}`,
			})),
		}));
		const plan = await planStorySections("a brief", 180, { sectionCount: 5, wordBudget: 500 });

		expect(plan.sections[2]!.needsDrafting).toBe(true);
		expect(plan.sections[2]!.notes).toContain("empty narration");
	});

	test("an empty visual prompt is distinguished from an empty narration", async () => {
		setStoryFramePlannerForTests(async () => frameResponse());
		setStoryDrafterForTests(async (_brief, slots: readonly StorySlot[]) => ({
			sections: slots.map((slot) => ({
				slot: slot.index,
				title: `Slot ${slot.index}`,
				narration: `Narration for slot ${slot.index}.`,
				visualPrompt: slot.index === 1 ? "   " : `A picture for slot ${slot.index}`,
			})),
		}));
		const plan = await planStorySections("a brief", 180, { sectionCount: 4, wordBudget: 400 });

		expect(plan.sections[1]!.notes).toContain("empty visual prompt");
		expect(plan.sections[1]!.notes).not.toContain("empty narration");
	});

	test("a timeout is reported as a timeout, with its bound", async () => {
		setStoryFramePlannerForTests(async () => frameResponse());
		setStoryDrafterForTests(async () => {
			throw new Error("planner subprocess timed out");
		});
		const plan = await planStorySections("a brief", 180, { sectionCount: 3, wordBudget: 300 });

		for (const section of plan.sections) {
			expect(section.needsDrafting).toBe(true);
			expect(section.notes).toContain("timed out after 180s");
		}
	});

	test("any other thrown failure carries its own message through", async () => {
		setStoryFramePlannerForTests(async () => frameResponse());
		setStoryDrafterForTests(async () => {
			throw new Error("exit 143");
		});
		const plan = await planStorySections("a brief", 180, { sectionCount: 3, wordBudget: 300 });

		expect(plan.sections[0]!.notes).toContain("exit 143");
	});

	test("a slot the retry rescues carries no failure note at all", async () => {
		setStoryFramePlannerForTests(async () => frameResponse());
		let attempts = 0;
		setStoryDrafterForTests(async (brief, slots: readonly StorySlot[]) => {
			attempts++;
			return fillingDrafter(attempts === 1 ? [2] : [])(brief, slots);
		});
		const plan = await planStorySections("a brief", 180, { sectionCount: 5, wordBudget: 500 });

		expect(plan.sections[2]!.needsDrafting).toBeUndefined();
		expect(plan.sections[2]!.notes ?? "").not.toContain("Drafting failed");
	});
});

describe("a schema rejection is reported in words, not as a Zod dump", () => {
	test("an invalid section names the field and the problem", async () => {
		setStoryFramePlannerForTests(async () => frameResponse());
		setStoryDrafterForTests(async (_brief, slots: readonly StorySlot[]) => ({
			sections: slots.map((slot) => ({
				slot: slot.index,
				title: `Slot ${slot.index}`,
				narration: `Narration for slot ${slot.index}.`,
				// Empty rather than blank: this fails the draft schema before the
				// drafted-slot check ever sees it, so the cause arrives as a Zod issue list.
				visualPrompt: "",
			})),
		}));
		const plan = await planStorySections("a brief", 180, { sectionCount: 3, wordBudget: 300 });

		const note = plan.sections[0]!.notes ?? "";
		expect(note).toContain("the drafter returned an invalid section");
		expect(note).toContain("visualPrompt");
		expect(note).not.toContain('"code"');
		expect(note).not.toContain("[");
	});
});
