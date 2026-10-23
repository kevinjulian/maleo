import {
	MAX_STORY_SHOTS_PER_SECTION,
	SHORTFORM_SCENE_DURATION_RULE,
} from "./content-generator-constants.ts";
import { parseJson, type LockedVisualConstraints } from "./story/authoring-utils.ts";
import {
	directStorySequence,
	hasStorySequenceDirectorOverride,
	type StoryDirectionOptions,
} from "./story/creative-director.ts";
import { z } from "zod";
import {
	EMOTIONS,
	EXPLAINER_TEACHING_MOVES,
	MIN_SHORTFORM_SCENE_SEC,
	MAX_SHORTFORM_SCENE_SEC,
	POV_CHAPTER_FUNCTIONS,
	STORY_ARCS,
	VIDEO_PLAN_KINDS,
	defaultGroundingFor,
	explainerContractSchema,
	povLifecycleSchema,
	povShotSchema,
	povStageSchema,
	resolveStoryArc,
	storyArcFunctionSlots,
	storyBibleSchema,
	storyEditorialDecisionSchema,
	storyEngagementSchema,
	storyGroundingSchema,
	storyPlannedReferenceSchema,
	type Emotion,
	type ExplainerContract,
	type PovLifecycle,
	type StoryArc,
	type StoryArcRequest,
	type StoryBible,
	type StoryEngagement,
	type StoryGrounding,
	type StoryPlannedReference,
	type StoryStructure,
	type VideoPlanKind,
	type WriterStyleProfile,
} from "@maleo/shared";
import { runPrompt } from "./text-runner.ts";
import { renderPrompt, type RenderedPrompt } from "./prompts/registry.ts";
import { oneOf } from "@maleo/shared";

const MAX_CLIP_DURATION_SEC = 60;
/* Plan-review granularity only. Planned shots are the operator's approved visual
 * INTENT, fed into per-beat authoring; how many visuals a section actually gets
 * is decided later, from measured audio. Nothing budgets shots against a guessed
 * beat count any more — that arithmetic is what made every section plan fewer
 * shots than the pipeline needed beats for. */

// Clamp instead of rejecting. The AI occasionally returns out-of-range
// durations; clamping keeps chat edits applying rather than failing with
// "Couldn't apply that".
const clampedDuration = (fallback: number) =>
	z
		.number()
		.transform((n) => Math.min(Math.max(1, n), MAX_CLIP_DURATION_SEC))
		.default(fallback);
const clampedSceneDuration = (fallback: number) =>
	z
		.number()
		.transform((n) => Math.min(Math.max(MIN_SHORTFORM_SCENE_SEC, n), MAX_SHORTFORM_SCENE_SEC))
		.default(fallback);

const videoSceneSchema = z.object({
	name: z.string().min(1),
	durationSec: clampedSceneDuration(4),
	shot: z.string().min(1),
	move: z.string().min(1),
	transition: z
		.enum(["cut", "fade", "slide", "zoom", "wipe", "flip", "clock_wipe"])
		.default("fade"),
	visual: z.string().min(1),
	action: z.string().default(""),
	voiceover: z.string().min(1),
	sfx: z.string().default(""),
	visualClips: z
		.array(
			z.object({
				kind: z.enum(["image", "video"]).default("image"),
				label: z.string().min(1),
				url: z.string().default(""),
				startSec: z.number().min(0).default(0),
				durationSec: clampedDuration(4),
				primary: z.boolean().optional(),
			}),
		)
		.optional(),
	audioClips: z
		.array(
			z.object({
				kind: z.enum(["voiceover", "sfx", "music"]),
				label: z.string().min(1),
				content: z.string().min(1),
				startSec: z.number().min(0).default(0),
				durationSec: clampedDuration(4),
			}),
		)
		.optional(),
});

const generatedContentSchema = z.object({
	type: z.literal("video"),
	title: z.string().min(1),
	scenes: z.array(videoSceneSchema).min(3).max(12),
});

export type { LockedVisualConstraints } from "./story/authoring-utils.ts";

export type GeneratedContent = z.infer<typeof generatedContentSchema>;

// ── Creative-direction router ──
// Split free-text direction into story/visual/voice channels so each reaches
// only its stage (story→plan/research, visual→image, voice→voiceover). Test seam
// mirrors the intent classifier so deterministic tests skip the subprocess.
const directionRouteSchema = z
	.object({
		story: z.string().trim().max(2000).default(""),
		visual: z.string().trim().max(2000).default(""),
		voice: z.string().trim().max(2000).default(""),
		/** Hard constraints. Defaulted, so a router response from before rules existed
		 *  (or a model that omits the key) still parses instead of failing the split. */
		rules: z.string().trim().max(2000).default(""),
	})
	.strict();
export type DirectionRoute = z.infer<typeof directionRouteSchema>;

let directionRouterOverride: ((raw: string) => Promise<DirectionRoute>) | null = null;
export function setDirectionRouterForTests(
	fn: ((raw: string) => Promise<DirectionRoute>) | null,
): void {
	directionRouterOverride = fn;
}

export function directionRouterRequest(raw: string): RenderedPrompt {
	return renderPrompt("prompt:content:directionRouterPrompt", { raw });
}

export function directionRouterPrompt(raw: string): string {
	return directionRouterRequest(raw).text;
}

/** Route free-text direction into channels. Empty input → empty channels. On any
 *  failure the raw text falls back to the story channel (never visual) so a
 *  router outage cannot redirect research off-subject. */
export async function routeDirection(raw: string): Promise<DirectionRoute> {
	const trimmed = raw.trim();
	if (!trimmed) return { story: "", visual: "", voice: "", rules: "" };
	if (directionRouterOverride) return directionRouterOverride(trimmed);
	try {
		const { stdout } = await runPrompt(directionRouterRequest(trimmed), { timeoutMs: 30_000 });
		const parsed = directionRouteSchema.safeParse(parseJson(stdout));
		if (parsed.success) return parsed.data;
	} catch {
		/* fall through */
	}
	return { story: trimmed, visual: "", voice: "", rules: "" };
}

