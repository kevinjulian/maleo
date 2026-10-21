/* Reference roster — the single resolver for "which reference entities does this
 * scene generate with".
 *
 * The rule used to be written out six times: five in the web editor and once on
 * the agent path, where it omitted the scene's opt-out entirely, so a scene that
 * turned project references OFF got them back at generation. Every surface that
 * displays, counts, or generates references resolves through here, so a card's
 * reference count and the render describe the same set.
 *
 * Resolution is one ordered pass:
 *   1. effective ids  — scene-declared references only
 *   2. roster misses  — declared ids the project has not attached, REPORTED here
 *                       because the later steps destroy the evidence
 *   3. defaulting     — roster 0 attaches nothing, roster 1 auto-casts, roster ≥2
 *                       uses the declared cast with the lead subject backfilling
 *   4. subject cap    — subjects past the cap are dropped primary-last and REPORTED
 *   5. reference map  — index-keyed, aligned with the resolved order by construction
 *
 * Pure and url-agnostic: SSRF validation belongs to the package where reference
 * urls enter (apps/api), not behind a seam the browser also calls. */
import { capCastSubjects, selectCast, type CastCandidate } from "./generation-cast.ts";
import { fieldOf, textOf } from "./object-keys.ts";
import type { ProjectSelection } from "./project-selection.ts";
import {
	resolveSelectionHints,
	type SelectionHintMatch,
	type VisualMaterialReference,
} from "./project-materials.ts";

/** The scene fields the rule reads. Satisfied by the editor's `Scene`, the agent's
 *  `AgentScene`, and a carousel slide. */
export interface RosterScene {
	/** Entities this scene explicitly assigns. */
	refIds?: readonly string[];
	/** Legacy flag retained for historical docs. Scene refs are explicit either way. */
	useGlobalReferences?: boolean;
}

/** The minimum a roster entry must carry. Role, lead-subject, and description live
 *  in different fields across callers (`CastEntity.role` vs the editor's tags), so
 *  they are reached through accessors rather than required on the shape. */
export interface RosterEntity {
	id: string;
}

export interface RosterAccessors<E extends RosterEntity> {
	/** The entity's role on the cast axis. Defaults to a `role` property. */
	roleOf?: (entity: E) => string;
	/** Whether the entity is the project's lead subject. Defaults to `primary`. */
	primaryOf?: (entity: E) => boolean;
}

export interface RosterInput<E extends RosterEntity> {
	/** The project's roster — the entities it has attached. Drives defaulting, so
	 *  it must NOT be the whole workspace library. */
	roster: readonly E[];
	/** Legacy project-level generation lock. Kept for API compatibility; explicit
	 *  scene refs now decide what gets attached. */
	selection: ProjectSelection;
	scene: RosterScene;
	/** Visual Material reference settings. Used only to fill missing scene ids from
	 *  `selectionHint`; explicit scene ids still win. */
	referenceSettings?: readonly VisualMaterialReference[];
	/** Text the hint matcher may inspect when scene ids are absent. */
	sceneText?: string;
	subjectCap?: number;
	accessors?: RosterAccessors<E>;
}

export interface ResolvedRoster<E extends RosterEntity> {
	/** Ids of the resolved entities, in provider order. */
	ids: string[];
	/** The resolved entities themselves, in the same order. */
	refs: E[];
	/** Entities the subject cap dropped. Surfaces mark these rather than counting
	 *  them as attached — otherwise a card describes a different set than renders. */
	dropped: E[];
	/** Ids that were declared but are not on the roster, so no entity exists to
	 *  return. Reported separately from `dropped`, which holds entities that DID
	 *  resolve and were then lost to the cap.
	 *
	 *  These two are different failures and a caller has to be able to tell them
	 *  apart: a cap drop means "attached, too many"; a miss means "asked for
	 *  something this project does not have". A miss could never reach `dropped`,
	 *  because `dropped` is derived from entities found in the roster — which is
	 *  exactly why an unattached id used to vanish in silence. */
	missing: string[];
	/** Hint matches that need operator assignment before provider calls. */
	ambiguous: SelectionHintMatch[];
}

