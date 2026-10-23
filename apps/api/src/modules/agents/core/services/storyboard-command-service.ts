import {
	applyStoryboardCommand,
	approveStoryDraft,
	canonicalizeLegacyStoryPlan,
	STORYBOARD_MISSING_REVISION_ID,
	type StoryboardCommand,
	type StoryboardCommandResult,
	type StoryboardGenerationState,
	type StoryApprovalMode,
	type StoryApprovalOutcome,
	type StoryExtensionPolicy,
	storySequenceDirectionError,
	storySequenceDirectionViolations,
	bibleWithDirectedReferences,
	storyDirectionInputFingerprint,
	validateStoryApproval,
} from "@maleo/shared";
import { recordApprovedPlan } from "../approval-state.ts";
import { estimateDurationFromWords, type StorySection } from "../../../../lib/story.ts";
import type { AgentJob } from "../model.ts";
import { getStoryPlan, setStoryPlan } from "../plan-state.ts";
import { persist } from "../persistence.ts";
import { listProjectReferences } from "@maleo/db/references";
import { castableSubjects } from "../../../../lib/wire/reference-entity.ts";

export async function directionOptionsFor(job: AgentJob) {
	const rows = await listProjectReferences(job.projectId);
	/* Castability comes from the entity model, through the one helper the rest of
	 * generation uses — never a second filter written here. A row this list keeps
	 * but `castableSubjects` drops (a style plate, an entity with no canonical
	 * image) would be bindable at review and then reported detached at generation,
	 * after approval. */
	const castable = new Set(castableSubjects(rows).map((subject) => subject.id));
	const roster = [
		...new Map(
			rows
				.filter((entity) => castable.has(entity.id))
				.map((entity) => [
					entity.id,
					{
						id: entity.id,
						role: entity.role,
						label: entity.label,
						description: entity.description,
						primary: entity.is_primary === 1,
						updatedAt: entity.updated_at,
					},
				]),
		).values(),
	];
	const template = job.timelineTemplate;
	return {
		roster,
		visual: job.direction?.visual,
		rules: job.direction?.rules,
		templateConstraints: template
			? {
					maxVisualBeatSec: template.maxVisualBeatSec,
					staticSceneMovement: template.staticSceneMovement,
					overrideSceneTransition: template.overrideSceneTransition,
					sceneTransition: template.sceneTransition,
					sectionTitlePolicy: template.sectionTitlePolicy,
					introTextPreset: template.introTextPreset,
					sectionTextPreset: template.sectionTextPreset,
				}
			: undefined,
	};
}

export async function currentStoryDirectionFingerprint(
	job: AgentJob,
	sections: readonly StorySection[],
): Promise<string> {
	const options = await directionOptionsFor(job);
	const inputs = await storyDirectionInputsFor(job);
	return storyDirectionInputFingerprint({
		narrations: sections.map((section) => section.narration),
		plannedShots: sections.map((section) => section.visualPrompts ?? [section.visualPrompt]),
		rosterIds: options.roster.map((entry) => entry.id),
		...inputs,
	});
}

export async function storyDirectionInputsFor(job: AgentJob) {
	const options = await directionOptionsFor(job);
	return {
		materials: JSON.stringify({ visual: options.visual ?? "", rules: options.rules ?? "" }),
		templateConstraints: JSON.stringify(options.templateConstraints ?? {}),
	};
}

const GENERATED_STORY_FIELDS = new Set([
	"status",
	"audioUrl",
	"speechInputHash",
	"audioDurationSec",
	"voiceSegments",
	"visualSegments",
	"visualInputHash",
	"sceneVoiceoverPauseSec",
	"captionWords",
	"captionSourceBeatId",
	"captionSourceRevisionId",
	"captionInputHash",
	"imageUrls",
	"imageUrl",
	"imageSourceBeatIds",
	"imageSourceRevisionIds",
	"imageInputHashes",
	"frameSourceBeatId",
	"frameSourceRevisionId",
	"frameInputHash",
	"error",
	"startSec",
]);

function authoredFields(
	beat: StoryboardGenerationState["draft"]["sections"][number]["beats"][number],
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(beat).filter(
			([key, value]) => value !== undefined && !GENERATED_STORY_FIELDS.has(key),
		),
	);
}

