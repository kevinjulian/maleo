import { describe, expect, test } from "vite-plus/test";
import {
	NARRATION_MIN_SEC,
	POV_CAMERA_ROLES,
	POV_CHAPTER_FUNCTIONS,
	POV_LIFECYCLE_STAGES,
	VIDEO_PLAN_KINDS,
	explainerContractSchema,
	hasEnoughPovShotDiversity,
	normalizeVideoPlanKind,
	povCameraRoleSpread,
	povLifecycleSchema,
	povShotNoveltyKey,
	povShotSchema,
	povStageSchema,
	repeatedAdjacentPovShotIndexes,
	resolveStoryStructure,
	storyDensityFor,
	storyEngagementSchema,
	wordsPerSecWithBreaths,
	storyPlannedReferenceSchema,
} from "./story-plan.ts";

describe("resolveStoryStructure", () => {
	test("auto below the threshold plans beats", () => {
		expect(resolveStoryStructure("auto", 15)).toBe("beat");
		expect(resolveStoryStructure(undefined, 15)).toBe("beat");
		expect(resolveStoryStructure("auto", NARRATION_MIN_SEC - 1)).toBe("beat");
	});

	test("auto at or above the threshold plans narration sections", () => {
		expect(resolveStoryStructure("auto", NARRATION_MIN_SEC)).toBe("narration_section");
		expect(resolveStoryStructure("auto", 120)).toBe("narration_section");
	});

	// The previous revision's routing let the duration threshold override an
	// explicit request, so a two-minute beat video was silently narrated.
	test("an explicit request wins at any duration", () => {
		expect(resolveStoryStructure("beat", 120)).toBe("beat");
		expect(resolveStoryStructure("beat", 600)).toBe("beat");
		expect(resolveStoryStructure("narration_section", 10)).toBe("narration_section");
	});
});

describe("storyPlannedReferenceSchema", () => {
	test("accepts a planned POV protagonist without a materialized entity id", () => {
		const parsed = storyPlannedReferenceSchema.parse({
			key: "pov_protagonist",
			role: "character",
			label: "POV manusia zaman batu",
			description: "First-person hands, rough hide clothing, and chipped stone tools.",
			visibilityMode: "hands_body",
			sectionIds: [1, 2],
		});
		expect(parsed.status).toBe("planned");
		expect(parsed.entityId).toBeUndefined();
		expect(parsed.sectionIds).toEqual(["1", "2"]);
	});

	test("accepts a materialized reference with a durable entity id", () => {
		expect(
			storyPlannedReferenceSchema.parse({
				key: "elder",
				role: "character",
				label: "Tetua gua",
				description: "An older tribe member with ash markings.",
				visibilityMode: "face",
				entityId: "ref-elder",
				status: "materialized",
			}).entityId,
		).toBe("ref-elder");
	});

	test("accepts a generated draft awaiting approval", () => {
		expect(
			storyPlannedReferenceSchema.parse({
				key: "elder",
				role: "character",
				label: "Tetua gua",
				description: "An older tribe member with ash markings.",
				visibilityMode: "face",
				entityId: "ref-elder",
				status: "generated",
			}).status,
		).toBe("generated");
	});

	test("loads old environment planned references as locations", () => {
		expect(
			storyPlannedReferenceSchema.parse({
				key: "cafe",
				role: "environment",
				label: "Cafe",
				description: "Corner cafe layout",
				visibilityMode: "environment",
			}).role,
		).toBe("location");
	});
});

describe("video plan kinds", () => {
	test("exposes the supported closed set", () => {
		expect(VIDEO_PLAN_KINDS).toEqual([
			"story",
			"explainer",
			"product",
			"tutorial",
			"documentary",
			"listicle",
			"comparison",
		]);
		expect(normalizeVideoPlanKind("auto")).toBeUndefined();
		expect(normalizeVideoPlanKind(undefined)).toBeUndefined();
		expect(normalizeVideoPlanKind("explainer")).toBe("explainer");
	});

	test("validates explainer contracts", () => {
		const parsed = explainerContractSchema.parse({
			learningObjective: "Explain why expectations can change student outcomes.",
			coreQuestion: "Can belief change performance?",
			misconception: "Expectations are private thoughts with no classroom effect.",
			conceptLadder: ["Define expectation effects", "Show the experiment", "Apply it to feedback"],
			evidenceMoment: "Rosenthal-style classroom experiment",
			transferTakeaway: "Use expectations as observable teaching behavior.",
			visualGrammar: "Simple teacher/student icons, arrows, and before-after panels.",
		});
		expect(parsed.conceptLadder).toHaveLength(3);
		expect(explainerContractSchema.safeParse({ learningObjective: "only one field" }).success).toBe(
			false,
		);
	});
});

