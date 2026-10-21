/* What each planned shot shows, and which project references it uses.
 *
 * Reference decisions used to be spread across framing, drafting, the Story Bible
 * and post-TTS beat authoring, so nothing could answer the one question review
 * asks before spend: what will this image show, and which reference will it use?
 * Direction answers it here, per planned shot, and everything downstream reads
 * these bindings instead of deciding again.
 *
 * A binding names a reference by IDENTITY, never by label: an existing project
 * roster entity id, or a plan-local planned-reference key. Rosters really do carry
 * several entities with the same label and role, so a label join picks an arbitrary
 * twin; `bindingIdentity` is what the Story Bible, beat authoring and coverage
 * checks all map through. */
import { z } from "zod";
import {
	DEFAULT_CAST_SUBJECT_CAP,
	MAX_REFERENCE_IMAGES,
	isSubjectRole,
} from "./generation-cast.ts";

export const STORY_SHOT_REFERENCE_ROLES = ["continuity", "novelty"] as const;
export type StoryShotReferenceRole = (typeof STORY_SHOT_REFERENCE_ROLES)[number];

/** Exactly one source. Written as one object with a refinement rather than a union
 *  so the failure says "both or neither" instead of listing two branch errors. */
export const storyReferenceBindingSchema = z
	.object({
		entityId: z.string().min(1).optional(),
		plannedKey: z.string().min(1).optional(),
	})
	.strict()
	.refine((binding) => !!binding.entityId !== !!binding.plannedKey, {
		message: "a binding names exactly one of entityId or plannedKey",
	});
export type StoryReferenceBinding = z.infer<typeof storyReferenceBindingSchema>;

/** The logical reference identity a binding points at. */
export function bindingIdentity(binding: StoryReferenceBinding): string {
	return binding.entityId ? `entity:${binding.entityId}` : `planned:${binding.plannedKey}`;
}

/* `rationale` is capped rather than free prose: it is regenerated whenever
 * direction re-runs, and review shows one line per shot. */
export const storyPlannedShotDirectionSchema = z
	.object({
		index: z.number().int().min(0),
		visualIntent: z.string().trim().min(1).max(500),
		role: z.enum(STORY_SHOT_REFERENCE_ROLES),
		bindings: z.array(storyReferenceBindingSchema).default([]),
		rationale: z.string().trim().min(1).max(160),
	})
	.strict();
export type StoryPlannedShotDirection = z.infer<typeof storyPlannedShotDirectionSchema>;

/** The narration's words for one bound identity. The Story Bible's reference
 *  entries take their aliases from here, which is what keeps the alias coverage
 *  invariant checkable by set membership rather than by a model. */
export const storyReferenceAliasSchema = z
	.object({
		ref: z.string().min(1),
		aliases: z.array(z.string().trim().min(1)).default([]),
	})
	.strict();
export type StoryReferenceAlias = z.infer<typeof storyReferenceAliasSchema>;

export interface StoryVisualDirectionRosterEntry {
	id: string;
	role: string;
	label: string;
	description?: string;
	primary?: boolean;
	updatedAt?: number;
}

export type StoryVisualDirectionInvariant =
	| "shot_coverage"
	| "unknown_entity"
	| "unknown_planned_key"
	| "duplicate_binding"
	| "missing_alias"
	| "unbound_required_reference"
	| "subject_cap_exceeded"
	| "reference_cap_exceeded"
	| "planned_product";

export interface StoryVisualDirectionViolation {
	invariant: StoryVisualDirectionInvariant;
	beatId: string;
	shotIndex?: number;
	detail: string;
}

export interface DirectedPlannedShotBeat {
	id: string;
	/** How many shots the draft planned for this beat. */
	plannedShotCount: number;
	shots?: readonly StoryPlannedShotDirection[];
}

export interface StoryVisualDirectionContext {
	roster: readonly StoryVisualDirectionRosterEntry[];
	/** Keys of the plan's final planned-reference set. */
	plannedKeys: readonly string[];
	plannedRoles?: Record<string, string>;
	/** Identities that direction returned an alias entry for. */
	aliasedIdentities: readonly string[];
	/** References the operator attached to a beat; direction must bind each one. */
	requiredByBeat?: Record<string, readonly StoryReferenceBinding[]>;
	subjectCap?: number;
	referenceCap?: number;
}