export interface EditVideoSceneInput {
	name: string;
	durationSec: number;
	shot: string;
	move: string;
	transition: string;
	visual: string;
	action?: string;
	voiceover: string;
	sfx?: string;
}
export interface EditVideoInput {
	scenes: EditVideoSceneInput[];
	instruction: string;
	audience?: string;
	format?: string;
}

// Incremental edit: apply a natural-language instruction to an existing video
// storyboard, changing as little as possible. Returns the full updated
// storyboard so the client can diff/merge (preserving frames on untouched scenes).
export async function editVideoStoryboard(input: EditVideoInput): Promise<GeneratedContent> {
	const prompt = `You are editing a short-form video storyboard for the Maleo create flow.
Return JSON only. No markdown. No explanation.
Apply this instruction to the storyboard, changing as little as possible:
Instruction: ${input.instruction}
Target audience: ${input.audience?.trim() || "general audience"}
Aspect ratio: ${input.format || "9:16"}

Current storyboard JSON:
${JSON.stringify({ type: "video", title: "", scenes: input.scenes }, null, 2)}

Return the FULL updated storyboard in this schema:
{
  "type": "video",
  "title": "short working title",
  "scenes": [
    { "name": "...", "durationSec": 4, "shot": "...", "move": "...", "transition": "cut|fade|slide|zoom|wipe|flip|clock_wipe", "visual": "...", "action": "...", "voiceover": "...", "sfx": "..." }
  ]
}

Rules:
- Keep scenes the instruction does NOT mention byte-for-byte identical (same name, visual, voiceover) so their generated frames are preserved.
- Only add/remove/modify scenes the instruction asks for.
- Scene durationSec must stay within ${SHORTFORM_SCENE_DURATION_RULE}. Preserve an existing 3s scene as 3s unless the instruction changes pacing.
- 3-12 scenes total.`;
	const { stdout } = await runPrompt(prompt, { timeoutMs: 120_000 });
	return generatedContentSchema.parse(parseJson(stdout));
}

/* ════ Longform planner: sections-first (narration + visual) ════ */
const longformSectionSchema = z.object({
	id: z.string().min(1).optional(),
	semanticBeatId: z.string().min(1).optional(),
	locked: z.boolean().optional(),
	title: z.string().min(1),
	/* Empty is legal here and nowhere else: an undrafted slot keeps its place in the
	 * plan with no narration. Every drafted section is checked for non-empty
	 * narration in code, where the retry that fixes it lives. */
	narration: z.string(),
	visualPrompt: z.string().min(1),
	teachingMove: z.preprocess(
		(value) =>
			typeof value === "string"
				? oneOf(value.trim().toLowerCase(), EXPLAINER_TEACHING_MOVES)
				: undefined,
		z.enum(EXPLAINER_TEACHING_MOVES).optional(),
	),
	// Ordered image prompts for this section. When present (and length > 1) the
	// section's single voiceover plays over multiple images that swap during the
	// narration, so a long section isn't one static frame. visualPrompt stays as the
	// primary/first shot for back-compat. Each shot may be a bare prompt string
	// (legacy) or { visualPrompt, cue } where cue is the exact narration sentence/
	// phrase that shot illustrates — used to time the shot to the narration's beat.
	shots: z
		.array(
			z.union([
				z.string().min(1),
				z.object({
					visualPrompt: z.string().min(1),
					cue: z.string().optional(),
					refKeys: z.array(z.string().min(1)).optional(),
					povShot: povShotSchema.optional(),
				}),
			]),
		)
		.min(1)
		.max(MAX_STORY_SHOTS_PER_SECTION)
		.optional(),
	povStage: povStageSchema.optional(),
	/* This section's job in the plan's arc. Written by the SKELETON, not by the
	 * drafter — the draft fills a slot, it does not choose which slot it is. Kept
	 * optional because a plan parsed from a legacy planner response has none. */
	chapterFunction: z.string().min(1).optional(),
	chapterObligation: z.string().min(1).optional(),
	/* A slot whose draft never succeeded. Narration is deliberately allowed to be
	 * empty on the schema — an undrafted slot must survive parsing so it can be
	 * shown as needing drafting, rather than being dropped or substituted. The draft
	 * stage is what decides a slot failed; it treats empty narration as a failure
	 * and only sets this after its retry. */
	needsDrafting: z.boolean().optional(),
	refKeys: z.array(z.string().min(1)).optional(),
	notes: z.string().optional(),
	sourceNotes: z.string().optional(),
	factual: z.boolean().optional(),
	// Real cited source URLs, chosen by the planner from the provided evidence
	// only. Validated against the known set by the caller (citation validation).
	sourceUrls: z.array(z.string()).optional(),
	// Exact supporting quotes. Caller verifies each normalized quote is present in
	// the retrieved excerpt before a section may be called citation-verified.
	sourceEvidence: z
		.array(z.object({ url: z.string(), quote: z.string().min(20).max(180) }))
		.optional(),
	editorial: storyEditorialDecisionSchema.optional(),
	requiredReferences: z
		.array(
			z
				.object({
					entityId: z.string().min(1).optional(),
					plannedKey: z.string().min(1).optional(),
				})
				.strict()
				.refine((binding) => !!binding.entityId !== !!binding.plannedKey, {
					message: "a required reference names exactly one source",
				}),
		)
		.optional(),
	// Felt tone of the section, used to pick a background-music cue. An unknown or
	// missing value degrades to absent rather than failing the whole plan parse: a
	// section with no emotion falls back to the template's default cue, which is a
	// far better outcome than losing a generated plan over one bad label.
	emotion: z.preprocess(
		(value) =>
			typeof value === "string" ? oneOf(value.trim().toLowerCase(), EMOTIONS) : undefined,
		z.enum(EMOTIONS).optional(),
	),
});
export const storyPlanSchema = z
	.object({
		sections: z.array(longformSectionSchema).min(1).max(40),
		planKind: z.enum(VIDEO_PLAN_KINDS).default("story"),
		/** The arc the skeleton was derived from. Absent for a plan from a test seam or
		 *  a legacy planner response, which then reports no arc coverage. */
		arc: z.enum(STORY_ARCS).optional(),
		/** The frame stage failed and the arc and language came from defaults. */
		frameDegraded: z.boolean().optional(),
		explainerContract: explainerContractSchema.optional(),
		povLifecycle: povLifecycleSchema.optional(),
		/* Story engagement, produced by the same call that drafts the sections. It is
		 * the planner's job because it must derive from the brief: the previous
		 * revision synthesised it locally from a fixed template and returned the same
		 * hook, tension and visual motif for every topic. Optional so an older or
		 * terser planner response still yields a usable plan. */
		engagement: storyEngagementSchema.partial().optional(),
		plannedReferences: z.array(storyPlannedReferenceSchema).max(12).optional(),
		referenceAliases: z
			.array(
				z
					.object({
						ref: z.string().min(1),
						aliases: z.array(z.string().trim().min(1)).default([]),
					})
					.strict(),
			)
			.optional(),
		/* BCP-47-ish tag for the narration the planner actually wrote, echoed back so
		 * the plan records the language rather than guessing it from topic words. */
		language: z.string().optional(),
		/** Direction failed twice. Keep draft reviewable, but block approval/assets. */
		needsDirection: z.boolean().optional(),
		/** The failure needs the operator, not another attempt. */
		directionBlocked: z.boolean().optional(),
		directionErrors: z.array(z.string().min(1)).optional(),
	})
	.superRefine((plan, ctx) => {
		if (plan.planKind === "explainer" && !plan.explainerContract) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["explainerContract"],
				message: "explainerContract is required when planKind is explainer",
			});
		}
	});