function carriesDirectedBindings(command: StoryboardCommand): boolean {
	const beatCarries = (beat: {
		editorial?: { shots?: unknown };
		requiredReferences?: unknown;
		refIds?: unknown;
		refKeys?: unknown;
	}): boolean =>
		beat.editorial?.shots !== undefined ||
		beat.requiredReferences !== undefined ||
		beat.refIds !== undefined ||
		beat.refKeys !== undefined;
	switch (command.type) {
		case "add_section":
			return command.section.beats.some(beatCarries);
		case "add_beat":
			return beatCarries(command.beat);
		case "split_beat":
			return command.first.editorial?.shots !== undefined || beatCarries(command.second);
		case "update_beat":
			return command.fields.editorial?.shots !== undefined;
		case "attach_reference":
		case "lock_beat":
		case "merge_beats":
		case "remove_beat":
		case "remove_section":
		case "reorder_beat":
		case "reorder_section":
		case "unlock_beat":
		case "update_section":
			return false;
	}
}

function stalesDirection(command: StoryboardCommand): boolean {
	switch (command.type) {
		case "update_section":
		case "lock_beat":
		case "unlock_beat":
			return false;
		case "update_beat":
			return Object.keys(command.fields).some((field) => field !== "title");
		case "add_beat":
		case "add_section":
		case "attach_reference":
		case "merge_beats":
		case "remove_beat":
		case "remove_section":
		case "reorder_beat":
		case "reorder_section":
		case "split_beat":
			return true;
	}
}

export function projectStoryboardSections(
	current: readonly StorySection[],
	state: StoryboardGenerationState,
): StorySection[] {
	return state.draft.sections.flatMap((section) =>
		section.beats.map((beat) => {
			const prior =
				current.find((candidate) => candidate.semanticBeatId === beat.id) ??
				(section.beats.length === 1
					? current.find((candidate) => (candidate.sectionId ?? candidate.id) === section.id)
					: undefined);
			const narrationChanged = prior !== undefined && prior.narration !== beat.narration;
			const visualChanged = prior !== undefined && prior.visualPrompt !== beat.visualPrompt;
			return {
				...prior,
				...authoredFields(beat),
				id: beat.id,
				sectionId: section.id,
				semanticBeatId: beat.id,
				title: section.title || beat.title,
				narration: beat.narration,
				visualPrompt: beat.visualPrompt,
				estimatedDurationSec:
					narrationChanged || !prior
						? estimateDurationFromWords(beat.narration)
						: prior.estimatedDurationSec,
				...(narrationChanged && prior.factual
					? { sourceUrls: [], sourceEvidence: [], citationStatus: "unsupported" as const }
					: {}),
				...(visualChanged ? { visualPrompts: [beat.visualPrompt], shotCues: undefined } : {}),
			};
		}),
	);
}

export function ensureStoryboardGenerationState(job: AgentJob): StoryboardGenerationState | null {
	const plan = getStoryPlan(job);
	if (!plan) return null;
	if (plan.generationState) return plan.generationState;
	const state = canonicalizeLegacyStoryPlan(plan.sections);
	setStoryPlan(
		job,
		plan.targetSec,
		projectStoryboardSections(plan.sections, state),
		false,
		undefined,
		{ ...plan, generationState: state },
	);
	return state;
}

/* Approve the current draft, or say why not.
 *
 * A refusal is returned, never written back onto the plan: recording it by
 * setting `needsDirection` latched a recomputable condition, so undoing the edit
 * that staled direction left the plan permanently unapprovable with its original
 * cause overwritten by the refusal text. */
