import { getContentProject } from "@maleo/db/project-detail";
import { addContentStoryboard, type ContentStoryboardRow } from "@maleo/db/storyboards";
import {
	stableStringify,
	approvedPlanArtifact,
	artifactRefOf,
	payloadOfKind,
	documentArtifacts,
	pipelineArtifactKinds,
	storyPlanArtifact,
	storyPlanArtifactOf,
	writeArtifact,
	type PipelineArtifact,
	applyStoryboardCommand,
	approveStoryDraft,
	canonicalizeLegacyStoryPlan,
	onlyNoDataRepairableDirectionErrors,
	readLegacyStoryDraft,
	readStoryboardDocument,
	STORYBOARD_LEGACY_REVISION_ID,
	STORYBOARD_MISSING_REVISION_ID,
	storyboardCommandSchema,
	openBlockers,
	storyboardGenerationStateSchema,
	needsStoryDirectionRepair,
	storyDirectionInputFingerprint,
	validateStoryApproval,
	directionFromMaterials,
	writeStoryboardDocument,
	type OpenBlocker,
	type StoryboardCommand,
	type StoryboardGenerationState,
	type StoryExtensionPolicy,
} from "@maleo/shared";
import type { StoryPlanPayload, StorySection } from "@maleo/shared/agent-wire";
import { projectStoryboardSections } from "../modules/agents/core/services/storyboard-command-service.ts";
import { redirectStorySections } from "../modules/agents/core/services/direction-repair.ts";
import { listProjectReferences } from "@maleo/db/references";
import { castableSubjects } from "./wire/reference-entity.ts";

type StoryPlan = StoryPlanPayload;

export interface StoryboardAuthoringSnapshot {
	state: StoryboardGenerationState | null;
	legacy: boolean;
	generatedByBeatId: Record<string, StorySection[]>;
	references: Record<string, { label: string; role: string; source: "existing" | "planned" }>;
}

export type StoryboardAuthoringResult =
	| ({ ok: true; storyboard: ContentStoryboardRow } & StoryboardAuthoringSnapshot)
	/* `blockers` carries what refused the approval in the same shape the blocker
	 * batch presents, so a refusal the operator meets here arrives with its remedy
	 * attached instead of as a sentence they can do nothing with. */
	| ({
			ok: false;
			reason: "conflict" | "invalid" | "locked" | "not_found";
			message: string;
			blockers?: OpenBlocker[];
	  } & StoryboardAuthoringSnapshot);

function storyPlanOf(artifacts: readonly PipelineArtifact[]): { plan: StoryPlan } | null {
	const plan = storyPlanArtifactOf(artifacts)?.payload;
	return plan ? { plan } : null;
}

function generatedByBeatId(
	sections: readonly StorySection[],
	state: StoryboardGenerationState | null,
): Record<string, StorySection[]> {
	const beats = state?.draft.sections.flatMap((section) => section.beats) ?? [];
	const beatIds = new Set(beats.map((beat) => beat.id));
	const grouped = new Map<string, StorySection[]>();
	for (const [index, section] of sections.entries()) {
		const beatId =
			section.semanticBeatId && beatIds.has(section.semanticBeatId)
				? section.semanticBeatId
				: beats[index]?.id;
		if (beatId) grouped.set(beatId, [...(grouped.get(beatId) ?? []), section]);
	}
	return Object.fromEntries(grouped);
}

function snapshotOf(
	plan: StoryPlan,
	state: StoryboardGenerationState | null,
	legacy: boolean,
	entities: readonly { id: string; label: string; role: string }[] = [],
): StoryboardAuthoringSnapshot {
	return {
		state,
		legacy,
		generatedByBeatId: generatedByBeatId(plan.sections, state),
		references: Object.fromEntries([
			...entities.map(
				(entity) =>
					[
						`entity:${entity.id}`,
						{ label: entity.label, role: entity.role, source: "existing" as const },
					] as const,
			),
			...(plan.plannedReferences ?? []).map(
				(reference) =>
					[
						`planned:${reference.key}`,
						{ label: reference.label, role: reference.role, source: "planned" as const },
					] as const,
			),
		]),
	};
}

function stateOf(
	plan: StoryPlan,
	entities: readonly { id: string; label: string; role: string }[] = [],
): StoryboardAuthoringSnapshot {
	const parsed = storyboardGenerationStateSchema.safeParse(plan.generationState);
	if (parsed.success) return snapshotOf(plan, parsed.data, false, entities);
	if (!plan.sections.length) return snapshotOf(plan, null, true, entities);
	return snapshotOf(
		plan,
		{ planId: STORYBOARD_LEGACY_REVISION_ID, draft: readLegacyStoryDraft(plan.sections) },
		true,
		entities,
	);
}

