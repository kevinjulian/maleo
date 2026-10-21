import { renderPrompt, type RenderedPrompt } from "../prompts/registry.ts";
import {
	collapsePlannedReferenceToRoster,
	storySequenceDirectionSchema,
	storySequenceDirectionViolations,
	storySequenceDirectionError,
	storyVisualDirectionViolations,
	storyVisualDirectionError,
	type StoryPlannedReference,
	type StoryReferenceAlias,
	type StorySequenceDirection,
	type StoryVisualDirectionRosterEntry,
} from "@maleo/shared";
import type { StoryPlanSection } from "../content-generator.ts";
import { runPrompt } from "../text-runner.ts";
import { parseJson } from "./authoring-utils.ts";

type StorySequenceDirector = (
	sections: readonly StoryPlanSection[],
	options: StoryDirectionOptions,
) => Promise<unknown>;
let storySequenceDirectorOverride: StorySequenceDirector | null = null;
export function setStorySequenceDirectorForTests(fn: StorySequenceDirector | null): void {
	storySequenceDirectorOverride = fn;
}

export function hasStorySequenceDirectorOverride(): boolean {
	return storySequenceDirectorOverride !== null;
}

export interface StoryDirectionOptions {
	allowInfographics?: boolean;
	/** Require per-shot direction and final reference output for a canonical plan. */
	authoritativeReferences?: boolean;
	roster?: readonly StoryVisualDirectionRosterEntry[];
	plannedReferences?: readonly StoryPlannedReference[];
	visual?: string;
	rules?: string;
	templateConstraints?: Readonly<Record<string, string | number | boolean>>;
}

export function storySequenceDirectionRequest(
	sections: readonly StoryPlanSection[],
	options: StoryDirectionOptions,
	correction?: string,
): RenderedPrompt {
	return renderPrompt("prompt:sequence:storySequenceDirectionPrompt", {
		sections,
		options,
		correction,
	});
}

export function storySequenceDirectionPrompt(
	sections: readonly StoryPlanSection[],
	options: StoryDirectionOptions,
	correction?: string,
): string {
	return storySequenceDirectionRequest(sections, options, correction).text;
}

interface DirectedStorySections {
	sections: StoryPlanSection[];
	plannedReferences?: StoryPlannedReference[];
	referenceAliases?: StoryReferenceAlias[];
	needsDirection?: boolean;
	/** Only the operator can clear this one; a correction retry cannot. */
	directionBlocked?: boolean;
	directionErrors?: string[];
}

function collapseDirectionReferences(
	direction: StorySequenceDirection,
	roster: readonly StoryVisualDirectionRosterEntry[],
): StorySequenceDirection {
	const replacements = new Map<string, string>();
	for (const planned of direction.plannedReferences ?? []) {
		const entityId = collapsePlannedReferenceToRoster(planned, roster);
		if (entityId) replacements.set(planned.key, entityId);
	}
	if (!replacements.size) return direction;
	const beats = direction.beats.map((beat) => ({
		...beat,
		editorial: {
			...beat.editorial,
			shots: beat.editorial.shots?.map((shot) => ({
				...shot,
				bindings: shot.bindings.map((binding) => {
					const entityId = binding.plannedKey ? replacements.get(binding.plannedKey) : undefined;
					return entityId ? { entityId } : binding;
				}),
			})),
		},
	}));
	const aliases = new Map<string, Set<string>>();
	for (const alias of direction.referenceAliases ?? []) {
		const key = alias.ref.startsWith("planned:") ? alias.ref.slice("planned:".length) : "";
		const ref = key && replacements.has(key) ? `entity:${replacements.get(key)!}` : alias.ref;
		const values = aliases.get(ref) ?? new Set<string>();
		for (const value of alias.aliases) values.add(value);
		aliases.set(ref, values);
	}
	return {
		...direction,
		beats,
		plannedReferences: direction.plannedReferences?.filter(
			(planned) => !replacements.has(planned.key),
		),
		referenceAliases: [...aliases].map(([ref, values]) => ({ ref, aliases: [...values] })),
	};
}