export function normalizedReferenceLabel(value: string): string {
	return value
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/* One deterministic winner when a roster carries duplicates.
 *
 * Only an EXACT normalized label plus role collapses. Nothing fuzzy: "Elder" and
 * "the old shaman" are the same character to a reader and not to this function,
 * and that is deliberate — the roster-first instruction and operator review handle
 * the rest, where a wrong automatic merge would be silent. */
export function collapsePlannedReferenceToRoster(
	planned: { role: string; label: string },
	roster: readonly StoryVisualDirectionRosterEntry[],
): string | undefined {
	const label = normalizedReferenceLabel(planned.label);
	const matches = roster.filter(
		(entry) => entry.role === planned.role && normalizedReferenceLabel(entry.label) === label,
	);
	if (!matches.length) return undefined;
	const best = [...matches].sort((a, b) => {
		if (!!a.primary !== !!b.primary) return a.primary ? -1 : 1;
		if ((a.updatedAt ?? 0) !== (b.updatedAt ?? 0)) return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	})[0];
	return best?.id;
}

/** Exact structural checks only — counts and set membership, no similarity score. */
export function storyVisualDirectionViolations(
	beats: readonly DirectedPlannedShotBeat[],
	context: StoryVisualDirectionContext,
): StoryVisualDirectionViolation[] {
	const violations: StoryVisualDirectionViolation[] = [];
	const rosterById = new Map(context.roster.map((entry) => [entry.id, entry]));
	const plannedKeys = new Set(context.plannedKeys);
	const aliased = new Set(context.aliasedIdentities);
	const subjectCap = context.subjectCap ?? DEFAULT_CAST_SUBJECT_CAP;
	const referenceCap = context.referenceCap ?? MAX_REFERENCE_IMAGES;
	for (const beat of beats) {
		const shots = beat.shots ?? [];
		const indexes = shots.map((shot) => shot.index);
		const expected = Array.from({ length: beat.plannedShotCount }, (_unused, index) => index);
		if (indexes.length !== expected.length || indexes.some((index, at) => index !== expected[at])) {
			violations.push({
				invariant: "shot_coverage",
				beatId: beat.id,
				detail: `${beat.id}: shot direction [${indexes.join(", ")}] does not cover planned shots 0..${beat.plannedShotCount - 1}`,
			});
		}
		const boundInBeat = new Set<string>();
		for (const shot of shots) {
			const seen = new Set<string>();
			let subjects = 0;
			for (const binding of shot.bindings) {
				const identity = bindingIdentity(binding);
				boundInBeat.add(identity);
				if (seen.has(identity)) {
					violations.push({
						invariant: "duplicate_binding",
						beatId: beat.id,
						shotIndex: shot.index,
						detail: `${beat.id}#${shot.index}: ${identity} is bound twice`,
					});
					continue;
				}
				seen.add(identity);
				let role: string | undefined;
				if (binding.entityId) {
					const entry = rosterById.get(binding.entityId);
					if (!entry)
						violations.push({
							invariant: "unknown_entity",
							beatId: beat.id,
							shotIndex: shot.index,
							detail: `${beat.id}#${shot.index}: ${binding.entityId} is not on the project roster`,
						});
					role = entry?.role;
				} else {
					const key = binding.plannedKey!;
					if (!plannedKeys.has(key))
						violations.push({
							invariant: "unknown_planned_key",
							beatId: beat.id,
							shotIndex: shot.index,
							detail: `${beat.id}#${shot.index}: ${key} is not a planned reference of this plan`,
						});
					role = context.plannedRoles?.[key];
					if (role === "product")
						violations.push({
							invariant: "planned_product",
							beatId: beat.id,
							shotIndex: shot.index,
							detail: `${beat.id}#${shot.index}: ${key} is a product; it needs an operator-supplied reference`,
						});
				}
				if (role && isSubjectRole(role)) subjects += 1;
				if (!aliased.has(identity))
					violations.push({
						invariant: "missing_alias",
						beatId: beat.id,
						shotIndex: shot.index,
						detail: `${beat.id}#${shot.index}: no alias entry for ${identity}`,
					});
			}
			/* The caps the resolver already applies. Checking them here is what keeps
			 * review honest: an over-cap shot would otherwise be approved showing five
			 * references and rendered with four. */
			if (subjects > subjectCap) {
				violations.push({
					invariant: "subject_cap_exceeded",
					beatId: beat.id,
					shotIndex: shot.index,
					detail: `${beat.id}#${shot.index}: ${subjects} subject references exceed the cap of ${subjectCap}`,
				});
			}
			if (seen.size > referenceCap) {
				violations.push({
					invariant: "reference_cap_exceeded",
					beatId: beat.id,
					shotIndex: shot.index,
					detail: `${beat.id}#${shot.index}: ${seen.size} references exceed the per-image cap of ${referenceCap}`,
				});
			}
		}
		for (const required of context.requiredByBeat?.[beat.id] ?? []) {
			const identity = bindingIdentity(required);
			if (!boundInBeat.has(identity)) {
				violations.push({
					invariant: "unbound_required_reference",
					beatId: beat.id,
					detail: `${beat.id}: operator-attached ${identity} is bound by no planned shot of this beat`,
				});
			}
		}
	}
	return violations;
}

export function storyVisualDirectionError(
	violations: readonly StoryVisualDirectionViolation[],
): string {
	return violations.map((violation) => `${violation.invariant}: ${violation.detail}`).join("; ");
}