export type StoryPlanSection = z.infer<typeof longformSectionSchema>;
export type StoryPlanDraft = z.infer<typeof storyPlanSchema>;

/** Untrusted retrieved evidence handed to the planner. Page text is DATA, never
 *  instructions — the prompt says so explicitly. */
export interface StoryResearchEvidence {
	sources: Array<{ url: string; title: string; excerpt: string }>;
}
export interface StoryPlanOpts {
	sectionCount?: number;
	wordBudget?: number;
	research?: StoryResearchEvidence;
	/** Narration language when the job pins one. Unset means "follow the brief". */
	language?: string;
	/** Beat-driven or narration-driven, so density guidance matches the structure. */
	structure?: StoryStructure;
	/** Explicit kind request. Unset means the planner chooses from the brief. */
	planKind?: VideoPlanKind;
	/** Explicit arc request. `auto` or unset defers to what the frame stage infers,
	 *  and then to the plan kind's default. An explicit arc is never overridden. */
	arc?: StoryArcRequest;
	/* What the planner's `visualPrompt` text must not contradict. Supplied for
	 * the same reason the style bible now gets it: a planner that has never been
	 * told the project is locked to a sketch stickman will happily write
	 * "prehistoric people gather round a fire", and the compiler downstream is
	 * then left choosing between the operator's lock and the planner's prose. */
	locked?: LockedVisualConstraints;
	/* The workspace's narration craft. Governs how the narration is WRITTEN and
	 * nothing else — it never reaches `authorStoryBeatVisuals` or speech synthesis,
	 * because sentence rhythm is not something an image provider or a TTS voice
	 * renders. */
	writerStyle?: WriterStyleProfile;
	/** Held skeleton for revision. Stable ids are authored before prose and reused. */
	skeleton?: readonly StorySlot[];
	/* Configuration demanding grounding the frame did not ask for. It only ever
	 * raises: an explicit request cannot be vetoed by the frame, and the frame can
	 * still call for grounding when this is unset. There is deliberately no way to
	 * force grounding OFF here — that would put the decision back where a caller
	 * guesses at the subject. */
	requireGrounding?: boolean;
	/** Asset-free, project-scoped inputs for authoritative sequence direction. */
	direction?: StoryDirectionOptions;
}

/* The override may return just the sections or the whole plan. Most tests only
 * care about sections and predate engagement; requiring the full shape would
 * have meant editing 40-odd call sites to say nothing new. */
type StoryPlannerResult = StoryPlanSection[] | StoryPlanDraft;
type StoryPlanner = (
	brief: string,
	targetDurationSec: number,
	opts?: StoryPlanOpts,
) => Promise<StoryPlannerResult>;
let storyPlannerOverride: StoryPlanner | null = null;
export function setStoryPlannerForTests(fn: StoryPlanner | null): void {
	storyPlannerOverride = fn;
}
/* Is this process driving the agent through test seams rather than the model?
 *
 * Any new model call on a path an
 * existing test already exercises needs the same answer, and asking each seam one
 * at a time is how a new call quietly starts shelling out inside `bun test`. */
export function modelSeamsStubbed(): boolean {
	/* The frame planner belongs here for the reason above, and it was missing: a
	 * test that stubs only the frame drives planning deterministically, so the
	 * post-research evidence analysis added beside it started spawning a real
	 * subprocess in four story-plan tests and timing them out. */
	return Boolean(
		storyPlannerOverride ||
		storyFramePlannerOverride ||
		storyDrafterOverride ||
		hasStorySequenceDirectorOverride() ||
		directionRouterOverride,
	);
}

const EMPTY_STORY_SECTIONS_MESSAGE = "planner returned no story sections";

function isEmptySectionsIssue(issue: z.ZodIssue): boolean {
	return issue.path[0] === "sections" && issue.code === z.ZodIssueCode.too_small;
}

function storyPlanParseError(error: z.ZodError): Error {
	if (error.issues.some(isEmptySectionsIssue)) return new Error(EMPTY_STORY_SECTIONS_MESSAGE);
	return error;
}

function asStoryPlan(result: unknown): StoryPlanDraft {
	const parsed = storyPlanSchema.safeParse(Array.isArray(result) ? { sections: result } : result);
	if (parsed.success) return parsed.data;
	throw storyPlanParseError(parsed.error);
}

