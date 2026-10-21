/* Plan revision and section editing, before approval.
 *
 * Planning itself is the `plan_story` workflow definition on the engine
 * (engine/planning/); its steps live in `planning-steps.ts`. This module keeps the
 * flows that change an existing plan: a redraft against the operator's revision,
 * a single section edit, and the direction refresh approval runs. */
import type { StoryInputs } from "../story-inputs.ts";
import type { z } from "zod";
import type { updateSectionArgs } from "../helpers/schemas.ts";
import type { AgentJob } from "../model.ts";
import {
	bibleWithDirectedReferences,
	needsStoryDirectionRepair,
	canonicalizeLegacyStoryPlan,
	defaultStoryArcFor,
	replaceStoryDraft,
	resolveStoryStructure,
	storyArcFunctionSlots,
	storyDensityFor,
	storySequenceDirectionError,
	storySequenceDirectionViolations,
} from "@maleo/shared";
import { distributeWordBudget, wordBudgetForTarget } from "../../../../lib/story.ts";
import {
	planStoryFromFrame,
	type StoryFrame,
	type StoryPlanDraft,
	type StoryResearchEvidence,
} from "../../../../lib/content-generator.ts";
import { materializePlannedSections, researchForPlan } from "../evidence.ts";
import { getStoryPlan, setStoryPlan, emitPlanTable } from "../plan-state.ts";
import { lockedConstraintsFor } from "../visual-gen.ts";
import { persist } from "../persistence.ts";
import { pushNote, parseMotionGraphic } from "../trace.ts";
import { directedBibleEntries, workspaceBreath, writerStyleWarning } from "./planning-steps.ts";
import { voicePromptLayers } from "../material-layers.ts";

import { redirectStorySections } from "./direction-repair.ts";
import {
	currentStoryDirectionFingerprint,
	directionOptionsFor,
	ensureStoryboardGenerationState,
	executeStoryboardCommand,
	storyDirectionInputsFor,
} from "./storyboard-command-service.ts";

type UpdateSectionArgs = z.infer<typeof updateSectionArgs>;

/* Redraft every section of an existing plan against the operator's revision.
 *
 * The frame, the skeleton's shape and the research bundle are the ones the plan
 * already has: a revision changes the prose, never the structure the operator was
 * looking at when they rejected it. This is why rejecting a plan no longer ends
 * the run — the expensive parts of pre-production are already paid for.
 *
 * The research bundle is resolved by the plan's own `researchKey`, NOT by
 * fingerprinting the brief: a revision changes the brief by definition, so brief
 * matching would silently drop the sources on the first iteration. */