function remapLegacyCommand(
	command: StoryboardCommand,
	preview: StoryboardGenerationState,
	canonical: StoryboardGenerationState,
): StoryboardCommand {
	const ids = new Map<string, string>();
	for (const [sectionIndex, section] of preview.draft.sections.entries()) {
		const target = canonical.draft.sections[sectionIndex];
		if (!target) continue;
		ids.set(section.id, target.id);
		for (const [beatIndex, beat] of section.beats.entries()) {
			const targetBeat = target.beats[beatIndex];
			if (targetBeat) ids.set(beat.id, targetBeat.id);
		}
	}
	const idFields = new Set([
		"sectionId",
		"afterSectionId",
		"beatId",
		"afterBeatId",
		"firstBeatId",
		"secondBeatId",
	]);
	return storyboardCommandSchema.parse(
		Object.fromEntries(
			Object.entries(command).map(([key, value]) => [
				key,
				idFields.has(key) && typeof value === "string" ? (ids.get(value) ?? value) : value,
			]),
		),
	);
}

async function current(projectId: string) {
	const detail = await getContentProject(projectId);
	if (!detail) return null;
	const latest = detail.storyboards[0];
	const doc = readStoryboardDocument(latest?.storyboard_json).doc;
	const artifacts = documentArtifacts(doc.artifacts);
	return { detail, latest, doc, artifacts, found: storyPlanOf(artifacts) };
}

export async function readStoryboardAuthoring(
	projectId: string,
): Promise<StoryboardAuthoringSnapshot | null> {
	const value = await current(projectId);
	if (!value) return null;
	return value.found
		? stateOf(value.found.plan, value.detail.entities)
		: { state: null, legacy: false, generatedByBeatId: {}, references: {} };
}

/* An edit made here is the operator's, outside any run, so the plan is written
 * with the editor producer: a new revision and a new content hash. */
async function savePlan(
	projectId: string,
	value: NonNullable<Awaited<ReturnType<typeof current>>>,
	plan: StoryPlan,
): Promise<ContentStoryboardRow | null> {
	const written = writeArtifact(pipelineArtifactKinds, value.artifacts, {
		kind: storyPlanArtifact.kind,
		payload: plan,
		producer: { type: "editor" },
		projectId,
	});
	/* An approval made here is recorded the way the chat path records one: the
	 * frozen snapshot as an `approved_plan` artifact referencing the plan revision
	 * just written. */
	const snapshot = plan.generationState?.approvedSnapshot;
	// A new approval — even of the same revision, under another extension policy —
	// is a new snapshot and is recorded; an unchanged one is not rewritten.
	const recorded = payloadOfKind(
		value.artifacts.find((a) => a.kind === approvedPlanArtifact.kind),
		approvedPlanArtifact,
	);
	const approvedChanged = snapshot && stableStringify(snapshot) !== stableStringify(recorded);
	const { artifacts } = approvedChanged
		? writeArtifact(pipelineArtifactKinds, written.artifacts, {
				kind: approvedPlanArtifact.kind,
				payload: snapshot,
				producer: { type: "editor" },
				projectId,
				inputRefs: [artifactRefOf(written.artifact)],
			})
		: written;
	return await addContentStoryboard({
		project_id: projectId,
		status: "storyboard",
		storyboard_json: writeStoryboardDocument({ ...value.doc, artifacts }),
	});
}