describe("embodied POV lifecycle contract", () => {
	test("validates optional bee lifecycle metadata", () => {
		expect(POV_CAMERA_ROLES).toContain("first_person_hands");
		expect(POV_LIFECYCLE_STAGES).toContain("assigned_role");
		expect(POV_CHAPTER_FUNCTIONS).toContain("body_cost");
		const lifecycle = povLifecycleSchema.parse({
			viewerRole: "worker bee",
			worldSystem: "pheromone-ruled hive colony",
			bodyConstraints: "compound eyes, antennae, wings, pollen baskets, short lifespan",
			sensoryModel: "smell trails, vibration, polarized sunlight, close-range macro vision",
			survivalGoal: "keep the colony and queen alive",
			endingFate: "die exhausted and be replaced by younger workers",
		});
		expect(lifecycle.viewerRole).toBe("worker bee");
		expect(povLifecycleSchema.parse({})).toEqual({});
	});

	test("validates section stage and shot grammar independently", () => {
		const stage = povStageSchema.parse({
			stage: "first_competence",
			chapterFunction: "first_work",
			statusShift: "from hive cleaner to forager",
			survivalProblem: "find nectar before rain destroys the scent trail",
			bodyCost: "wing muscles burn and pollen weighs down your legs",
			sensoryAnchor: "wax heat, queen pheromone, flower ultraviolet patterns",
			irreversibleConsequence: "outside work starts the countdown to death",
		});
		const shot = povShotSchema.parse({
			cameraRole: "body_detail",
			location: "hive entrance",
			bodyAction: "legs gripping wax edge before first flight",
			propFocus: "pollen baskets",
			noveltyKey: "macro legs at hive threshold",
		});
		expect(stage.stage).toBe("first_competence");
		expect(shot.cameraRole).toBe("body_detail");
	});

	test("normalizes planner drift for POV objects", () => {
		expect(povStageSchema.parse("newly emerged worker in nursery comb")).toEqual({
			statusShift: "newly emerged worker in nursery comb",
		});
		expect(povStageSchema.parse("bodyCost: wing muscles start failing")).toEqual({
			bodyCost: "wing muscles start failing",
		});
		expect(
			povLifecycleSchema.parse([
				"viewerRole: worker bee",
				"bodyConstraints: compound eyes and antennae",
				"die exhausted beside the hive",
			]),
		).toEqual({
			viewerRole: "worker bee",
			bodyConstraints: "compound eyes and antennae",
			transformationArc: "die exhausted beside the hive",
		});
		expect(povShotSchema.parse("threat_pov")).toEqual({ cameraRole: "threat_pov" });
		expect(povShotSchema.parse("antennae brushing wax wall")).toEqual({
			noveltyKey: "antennae brushing wax wall",
		});
	});

	test("detects repeated adjacent POV shots", () => {
		const repeated = [
			{
				cameraRole: "first_person_hands" as const,
				location: "wax comb",
				bodyAction: "cleaning cell",
				noveltyKey: "one",
			},
			{
				cameraRole: "first_person_hands" as const,
				location: "Wax   comb",
				bodyAction: "cleaning-cell",
				noveltyKey: "two",
			},
			{
				cameraRole: "object_closeup" as const,
				location: "nursery cell",
				bodyAction: "feeding larva",
				noveltyKey: "three",
			},
		];
		expect(povShotNoveltyKey(repeated[0]!)).toBe("first_person_hands|wax comb|cleaning cell");
		expect(repeatedAdjacentPovShotIndexes(repeated)).toEqual([1]);
		expect(hasEnoughPovShotDiversity(repeated)).toBe(false);
	});

	test("accepts diverse bee foraging shots", () => {
		const diverse = [
			{
				cameraRole: "environment_establishing" as const,
				location: "hive entrance",
				bodyAction: "launching into sunlight",
				propFocus: "comb edge",
				noveltyKey: "hive launch",
			},
			{
				cameraRole: "body_detail" as const,
				location: "flower field",
				bodyAction: "pollen sticking to legs",
				propFocus: "pollen baskets",
				noveltyKey: "pollen legs",
			},
			{
				cameraRole: "threat_pov" as const,
				location: "flower field",
				bodyAction: "freezing under hornet shadow",
				propFocus: "hornet shadow",
				noveltyKey: "hornet threat",
			},
			{
				cameraRole: "system_view" as const,
				location: "return corridor",
				bodyAction: "waggle dance among workers",
				propFocus: "queen pheromone crowd",
				noveltyKey: "hive dance",
			},
		];
		expect(povCameraRoleSpread(diverse)).toEqual({
			distinctRoles: 4,
			hasDistinctDetailFocus: true,
		});
		expect(hasEnoughPovShotDiversity(diverse)).toBe(true);
	});
});