type StyleBibleGenerator = (brief: string, locked?: LockedVisualConstraints) => Promise<string>;
let styleBibleOverride: StyleBibleGenerator | null = null;
export function setStyleBibleGeneratorForTests(fn: StyleBibleGenerator | null): void {
	styleBibleOverride = fn;
}

/** A project-wide visual style bible derived from the brief, used to keep every
 *  generated shot visually consistent when the user picked no style reference image.
 *  Returns a compact comma-separated directive (medium, era, palette, lighting, lens,
 *  negatives). Best-effort — the caller treats a throw as "no style". */
/* What a generated style bible is not allowed to contradict.
 *
 * The style bible used to be generated from the brief alone. That is how a
 * project locked to "only sketch stickman, no human presence" received a bible
 * asking for cinematic paleo-realism with prehistoric people in it: the
 * generator was never told the constraints it was about to violate, and the
 * contradiction was then discovered — or not — layers downstream in the
 * compiled prompt.
 *
 * Detecting that afterwards means keyword-matching generated prose and deleting
 * it on a heuristic. Preventing it means saying so up front, which is what this
 * carries. */

export function styleBibleRequest(
	brief: string,
	locked: LockedVisualConstraints | undefined,
): RenderedPrompt {
	return renderPrompt("prompt:content:generateStyleBible", { brief, locked });
}

export function styleBiblePrompt(
	brief: string,
	locked: LockedVisualConstraints | undefined,
): string {
	return styleBibleRequest(brief, locked).text;
}

export async function generateStyleBible(
	brief: string,
	locked?: LockedVisualConstraints,
): Promise<string> {
	if (styleBibleOverride) return styleBibleOverride(brief, locked);
	const { stdout } = await runPrompt(styleBibleRequest(brief, locked), { timeoutMs: 60_000 });
	return stdout.replace(/\s+/g, " ").trim().slice(0, 600);
}

/* ════ Story Bible: the story's visual constants, authored once ════
 *
 * The prose style bible above says the same things in one comma-separated line.
 * It stays — as `bible.summary`, for plan review — but it is no longer what a
 * prompt compiles from. Prose had to be re-stated per beat to be used, and
 * re-stating it is how one lock came to be spelled four different ways inside a
 * single section.
 *
 * The model authors the look and the cast here. Planned references are merged in
 * AFTERWARDS, deterministically, so a reference's key reaches its subject whether
 * or not the model thought to mention it. */

const storyBibleSubjectDraftSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	aliases: z.array(z.string().min(1)).default([]),
	descriptors: z.array(z.string().min(1)).default([]),
	mustAvoid: z.array(z.string().min(1)).default([]),
});
const storyBibleDraftSchema = z.object({
	subjects: z.array(storyBibleSubjectDraftSchema).default([]),
	locations: z
		.array(
			z.object({
				id: z.string().min(1),
				label: z.string().min(1),
				descriptors: z.array(z.string().min(1)).default([]),
			}),
		)
		.default([]),
	medium: z.string().optional(),
	realism: z.string().optional(),
	visualTreatment: z.string().optional(),
	lighting: z.string().optional(),
	palette: z.string().optional(),
	moodDefault: z.string().optional(),
	cameraLanguage: z
		.object({
			defaultShot: z.string().optional(),
			angleVocabulary: z.array(z.string().min(1)).default([]),
		})
		.optional(),
	negatives: z.array(z.string().min(1)).default([]),
});

export interface StoryBibleOpts {
	locked?: LockedVisualConstraints;
	/** The prose style bible, kept as the plan-review summary. */
	summary?: string;
	/** Planned references, merged in deterministically after authoring. */
	plannedReferences?: readonly StoryPlannedReference[];
	/** Direction-owned labels. The descriptive Bible model must not duplicate them. */
	boundLabels?: readonly string[];
	/** Embodied POV contract, so the viewer's own body is a bible subject. */
	povLifecycle?: PovLifecycle;
	language?: string;
}

type StoryBibleAuthor = (brief: string, opts?: StoryBibleOpts) => Promise<unknown>;
let storyBibleAuthorOverride: StoryBibleAuthor | null = null;
export function setStoryBibleAuthorForTests(fn: StoryBibleAuthor | null): void {
	storyBibleAuthorOverride = fn;
}

function slugId(value: string, fallback: string): string {
	const slug = value
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug || fallback;
}

/* Planned references are the operator-approved cast, so they are authoritative
 * over anything the bible call invented. A reference merges into an existing
 * subject when their labels match; otherwise it becomes one. Either way the
 * subject ends up carrying `refKey`, which is what lets compilation use the
 * resolved reference description as the locked identity. */
function withPlannedReferences(
	bible: StoryBible,
	refs: readonly StoryPlannedReference[] | undefined,
): StoryBible {
	if (!refs?.length) return bible;
	const sameLabel = (a: string, b: string): boolean =>
		a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
	/* The reference description is one sentence saying what the model has usually
	 * already said as separate descriptors — merging both produced entries like
	 * "hexagonal cells, warm wax, honey glints" sitting beside those same three as
	 * items. So it is added only when the entry would otherwise be empty. Nothing
	 * is lost: where a subject carries `refKey`, the RESOLVED reference description
	 * is the locked identity at compile time. */
	let subjects = [...bible.subjects];
	let locations = [...bible.locations];
	for (const ref of refs) {
		if (ref.role === "location") {
			const at = locations.findIndex((location) => sameLabel(location.label, ref.label));
			locations =
				at >= 0
					? locations.map((location, index) =>
							index === at
								? {
										...location,
										descriptors:
											location.descriptors.length > 0
												? location.descriptors
												: [ref.description].filter(Boolean),
									}
								: location,
						)
					: [
							...locations,
							{
								id: slugId(ref.label, `location-${locations.length + 1}`),
								label: ref.label,
								descriptors: [ref.description].filter(Boolean),
							},
						];
			continue;
		}
		const at = subjects.findIndex((subject) => sameLabel(subject.label, ref.label));
		if (at >= 0) {
			subjects = subjects.map((subject, index) =>
				index === at
					? {
							...subject,
							refKey: ref.key,
							descriptors:
								subject.descriptors.length > 0
									? subject.descriptors
									: [ref.description].filter(Boolean),
						}
					: subject,
			);
			continue;
		}
		subjects = [
			...subjects,
			{
				id: slugId(ref.label, `subject-${subjects.length + 1}`),
				label: ref.label,
				aliases: [],
				descriptors: [ref.description].filter(Boolean),
				mustAvoid: [],
				refKey: ref.key,
			},
		];
	}
	return { ...bible, subjects, locations };
}

