/* Story planning: one plan, engagement that comes from the brief.
 *
 * The planner is stubbed here, so what these tests pin is the contract between
 * the planner and the plan: whatever engagement and language the planner returns
 * is what the story plan records. That is the point. The previous revision
 * synthesised engagement locally from a fixed template and returned the same
 * prehistoric-boredom hook for every brief — a stainless-steel-water-bottle
 * advert included — and its tests passed because they asserted those constants.
 * Asserting brief-linkage instead means a regression to a fixed template fails. */
import { fixtureArtifacts } from "./artifact-fixtures.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import {
	setStoryDrafterForTests,
	setStoryFramePlannerForTests,
	setStoryPlannerForTests,
	type StoryPlanDraft,
	type StoryPlanOpts,
	setStoryBibleAuthorForTests,
	type StorySlot,
} from "../../../lib/content-generator.ts";
import { planStoryArgs } from "./helpers/schemas.ts";
import { emitPlanTable, getStoryPlan, setStoryPlan } from "./plan-state.ts";
import { planStory } from "./__tests__/support/plan-story.ts";
import type { AgentJob } from "./model.ts";
import {
	storyArcCoverageViolations,
	storyArcSpec,
	type PovLifecycle,
	type PovShot,
	type PovStage,
	type VideoPlanKind,
} from "@maleo/shared";