export async function approveCurrentStoryPlan(
	job: AgentJob,
	approvalMode: StoryApprovalMode,
	extensionPolicy: StoryExtensionPolicy = "review_additions",
	parentRevisionId?: string,
): Promise<StoryApprovalOutcome<StoryboardGenerationState>> {
	const plan = getStoryPlan(job);
	if (!plan)
		return {
			ok: false,
			reason: "no_plan",
			message: "No story plan remains for this saved approval. Run plan_story again.",
		};
	if (plan.needsDirection && plan.referenceAliases === undefined) {
		return {
			ok: false,
			reason: "needs_direction",
			message:
				plan.directionErrors?.[0] ??
				"Story sequence direction needs review before approval or asset generation.",
		};
	}
	const currentState = plan.generationState ?? canonicalizeLegacyStoryPlan(plan.sections);
	const approval = validateStoryApproval({
		directed: plan.referenceAliases !== undefined,
		directionBlocked: plan.directionBlocked,
		needsDirection: plan.needsDirection,
		directionErrors: plan.directionErrors,
		directionFingerprint: plan.directionFingerprint,
		currentDirectionFingerprint: await currentStoryDirectionFingerprint(job, plan.sections),
		approvalMode,
	});
	if (!approval.ok) return { ok: false, reason: approval.reason, message: approval.message };
	const violations = storySequenceDirectionViolations(
		plan.sections.map((section) => ({
			id: section.semanticBeatId ?? section.id,
			editorial: section.editorial,
		})),
	);
	if (violations.length)
		return {
			ok: false,
			reason: "needs_direction",
			message: storySequenceDirectionError(violations),
		};
	const state = approveStoryDraft(
		currentState,
		approvalMode,
		extensionPolicy,
		undefined,
		parentRevisionId,
		{
			plannedReferences: plan.plannedReferences,
			referenceAliases: plan.referenceAliases,
			directionFingerprint: plan.directionFingerprint,
		},
	);
	setStoryPlan(
		job,
		plan.targetSec,
		projectStoryboardSections(plan.sections, state),
		true,
		undefined,
		{ ...plan, generationState: state },
	);
	if (state.approvedSnapshot) recordApprovedPlan(job, state.approvedSnapshot);
	return { ok: true, state };
}

export async function executeStoryboardCommand(
	job: AgentJob,
	expectedRevisionId: string,
	command: StoryboardCommand,
	options: { newRevisionId?: string; save?: (job: AgentJob) => void } = {},
): Promise<StoryboardCommandResult> {
	const plan = getStoryPlan(job);
	if (!plan)
		return {
			ok: false,
			reason: "invalid",
			currentRevisionId: STORYBOARD_MISSING_REVISION_ID,
			message: "No story plan yet.",
		};
	const state = ensureStoryboardGenerationState(job)!;
	const directed = plan.referenceAliases !== undefined;
	if (directed && carriesDirectedBindings(command)) {
		return {
			ok: false,
			reason: "invalid",
			currentRevisionId: state.draft.revisionId,
			message:
				"Only story visual direction may write planned-shot direction or reference bindings.",
		};
	}
	if (directed && command.type === "attach_reference") {
		const valid =
			command.referenceKind === "planned"
				? plan.plannedReferences?.some((reference) => reference.key === command.referenceId)
				: (await listProjectReferences(job.projectId)).some(
						(reference) => reference.id === command.referenceId,
					);
		if (!valid)
			return {
				ok: false,
				reason: "invalid",
				currentRevisionId: state.draft.revisionId,
				message: `${command.referenceKind} reference is not in this plan's approved selection boundary.`,
			};
	}
	const result = applyStoryboardCommand(state, expectedRevisionId, command, options.newRevisionId);
	if (!result.ok) return result;
	const sections = projectStoryboardSections(plan.sections, result.state);
	if (directed) {
		const stale = stalesDirection(command);
		setStoryPlan(job, plan.targetSec, sections, true, undefined, {
			...plan,
			generationState: result.state,
			bible: stale && plan.bible ? bibleWithDirectedReferences(plan.bible, []) : plan.bible,
			needsDirection: stale ? true : plan.needsDirection,
			directionErrors: stale
				? [`stale_direction: ${command.type} changed visual-direction inputs`]
				: plan.directionErrors,
		});
		(options.save ?? persist)(job);
		return result;
	}
	const violations = storySequenceDirectionViolations(
		sections.map((section) => ({
			id: section.semanticBeatId ?? section.id,
			editorial: section.editorial,
		})),
	);
	setStoryPlan(job, plan.targetSec, sections, true, undefined, {
		...plan,
		generationState: result.state,
		needsDirection: violations.length > 0,
		directionErrors: violations.length ? [storySequenceDirectionError(violations)] : [],
	});
	(options.save ?? persist)(job);
	return result;
}