/* A bible with no subject cannot be authored against: beat authoring picks from a
 * closed list, and an empty list closes generation entirely. A story with no cast
 * is ordinary — a narrated explainer has no character — so the POV viewer, else
 * the brief's own subject, becomes the one subject rather than failing the plan. */
function withAtLeastOneSubject(
	bible: StoryBible,
	brief: string,
	povLifecycle: PovLifecycle | undefined,
): StoryBible {
	if (bible.subjects.length > 0) return bible;
	const label =
		povLifecycle?.viewerRole?.trim() ||
		brief
			.replace(/\s+/g, " ")
			.trim()
			.split(/[.;:\n]/)[0]
			?.trim()
			.slice(0, 60) ||
		"subject";
	return {
		...bible,
		subjects: [
			{
				id: slugId(label, "subject-1"),
				label,
				aliases: [],
				descriptors: povLifecycle?.bodyConstraints ? [povLifecycle.bodyConstraints] : [],
				mustAvoid: [],
			},
		],
	};
}

/** Author the story's visual constants once, at plan time.
 *
 *  Best-effort in the same sense as `generateStyleBible`: a throw leaves the plan
 *  without a bible and the legacy prose path still generates. What it must never do
 *  is return a bible with no subject — see `withAtLeastOneSubject`. */
export function storyBibleRequest(brief: string, opts: StoryBibleOpts | undefined): RenderedPrompt {
	return renderPrompt("prompt:content:authorStoryBible", { brief, opts });
}

export function storyBiblePrompt(brief: string, opts: StoryBibleOpts | undefined): string {
	return storyBibleRequest(brief, opts).text;
}

export async function authorStoryBible(brief: string, opts?: StoryBibleOpts): Promise<StoryBible> {
	const refs = opts?.plannedReferences;
	const draft = async (): Promise<unknown> => {
		if (storyBibleAuthorOverride) return storyBibleAuthorOverride(brief, opts);
		const { stdout } = await runPrompt(storyBibleRequest(brief, opts), { timeoutMs: 120_000 });
		return parseJson(stdout);
	};
	const parsed = storyBibleDraftSchema.parse(await draft());
	const bible = storyBibleSchema.parse({ ...parsed, summary: opts?.summary });
	return withAtLeastOneSubject(
		opts?.boundLabels ? bible : withPlannedReferences(bible, refs),
		brief,
		opts?.povLifecycle,
	);
}

/* ════ Story planning, in three stages ════
 *
 * Frame → skeleton → draft, and only two of the three call a model.
 *
 * The single call this replaces assembled six conditionally-concatenated rule
 * blocks and then, on a parse failure, retried against a second prompt restating
 * the whole JSON shape — a copy that had already drifted from the primary. Adding
 * an arc to that prompt would have made it worse.
 *
 * The SKELETON is the point of the split. Once section slots exist as data, the
 * draft call fills pre-shaped holes instead of inventing structure and prose at
 * once, and a failed slot has something to retry against. */

/** The frame stage's timeout. Far below drafting's 180s, because the frame returns
 *  a small framing object rather than a script — that is the whole reason it is a
 *  separate call, and what makes retrying it cheap. */
const STORY_FRAME_TIMEOUT_MS = 45_000;
const STORY_DRAFT_TIMEOUT_MS = 180_000;

const storyFrameSchema = z.object({
	planKind: z.enum(VIDEO_PLAN_KINDS).default("story"),
	/* Unknown strings degrade to absent rather than failing the frame: an arc the
	 * model invented is "nothing inferred", which `resolveStoryArc` then answers
	 * with the plan kind's default. */
	arc: z.preprocess(
		(value) =>
			typeof value === "string" ? oneOf(value.trim().toLowerCase(), STORY_ARCS) : undefined,
		z.enum(STORY_ARCS).optional(),
	),
	language: z.string().optional(),
	engagement: storyEngagementSchema.partial().optional(),
	plannedReferences: z.array(storyPlannedReferenceSchema).max(12).optional(),
	explainerContract: explainerContractSchema.optional(),
	povLifecycle: povLifecycleSchema.optional(),
	grounding: storyGroundingSchema.optional(),
});

/** The plan's framing: everything decided before a word of narration exists. */
export interface StoryFrame {
	planKind: VideoPlanKind;
	arc: StoryArc;
	language?: string;
	engagement?: Partial<StoryEngagement>;
	plannedReferences?: StoryPlannedReference[];
	explainerContract?: ExplainerContract;
	povLifecycle?: PovLifecycle;
	/** Whether this plan's claims need retrieved sources, and what to ask. Always
	 *  resolved — the frame's answer, the caller's override, or the plan kind's
	 *  default when the frame degraded. */
	grounding: StoryGrounding;
	/** The frame call never succeeded; arc and language came from defaults. */
	degraded: boolean;
}

type StoryFramePlanner = (
	brief: string,
	targetDurationSec: number,
	opts?: StoryPlanOpts,
) => Promise<unknown>;
let storyFramePlannerOverride: StoryFramePlanner | null = null;
export function setStoryFramePlannerForTests(fn: StoryFramePlanner | null): void {
	storyFramePlannerOverride = fn;
}

export function storyFrameRequest(
	brief: string,
	targetDurationSec: number,
	sectionCount: number,
	opts: StoryPlanOpts | undefined,
): RenderedPrompt {
	return renderPrompt("prompt:content:storyFramePrompt", {
		brief,
		targetDurationSec,
		sectionCount,
		opts,
	});
}