describe("story engagement schema", () => {
	test("normalizes common model emotion synonyms into the closed renderer set", () => {
		const engagement = storyEngagementSchema.parse({
			emotionalArc: [
				"calm",
				"tender",
				"focused",
				"warm",
				"tense",
				"wonder",
				"purposeful",
				"reflective",
			],
		});

		expect(engagement.emotionalArc).toEqual([
			"calm",
			"hope",
			"curiosity",
			"hope",
			"tension",
			"curiosity",
			"curiosity",
			"calm",
		]);
	});
});

describe("storyDensityFor", () => {
	test("beat structure buys more, shorter sections than narration", () => {
		const beat = storyDensityFor("beat", 60);
		const narration = storyDensityFor("narration_section", 60);
		expect(beat.sectionCount).toBeGreaterThan(narration.sectionCount);
		expect(beat.wordsPerSec).toBeLessThan(narration.wordsPerSec);
	});

	test("section count scales with duration and stays clamped", () => {
		expect(storyDensityFor("beat", 15).sectionCount).toBeLessThan(
			storyDensityFor("beat", 60).sectionCount,
		);
		expect(storyDensityFor("beat", 6000).sectionCount).toBeLessThanOrEqual(12);
		expect(storyDensityFor("narration_section", 60_000).sectionCount).toBeLessThanOrEqual(24);
		expect(storyDensityFor("narration_section", 5).sectionCount).toBeGreaterThanOrEqual(4);
	});

	/* The pre-writer-style numbers, pinned. Every caller without a writer style
	 * still gets exactly these, so adopting the feature cannot change the length of
	 * a video nobody opted in for. */
	test("omitting a breath rate reproduces the original rates exactly", () => {
		expect(storyDensityFor("beat", 60).wordsPerSec).toBe(1.6);
		expect(storyDensityFor("narration_section", 60).wordsPerSec).toBe(2.6);
		expect(storyDensityFor("beat", 60, undefined).wordsPerSec).toBe(1.6);
	});

	test("a breath rate lowers the rate a target really buys", () => {
		const plain = storyDensityFor("narration_section", 60).wordsPerSec;
		const breathed = storyDensityFor("narration_section", 60, {
			sentencesPerHundredWords: 8,
			sentencePauseSec: 0.35,
		}).wordsPerSec;
		expect(breathed).toBeLessThan(plain);
	});

	test("denser prose buys fewer words at the same target", () => {
		const sparse = storyDensityFor("narration_section", 60, {
			sentencesPerHundredWords: 4,
			sentencePauseSec: 0.35,
		}).wordsPerSec;
		const dense = storyDensityFor("narration_section", 60, {
			sentencesPerHundredWords: 12,
			sentencePauseSec: 0.35,
		}).wordsPerSec;
		expect(dense).toBeLessThan(sparse);
	});

	test("section count ignores the breath rate", () => {
		const plain = storyDensityFor("narration_section", 600).sectionCount;
		const breathed = storyDensityFor("narration_section", 600, {
			sentencesPerHundredWords: 12,
			sentencePauseSec: 0.35,
		}).sectionCount;
		expect(breathed).toBe(plain);
	});
});

describe("wordsPerSecWithBreaths", () => {
	test("leaves the rate untouched with no breath rate", () => {
		expect(wordsPerSecWithBreaths(2.6, undefined)).toBe(2.6);
	});

	/* A template with no sentence pause inserts no silence, so there is nothing to
	 * pay for — and a zero density means no sentence boundaries to pause at. */
	test("leaves the rate untouched when there is no silence to pay for", () => {
		expect(wordsPerSecWithBreaths(2.6, { sentencesPerHundredWords: 8, sentencePauseSec: 0 })).toBe(
			2.6,
		);
		expect(
			wordsPerSecWithBreaths(2.6, { sentencesPerHundredWords: 0, sentencePauseSec: 0.35 }),
		).toBe(2.6);
	});

	/* The budget this produces must actually fit the target: speech time plus the
	 * breaths those words earn should land back on the requested duration. */
	test("the words it buys fit the target once their breaths are paid", () => {
		const targetSec = 120;
		const breath = { sentencesPerHundredWords: 9, sentencePauseSec: 0.35 };
		const words = targetSec * wordsPerSecWithBreaths(2.6, breath);
		const speechSec = words / 2.6;
		const breathSec = ((words * breath.sentencesPerHundredWords) / 100) * breath.sentencePauseSec;
		expect(speechSec + breathSec).toBeCloseTo(targetSec, 6);
	});
});
