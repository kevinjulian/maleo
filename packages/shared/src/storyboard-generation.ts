import { z } from "zod";
import { storyPlannedReferenceDefinitionSchema } from "./story-plan.ts";
import {
	storyReferenceAliasSchema,
	storyReferenceBindingSchema,
} from "./story-visual-direction.ts";
import { storyEditorialDecisionSchema } from "./story-sequence-direction.ts";

export const storyApprovalModeSchema = z.enum([
	"explicit",
	"implicit_one_shot",
	"implicit_extension",
]);
export const storyExtensionPolicySchema = z.enum(["review_additions", "auto_approve_additions"]);
export type StoryApprovalMode = z.infer<typeof storyApprovalModeSchema>;
export type StoryExtensionPolicy = z.infer<typeof storyExtensionPolicySchema>;

const opaqueId = z.string().min(1);
const references = {
	refKeys: z.array(opaqueId).optional(),
	refIds: z.array(opaqueId).optional(),
};

export const storySemanticBeatSchema = z
	.object({
		id: opaqueId,
		title: z.string().default(""),
		narration: z.string().default(""),
		visualPrompt: z.string().default(""),
		editorial: storyEditorialDecisionSchema.optional(),
		requiredReferences: z.array(storyReferenceBindingSchema).optional(),
		locked: z.boolean().optional(),
		...references,
	})
	.passthrough();
export type StorySemanticBeat = z.infer<typeof storySemanticBeatSchema>;

export const storyDraftSectionSchema = z
	.object({
		id: opaqueId,
		title: z.string().default(""),
		beats: z.array(storySemanticBeatSchema).min(1),
	})
	.passthrough();
export type StoryDraftSection = z.infer<typeof storyDraftSectionSchema>;

export const storyDraftRevisionSchema = z.object({
	revisionId: opaqueId,
	sections: z.array(storyDraftSectionSchema).min(1),
});
export type StoryDraftRevision = z.infer<typeof storyDraftRevisionSchema>;

export const storyApprovedSnapshotSchema = storyDraftRevisionSchema.extend({
	approvalMode: storyApprovalModeSchema,
	extensionPolicy: storyExtensionPolicySchema,
	approvedAt: z.string().datetime(),
	parentRevisionId: opaqueId.optional(),
	/* The visual contract the operator approved, frozen beside the beats it was
	 * decided for. Definitions live here so a later draft edit cannot change what
	 * an approved run materializes; the key→entity mapping does NOT, because that
	 * is resolution, not decision. */
	plannedReferences: z.array(storyPlannedReferenceDefinitionSchema).optional(),
	referenceAliases: z.array(storyReferenceAliasSchema).optional(),
	directionFingerprint: z.string().min(1).optional(),
});
export type StoryApprovedSnapshot = z.infer<typeof storyApprovedSnapshotSchema>;

export const storyboardGenerationStateSchema = z.object({
	planId: opaqueId,
	draft: storyDraftRevisionSchema,
	approvedSnapshot: storyApprovedSnapshotSchema.optional(),
	/** Planned key → materialized entity, for one approved revision. */
	materialization: z
		.object({
			revisionId: opaqueId,
			byKey: z.record(z.string().min(1), z.string().min(1)).default({}),
		})
		.optional(),
});
export type StoryboardGenerationState = z.infer<typeof storyboardGenerationStateSchema>;

export type StoryApprovalValidation =
	| { ok: true }
	| {
			ok: false;
			reason: "stale_direction" | "needs_direction" | "blocking_requirement";
			message: string;
	  };

/** Why an approval was refused. `no_plan` is the one reason validation cannot
 *  report, because it is the absence of the thing validation reads. */
export type StoryApprovalRefusalReason =
	| Extract<StoryApprovalValidation, { ok: false }>["reason"]
	| "no_plan";