export function storyFramePrompt(
	brief: string,
	targetDurationSec: number,
	sectionCount: number,
	opts: StoryPlanOpts | undefined,
): string {
	return storyFrameRequest(brief, targetDurationSec, sectionCount, opts).text;
}

/* Frame the plan, retrying once before degrading.
 *
 * Degrading means falling back to the plan kind's default arc and the job's
 * configured language — never to substitute narration. The fallback this replaces
 * emitted a hundred lines of hardcoded bee prose for any brief matching five
 * words; a frame with no engagement and a default arc is topic-agnostic, which is
 * the only honest thing to be when the planner is dead.
 *
 * With no configured language there is nothing usable to degrade TO — narration
 * language is never guessed from topic words — so planning fails visibly with the
 * underlying error instead. */
/* Resolve the grounding decision. Configuration only raises: `requireGrounding`
 * turns grounding on when the frame said no, and never turns it off. */
function resolveGrounding(
	inferred: StoryGrounding | undefined,
	planKind: VideoPlanKind,
	requireGrounding: boolean | undefined,
): StoryGrounding {
	const base = inferred ?? { needed: defaultGroundingFor(planKind), questions: [] };
	return requireGrounding ? { ...base, needed: true } : base;
}

export async function planStoryFrame(
	brief: string,
	targetDurationSec: number,
	sectionCount: number,
	opts?: StoryPlanOpts,
): Promise<StoryFrame> {
	/* A whole-plan override stubs the planner end to end, so framing it would spawn
	 * the real model process for a frame whose narration is discarded anyway. Test
	 * seam only, and it never fires when the frame itself is stubbed — a test about
	 * framing installs `setStoryFramePlannerForTests` and gets the real stage. */
	if (storyPlannerOverride && !storyFramePlannerOverride) {
		const planKind = opts?.planKind ?? "story";
		return {
			planKind,
			arc: resolveStoryArc(opts?.arc, planKind),
			language: opts?.language || undefined,
			grounding: resolveGrounding(undefined, planKind, opts?.requireGrounding),
			degraded: false,
		};
	}
	const attempt = async (): Promise<unknown> => {
		if (storyFramePlannerOverride) return storyFramePlannerOverride(brief, targetDurationSec, opts);
		const { stdout } = await runPrompt(
			storyFrameRequest(brief, targetDurationSec, sectionCount, opts),
			{ timeoutMs: STORY_FRAME_TIMEOUT_MS },
		);
		return parseJson(stdout);
	};
	let failure: unknown;
	// One retry, then degrade. A second failure is a signal, not a rounding error.
	for (let tries = 0; tries < 2; tries++) {
		try {
			const frame = storyFrameSchema.parse(await attempt());
			const planKind = opts?.planKind ?? frame.planKind;
			return {
				planKind,
				arc: resolveStoryArc(opts?.arc, planKind, frame.arc),
				language: opts?.language || frame.language || undefined,
				engagement: frame.engagement,
				plannedReferences: frame.plannedReferences,
				explainerContract: frame.explainerContract,
				povLifecycle: frame.povLifecycle,
				grounding: resolveGrounding(frame.grounding, planKind, opts?.requireGrounding),
				degraded: false,
			};
		} catch (err) {
			failure = err;
		}
	}
	if (!opts?.language?.trim()) {
		throw new Error(
			`Story framing failed and no narration language is configured: ${failure instanceof Error ? failure.message : String(failure)}`,
		);
	}
	const planKind = opts.planKind ?? "story";
	// Degrading resolves grounding from the plan kind, never from the brief text —
	// the same posture the arc and the language already take here.
	return {
		planKind,
		arc: resolveStoryArc(opts.arc, planKind),
		language: opts.language,
		grounding: resolveGrounding(undefined, planKind, opts.requireGrounding),
		degraded: true,
	};
}

/* ── Skeleton: the one stage that calls no model ── */

/** One section slot, shaped before any prose exists. */
export interface StorySlot {
	index: number;
	sectionId: string;
	semanticBeatId: string;
	chapterFunction: string;
	obligation: string;
	emotion: Emotion;
	wordBudget: number;
	povStage?: string;
}

/* Derive the section slots from the arc, the section count and the writer style.
 *
 * Pure arithmetic over the arc library — the same move `storyDensityFor` already
 * made for section count and word budget, one layer up. Nothing here asks a model
 * anything, which is what makes a failed draft retryable against a skeleton that
 * still exists.
 *
 * The writer style contributes its opening move to slot 0, so the first section
 * does not default to a throat-clear. It does not touch the other slots: sentence
 * rhythm has already been paid for in the word budget this is handed. */
export function storySkeleton(
	arc: StoryArc,
	sectionCount: number,
	wordBudget: number,
	writerStyle?: WriterStyleProfile,
	id: () => string = () => crypto.randomUUID(),
): StorySlot[] {
	const count = Math.max(1, Math.floor(sectionCount));
	const perSection = Math.max(20, Math.round(wordBudget / count));
	return storyArcFunctionSlots(arc, count).map((fn, index) => ({
		index,
		sectionId: id(),
		semanticBeatId: id(),
		chapterFunction: fn.key,
		obligation:
			index === 0 && writerStyle ? `${fn.obligation} ${writerStyle.openingMove}` : fn.obligation,
		emotion: fn.defaultEmotion,
		wordBudget: perSection,
		povStage: fn.povStage,
	}));
}

/* ── Draft: fill the skeleton's slots ── */

type StoryDrafter = (
	brief: string,
	slots: readonly StorySlot[],
	frame: StoryFrame,
	opts?: StoryPlanOpts,
) => Promise<unknown>;
let storyDrafterOverride: StoryDrafter | null = null;
export function setStoryDrafterForTests(fn: StoryDrafter | null): void {
	storyDrafterOverride = fn;
}

const storyDraftSchema = z.object({
	sections: z.array(
		longformSectionSchema.extend({ slot: z.coerce.number().int().min(0).optional() }),
	),
});