/** Whole-draft pass. Failed direction remains visible but cannot be approved. */
export async function directStorySequence(
	sections: readonly StoryPlanSection[],
	options: StoryDirectionOptions = {},
): Promise<DirectedStorySections> {
	/* Two different faults blocked direction here, and reporting them as one sent
	 * operators looking for a missing id that was never missing. Name the sections
	 * and say which fault each one has: an undrafted section is fixed by re-running
	 * planning or writing it by hand, a missing beat id is not. */
	const unidentified = sections.filter((section) => !section.semanticBeatId);
	const undrafted = sections.filter((section) => section.needsDrafting);
	if (unidentified.length || undrafted.length) {
		const label = (section: StoryPlanSection, index: number): string =>
			section.title?.trim() || `section ${index + 1}`;
		const errors: string[] = [];
		if (undrafted.length) {
			errors.push(
				`${undrafted.length} section(s) were never drafted and are still empty: ${undrafted.map((section) => label(section, sections.indexOf(section))).join(", ")}. Re-run planning, or write them by hand, then approve again.`,
			);
		}
		if (unidentified.length) {
			errors.push(
				`${unidentified.length} section(s) have no stable beat id: ${unidentified.map((section) => label(section, sections.indexOf(section))).join(", ")}.`,
			);
		}
		return {
			sections: [...sections],
			plannedReferences: options.authoritativeReferences ? [] : undefined,
			referenceAliases: options.authoritativeReferences ? [] : undefined,
			needsDirection: true,
			directionErrors: errors,
		};
	}
	let failure = "sequence direction failed";
	for (let tries = 0; tries < 2; tries++) {
		try {
			const correction = tries > 0 ? failure : undefined;
			const raw = storySequenceDirectorOverride
				? await storySequenceDirectorOverride(sections, options)
				: parseJson(
						(
							await runPrompt(storySequenceDirectionRequest(sections, options, correction), {
								timeoutMs: 300_000,
							})
						).stdout,
					);
			let direction: StorySequenceDirection = storySequenceDirectionSchema.parse(raw);
			if (options.authoritativeReferences) {
				if (!direction.plannedReferences || !direction.referenceAliases)
					throw new Error("direction must return plannedReferences and referenceAliases");
				direction = collapseDirectionReferences(direction, options.roster ?? []);
			}
			const expected = sections.map((section) => section.semanticBeatId!);
			if (
				direction.beats.length !== expected.length ||
				direction.beats.some((beat, index) => beat.beatId !== expected[index])
			) {
				throw new Error(`expected beat ids in order: ${expected.join(", ")}`);
			}
			const byId = new Map(direction.beats.map((beat) => [beat.beatId, beat.editorial]));
			const directed = sections.map((section) => {
				let editorial = byId.get(section.semanticBeatId!);
				if (options.allowInfographics === false && editorial?.presentation === "infographic") {
					const { motionGraphic: _motionGraphic, ...rest } = editorial;
					editorial = { ...rest, presentation: "explainer" };
				}
				return { ...section, editorial, motionGraphic: editorial?.motionGraphic };
			});
			const violations = storySequenceDirectionViolations(
				directed.map((section) => ({ id: section.semanticBeatId!, editorial: section.editorial })),
				{ requireDirection: true },
			);
			if (violations.length) throw new Error(storySequenceDirectionError(violations));
			if (options.authoritativeReferences) {
				const planned = direction.plannedReferences ?? [];
				const visualViolations = storyVisualDirectionViolations(
					directed.map((section) => ({
						id: section.semanticBeatId!,
						plannedShotCount: section.shots?.length ?? 1,
						shots: section.editorial?.shots,
					})),
					{
						roster: options.roster ?? [],
						plannedKeys: planned.map((reference) => reference.key),
						plannedRoles: Object.fromEntries(
							planned.map((reference) => [reference.key, reference.role]),
						),
						aliasedIdentities: (direction.referenceAliases ?? []).map((alias) => alias.ref),
						requiredByBeat: Object.fromEntries(
							sections.map((section) => [
								section.semanticBeatId!,
								section.requiredReferences ?? [],
							]),
						),
					},
				);
				if (visualViolations.length) {
					const message = storyVisualDirectionError(visualViolations);
					if (visualViolations.some((violation) => violation.invariant === "planned_product")) {
						return {
							sections: [...sections],
							plannedReferences: direction.plannedReferences ?? [],
							referenceAliases: direction.referenceAliases ?? [],
							needsDirection: true,
							directionBlocked: true,
							directionErrors: [message],
						};
					}
					throw new Error(message);
				}
			}
			return {
				sections: directed,
				plannedReferences: direction.plannedReferences,
				referenceAliases: direction.referenceAliases,
			};
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}
	}
	return {
		sections: [...sections],
		plannedReferences: options.authoritativeReferences ? [] : undefined,
		referenceAliases: options.authoritativeReferences ? [] : undefined,
		needsDirection: true,
		directionErrors: [failure],
	};
}
