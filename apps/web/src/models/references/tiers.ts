/* Reference scope tiers — pure, so the nesting rule is testable without a panel.
 *
 * Three nested scopes, each selecting from the one above:
 *
 *   workspace  every entity in the workspace library
 *     project  the entities this project attached — its roster + generation lock
 *       scene  the entities this scene casts
 *
 * The UI used to present these as one flat union, so an operator could cast an
 * entity into a scene that the project had never selected. That reads as working
 * and generates nothing: `resolveEntityRefImages` builds its lookup from the
 * project roster and skips ids it cannot find there. */

export type ReferenceTier = "workspace" | "project" | "scene";

export interface TierInput {
	/** Entity ids the project has selected (its generation lock). */
	projectEntityIds: readonly string[];
	/** Entity ids the current scene casts, when a scene is in context. */
	sceneRefIds?: readonly string[];
}

/** The deepest scope an entity currently belongs to. */
export function tierOf(entityId: string, input: TierInput): ReferenceTier {
	if (input.sceneRefIds?.includes(entityId)) return "scene";
	if (input.projectEntityIds.includes(entityId)) return "project";
	return "workspace";
}

export const TIER_LABEL = {
	workspace: "In workspace library",
	project: "Selected by project",
	scene: "Cast in this scene",
} satisfies Record<ReferenceTier, string>;

/** Casting into a scene requires the project to have selected the entity first.
 *  A picker offers only what the project selected; everything else has to come
 *  through an explicit add-from-library step. */
export function isCastable(entityId: string, input: TierInput): boolean {
	return input.projectEntityIds.includes(entityId);
}

export interface UsageInput extends TierInput {
	/** Every scene's cast, for counting attachments across the project. */
	sceneCasts: ReadonlyArray<readonly string[]>;
}

/** How many places an entity is attached: the project selection counts once, and
 *  each scene that casts it counts once. This is what the "used by N" badge
 *  reports, and it spans both tiers rather than one of them. */
export function usageCount(entityId: string, input: UsageInput): number {
	const inProject = input.projectEntityIds.includes(entityId) ? 1 : 0;
	const inScenes = input.sceneCasts.filter((cast) => cast.includes(entityId)).length;
	return inProject + inScenes;
}

/** Usage for every attached id in one pass, for rendering a whole grid. */
export function usageMap(input: UsageInput): Map<string, number> {
	const usage = new Map<string, number>();
	const bump = (id: string): void => {
		usage.set(id, (usage.get(id) ?? 0) + 1);
	};
	for (const id of input.projectEntityIds) bump(id);
	for (const cast of input.sceneCasts) for (const id of cast) bump(id);
	return usage;
}

/** Removing a project selection strands every scene that casts it, so the UI has
 *  to say how many before it happens. */
export function scenesStrandedBy(
	entityId: string,
	sceneCasts: ReadonlyArray<readonly string[]>,
): number {
	return sceneCasts.filter((cast) => cast.includes(entityId)).length;
}