/* A refusal is returned, never written onto the plan.
 *
 * Refusals used to be recorded by setting `needsDirection` and overwriting
 * `directionErrors` with the refusal text. That turned a recomputable condition
 * into a latch — a staling edit that the operator then undid left the plan
 * unapprovable with its original cause erased — so the refusal now travels back
 * to the caller and the plan keeps describing itself. */
export type StoryApprovalOutcome<TState> =
	| { ok: true; state: TState }
	| { ok: false; reason: StoryApprovalRefusalReason; message: string };

/* Whether re-running direction before approval could change the answer.
 *
 * One rule for both approval paths, because they disagreed: chat repaired first
 * and the editor only refused, so the same plan approved in one surface and
 * dead-ended in the other. Drift is not the only trigger — a plan marked
 * `needsDirection` is repaired even when its inputs match what direction last
 * saw, which is the state an undone edit leaves behind. A blocker only the
 * operator can clear is never repaired: the inputs have not changed, so the
 * re-run would spend a model call to reproduce the same refusal. */
export function needsStoryDirectionRepair(
	plan: {
		directed: boolean;
		directionBlocked?: boolean;
		needsDirection?: boolean;
		directionFingerprint?: string;
	},
	currentDirectionFingerprint: string,
): boolean {
	if (!plan.directed) return false;
	if (plan.directionBlocked) return false;
	if (plan.needsDirection) return true;
	return plan.directionFingerprint !== currentDirectionFingerprint;
}

/** One approval rule for chat and storyboard routes. Legacy plans opt out by not
 * carrying the directed-plan marker (`referenceAliases`). */
export function validateStoryApproval(input: {
	directed: boolean;
	/** Set by the direction stage when only the operator can resolve the blocker —
	 *  a flag, because classifying by message text made a reference LABEL able to
	 *  decide which branch an approval took. */
	directionBlocked?: boolean;
	needsDirection?: boolean;
	directionErrors?: readonly string[];
	directionFingerprint?: string;
	currentDirectionFingerprint?: string;
	approvalMode?: StoryApprovalMode;
}): StoryApprovalValidation {
	if (!input.directed) return { ok: true };
	const errors = input.directionErrors ?? [];
	if (input.directionBlocked) {
		return {
			ok: false,
			reason: "blocking_requirement",
			message: errors[0] ?? "Story direction needs operator reference input.",
		};
	}
	if (input.needsDirection)
		return {
			ok: false,
			reason: "needs_direction",
			message: errors[0] ?? "Story visual direction needs review.",
		};
	/* An extension adds sections to a plan the operator already approved, under the
	 * extension policy they chose. Those additions ARE a change of direction input,
	 * so requiring a fresh fingerprint here refuses every extension — and the
	 * generation path then dereferences the refusal. Directed content still cannot
	 * pass: a blocker or `needsDirection` above refuses this mode too. */
	if (input.approvalMode === "implicit_extension") return { ok: true };
	if (
		!input.directionFingerprint ||
		input.directionFingerprint !== input.currentDirectionFingerprint
	) {
		return {
			ok: false,
			reason: "stale_direction",
			message: "Story visual direction inputs changed; run direction again before approval.",
		};
	}
	return { ok: true };
}

export const storyGeneratedSourceSchema = z.object({
	sourceBeatId: opaqueId,
	sourceRevisionId: opaqueId,
	inputHash: opaqueId,
});
export type StoryGeneratedSource = z.infer<typeof storyGeneratedSourceSchema>;

const sectionFields = z.object({ title: z.string().optional() }).strict();
const beatFields = z
	.object({
		title: z.string().optional(),
		narration: z.string().optional(),
		visualPrompt: z.string().optional(),
		editorial: storyEditorialDecisionSchema.optional(),
	})
	.strict();