/* The prompt that fills slots.
 *
 * It does not ask for structure. The number of sections, their order, each one's
 * job and each one's word budget are already decided; what is missing is prose,
 * shots, and per-section editorial calls. A slot is addressed by index, so the
 * response can be matched back to the skeleton without a similarity guess — and a
 * single missing slot can be re-asked for on its own. */
export function storyDraftRequest(
	brief: string,
	frame: StoryFrame,
	slots: readonly StorySlot[],
	opts: StoryPlanOpts | undefined,
): RenderedPrompt {
	return renderPrompt("prompt:content:storyDraftPrompt", { brief, frame, slots, opts });
}

export function storyDraftPrompt(
	brief: string,
	frame: StoryFrame,
	slots: readonly StorySlot[],
	opts: StoryPlanOpts | undefined,
): string {
	return storyDraftRequest(brief, frame, slots, opts).text;
}

/** A drafted section is usable when it has prose to speak and a picture to show. */
function draftedSlot(section: StoryPlanSection | undefined): boolean {
	return Boolean(section?.narration.trim() && section.visualPrompt.trim());
}

/** The slot's own structure, stamped onto whatever the drafter returned. The
 *  draft fills a slot; it does not get to choose which slot it is. */
function withSlotStructure(slot: StorySlot, section: StoryPlanSection): StoryPlanSection {
	return {
		...section,
		id: slot.sectionId,
		semanticBeatId: slot.semanticBeatId,
		chapterFunction: slot.chapterFunction,
		chapterObligation: slot.obligation,
		// Arc-derived default, overridable: the planner may name a different emotion
		// where a section warrants it, and that deliberate choice is kept.
		emotion: section.emotion ?? slot.emotion,
		povStage:
			slot.povStage && section.povStage
				? {
						...section.povStage,
						chapterFunction:
							oneOf(slot.chapterFunction, POV_CHAPTER_FUNCTIONS) ??
							section.povStage.chapterFunction,
					}
				: section.povStage,
	};
}

/** A slot that never drafted. It stays in the plan, empty and marked — dropping it
 *  would silently shorten the video, and filling it would ship prose about a
 *  subject nobody asked for. */
/* `reason` is why this slot has no draft.
 *
 * Drafting degrades on purpose — one slot the model would not fill must not cost a
 * ten-section plan — but the two failure paths used to discard the cause, so every
 * undrafted section reported the same sentence whether the retry had timed out,
 * returned unparseable JSON, or answered with an empty narration. That left the
 * operator, and anyone debugging the run later, with no way to tell a transient
 * outage from a slot the model keeps refusing. */
function undraftedSection(slot: StorySlot, reason?: string): StoryPlanSection {
	const cause = reason?.trim().replace(/\s+/g, " ").slice(0, 200);
	return longformSectionSchema.parse({
		id: slot.sectionId,
		semanticBeatId: slot.semanticBeatId,
		title: `Section ${slot.index + 1}`,
		narration: "",
		visualPrompt: `Placeholder for an undrafted section: ${slot.obligation}`,
		chapterFunction: slot.chapterFunction,
		chapterObligation: slot.obligation,
		emotion: slot.emotion,
		needsDrafting: true,
		notes: `Drafting failed for this section after a retry${cause ? `: ${cause}` : ""}. Re-run planning or edit it by hand.`,
	});
}

/* `correction` carries the previous attempt's failure back to the model.
 *
 * Without it the retry is blind: the same prompt produces the same answer, so two
 * tries cost twice as long and fail identically. A model that answered `kind` with
 * a description of the graphic it imagined cannot know the field is a closed list
 * of renderers unless the rejection says so. */

/* Draft every slot, then retry the ones that did not land.
 *
 * The retry re-asks for ONE slot against the skeleton that still exists. It does
 * not recompute the frame, does not recompute the skeleton, and does not restate
 * the full plan schema — that duplicated retry prompt is what drifted from the
 * primary and lost `teachingMove`, `povStage` and `plannedReferences`. */
async function draftStorySections(
	brief: string,
	frame: StoryFrame,
	slots: readonly StorySlot[],
	opts: StoryPlanOpts | undefined,
): Promise<StoryPlanSection[]> {
	/* Rejections are reported alongside the drafts, so a slot the drafter answered
	 * with an empty narration is distinguishable from one it never answered at all.
	 * Both end up undrafted; only one of them means the model is refusing the slot. */
	const ask = async (
		subset: readonly StorySlot[],
	): Promise<{ byIndex: Map<number, StoryPlanSection>; rejected: Map<number, string> }> => {
		const raw = storyDrafterOverride
			? await storyDrafterOverride(brief, subset, frame, opts)
			: parseJson(
					(
						await runPrompt(storyDraftRequest(brief, frame, subset, opts), {
							timeoutMs: STORY_DRAFT_TIMEOUT_MS,
						})
					).stdout,
				);
		const parsed = storyDraftSchema.parse(Array.isArray(raw) ? { sections: raw } : raw);
		const byIndex = new Map<number, StoryPlanSection>();
		const rejected = new Map<number, string>();
		for (const [order, section] of parsed.sections.entries()) {
			// `slot` when the drafter echoed it, position within the ask otherwise —
			// a drafter that returns the right number of sections in order is still
			// answering the question, and refusing it would cost a whole plan.
			const slot = subset.find((candidate) => candidate.index === section.slot) ?? subset[order];
			if (!slot) continue;
			if (draftedSlot(section)) byIndex.set(slot.index, section);
			else
				rejected.set(
					slot.index,
					section.narration.trim()
						? "the drafter returned an empty visual prompt"
						: "the drafter returned an empty narration",
				);
		}
		return { byIndex, rejected };
	};
	const drafted = new Map<number, StoryPlanSection>();
	const failure = new Map<number, string>();
	/* A cause an operator can act on. A raw Zod dump names the offending field but
	 * buries it in a JSON array of issue objects, which is the wrong shape for a note
	 * rendered beside a section in the plan view. */
	const describe = (error: unknown): string => {
		const message = error instanceof Error ? error.message : String(error);
		if (/timed out|ETIMEDOUT/i.test(message))
			return `the drafter timed out after ${Math.round(STORY_DRAFT_TIMEOUT_MS / 1000)}s`;
		try {
			const issues: unknown = JSON.parse(message);
			const first: unknown = Array.isArray(issues) ? issues[0] : undefined;
			if (first && typeof first === "object") {
				const path = "path" in first ? first.path : undefined;
				const detail =
					"message" in first && typeof first.message === "string"
						? first.message.toLowerCase()
						: "was rejected";
				const field = Array.isArray(path)
					? path.filter((part) => typeof part === "string").join(".")
					: "";
				return `the drafter returned an invalid section${field ? ` (${field}: ${detail})` : `: ${detail}`}`;
			}
		} catch {
			/* not a Zod issue list; the raw message is the best available cause */
		}
		return message;
	};
	try {
		const first = await ask(slots);
		for (const [index, section] of first.byIndex) drafted.set(index, section);
		for (const [index, why] of first.rejected) failure.set(index, why);
	} catch (error) {
		// Every slot is missing; each is retried on its own below, and this reason is
		// held in case the retry fails too.
		for (const slot of slots) failure.set(slot.index, describe(error));
	}
	for (const slot of slots) {
		if (drafted.has(slot.index)) continue;
		try {
			const retry = await ask([slot]);
			const retried = retry.byIndex.get(slot.index);
			if (retried) {
				drafted.set(slot.index, retried);
				failure.delete(slot.index);
				continue;
			}
			// Kept and marked below rather than dropped or substituted.
			failure.set(
				slot.index,
				retry.rejected.get(slot.index) ?? "the drafter returned no section for this slot",
			);
		} catch (error) {
			failure.set(slot.index, describe(error));
		}
	}
	return slots.map((slot) => {
		const section = drafted.get(slot.index);
		return section
			? withSlotStructure(slot, section)
			: undraftedSection(slot, failure.get(slot.index));
	});
}