export async function commandStoryboard(
	projectId: string,
	expectedRevisionId: string,
	command: StoryboardCommand,
): Promise<StoryboardAuthoringResult> {
	const value = await current(projectId);
	if (!value)
		return {
			ok: false,
			reason: "not_found",
			message: "Project not found.",
			state: null,
			legacy: false,
			generatedByBeatId: {},
			references: {},
		};
	if (!value.found) {
		if (expectedRevisionId !== STORYBOARD_MISSING_REVISION_ID || command.type !== "add_section") {
			return {
				ok: false,
				reason: "conflict",
				message: "Story draft changed; reload and retry.",
				state: null,
				legacy: false,
				generatedByBeatId: {},
				references: {},
			};
		}
		const state = storyboardGenerationStateSchema.parse({
			planId: crypto.randomUUID(),
			draft: { revisionId: crypto.randomUUID(), sections: [command.section] },
		});
		const plan: StoryPlan = {
			targetSec: value.detail.project.target_duration_sec ?? 60,
			sections: projectStoryboardSections([], state),
			generationState: state,
		};
		const storyboard = await savePlan(projectId, value, plan);
		return storyboard
			? { ok: true, storyboard, ...snapshotOf(plan, state, false, value.detail.entities) }
			: {
					ok: false,
					reason: "not_found",
					message: "Project not found.",
					state: null,
					legacy: false,
					generatedByBeatId: {},
					references: {},
				};
	}

	const snapshot = stateOf(value.found.plan, value.detail.entities);
	if (snapshot.legacy && expectedRevisionId !== STORYBOARD_LEGACY_REVISION_ID) {
		return {
			ok: false,
			reason: "conflict",
			message: "Story draft changed; reload and retry.",
			...snapshot,
		};
	}
	const canonical = snapshot.legacy
		? canonicalizeLegacyStoryPlan(value.found.plan.sections)
		: snapshot.state!;
	const expected =
		snapshot.legacy && expectedRevisionId === STORYBOARD_LEGACY_REVISION_ID
			? canonical.draft.revisionId
			: expectedRevisionId;
	const currentCommand = snapshot.legacy
		? remapLegacyCommand(command, snapshot.state!, canonical)
		: command;
	const result = applyStoryboardCommand(canonical, expected, currentCommand);
	if (!result.ok) return { ...result, ...snapshot, state: canonical };
	const plan: StoryPlan = {
		...value.found.plan,
		sections: projectStoryboardSections(value.found.plan.sections, result.state),
		generationState: result.state,
	};
	const storyboard = await savePlan(projectId, value, plan);
	return storyboard
		? { ok: true, storyboard, ...snapshotOf(plan, result.state, false, value.detail.entities) }
		: {
				ok: false,
				reason: "not_found",
				message: "Project not found.",
				...snapshot,
				state: canonical,
			};
}

/** The direction inputs as the project now holds them, in the one shape both the
 *  fingerprint and a re-direction need. */
function directionInputsOf(
	value: NonNullable<Awaited<ReturnType<typeof current>>>,
	plan: StoryPlan,
) {
	const live = directionFromMaterials(value.doc.materials);
	const templateConstraints = readTemplateConstraints(plan.directionInputs?.templateConstraints);
	return {
		visual: live.visual ?? undefined,
		rules: live.rules ?? undefined,
		templateConstraints,
		rosterIds: [...new Set(castableSubjects(value.detail.entities).map((entity) => entity.id))],
	};
}

function readTemplateConstraints(
	stored: string | undefined,
): Record<string, string | number | boolean> | undefined {
	if (!stored) return undefined;
	try {
		// SAFETY: written by `storyDirectionInputsFor` as JSON; a value of any other
		// shape degrades to "no constraints", which direction already handles.
		const parsed: unknown = JSON.parse(stored);
		// SAFETY: object-ness is checked on the line itself; direction reads these as
		// loose constraint values and ignores any key it does not know.
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, string | number | boolean>)
			: undefined;
	} catch {
		return undefined;
	}
}

function currentDirectionFingerprintOf(
	value: NonNullable<Awaited<ReturnType<typeof current>>>,
	plan: StoryPlan,
): string | undefined {
	if (!plan.directionInputs) return plan.directionFingerprint;
	const inputs = directionInputsOf(value, plan);
	return storyDirectionInputFingerprint({
		narrations: plan.sections.map((section) => section.narration),
		plannedShots: plan.sections.map((section) => section.visualPrompts ?? [section.visualPrompt]),
		rosterIds: inputs.rosterIds,
		materials: JSON.stringify({ visual: inputs.visual ?? "", rules: inputs.rules ?? "" }),
		templateConstraints: plan.directionInputs.templateConstraints,
	});
}

/* Repair the project's plan before approval judges it.
 *
 * The chat path has always done this; the editor only refused, so an edit made
 * here could leave a plan that chat would happily approve and this surface would
 * not. Same gate (`needsStoryDirectionRepair`), same repair call, different
 * store: the result is written back as a storyboard version rather than onto a
 * run. */