export const storyboardCommandSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("add_section"),
		afterSectionId: opaqueId.optional(),
		section: storyDraftSectionSchema,
	}),
	z.object({ type: z.literal("update_section"), sectionId: opaqueId, fields: sectionFields }),
	z.object({ type: z.literal("remove_section"), sectionId: opaqueId }),
	z.object({
		type: z.literal("reorder_section"),
		sectionId: opaqueId,
		afterSectionId: opaqueId.nullable(),
	}),
	z.object({
		type: z.literal("add_beat"),
		sectionId: opaqueId,
		afterBeatId: opaqueId.optional(),
		beat: storySemanticBeatSchema,
	}),
	z.object({ type: z.literal("update_beat"), beatId: opaqueId, fields: beatFields }),
	z.object({ type: z.literal("remove_beat"), beatId: opaqueId }),
	z.object({
		type: z.literal("reorder_beat"),
		beatId: opaqueId,
		sectionId: opaqueId,
		afterBeatId: opaqueId.nullable(),
	}),
	z.object({
		type: z.literal("split_beat"),
		beatId: opaqueId,
		first: beatFields,
		second: storySemanticBeatSchema,
	}),
	z.object({ type: z.literal("merge_beats"), firstBeatId: opaqueId, secondBeatId: opaqueId }),
	z.object({ type: z.literal("lock_beat"), beatId: opaqueId }),
	z.object({ type: z.literal("unlock_beat"), beatId: opaqueId }),
	z.object({
		type: z.literal("attach_reference"),
		beatId: opaqueId,
		referenceId: opaqueId,
		referenceKind: z.enum(["planned", "entity"]),
	}),
]);
export type StoryboardCommand = z.infer<typeof storyboardCommandSchema>;

export type StoryboardCommandResult =
	| { ok: true; state: StoryboardGenerationState }
	| {
			ok: false;
			reason: "conflict" | "invalid" | "locked";
			currentRevisionId: string;
			message: string;
	  };

function insertedAfter<T>(items: readonly T[], after: T | undefined, value: T): T[] {
	if (after === undefined) return [...items, value];
	const index = items.indexOf(after);
	if (index < 0) throw new Error("Insertion anchor not found");
	return [...items.slice(0, index + 1), value, ...items.slice(index + 1)];
}

function beatLocation(sections: readonly StoryDraftSection[], beatId: string) {
	for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
		const beatIndex = sections[sectionIndex]!.beats.findIndex((beat) => beat.id === beatId);
		if (beatIndex >= 0) return { sectionIndex, beatIndex };
	}
	return undefined;
}

function uniqueIds(sections: readonly StoryDraftSection[]): boolean {
	const ids = new Set<string>();
	for (const section of sections) {
		if (ids.has(section.id)) return false;
		ids.add(section.id);
		for (const beat of section.beats) {
			if (ids.has(beat.id)) return false;
			ids.add(beat.id);
		}
	}
	return true;
}