export async function redraftStoryPlanFlow(
	job: AgentJob,
	revision: string,
	inputs: StoryInputs,
	opts?: { grounded?: boolean },
): Promise<{ note: string }> {
	const plan = inputs.plan;
	if (!plan) return { note: "No story plan to revise — run plan_story first." };
	const { writerStyle, breath } = await workspaceBreath(job);
	const targetSec = plan.targetSec;
	const structure = plan.structure ?? resolveStoryStructure("auto", targetSec);
	const density = storyDensityFor(structure, targetSec, breath);
	const sectionCount = plan.sections.length || density.sectionCount;
	const wordBudget =
		structure === "narration_section"
			? wordBudgetForTarget(targetSec, breath)
			: Math.round(targetSec * density.wordsPerSec);
	const research = researchForPlan(inputs.research, plan);
	const evidence: StoryResearchEvidence | undefined =
		research && research.sources.length
			? {
					sources: research.sources.map((s) => ({
						url: s.url,
						title: s.title,
						excerpt: s.excerpt,
					})),
				}
			: undefined;
	// An operator who asked for research on an ungrounded plan has just made it a
	// grounded one; otherwise the plan's own decision stands.
	const grounded = opts?.grounded ?? plan.factual ?? false;
	// The frame the plan was drafted against, rebuilt from what was persisted with
	// it. Nothing here calls the framing model again.
	const planKind = plan.planKind ?? "story";
	const frame: StoryFrame = {
		planKind,
		arc: plan.arc ?? defaultStoryArcFor(planKind),
		language: plan.language,
		engagement: plan.engagement,
		plannedReferences: plan.plannedReferences,
		explainerContract: plan.explainerContract,
		povLifecycle: plan.povLifecycle,
		grounding: { needed: grounded, questions: [] },
		degraded: plan.frameDegraded ?? false,
	};
	const planningBrief = plan.planningBrief ?? job.brief;
	const scriptingBrief = `${voicePromptLayers(planningBrief, job.direction)}\n\nRevision requested (rewrite the narration to satisfy it; keep the structure): ${revision.trim()}`;
	pushNote(job, "Revising", `Redrafting ${sectionCount} section(s) against your revision…`);
	let drafted: StoryPlanDraft;
	try {
		const functions = storyArcFunctionSlots(frame.arc, sectionCount);
		const skeleton = Array.from({ length: sectionCount }, (_, index) => {
			const prior = plan.sections[index];
			const fn = functions[index]!;
			return {
				index,
				sectionId: prior?.sectionId ?? prior?.id ?? crypto.randomUUID(),
				semanticBeatId: prior?.semanticBeatId ?? crypto.randomUUID(),
				chapterFunction: prior?.chapterFunction ?? fn.key,
				obligation: prior?.chapterObligation ?? fn.obligation,
				emotion: prior?.emotion ?? fn.defaultEmotion,
				wordBudget: Math.max(20, Math.round(wordBudget / sectionCount)),
				povStage: fn.povStage,
			};
		});
		drafted = await planStoryFromFrame(
			scriptingBrief,
			targetSec,
			frame,
			{ sectionCount, wordBudget },
			{
				sectionCount,
				wordBudget,
				research: evidence,
				locked: await lockedConstraintsFor(job),
				language: plan.language || job.language || undefined,
				structure,
				planKind,
				arc: frame.arc,
				writerStyle,
				skeleton,
				allowInfographics: job.timelineTemplate?.useData !== false,
				direction: await directionOptionsFor(job),
			},
		);
	} catch (err) {
		throw new Error(`Story revision failed: ${err instanceof Error ? err.message : String(err)}`);
	}
	const budgets = distributeWordBudget(wordBudget, drafted.sections.length);
	const allowData = job.timelineTemplate?.useData !== false;
	const sections = materializePlannedSections(drafted.sections, 0, evidence, grounded, budgets).map(
		(section) => {
			const prior = plan.sections.find(
				(candidate) => (candidate.sectionId ?? candidate.id) === (section.sectionId ?? section.id),
			);
			const authored = prior?.locked ? prior : section;
			return allowData
				? authored
				: {
						...authored,
						motionGraphic: {
							needed: false,
							kind: "none" as const,
							purpose: "none" as const,
							reason: "Timeline template disables data overlays.",
						},
					};
		},
	);
	const generationState = replaceStoryDraft(
		plan.generationState ?? canonicalizeLegacyStoryPlan(plan.sections),
		sections,
	);
	const directionFingerprint = drafted.needsDirection
		? undefined
		: await currentStoryDirectionFingerprint(job, sections);
	const revisedBible = plan.bible
		? bibleWithDirectedReferences(
				plan.bible,
				drafted.needsDirection
					? []
					: directedBibleEntries(drafted, (await directionOptionsFor(job)).roster),
			)
		: undefined;
	// The plan context is carried forward untouched: the same brief, the same
	// research key, the same bible and visual style. Only the prose is new.
	setStoryPlan(job, targetSec, sections, true, !evidence && grounded, {
		planningBrief,
		factual: grounded,
		researchKey: plan.researchKey ?? null,
		visualStyle: plan.visualStyle,
		bible: revisedBible,
		engagement: drafted.engagement ?? plan.engagement,
		planKind,
		arc: frame.arc,
		frameDegraded: plan.frameDegraded,
		explainerContract: plan.explainerContract,
		povLifecycle: plan.povLifecycle,
		structure,
		language: plan.language,
		plannedReferences: drafted.plannedReferences,
		referenceAliases: drafted.referenceAliases,
		directionFingerprint,
		directionInputs: await storyDirectionInputsFor(job),
		needsDirection: drafted.needsDirection,
		directionBlocked: drafted.directionBlocked,
		directionErrors: drafted.directionErrors,
		generationState,
	});
	await persist(job);
	const arcTitle = frame.arc ? ` · ${frame.arc}` : "";
	emitPlanTable(
		job,
		sections,
		`Story plan${arcTitle} · ${sections.length} ${structure === "narration_section" ? "sections" : "beats"} · revised`,
	);
	job.events.push({ kind: "storyboard_patch" });
	const kept = evidence ? ` Kept ${evidence.sources.length} retrieved source(s).` : "";
	const craftNote = writerStyleWarning(sections, writerStyle);
	return {
		note: `Revised ${sections.length} section(s) against the same arc and skeleton.${kept}${craftNote} Review the plan again, then approve to generate assets.`,
	};
}

