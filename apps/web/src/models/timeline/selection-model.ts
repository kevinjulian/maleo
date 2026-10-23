import type { ClipSource } from "@maleo/shared";
import { editorEngine } from "@maleo/shared/editor";

/* What the timeline editor has selected.
 *
 * This was eight `useState` calls and a ninth `Set`, with the "selecting one kind
 * clears the others" rule written out at each of four call sites. Two of those
 * sites disagreed — see `toggleClip` — and nothing could have caught it, because
 * the rule existed only inside click handlers in a 2,300-line component.
 *
 * The model is pure: it decides what is selected, and the component keeps the
 * side effects (seeking the playhead, opening a drawer) that a selection causes.
 *
 * The transitions are the shared core's (`crates/app-core`, OpenSpec
 * `p1-app-core`): each one is an action the engine applies. The reads below
 * them (primary key, membership, equality) stay here, because a clip asks them
 * on every render and they decide nothing. */

/** Clip families that can be selected on the timeline. `scene` and `effect` are
 *  toggle-only — a scene is selected through `selectScene`.
 *
 *  Owned by `@maleo/shared`, not redeclared here. It was written out in both
 *  places with the same six members in a different order, which is the shape
 *  `timeline-clips.ts` records as having already diverged once over `trans:`
 *  ids. Re-exported so this module stays the editor's import site. */
export type { ClipSource };

/** The families a single click can make primary. An effect is included: the
 *  timeline selects one the same way, through a handler that used to carry its
 *  own copy of the clear-the-others rule. */
export type PrimaryClipSource = Extract<
	ClipSource,
	"video" | "text" | "audio" | "infographic" | "effect"
>;

export interface Selection {
	/** The selected scene, if the selection is a scene. */
	sceneId?: number;
	/** The scene whose editor drawer is open. Cleared by every transition. */
	editorSceneId?: number;
	overlayId: number | null;
	infographicId: number | null;
	audioId: number | null;
	videoOverlayId: number | null;
	effectId: number | null;
	transitionId: number | null;
	/** Multi-select set, keyed `source:refId`. */
	freeIds: ReadonlySet<string>;
}

export const EMPTY_SELECTION: Selection = {
	sceneId: undefined,
	editorSceneId: undefined,
	overlayId: null,
	infographicId: null,
	audioId: null,
	videoOverlayId: null,
	effectId: null,
	transitionId: null,
	freeIds: new Set(),
};

/** `source:refId`, the key the multi-select set and the DOM both use. */
export function clipKey(source: ClipSource, refId: number): string {
	return `${source}:${refId}`;
}

type SelectionAction =
	| { type: "selectScene"; sceneId: number }
	| { type: "selectClip"; source: PrimaryClipSource; refId: number }
	| { type: "toggleClip"; source: ClipSource; refId: number }
	| { type: "selectTransition"; transitionId: number }
	| { type: "clear" }
	| { type: "openSceneEditor"; sceneId: number };

/** Apply one action in the shared core. Every transition returns a new selection. */
function applyAction(current: Selection, action: SelectionAction): Selection {
	const result = editorEngine().selectionApply(
		JSON.stringify({ selection: { ...current, freeIds: [...current.freeIds] }, action }),
	);
	if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
	// SAFETY: the selection shape `selection::Selection::to_value` writes, with `freeIds` as an array.
	const next = JSON.parse(result.value) as Omit<Selection, "freeIds"> & { freeIds: string[] };
	return { sceneId: undefined, editorSceneId: undefined, ...next, freeIds: new Set(next.freeIds) };
}

/** Select a scene. Clears every clip selection and closes the drawer. */
export function selectScene(sceneId: number): Selection {
	return applyAction(EMPTY_SELECTION, { type: "selectScene", sceneId });
}

/** Select one clip as primary, replacing whatever was selected. */
export function selectClip(source: PrimaryClipSource, refId: number): Selection {
	return applyAction(EMPTY_SELECTION, { type: "selectClip", source, refId });
}

/** Shift-click: add or remove a clip in the multi-select set, and make it primary.
 *
 *  Note the asymmetry with `selectClip`, preserved deliberately: this path does
 *  NOT clear `infographicId`, so shift-clicking a video clip while an infographic
 *  is primary leaves the infographic primary too. It reads as an oversight rather
 *  than a decision — the other three families are cleared — but changing it
 *  changes what the inspector shows after a shift-click, so it is recorded here
 *  and left alone rather than quietly altered during a refactor. */
export function toggleClip(current: Selection, source: ClipSource, refId: number): Selection {
	return applyAction(current, { type: "toggleClip", source, refId });
}

/** Select a transition between two clips. */
export function selectTransition(transitionId: number): Selection {
	return applyAction(EMPTY_SELECTION, { type: "selectTransition", transitionId });
}

/** Click on empty space, or Escape. */
export function clearSelection(): Selection {
	return applyAction(EMPTY_SELECTION, { type: "clear" });
}

/** Open a scene's editor drawer. The scene becomes the selection. */
export function openSceneEditor(sceneId: number): Selection {
	return applyAction(EMPTY_SELECTION, { type: "openSceneEditor", sceneId });
}

/** The primary clip key, or null when the selection is a scene, a transition or
 *  nothing. Drives which clip the inspector describes. */
export function primaryClipKey(selection: Selection): string | null {
	if (selection.videoOverlayId != null) return clipKey("video", selection.videoOverlayId);
	if (selection.overlayId != null) return clipKey("text", selection.overlayId);
	if (selection.audioId != null) return clipKey("audio", selection.audioId);
	if (selection.infographicId != null) return clipKey("infographic", selection.infographicId);
	if (selection.effectId != null) return clipKey("effect", selection.effectId);
	return null;
}

/** A clip is selected when it is primary or part of the multi-select set. */
export function isClipSelected(selection: Selection, key: string): boolean {
	return selection.freeIds.has(key) || primaryClipKey(selection) === key;
}

/** Whether two selections say the same thing.
 *
 *  Every constructor above returns a fresh object, so selecting the clip that is
 *  already selected produced a new identity, a state change, and a commit that
 *  carried no information — the "no clip re-renders" case in the render budget.
 *  Asked here rather than at the call sites because the shape is this module's,
 *  and a comparison written next to a click handler is one that goes stale the
 *  next time a field is added. */
export function selectionsEqual(a: Selection, b: Selection): boolean {
	if (a === b) return true;
	if (a.sceneId !== b.sceneId || a.editorSceneId !== b.editorSceneId) return false;
	if (a.overlayId !== b.overlayId || a.infographicId !== b.infographicId) return false;
	if (a.audioId !== b.audioId || a.videoOverlayId !== b.videoOverlayId) return false;
	if (a.effectId !== b.effectId || a.transitionId !== b.transitionId) return false;
	if (a.freeIds.size !== b.freeIds.size) return false;
	for (const id of a.freeIds) if (!b.freeIds.has(id)) return false;
	return true;
}

/** True when nothing is selected — the inspector's empty state. */
export function isEmptySelection(selection: Selection): boolean {
	return (
		selection.sceneId === undefined &&
		selection.transitionId === null &&
		primaryClipKey(selection) === null &&
		selection.freeIds.size === 0
	);
}