export function applyStoryboardCommand(
	state: StoryboardGenerationState,
	expectedRevisionId: string,
	commandInput: StoryboardCommand,
	newRevisionId: string = crypto.randomUUID(),
): StoryboardCommandResult {
	if (expectedRevisionId !== state.draft.revisionId) {
		return {
			ok: false,
			reason: "conflict",
			currentRevisionId: state.draft.revisionId,
			message: "Story draft changed; reload and retry.",
		};
	}
	const parsed = storyboardCommandSchema.safeParse(commandInput);
	if (!parsed.success)
		return {
			ok: false,
			reason: "invalid",
			currentRevisionId: state.draft.revisionId,
			message: parsed.error.issues[0]?.message ?? "Invalid storyboard command.",
		};
	const command = parsed.data;
	let sections = state.draft.sections.map((section) => ({
		...section,
		beats: section.beats.map((beat) => ({ ...beat })),
	}));
	const fail = (reason: "invalid" | "locked", message: string): StoryboardCommandResult => ({
		ok: false,
		reason,
		currentRevisionId: state.draft.revisionId,
		message,
	});
	const locate = (id: string) => beatLocation(sections, id);
	const locked = (id: string) => {
		const at = locate(id);
		return at ? Boolean(sections[at.sectionIndex]!.beats[at.beatIndex]!.locked) : false;
	};

	try {
		switch (command.type) {
			case "add_section": {
				const after = command.afterSectionId
					? sections.find((section) => section.id === command.afterSectionId)
					: undefined;
				if (command.afterSectionId && !after) return fail("invalid", "Section anchor not found.");
				sections = insertedAfter(sections, after, command.section);
				break;
			}
			case "update_section": {
				const index = sections.findIndex((section) => section.id === command.sectionId);
				if (index < 0) return fail("invalid", "Section not found.");
				sections[index] = { ...sections[index]!, ...command.fields };
				break;
			}
			case "remove_section": {
				const section = sections.find((item) => item.id === command.sectionId);
				if (!section) return fail("invalid", "Section not found.");
				if (section.beats.some((beat) => beat.locked))
					return fail("locked", "Section contains locked beat.");
				if (sections.length === 1) return fail("invalid", "Story must keep one section.");
				sections = sections.filter((item) => item.id !== command.sectionId);
				break;
			}
			case "reorder_section": {
				const section = sections.find((item) => item.id === command.sectionId);
				if (!section || command.afterSectionId === command.sectionId)
					return fail("invalid", "Invalid section reorder.");
				const rest = sections.filter((item) => item.id !== command.sectionId);
				const after =
					command.afterSectionId === null
						? undefined
						: rest.find((item) => item.id === command.afterSectionId);
				if (command.afterSectionId !== null && !after)
					return fail("invalid", "Section anchor not found.");
				sections =
					command.afterSectionId === null
						? [section, ...rest]
						: insertedAfter(rest, after, section);
				break;
			}
			case "add_beat": {
				const sectionIndex = sections.findIndex((section) => section.id === command.sectionId);
				if (sectionIndex < 0) return fail("invalid", "Section not found.");
				const beats = sections[sectionIndex]!.beats;
				const after = command.afterBeatId
					? beats.find((beat) => beat.id === command.afterBeatId)
					: undefined;
				if (command.afterBeatId && !after) return fail("invalid", "Beat anchor not found.");
				sections[sectionIndex] = {
					...sections[sectionIndex]!,
					beats: insertedAfter(beats, after, command.beat),
				};
				break;
			}
			case "update_beat": {
				const at = locate(command.beatId);
				if (!at) return fail("invalid", "Beat not found.");
				if (locked(command.beatId)) return fail("locked", "Beat is locked.");
				const section = sections[at.sectionIndex]!;
				section.beats[at.beatIndex] = { ...section.beats[at.beatIndex]!, ...command.fields };
				break;
			}
			case "remove_beat": {
				const at = locate(command.beatId);
				if (!at) return fail("invalid", "Beat not found.");
				if (locked(command.beatId)) return fail("locked", "Beat is locked.");
				const section = sections[at.sectionIndex]!;
				if (section.beats.length === 1) return fail("invalid", "Section must keep one beat.");
				section.beats = section.beats.filter((beat) => beat.id !== command.beatId);
				break;
			}
			case "reorder_beat": {
				const at = locate(command.beatId);
				const targetIndex = sections.findIndex((section) => section.id === command.sectionId);
				if (!at || targetIndex < 0 || command.afterBeatId === command.beatId)
					return fail("invalid", "Invalid beat reorder.");
				const beat = sections[at.sectionIndex]!.beats[at.beatIndex]!;
				sections[at.sectionIndex]!.beats.splice(at.beatIndex, 1);
				const target = sections[targetIndex]!.beats;
				const after =
					command.afterBeatId === null
						? undefined
						: target.find((item) => item.id === command.afterBeatId);
				if (command.afterBeatId !== null && !after)
					return fail("invalid", "Beat anchor not found.");
				sections[targetIndex]!.beats =
					command.afterBeatId === null ? [beat, ...target] : insertedAfter(target, after, beat);
				if (sections[at.sectionIndex]!.beats.length === 0)
					return fail("invalid", "Source section must keep one beat.");
				break;
			}
			case "split_beat": {
				const at = locate(command.beatId);
				if (!at) return fail("invalid", "Beat not found.");
				if (locked(command.beatId)) return fail("locked", "Beat is locked.");
				const section = sections[at.sectionIndex]!;
				const original = section.beats[at.beatIndex]!;
				section.beats.splice(at.beatIndex, 1, { ...original, ...command.first }, command.second);
				break;
			}
			case "merge_beats": {
				const first = locate(command.firstBeatId);
				const second = locate(command.secondBeatId);
				if (
					!first ||
					!second ||
					first.sectionIndex !== second.sectionIndex ||
					Math.abs(first.beatIndex - second.beatIndex) !== 1
				)
					return fail("invalid", "Merge needs adjacent beats in one section.");
				if (locked(command.firstBeatId) || locked(command.secondBeatId))
					return fail("locked", "Beat is locked.");
				const section = sections[first.sectionIndex]!;
				const start = Math.min(first.beatIndex, second.beatIndex);
				const a = section.beats[start]!;
				const b = section.beats[start + 1]!;
				const required = [...(a.requiredReferences ?? []), ...(b.requiredReferences ?? [])];
				const merged = {
					...a,
					narration: [a.narration, b.narration].filter(Boolean).join(" "),
					visualPrompt: [a.visualPrompt, b.visualPrompt].filter(Boolean).join("; "),
					refKeys: [...new Set([...(a.refKeys ?? []), ...(b.refKeys ?? [])])],
					refIds: [...new Set([...(a.refIds ?? []), ...(b.refIds ?? [])])],
					requiredReferences: required.filter(
						(binding, index) =>
							required.findIndex(
								(candidate) => JSON.stringify(candidate) === JSON.stringify(binding),
							) === index,
					),
				};
				section.beats = section.beats.filter(
					(_, index) => index !== first.beatIndex && index !== second.beatIndex,
				);
				section.beats.splice(start, 0, merged);
				break;
			}
			case "lock_beat":
			case "unlock_beat": {
				const at = locate(command.beatId);
				if (!at) return fail("invalid", "Beat not found.");
				const section = sections[at.sectionIndex]!;
				section.beats[at.beatIndex] = {
					...section.beats[at.beatIndex]!,
					locked: command.type === "lock_beat" || undefined,
				};
				break;
			}
			case "attach_reference": {
				const at = locate(command.beatId);
				if (!at) return fail("invalid", "Beat not found.");
				if (locked(command.beatId)) return fail("locked", "Beat is locked.");
				const section = sections[at.sectionIndex]!;
				const beat = section.beats[at.beatIndex]!;
				const key = command.referenceKind === "planned" ? "refKeys" : "refIds";
				const required =
					command.referenceKind === "planned"
						? { plannedKey: command.referenceId }
						: { entityId: command.referenceId };
				section.beats[at.beatIndex] = {
					...beat,
					[key]: [...new Set([...(beat[key] ?? []), command.referenceId])],
					requiredReferences: [...(beat.requiredReferences ?? []), required].filter(
						(binding, index, all) =>
							all.findIndex(
								(candidate) => JSON.stringify(candidate) === JSON.stringify(binding),
							) === index,
					),
				};
				break;
			}
		}
	} catch (error) {
		return fail("invalid", error instanceof Error ? error.message : String(error));
	}
	if (!uniqueIds(sections)) return fail("invalid", "Section and beat ids must be unique.");
	const next = storyboardGenerationStateSchema.safeParse({
		...state,
		draft: { revisionId: newRevisionId, sections },
	});
	return next.success
		? { ok: true, state: next.data }
		: fail("invalid", next.error.issues[0]?.message ?? "Invalid story draft.");
}

