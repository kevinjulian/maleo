/* Maleo — reference derivations for the timeline editor.
 *
 * The rule that decides which references a scene generates with lives in
 * `@maleo/shared` (`resolveSceneRoster`), so this hook is a memo over it plus
 * the per-scene prompt and character description. It used to carry its own copy
 * of the rule; four other surfaces carried theirs, and they disagreed about the
 * subject cap and about roster defaulting. */
import { useMemo } from "react";
import { resolveSceneRoster, type RosterScene } from "@maleo/shared";
import { roleOfRef } from "@models/references/reference-vocabulary.ts";
import type { ProjectSelection, RefImage, Scene } from "@maleo/shared";
import { rosterOf } from "@models/references/pool.ts";
import type { GlobalSettings } from "@models/presets/creative-settings.ts";

export interface SceneRefs {
	allImageRefs: RefImage[];
	refsById: Map<string, RefImage>;
	selectedRefIdsFor: (item: Scene) => string[];
	selectedRefsFor: (item: Scene) => RefImage[];
	refsFor: (item: Scene) => RefImage[];
	/** Subject references the cap drops at generation. Surfaced rather than
	 *  silently counted, so no panel describes a set the render will not use. */
	droppedRefsFor: (item: Scene) => RefImage[];
	/** Ids the scene declares that are NOT on the project's roster, so no entity
	 *  exists for them. A different failure from the cap: nothing was over a limit,
	 *  the project simply has not attached them. Carried as ids because there is no
	 *  entity to carry. */
	missingRefIdsFor: (item: Scene) => string[];
	globalStyleRef: RefImage | undefined;
	visualPromptFor: (item: Scene) => string;
	characterDesc: (item: Scene) => string | undefined;
}

/** How a pool entry exposes role, lead subject, and description: the editor keeps
 *  role in tags/kind and the lead subject in `default`. */
const POOL_ACCESSORS = {
	roleOf: (ref: RefImage): string => roleOfRef(ref) ?? "",
	primaryOf: (ref: RefImage): boolean => Boolean(ref.primary),
};

/** Everything a surface needs to describe a scene's references honestly: what
 *  renders, what the cap dropped, and what the project never attached. A surface
 *  that reads only `refs` describes a smaller set than the operator selected. */
export interface ResolvedSceneRefs {
	ids: string[];
	refs: RefImage[];
	dropped: RefImage[];
	missing: string[];
}

/** Resolve a scene's references against the project's roster — the one call the
 *  studio, the timeline panels, and the agent wire all make.
 *
 *  The parameter is `RosterScene`, the two fields the rule actually reads, not
 *  `Scene`. The rule is declared for "the editor's `Scene`, the agent's
 *  `AgentScene`, and a carousel slide"; narrowing it to `Scene` here made the
 *  studio assert `item as Scene` on a `Scene | Slide` to get past a restriction
 *  the rule never had. */
export function resolveSceneRefs(
	pool: RefImage[],
	selection: ProjectSelection,
	scene: RosterScene,
): ResolvedSceneRefs {
	const { ids, refs, dropped, missing } = resolveSceneRoster({
		roster: rosterOf(pool),
		selection,
		scene,
		accessors: POOL_ACCESSORS,
	});
	return { ids, refs, dropped, missing };
}

export function useSceneRefs(input: {
	pool: RefImage[];
	projectReferences: ProjectSelection;
	settings: GlobalSettings;
}): SceneRefs {
	const { pool, projectReferences, settings } = input;

	const refsById = useMemo(() => new Map(pool.map((r) => [r.id, r])), [pool]);

	const resolve = (item: Scene): ResolvedSceneRefs =>
		resolveSceneRefs(pool, projectReferences, item);

	// Global style lock (Settings) — sent separately as a "style" role ref so it's
	// matched for look only, never treated as an exact product/subject lock.
	const globalStyleRef = settings.globalStyleRefId
		? refsById.get(settings.globalStyleRefId)
		: undefined;
	const visualPromptFor = (item: Scene): string => {
		const prompt = item.vis || item.name || "product scene";
		const globalPrompt = projectReferences.prompt.trim();
		if (item.useGlobalReferences === false || !globalPrompt) return prompt;
		return `Project reference brief: ${globalPrompt}\n\nClip prompt: ${prompt}`;
	};
	const refsFor = (item: Scene): RefImage[] => resolve(item).refs;
	const characterDesc = (item: Scene): string | undefined =>
		refsFor(item)
			.filter((r) => roleOfRef(r) === "character")
			.map((r) => r.description)
			.filter(Boolean)
			.join("; ") || undefined;

	return {
		allImageRefs: pool,
		refsById,
		selectedRefIdsFor: (item) => resolve(item).ids,
		selectedRefsFor: refsFor,
		refsFor,
		droppedRefsFor: (item) => resolve(item).dropped,
		missingRefIdsFor: (item) => resolve(item).missing,
		globalStyleRef,
		visualPromptFor,
		characterDesc,
	};
}