export async function repairStoryboardDirection(projectId: string): Promise<void> {
	const value = await current(projectId);
	if (!value?.found) return;
	const plan = value.found.plan;
	const fingerprint = currentDirectionFingerprintOf(value, plan);
	if (!fingerprint) return;
	if (
		!needsStoryDirectionRepair(
			{
				directed: plan.referenceAliases !== undefined,
				directionBlocked: plan.directionBlocked,
				needsDirection: plan.needsDirection,
				directionFingerprint: plan.directionFingerprint,
			},
			fingerprint,
		)
	)
		return;
	const inputs = directionInputsOf(value, plan);
	const rows = await listProjectReferences(projectId);
	const castable = new Set(inputs.rosterIds);
	const directed = await redirectStorySections(plan.sections, {
		roster: rows
			.filter((entity) => castable.has(entity.id))
			.map((entity) => ({
				id: entity.id,
				role: entity.role,
				label: entity.label,
				description: entity.description,
				primary: entity.is_primary === 1,
				updatedAt: entity.updated_at,
			})),
		visual: inputs.visual,
		rules: inputs.rules,
		templateConstraints: inputs.templateConstraints,
		allowInfographics: inputs.templateConstraints?.useData !== false,
		plannedReferences: plan.plannedReferences,
	});
	const repaired: StoryPlan = directed.ok
		? {
				...plan,
				sections: directed.sections,
				plannedReferences: directed.plannedReferences,
				referenceAliases: directed.referenceAliases,
				directionFingerprint: fingerprint,
				needsDirection: false,
				directionBlocked: undefined,
				directionErrors: [],
			}
		: {
				...plan,
				plannedReferences: directed.plannedReferences,
				referenceAliases: directed.referenceAliases,
				needsDirection: true,
				directionBlocked: directed.directionBlocked,
				directionErrors: directed.directionErrors,
			};
	await savePlan(projectId, value, repaired);
}

export async function approveStoryboard(
	projectId: string,
	expectedRevisionId: string,
	extensionPolicy: StoryExtensionPolicy,
): Promise<StoryboardAuthoringResult> {
	await repairStoryboardDirection(projectId);
	const value = await current(projectId);
	if (!value)
		return {
			ok: false,
			reason: "not_found",
			message: "Project not found.",
			state: null,
			legacy: false,
			generatedByBeatId: {},
			references: {},
		};
	if (!value.found)
		return {
			ok: false,
			reason: "invalid",
			message: "No story plan yet.",
			state: null,
			legacy: false,
			generatedByBeatId: {},
			references: {},
		};
	const snapshot = stateOf(value.found.plan, value.detail.entities);
	const canonical = snapshot.legacy
		? canonicalizeLegacyStoryPlan(value.found.plan.sections)
		: snapshot.state!;
	if (
		expectedRevisionId !== canonical.draft.revisionId &&
		!(snapshot.legacy && expectedRevisionId === STORYBOARD_LEGACY_REVISION_ID)
	) {
		return {
			ok: false,
			reason: "conflict",
			message: "Story draft changed; reload and retry.",
			...snapshot,
			state: canonical,
		};
	}
	/* Same rule the chat path enforces before generation: a plan whose sequence
	 * direction failed is not approvable. The one exception is the error class
	 * generation repairs itself when data overlays are off; it re-checks there. */
	const directed = value.found.plan.referenceAliases !== undefined;
	const blockersOf = (message: string): OpenBlocker[] => {
		const derived = openBlockers({
			plan: {
				...value.found!.plan,
				needsDirection: true,
				directionErrors: value.found!.plan.directionErrors?.length
					? value.found!.plan.directionErrors
					: [message],
			},
		});
		return derived;
	};
	if (
		!directed &&
		value.found.plan.needsDirection &&
		!onlyNoDataRepairableDirectionErrors(value.found.plan.directionErrors)
	) {
		const detail = value.found.plan.directionErrors?.[0];
		const message = `Story sequence direction needs review before approval${detail ? `: ${detail}` : "."}`;
		return {
			ok: false,
			reason: "invalid",
			message,
			blockers: blockersOf(message),
			...snapshot,
			state: canonical,
		};
	}
	const currentFingerprint = currentDirectionFingerprintOf(value, value.found.plan);
	const approval = validateStoryApproval({
		directed,
		directionBlocked: value.found.plan.directionBlocked,
		needsDirection: value.found.plan.needsDirection,
		directionErrors: value.found.plan.directionErrors,
		directionFingerprint: value.found.plan.directionFingerprint,
		currentDirectionFingerprint: currentFingerprint,
	});
	if (!approval.ok)
		return {
			ok: false,
			reason: "invalid",
			message: approval.message,
			blockers: blockersOf(approval.message),
			...snapshot,
			state: canonical,
		};
	const state = approveStoryDraft(canonical, "explicit", extensionPolicy, undefined, undefined, {
		plannedReferences: value.found.plan.plannedReferences,
		referenceAliases: value.found.plan.referenceAliases,
		directionFingerprint: value.found.plan.directionFingerprint,
	});
	const plan: StoryPlan = {
		...value.found.plan,
		sections: projectStoryboardSections(value.found.plan.sections, state),
		generationState: state,
	};
	const storyboard = await savePlan(projectId, value, plan);
	return storyboard
		? { ok: true, storyboard, ...snapshotOf(plan, state, false, value.detail.entities) }
		: {
				ok: false,
				reason: "not_found",
				message: "Project not found.",
				...snapshot,
				state: canonical,
			};
}