export interface ApprovedDirectionContract {
	plannedReferences?: readonly unknown[];
	referenceAliases?: readonly unknown[];
	directionFingerprint?: string;
}

export function approveStoryDraft(
	state: StoryboardGenerationState,
	approvalMode: StoryApprovalMode,
	extensionPolicy: StoryExtensionPolicy = "review_additions",
	approvedAt = new Date().toISOString(),
	parentRevisionId?: string,
	direction?: ApprovedDirectionContract,
): StoryboardGenerationState {
	const { materialization: _superseded, ...rest } = state;
	return storyboardGenerationStateSchema.parse({
		...rest,
		approvedSnapshot: structuredClone({
			...state.draft,
			approvalMode,
			extensionPolicy,
			approvedAt,
			parentRevisionId,
			plannedReferences: direction?.plannedReferences,
			referenceAliases: direction?.referenceAliases,
			directionFingerprint: direction?.directionFingerprint,
		}),
	});
}

/* Resolution, recorded outside the approved decision. Keyed by the revision it was
 * resolved for, so a re-approval never inherits the previous run's entities. */
export function recordMaterializedReference(
	state: StoryboardGenerationState,
	key: string,
	entityId: string,
): StoryboardGenerationState {
	const revisionId = state.approvedSnapshot?.revisionId;
	if (!revisionId) throw new Error("cannot record a materialized reference before approval");
	const current =
		state.materialization?.revisionId === revisionId ? state.materialization.byKey : {};
	if (current[key] === entityId) return state;
	return storyboardGenerationStateSchema.parse({
		...state,
		materialization: { revisionId, byKey: { ...current, [key]: entityId } },
	});
}