export async function updateSectionFlow(
	job: AgentJob,
	args: UpdateSectionArgs,
	inputs: StoryInputs,
	save: (job: AgentJob) => void = persist,
) {
	const plan = inputs.plan;
	if (!plan) return { note: "No story plan yet — run plan_story first." };
	const i = args.sectionId
		? plan.sections.findIndex((section) => (section.sectionId ?? section.id) === args.sectionId)
		: args.index!;
	const s = plan.sections[i];
	if (!s)
		return {
			note: args.sectionId
				? `No section with id ${args.sectionId}.`
				: `No section at index ${String(args.index)}.`,
		};
	const narration = args.narration ?? s.narration;
	const visualPrompt = args.visualPrompt ?? s.visualPrompt;
	const motionGraphic =
		args.motionGraphic != null ? parseMotionGraphic(args.motionGraphic) : undefined;
	if (args.motionGraphic != null && !motionGraphic)
		return {
			note: "Invalid motionGraphic. Use needed, kind, purpose, reason, and optional title/value/rows/columns/tableRows.",
		};
	const narrationChanged = narration !== s.narration;
	const visualChanged = visualPrompt !== s.visualPrompt;
	const editorialChanged =
		args.editorial !== undefined && JSON.stringify(args.editorial) !== JSON.stringify(s.editorial);
	const state = ensureStoryboardGenerationState(job);
	const sectionId = s.sectionId ?? s.id;
	const beatId =
		state?.draft.sections
			.find((section) => section.id === sectionId)
			?.beats.find((beat) => beat.id === s.semanticBeatId)?.id ??
		state?.draft.sections.find((section) => section.id === sectionId)?.beats[0]?.id;
	if (!state || !beatId) return { note: `Section ${sectionId} has no semantic beat.` };
	const result = await executeStoryboardCommand(
		job,
		state.draft.revisionId,
		{
			type: "update_beat",
			beatId,
			fields: {
				...(args.title !== undefined ? { title: args.title } : {}),
				...(args.narration !== undefined ? { narration } : {}),
				...(args.visualPrompt !== undefined ? { visualPrompt } : {}),
				...(motionGraphic ? { motionGraphic } : {}),
				...(args.editorial
					? { editorial: args.editorial, motionGraphic: args.editorial.motionGraphic }
					: {}),
			},
		},
		{ save: () => {} },
	);
	if (!result.ok) return { note: result.message };
	let updated = getStoryPlan(job)!;
	if (editorialChanged && updated.referenceAliases === undefined) {
		const violations = storySequenceDirectionViolations(
			updated.sections.map((section) => ({
				id: section.semanticBeatId ?? section.id,
				editorial: section.editorial,
			})),
			{ requireDirection: true },
		);
		setStoryPlan(job, updated.targetSec, updated.sections, false, undefined, {
			...updated,
			needsDirection: violations.length > 0,
			directionErrors: violations.length ? [storySequenceDirectionError(violations)] : [],
		});
		updated = getStoryPlan(job)!;
	}
	save(job);
	emitPlanTable(job, updated.sections, `Story plan · ${updated.sections.length} sections`);
	const what = [
		narrationChanged ? "voiceover" : "",
		visualChanged || editorialChanged ? "image/editorial" : "",
	]
		.filter(Boolean)
		.join(" + ");
	return {
		note: `Updated section ${i + 1}${what ? ` (${what} will regenerate on approve)` : ""}.`,
	};
}

/** Approval-time roster/material/template drift gets one re-direction through the
 * existing call. Unchanged inputs cost no model call. */
export async function refreshStoryDirectionForApproval(
	job: AgentJob,
	inputs: StoryInputs,
): Promise<boolean> {
	const plan = inputs.plan;
	if (!plan || plan.referenceAliases === undefined) return false;
	const state = plan.generationState ?? canonicalizeLegacyStoryPlan(plan.sections);
	const currentFingerprint = await currentStoryDirectionFingerprint(job, plan.sections);
	if (
		!needsStoryDirectionRepair(
			{
				directed: true,
				directionBlocked: plan.directionBlocked,
				needsDirection: plan.needsDirection,
				directionFingerprint: plan.directionFingerprint,
			},
			currentFingerprint,
		)
	)
		return false;
	const directed = await redirectStorySections(plan.sections, {
		...(await directionOptionsFor(job)),
		allowInfographics: job.timelineTemplate?.useData !== false,
		plannedReferences: plan.plannedReferences,
	});
	if (!directed.ok) {
		setStoryPlan(job, plan.targetSec, plan.sections, true, undefined, {
			...plan,
			plannedReferences: directed.plannedReferences,
			referenceAliases: directed.referenceAliases,
			bible: plan.bible ? bibleWithDirectedReferences(plan.bible, []) : undefined,
			needsDirection: true,
			directionBlocked: directed.directionBlocked,
			directionErrors: directed.directionErrors,
		});
		await persist(job);
		return true;
	}
	const sections = directed.sections;
	const nextState = replaceStoryDraft(state, sections);
	const nextPlan = {
		sections,
		plannedReferences: directed.plannedReferences,
		referenceAliases: directed.referenceAliases,
	};
	const bible = plan.bible
		? bibleWithDirectedReferences(
				plan.bible,
				directedBibleEntries(nextPlan, (await directionOptionsFor(job)).roster),
			)
		: undefined;
	setStoryPlan(job, plan.targetSec, sections, true, undefined, {
		...plan,
		plannedReferences: directed.plannedReferences,
		referenceAliases: directed.referenceAliases,
		directionFingerprint: await currentStoryDirectionFingerprint(job, sections),
		directionInputs: await storyDirectionInputsFor(job),
		bible,
		needsDirection: false,
		directionBlocked: undefined,
		directionErrors: [],
		generationState: nextState,
	});
	await persist(job);
	return true;
}