const dbPath = join(tmpdir(), "maleo-story-plan.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;
const idBrief = "ceritakan selama 2 menit apa yang dilakukan manusia purba saat mereka bosan";

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

function videoJob(projectId: string, brief: string): AgentJob {
	return {
		id: `job-${Date.now()}`,
		projectId,
		contentType: "video",
		status: "running",
		events: [],
		scenes: [],
		textOverlays: [],
		infographicOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: fixtureArtifacts(projectId, [
			{
				kind: "research_bundle",
				payload: {
					topic: brief,
					sources: [
						{
							title: "Reference",
							url: "https://example.test/reference",
							excerpt: "A retrieved excerpt standing in for real research during tests.",
							retrievedAt: new Date(0).toISOString(),
						},
					],
					claimCount: 1,
				},
			},
		]),
		aspect: "9:16",
		brief,
		startedAt: Date.now(),
		// styleImageUrl skips the style-bible call; pre-seeded research artifact skips the
		// live research pass a factual brief would otherwise trigger.
		styleImageUrl: "/style.png",
	};
}

/** A planner that answers the brief it was handed, the way a real one would —
 *  so nothing in the assertions can be satisfied by a fixed template. */
function planetaryPlanner(): (
	brief: string,
	targetSec: number,
	opts?: StoryPlanOpts,
) => Promise<{
	planKind: VideoPlanKind;
	explainerContract?: {
		learningObjective: string;
		coreQuestion: string;
		misconception: string;
		conceptLadder: string[];
		evidenceMoment: string;
		transferTakeaway: string;
		visualGrammar: string;
	};
	povLifecycle?: PovLifecycle;
	sections: Array<{
		title: string;
		narration: string;
		visualPrompt: string;
		teachingMove?: "define" | "demonstrate";
		povStage?: PovStage;
		factual: boolean;
		sourceNotes: string;
		refKeys?: string[];
		shots?: Array<{ visualPrompt: string; cue?: string; refKeys?: string[]; povShot?: PovShot }>;
	}>;
	engagement: Record<string, unknown>;
	plannedReferences?: Array<{
		key: string;
		role: "character";
		label: string;
		description: string;
		visibilityMode: "hands_body" | "face";
		sectionIds?: string[];
		status: "planned";
	}>;
	language: string;
}> {
	return async (brief, _targetSec, opts) => {
		const subject = brief.split("\n")[0]!.slice(0, 60);
		const indonesian = /\b(ceritakan|jelaskan|bagaimana|mengapa)\b/i.test(brief);
		const povPrehistory =
			/\bpov\b/i.test(brief) && /\b(jaman batu|zaman batu|purba)\b/i.test(brief);
		const povBee = /\bpov\b/i.test(brief) && /\b(bee|bees|lebah|queen|ratu)\b/i.test(brief);
		const embodiedPov = povPrehistory || povBee;
		const inferredKind: VideoPlanKind =
			opts?.planKind ??
			(/\b(sprouts|explain|explainer|theory|effect|science|jelaskan)\b/i.test(brief)
				? "explainer"
				: "story");
		const explainerContract =
			inferredKind === "explainer"
				? {
						learningObjective: `Explain the core mechanism behind ${subject}`,
						coreQuestion: `Why does ${subject} matter?`,
						misconception: `${subject} is obvious or purely intuitive.`,
						conceptLadder: [
							`Define ${subject}`,
							`Show how ${subject} works`,
							`Apply ${subject} to everyday life`,
						],
						evidenceMoment: `Concrete example that demonstrates ${subject}`,
						transferTakeaway: `Use ${subject} to make a better decision tomorrow.`,
						visualGrammar: `Simple icons, arrows, labels, and comparison panels for ${subject}`,
					}
				: undefined;
		const plannedReferences = povPrehistory
			? [
					{
						key: "pov_protagonist",
						role: "character" as const,
						label: "POV manusia zaman batu",
						description: "First-person hands with rough hide wraps holding chipped stone tools.",
						visibilityMode: "hands_body" as const,
						sectionIds: ["sec-1", "sec-2"],
						status: "planned" as const,
					},
				]
			: undefined;
		const povLifecycle = povBee
			? {
					viewerRole: "worker bee",
					worldSystem: "pheromone-ruled hive colony",
					socialOrder: "queen, nursery workers, guards, foragers, replaceable sisters",
					bodyConstraints:
						"compound eyes, antennae, vibrating wings, pollen baskets, short lifespan",
					sensoryModel:
						"pheromone trails, wax heat, wing vibration, polarized sunlight, flower ultraviolet patterns",
					agencyLimits: "queen chemistry and colony hunger decide your work",
					survivalGoal: "feed larvae, serve the queen, and return nectar before your body fails",
					coreFear: "getting lost outside the hive before delivering food",
					tabooCost: "you never choose a life beyond service",
					transformationArc: "from sealed larva to cleaner, forager, exhausted disposable worker",
					endingFate: "die worn out while the colony replaces you without ceremony",
				}
			: undefined;
		const povShots = Array.from({ length: 8 }, (_, i) => ({
			visualPrompt: `First-person prehistoric survival shot ${i + 1} for ${subject}, rough hands and stone tools, cinematic documentary illustration, no modern objects, no text`,
			cue: `Bagian pertama tentang ${subject}.`,
			refKeys: ["pov_protagonist"],
			povShot: {
				cameraRole: (
					[
						"first_person_hands",
						"body_detail",
						"environment_establishing",
						"object_closeup",
						"threat_pov",
						"companion_view",
						"reflection_shadow",
						"system_view",
					] as const
				)[i]!,
				location: `prehistoric location ${i + 1}`,
				bodyAction: `survival action ${i + 1}`,
				propFocus: `stone tool detail ${i + 1}`,
				noveltyKey: `prehistoric-${i + 1}`,
			},
		}));
		const beeShots = [
			{
				visualPrompt:
					"bee-scale view from wax comb cell, antennae visible, newborn worker emerging, no text",
				cue: `Bagian pertama tentang ${subject}.`,
				povShot: {
					cameraRole: "body_detail" as const,
					location: "wax birth cell",
					bodyAction: "pushing out of comb",
					propFocus: "antennae and wax cap",
					noveltyKey: "bee birth body",
				},
			},
			{
				visualPrompt:
					"first-person worker bee legs cleaning nursery cell in warm hive, macro wax texture, no text",
				cue: `Bagian pertama tentang ${subject}.`,
				povShot: {
					cameraRole: "first_person_hands" as const,
					location: "nursery comb",
					bodyAction: "cleaning larval cell",
					propFocus: "wax cell rim",
					noveltyKey: "nursery cleaning",
				},
			},
			{
				visualPrompt:
					"wide bee-height establishing shot at hive entrance facing huge flower field, no text",
				cue: `Bagian pertama tentang ${subject}.`,
				povShot: {
					cameraRole: "environment_establishing" as const,
					location: "hive entrance",
					bodyAction: "launching into first flight",
					propFocus: "sunlit entrance",
					noveltyKey: "first flight field",
				},
			},
			{
				visualPrompt:
					"macro closeup of pollen dust sticking to hairy bee legs on giant flower petals, no text",
				cue: `Bagian pertama tentang ${subject}.`,
				povShot: {
					cameraRole: "object_closeup" as const,
					location: "flower field",
					bodyAction: "packing pollen on legs",
					propFocus: "pollen baskets",
					noveltyKey: "pollen leg detail",
				},
			},
			{
				visualPrompt:
					"threatening shadow of hornet crossing over flowers from tiny bee perspective, no text",
				cue: `Bagian pertama tentang ${subject}.`,
				povShot: {
					cameraRole: "threat_pov" as const,
					location: "flower field",
					bodyAction: "freezing under predator shadow",
					propFocus: "hornet shadow",
					noveltyKey: "hornet threat",
				},
			},
			{
				visualPrompt:
					"system view inside queen chamber, worker bees pressed around queen pheromone cloud, no text",
				cue: `Bagian pertama tentang ${subject}.`,
				povShot: {
					cameraRole: "system_view" as const,
					location: "queen chamber",
					bodyAction: "following pheromone pressure",
					propFocus: "queen and worker crowd",
					noveltyKey: "queen system",
				},
			},
		];
		return {
			planKind: inferredKind,
			explainerContract,
			povLifecycle,
			sections: [
				{
					title: `Pembuka: ${subject}`,
					narration: `Bagian pertama tentang ${subject}.`,
					visualPrompt: `opening shot for ${subject}`,
					...(inferredKind === "explainer" ? { teachingMove: "define" as const } : {}),
					...(embodiedPov
						? {
								povStage: {
									stage: "origin" as const,
									chapterFunction: "birth_trap" as const,
									statusShift: `beginning life as ${povBee ? "worker bee" : "POV survivor"}`,
									survivalProblem: povBee
										? "survive the colony's first assigned labor"
										: "survive the first harsh conditions",
									bodyCost: povBee
										? "soft new body hardens into a disposable worker"
										: "hands and body carry survival damage",
									sensoryAnchor: povBee
										? "wax heat, antennae, queen pheromone"
										: "rough hands, smoke, stone, cold",
									irreversibleConsequence: povBee
										? "work begins the countdown to exhaustion"
										: "childhood ends inside the survival system",
								},
							}
						: {}),
					...(povPrehistory ? { refKeys: ["pov_protagonist"], shots: povShots } : {}),
					...(povBee ? { shots: beeShots } : {}),
					factual: false,
					sourceNotes: "",
				},
				{
					title: `Inti: ${subject}`,
					narration: `Bagian kedua tentang ${subject}.`,
					visualPrompt: `middle shot for ${subject}`,
					...(inferredKind === "explainer" ? { teachingMove: "demonstrate" as const } : {}),
					factual: false,
					sourceNotes: "",
				},
			],
			engagement: {
				premise: `A story about ${subject}`,
				hook: `Opening hook for ${subject}`,
				tension: `What is unresolved about ${subject}`,
				escalation: `How ${subject} deepens`,
				turn: `The reveal in ${subject}`,
				resolution: `What ${subject} leaves you with`,
				emotionalArc: ["curiosity", "tension", "relief", "hope"],
				visualMotif: `recurring imagery of ${subject}`,
			},
			plannedReferences,
			language: opts?.language || (indonesian ? "id" : "en"),
		};
	};
}

beforeEach(async () => {
	// Plan time authors the story bible through a provider call, like the style
	// bible beside it. Stubbed so planning stays offline.
	setStoryBibleAuthorForTests(async () => ({
		subjects: [{ id: "test-subject", label: "test subject" }],
		locations: [{ id: "test-place", label: "test place" }],
		medium: "test medium",
		negatives: ["test negative"],
	}));
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
});

afterEach(async () => {
	setStoryBibleAuthorForTests(null);
	setStoryPlannerForTests(null);
	setStoryFramePlannerForTests(null);
	setStoryDrafterForTests(null);
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
});

async function planFor(brief: string, targetDurationSec: number) {
	setStoryPlannerForTests(planetaryPlanner());
	const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
	const job = videoJob(projectId, brief);
	const result = await planStory(job, { brief, targetDurationSec });
	return { job, result };
}

/* Planning through the real stage seams rather than the whole-planner override,
 * because what the arc cases pin is what the STAGES agree on: the frame chooses
 * the framing, the skeleton fixes the structure, the draft fills it. */
async function planWithStages(args: {
	brief: string;
	arc?: string;
	planKind?: VideoPlanKind;
	frame?: Record<string, unknown>;
}) {
	setStoryFramePlannerForTests(async () => ({
		planKind: "story",
		arc: "three_act",
		language: "en",
		engagement: { premise: "A premise.", turn: "The turn." },
		...args.frame,
	}));
	setStoryDrafterForTests(async (_brief: string, slots: readonly StorySlot[]) => ({
		sections: slots.map((slot) => ({
			slot: slot.index,
			title: `Slot ${slot.index}`,
			narration: `Narration about ${args.brief} for slot ${slot.index}.`,
			visualPrompt: `A picture for slot ${slot.index}`,
		})),
	}));
	const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
	const job = videoJob(projectId, args.brief);
	const result = await planStory(job, {
		brief: args.brief,
		targetDurationSec: 180,
		...(args.arc ? { arc: args.arc as never } : {}),
		...(args.planKind ? { planKind: args.planKind } : {}),
	});
	return { job, result };
}

async function planWithKind(brief: string, planKind: VideoPlanKind) {
	setStoryPlannerForTests(planetaryPlanner());
	const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
	const job = videoJob(projectId, brief);
	const result = await planStory(job, { brief, targetDurationSec: 120, planKind });
	return { job, result };
}

describe("story planning", () => {
	test("plan_story args accept omitted or explicit plan kind and reject invalid kind", () => {
		expect(planStoryArgs.parse({ brief: "make a video" }).planKind).toBeUndefined();
		expect(planStoryArgs.parse({ planKind: "explainer" }).planKind).toBe("explainer");
		expect(planStoryArgs.parse({ planKind: "auto" }).planKind).toBe("auto");
		expect(planStoryArgs.safeParse({ planKind: "lecture" }).success).toBe(false);
		expect(planStoryArgs.safeParse({ planKind: "pov" }).success).toBe(false);
	});

	test("plan_story args map plain-English structure words onto the enum and still reject unknown ones", () => {
		expect(planStoryArgs.parse({ structure: "sections" }).structure).toBe("narration_section");
		expect(planStoryArgs.parse({ structure: "Narration" }).structure).toBe("narration_section");
		expect(planStoryArgs.parse({ structure: "beats" }).structure).toBe("beat");
		expect(planStoryArgs.parse({ structure: "auto" }).structure).toBe("auto");
		expect(planStoryArgs.parse({ brief: "make a video" }).structure).toBeUndefined();
		expect(planStoryArgs.safeParse({ structure: "chapters" }).success).toBe(false);
	});

	test("a minimal Indonesian two-minute prompt produces one 120s narration-first story plan", async () => {
		const { job, result } = await planFor(idBrief, 120);

		expect(result.note).toContain("Review the story plan");
		expect(getStoryPlan(job)?.targetSec).toBe(120);

		const story = getStoryPlan(job);
		expect(story).toBeDefined();
		expect(story?.targetSec).toBe(120);
		expect(story?.structure).toBe("narration_section");
		expect(story?.planKind).toBe("story");

		// Exactly one plan artifact, and exactly one artifact EVENT for it. The
		// artifact array dedupes by kind, so only the event count can catch a flow
		// that emits the plan twice — which the delegating version did, once from
		// the longform flow and once from its caller, giving the chat two cards.
		expect(job.artifacts.filter((a) => a.kind === "story_plan")).toHaveLength(1);
		expect(
			job.events.filter((e) => e.kind === "artifact" && e.artifact.kind === "story_plan"),
		).toHaveLength(1);
	});

	test("the plan keeps the brief's language and topic", async () => {
		const { job } = await planFor(idBrief, 120);
		const story = getStoryPlan(job);

		expect(story?.language).toBe("id");
		expect(story?.planningBrief).toContain("manusia purba");
		expect(story?.sections.map((s: { narration: string }) => s.narration).join(" ")).toContain(
			"manusia purba",
		);
	});

	test("the plan carries a full engagement spine and ordered visuals", async () => {
		const { job } = await planFor(idBrief, 120);
		const story = getStoryPlan(job);
		const e = story!.engagement!;

		for (const field of [
			e.premise,
			e.hook,
			e.tension,
			e.escalation,
			e.turn,
			e.resolution,
			e.visualMotif,
		]) {
			expect(field?.length ?? 0).toBeGreaterThan(0);
		}
		expect(e.emotionalArc?.length ?? 0).toBeGreaterThanOrEqual(4);
		expect(
			story!.sections.flatMap((s: { visualPrompts?: string[] }) => s.visualPrompts ?? []).length,
		).toBeGreaterThanOrEqual(2);
	});

	/* The regression guard. A fixed engagement template passes every assertion
	 * above; it cannot pass this one. */
	test("engagement differs between two unrelated briefs", async () => {
		const bottle = "a 15 second ad for a stainless steel water bottle";
		const { job: idJob } = await planFor(idBrief, 120);
		const { job: adJob } = await planFor(bottle, 120);

		const a = getStoryPlan(idJob)!.engagement!;
		const b = getStoryPlan(adJob)!.engagement!;

		expect(a.hook).not.toBe(b.hook);
		expect(a.tension).not.toBe(b.tension);
		expect(a.visualMotif).not.toBe(b.visualMotif);
		// …and each refers to its own subject.
		expect(a.premise).toContain("manusia purba");
		expect(b.premise).toContain("water bottle");
	});

	/* The old language detector matched a word list containing "manusia",
	 * "purba" and "bosan" — topic words, not language markers — so an unrelated
	 * Indonesian brief came back as English. */
	test("an Indonesian brief unrelated to prehistory is still planned in Indonesian", async () => {
		const { job } = await planFor("jelaskan cara kerja mesin kopi espresso", 120);
		expect(getStoryPlan(job)?.language).toBe("id");
	});

	test("a short prompt plans beats through the same flow", async () => {
		const { job } = await planFor("a 15 second ad for a stainless steel water bottle", 15);
		const story = getStoryPlan(job);

		expect(story?.structure).toBe("beat");
		expect(story?.targetSec).toBe(15);
		// Same artifact type as the two-minute narrated plan.
		expect(job.artifacts.filter((a) => a.kind === "story_plan")).toHaveLength(1);
	});

	test("a sparse POV prehistory brief stores planned references and section keys", async () => {
		const { job } = await planFor("pov kamu hidup di jaman batu", 120);
		const story = getStoryPlan(job);

		expect(story?.plannedReferences?.[0]).toMatchObject({
			key: "pov_protagonist",
			role: "character",
			visibilityMode: "hands_body",
			status: "planned",
		});
		expect(story?.sections[0]?.refKeys).toEqual(["pov_protagonist"]);
		expect(story?.sections[0]?.visualRefKeys?.[0]).toEqual(["pov_protagonist"]);
		expect(story?.sections[0]?.visualPrompt).toContain("opening shot");
		expect(story?.sections[0]?.visualPrompts).toHaveLength(8);
		expect(story?.sections[0]?.visualPrompts?.[0]).toContain(
			"First-person prehistoric survival shot 1",
		);
		expect(story?.sections[0]?.visualPrompts?.[7]).toContain(
			"First-person prehistoric survival shot 8",
		);
	});

	test("a worker bee POV brief stores embodied lifecycle and diverse shot grammar", async () => {
		const { job } = await planFor(
			"pov when we birth as bee that working for a queen till we die",
			180,
		);
		const story = getStoryPlan(job);
		const section = story?.sections[0];

		expect(story?.planKind).toBe("story");
		expect(story?.povLifecycle?.viewerRole).toBe("worker bee");
		expect(story?.povLifecycle?.bodyConstraints).toContain("compound eyes");
		expect(story?.povLifecycle?.sensoryModel).toContain("pheromone");
		expect(story?.povLifecycle?.endingFate).toContain("replaces");
		expect(section?.povStage?.stage).toBe("origin");
		expect(section?.povStage?.sensoryAnchor).toContain("queen pheromone");
		expect(section?.visualPrompts).toHaveLength(6);
		expect(section?.povShots?.map((shot) => shot.cameraRole)).toEqual([
			"body_detail",
			"first_person_hands",
			"environment_establishing",
			"object_closeup",
			"threat_pov",
			"system_view",
		]);
		expect(section?.visualPrompts?.join(" ")).toContain("antennae");
		expect(section?.visualPrompts?.join(" ")).not.toContain("front-facing human");
	});

	test("plan_story args accept omitted or explicit arc and reject an invalid one", () => {
		expect(planStoryArgs.parse({ brief: "make a video" }).arc).toBeUndefined();
		expect(planStoryArgs.parse({ arc: "pov_lifecycle" }).arc).toBe("pov_lifecycle");
		expect(planStoryArgs.parse({ arc: "auto" }).arc).toBe("auto");
		expect(planStoryArgs.safeParse({ arc: "heros_journey" }).success).toBe(false);
		expect(planStoryArgs.safeParse({ arc: "three-act" }).success).toBe(false);
	});

	test("an explicit arc is recorded and is not overridden by inference", async () => {
		// The frame infers three_act; the caller asked for pov_lifecycle.
		const { job } = await planWithStages({
			brief: "a brief with no POV words in it",
			arc: "pov_lifecycle",
		});
		expect(getStoryPlan(job)?.arc).toBe("pov_lifecycle");
	});

	test("arc and plan kind resolve independently", async () => {
		const { job } = await planWithStages({
			brief: "compare two things",
			arc: "fichtean",
			planKind: "comparison",
		});
		const plan = getStoryPlan(job);
		expect(plan?.arc).toBe("fichtean");
		expect(plan?.planKind).toBe("comparison");
	});

	test("a plan kind's default arc applies only when inference yields nothing usable", async () => {
		const { job } = await planWithStages({
			brief: "a researched history",
			planKind: "documentary",
			frame: { arc: "not_an_arc" },
		});
		expect(getStoryPlan(job)?.arc).toBe("fichtean");
	});

	test("a persisted plan round-trips its arc, chapter functions and obligations", async () => {
		const { job } = await planWithStages({
			brief: "a brief about tide pools",
			frame: { arc: "story_circle" },
		});
		const plan = getStoryPlan(job)!;
		expect(plan.arc).toBe("story_circle");
		const order = storyArcSpec("story_circle").functions.map((fn) => fn.key);
		const indexes = plan.sections.map((section) => order.indexOf(section.chapterFunction ?? ""));
		expect(indexes.every((index) => index >= 0)).toBe(true);
		expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
		expect(plan.sections.every((section) => Boolean(section.chapterObligation))).toBe(true);
	});

	test("a plan persisted before arcs existed loads and renders, reporting no arc coverage", async () => {
		const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
		const job = videoJob(projectId, "a legacy brief");
		// Exactly the shape `setStoryPlan` wrote before arcs: no arc, no chapter
		// functions on the sections.
		setStoryPlan(job, 120, [
			{
				id: "sec-1",
				title: "One",
				narration: "Legacy narration.",
				visualPrompt: "a picture",
				estimatedDurationSec: 20,
			},
		]);
		const plan = getStoryPlan(job)!;
		expect(plan.arc).toBeUndefined();
		expect(plan.sections).toHaveLength(1);
		expect(
			storyArcCoverageViolations({
				arc: plan.arc,
				sections: plan.sections,
				engagement: plan.engagement,
			}),
		).toEqual([]);
		expect(() => emitPlanTable(job, plan.sections, "Story plan")).not.toThrow();
	});

	test("arc coverage violations are reported on the plan and approval still proceeds", async () => {
		// Every slot answers with the same emotion, so the emotional arc is flat.
		setStoryFramePlannerForTests(async () => ({
			planKind: "story",
			arc: "three_act",
			language: "en",
			engagement: { premise: "A premise.", turn: "The turn." },
		}));
		setStoryDrafterForTests(async (_brief: string, slots: readonly StorySlot[]) => ({
			sections: slots.map((slot) => ({
				slot: slot.index,
				title: `Slot ${slot.index}`,
				narration: `Narration ${slot.index}.`,
				visualPrompt: `Picture ${slot.index}`,
				emotion: "calm",
			})),
		}));
		const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
		const job = videoJob(projectId, "a flat brief");
		const result = await planStory(job, { brief: "a flat brief", targetDurationSec: 180 });
		expect(result.note).toContain("emotion_not_flat");
		expect(result.note).toContain("Advisory only");
		// Reported, never blocking: the plan is there and every section is drafted.
		const plan = getStoryPlan(job)!;
		expect(plan.sections.length).toBeGreaterThan(0);
		expect(plan.sections.some((section) => section.status === "failed")).toBe(false);
		expect(plan.sections.some((section) => section.needsDrafting)).toBe(false);
	});

	/* POV planning is a selectable arc, not a regex over the brief.
	 *
	 * What these two replace is `EMBODIED_POV_HINT` and the hundred lines of
	 * hardcoded bee narration it gated: any brief matching five topic words got a
	 * POV mode it may not have wanted, and a dead planner shipped bee prose about
	 * whatever the topic actually was. */
	test("the POV lifecycle arc is requestable for a brief with no POV topic words", async () => {
		const { job } = await planWithStages({
			brief: "how a municipal water treatment plant works",
			arc: "pov_lifecycle",
		});
		const plan = getStoryPlan(job)!;
		expect(plan.arc).toBe("pov_lifecycle");
		const povFunctions = storyArcSpec("pov_lifecycle").functions.map((fn) => fn.key);
		expect(
			plan.sections.every((section) => povFunctions.includes(section.chapterFunction ?? "")),
		).toBe(true);
	});

	test("a brief full of POV topic words is not forced into the POV arc", async () => {
		// "queen", "lebah", "hidup sebagai" — every word the deleted regex matched.
		const { job } = await planWithStages({
			brief: "Ceritakan bagaimana lebah pekerja melayani ratu, hidup sebagai koloni",
			frame: { arc: "fichtean", planKind: "documentary" },
		});
		const plan = getStoryPlan(job)!;
		expect(plan.arc).toBe("fichtean");
		expect(plan.povLifecycle).toBeUndefined();
		// And no bee narration arrives from anywhere but the drafter.
		expect(plan.sections.every((section) => section.narration.includes("lebah pekerja"))).toBe(
			true,
		);
	});

	test("a Sprouts-style concept brief becomes an explainer plan with learning fields", async () => {
		const { job } = await planFor("make a Sprouts-style explainer about the Pygmalion effect", 300);
		const story = getStoryPlan(job);

		expect(story?.planKind).toBe("explainer");
		expect(story?.explainerContract?.learningObjective).toContain("Pygmalion effect");
		expect(story?.explainerContract?.coreQuestion).toContain("Pygmalion effect");
		expect(story?.explainerContract?.conceptLadder.length).toBeGreaterThanOrEqual(2);
		expect(story?.sections[0]?.teachingMove).toBe("define");
		expect(story?.sections[1]?.teachingMove).toBe("demonstrate");
	});

	test("explicit plan kind wins over inference", async () => {
		for (const kind of [
			"story",
			"explainer",
			"product",
			"tutorial",
			"documentary",
			"listicle",
			"comparison",
		] as const) {
			const { job } = await planWithKind("explain attachment theory as a video", kind);
			expect(getStoryPlan(job)?.planKind).toBe(kind);
		}
	});

	test("planner drift in POV metadata is normalized instead of failing the plan", async () => {
		setStoryPlannerForTests(
			async () =>
				({
					planKind: "story",
					povLifecycle: [
						"viewerRole: worker bee",
						"bodyConstraints: compound eyes, antennae, wings, pollen baskets",
						"serves queen until exhaustion",
					],
					sections: [
						{
							title: "Birth",
							narration: "You chew through wax and enter the hive as a worker.",
							visualPrompt: "bee-scale birth cell, antennae visible, warm wax hive, no text",
							povStage: "newly emerged worker in the nursery comb",
							shots: [
								{
									visualPrompt: "bee-scale birth cell, antennae visible, no text",
									povShot: "body_detail",
								},
							],
							factual: false,
							sourceNotes: "",
						},
						{
							title: "Work",
							narration: "The queen's chemistry turns hunger into duty.",
							visualPrompt: "worker bee inside queen chamber, pheromone pressure, no text",
							povStage: "survivalProblem: obey pheromone commands while body wears down",
							shots: [
								{
									visualPrompt: "queen chamber system view, worker crowd, no text",
									povShot: "system_view",
								},
							],
							factual: false,
							sourceNotes: "",
						},
					],
					engagement: {
						premise: "Worker bee lifecycle.",
						hook: "You are born into work.",
						tension: "Your body belongs to the hive.",
						escalation: "Each job costs more energy.",
						turn: "Service is survival and erasure.",
						resolution: "The colony continues after you die.",
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
						visualMotif: "wax, antennae, pollen, queen pheromone",
					},
					language: "en",
				}) as unknown as StoryPlanDraft,
		);
		const projectId = (await createContentProject({ title: "Bee", type: "video" })).project.id;
		const job = videoJob(
			projectId,
			"pov when we birth as bee that working for a queen till we die",
		);

		const result = await planStory(job, { brief: job.brief, targetDurationSec: 180 });
		const story = getStoryPlan(job);

		expect(result.note).toContain("Review the story plan");
		expect(story?.povLifecycle?.viewerRole).toBe("worker bee");
		expect(story?.povLifecycle?.transformationArc).toBe("serves queen until exhaustion");
		expect(story?.sections[0]?.povStage?.statusShift).toBe(
			"newly emerged worker in the nursery comb",
		);
		expect(story?.sections[1]?.povStage?.survivalProblem).toBe(
			"obey pheromone commands while body wears down",
		);
		expect(story?.engagement?.emotionalArc).toEqual([
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

	test("an empty-sections planner response fails with a concise planning error", async () => {
		setStoryPlannerForTests(async () => ({ planKind: "story", sections: [] }));
		const projectId = (await createContentProject({ title: "Broken", type: "video" })).project.id;
		const job = videoJob(
			projectId,
			"pov when we birth as bee that working for a queen till we die",
		);

		await expect(planStory(job, { brief: job.brief, targetDurationSec: 180 })).rejects.toThrow(
			"Story planning failed: planner returned no story sections",
		);

		expect(getStoryPlan(job)).toBeNull();
	});
});