export function materializedEntityId(
	state: StoryboardGenerationState,
	key: string,
): string | undefined {
	if (
		!state.approvedSnapshot ||
		state.materialization?.revisionId !== state.approvedSnapshot.revisionId
	)
		return undefined;
	return state.materialization.byKey[key];
}

export function replaceStoryDraft(
	state: StoryboardGenerationState,
	sections: readonly LegacyStorySection[],
	revisionId: string = crypto.randomUUID(),
): StoryboardGenerationState {
	const canonical = canonicalizeLegacyStoryPlan(sections);
	return storyboardGenerationStateSchema.parse({
		...state,
		draft: { ...canonical.draft, revisionId },
	});
}

export interface LegacyStorySection {
	id?: string;
	sectionId?: string;
	semanticBeatId?: string;
	title?: string;
	narration?: string;
	visualPrompt?: string;
	editorial?: z.infer<typeof storyEditorialDecisionSchema>;
	refKeys?: string[];
	refIds?: string[];
}

export const STORYBOARD_MISSING_REVISION_ID = "missing";
export const STORYBOARD_LEGACY_REVISION_ID = "legacy-unpersisted";

/** Read-only view: deterministic temporary keys, never a value callers may save. */
export function readLegacyStoryDraft(sections: readonly LegacyStorySection[]): StoryDraftRevision {
	return {
		revisionId: STORYBOARD_LEGACY_REVISION_ID,
		sections: sections.map((section, index) => ({
			...section,
			id: section.sectionId || section.id || `legacy-section-${index}`,
			title: section.title ?? "",
			beats: [
				{
					...section,
					id: `legacy-beat-${index}`,
					title: section.title ?? "",
					narration: section.narration ?? "",
					visualPrompt: section.visualPrompt ?? "",
					refKeys: section.refKeys,
					refIds: section.refIds,
				},
			],
		})),
	};
}

export function canonicalizeLegacyStoryPlan(
	sections: readonly LegacyStorySection[],
	id: () => string = () => crypto.randomUUID(),
): StoryboardGenerationState {
	return storyboardGenerationStateSchema.parse({
		planId: id(),
		draft: {
			revisionId: id(),
			sections: sections.map((section) => ({
				...section,
				id: section.sectionId || section.id || id(),
				title: section.title ?? "",
				beats: [
					{
						...section,
						id:
							typeof section.semanticBeatId === "string" && section.semanticBeatId
								? section.semanticBeatId
								: id(),
						title: section.title ?? "",
						narration: section.narration ?? "",
						visualPrompt: section.visualPrompt ?? "",
						refKeys: section.refKeys,
						refIds: section.refIds,
					},
				],
			})),
		},
	});
}