/** How many sections the plan gets and how many words they share. Resolved before
 *  the frame, because the frame is told the section count. */
export interface StoryPlanShape {
	sectionCount: number;
	wordBudget: number;
}

export function storyPlanShape(targetDurationSec: number, opts?: StoryPlanOpts): StoryPlanShape {
	const minutes = Math.max(1, Math.round(targetDurationSec / 60));
	// ~8 sections for short, scaling toward ~20 for 10 minutes; clamp 2..24.
	return {
		sectionCount: Math.max(
			2,
			Math.min(24, opts?.sectionCount ?? Math.max(4, Math.round(minutes * 2))),
		),
		wordBudget: opts?.wordBudget ?? Math.round(targetDurationSec * 2.6),
	};
}

/* Skeleton + draft, against a frame that already exists.
 *
 * Split out from `planStorySections` so a caller can act on the frame BEFORE the
 * skeleton is derived — the research stage runs there, and it is IO, which this
 * module does not do. Keeping it as a callback into `planStorySections` would
 * have hidden a network call inside a module whose contract is model calls only,
 * and would have left research unaddressable: re-running it would mean re-running
 * the frame. */
export async function planStoryFromFrame(
	brief: string,
	targetDurationSec: number,
	frame: StoryFrame,
	shape: StoryPlanShape,
	opts?: StoryPlanOpts,
): Promise<StoryPlanDraft> {
	if (storyPlannerOverride)
		return asStoryPlan(await storyPlannerOverride(brief, targetDurationSec, opts));
	const slots =
		opts?.skeleton ??
		storySkeleton(frame.arc, shape.sectionCount, shape.wordBudget, opts?.writerStyle);
	const sections = await draftStorySections(brief, frame, slots, opts);
	// Existing deterministic seams predate this stage. Skip only when no explicit
	// sequence-director seam was installed; production always runs direction.
	const directed =
		modelSeamsStubbed() && !hasStorySequenceDirectorOverride()
			? { sections }
			: await directStorySequence(sections, {
					...opts?.direction,
					authoritativeReferences: true,
					plannedReferences: frame.plannedReferences,
				});
	return asStoryPlan({
		sections: directed.sections,
		planKind: frame.planKind,
		arc: frame.arc,
		frameDegraded: frame.degraded || undefined,
		engagement: frame.engagement,
		explainerContract: frame.explainerContract,
		povLifecycle: frame.povLifecycle,
		plannedReferences: directed.plannedReferences ?? frame.plannedReferences,
		referenceAliases: directed.referenceAliases,
		language: frame.language,
		needsDirection: directed.needsDirection,
		directionBlocked: directed.directionBlocked,
		directionErrors: directed.directionErrors,
	});
}

/** Plan a narrated video as ordered sections. Frame, then skeleton, then draft —
 *  the composed path, for callers that do not ground between the first two. Word
 *  counts are a planning hint; real timing comes from measured TTS audio later. */
export async function planStorySections(
	brief: string,
	targetDurationSec: number,
	opts?: StoryPlanOpts,
): Promise<StoryPlanDraft> {
	if (storyPlannerOverride)
		return asStoryPlan(await storyPlannerOverride(brief, targetDurationSec, opts));
	const shape = storyPlanShape(targetDurationSec, opts);
	const frame = await planStoryFrame(brief, targetDurationSec, shape.sectionCount, opts);
	return planStoryFromFrame(brief, targetDurationSec, frame, shape, opts);
}
/* ════ Per-beat story visual authoring ════
 *
 * How many visuals a section needs is knowable only after its audio is measured:
 * the beats are cut from real speech at the template's `maxVisualBeatSec`. So the
 * beat list is an INPUT here, never a prediction. The planner's shots come in as
 * approved intent — what the operator agreed the section should show — and the
 * text that reaches the image provider is what this call writes for each beat.
 *
 * The checks below are counts, not thresholds: one visual per beat, every index
 * once, no adjacent normalize-equal pair. A violation retries once and then
 * throws, because a section that fails visibly is strictly better than one that
 * quietly ships the same picture twice. */