/** The effective references for a scene: the scene's own assigned refs,
 *  deduplicated in declared order.
 *
 *  This is the rule. It has exactly one implementation on purpose. */
export function effectiveRefIds(_selection: ProjectSelection, scene: RosterScene): string[] {
	return Array.from(new Set(scene.refIds ?? []));
}

function readRole<E extends RosterEntity>(entity: E, accessors?: RosterAccessors<E>): string {
	if (accessors?.roleOf) return accessors.roleOf(entity);
	return textOf(fieldOf(entity, "role"));
}

function readPrimary<E extends RosterEntity>(entity: E, accessors?: RosterAccessors<E>): boolean {
	if (accessors?.primaryOf) return accessors.primaryOf(entity);
	return fieldOf(entity, "primary") === true;
}

/** Resolve a scene's references against the project roster, in one ordered pass.
 *
 *  Generic over the roster entity so the editor resolves its own `RefImage` and
 *  the agent path its `CastEntity` through the same rules — the two used to
 *  disagree about the opt-out, the cap, and defaulting all at once. */
export function resolveSceneRoster<E extends RosterEntity>(
	input: RosterInput<E>,
): ResolvedRoster<E> {
	const { roster, selection, scene, referenceSettings, sceneText, subjectCap, accessors } = input;

	// Defaulting reads three things about an entity: its id, its role, and whether
	// it is the lead subject. It used to project onto CastEntity, which meant
	// inventing an empty `imageUrl` and `description` for a shape that never looks
	// at them -- fabricated fields that a later reader could take for data. Name the
	// three, and the entity itself is carried through by id so callers get their
	// own type back.
	const byId = new Map(roster.map((entity) => [entity.id, entity]));
	// No `role`: `selectCast` does not read one, and inventing it here meant
	// asserting an unchecked string into `Role` — the silent default `roleOf`
	// explicitly forbids, because the UI once defaulted unknown to "style" while
	// the backend defaulted it to "character". Same fabrication the comment above
	// describes removing for `imageUrl` and `description`; `role` outlived it.
	const castRoster: CastCandidate[] = roster.map((entity) => ({
		id: entity.id,
		primary: readPrimary(entity, accessors),
	}));

	const explicit = effectiveRefIds(selection, scene);
	const hintResolution =
		explicit.length === 0 && referenceSettings?.length && sceneText?.trim()
			? resolveSelectionHints(referenceSettings, sceneText)
			: { selectedIds: [], matches: [], ambiguous: [] };
	const declared = explicit.length > 0 ? explicit : hintResolution.selectedIds;
	/* Misses are measured against the roster BEFORE `selectCast`, not after, because
	 * `selectCast` loses the evidence three different ways: roster 0 returns nothing,
	 * roster 1 auto-casts its single entity without reading `declared` at all, and
	 * roster >= 2 silently filters on `byId.has`. Only the declared list still knows
	 * what was asked for. */
	const missing = declared.filter((id) => !byId.has(id));
	const cast = selectCast(declared, castRoster);

	const seen = new Set<string>();
	const ordered: E[] = [];
	for (const id of cast) {
		if (seen.has(id)) continue;
		const entity = byId.get(id);
		if (!entity) continue;
		seen.add(id);
		ordered.push(entity);
	}

	const capped = capCastSubjects(
		ordered.map((entity) => ({
			entity,
			role: readRole(entity, accessors),
			primary: readPrimary(entity, accessors),
		})),
		{ subjectCap },
	);
	const kept = new Set(capped.map((c) => c.entity.id));

	const refs = capped.map((c) => c.entity);
	const dropped = ordered.filter((entity) => !kept.has(entity.id));

	return {
		ids: refs.map((entity) => entity.id),
		refs,
		dropped,
		missing,
		ambiguous: hintResolution.ambiguous,
	};
}
