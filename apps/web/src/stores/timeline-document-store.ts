/* Canonical timeline document store (clip-first, schemaVersion 2).
 *
 * Holds ONE `EditorDoc` (`clips[] + markers[] + captions + projectReferences`) as the
 * in-memory source of truth for the video editor, replacing the 11 parallel `useState`
 * arrays in CreateContent. Consumers that read the per-type views get them from
 * `deriveArrays()`, a memoized clip-native projection (`fromTimelineDoc`) keyed on
 * document identity — so an unchanged document returns the SAME array references (no
 * re-render churn) and a changed document returns fresh ones.
 *
 * Session fields (chat, media library, settings, hook variants) are NOT part of
 * this document — they live as separate state (see design D6/D7). Track flags
 * were on that list and should not have been: they persist with the storyboard
 * and decide what a render contains, so they are document state.
 *
 * This module is a self-contained, framework-agnostic store plus a `useSyncExternalStore`
 * hook. It is wired into CreateContent in a later step; here it is unit-tested in
 * isolation so the source-of-truth flip is gated on proven store + selector behavior.
 */
import { useCallback, useSyncExternalStore } from "react";
import {
	DEFAULT_CAPTIONS,
	EMPTY_PROJECT_MATERIALS,
	fromTimelineDoc,
	type CaptionConfig,
	type Chapter,
	type ProjectMaterials,
	type SceneMarker,
	type TrackFlags,
} from "@maleo/shared";
import type { EditorDoc, DocUpdater } from "@models/storyboard/editor-doc.ts";
// Re-exported so the store stays the import site its consumers already use.
export type { EditorDoc, DocUpdater };

/** The full editor document: the render timeline plus doc-level caption config. */

/** Defined in models, which is the layer both the store and the hit-testing math
 *  may import. Re-exported here for the store's existing consumers. */
import type { DerivedArrays } from "@models/timeline/derived-arrays.ts";
export type { DerivedArrays };

/** A reversible mutation of the document (see timeline-edit-commands). Kept minimal
 *  here so the store owns application; command objects layer on top later. */

export interface TimelineDocumentStore {
	/** Current document (stable reference between mutations). */
	getDoc: () => EditorDoc;
	/** Replace the document, immutably. No-op (no notify) when the next doc is identical. */
	setDoc: (next: EditorDoc | DocUpdater) => void;
	/** Memoized legacy-array projection of the current document. Stable while the
	 *  document is unchanged; recomputed once per new document. */
	deriveArrays: () => DerivedArrays;
	/** Current scene markers (first-class doc state). */
	getMarkers: () => SceneMarker[];
	/** Subscribe to document changes. Returns an unsubscribe fn. */
	subscribe: (listener: () => void) => () => void;
}

function emptyDoc(): EditorDoc {
	return { schemaVersion: 2, clips: [], markers: [] };
}

/** Create an isolated document store seeded with `initial` (default empty). */
export function createTimelineDocumentStore(initial?: EditorDoc): TimelineDocumentStore {
	let doc: EditorDoc = initial ?? emptyDoc();
	const listeners = new Set<() => void>();
	// Cache keyed on document identity: recompute the array projection only when the
	// document reference changes, so subscribers get stable arrays between mutations.
	let cacheKey: EditorDoc | null = null;
	let cacheVal: DerivedArrays | null = null;

	const getDoc = (): EditorDoc => doc;
	const getMarkers = (): SceneMarker[] => doc.markers;

	const deriveArrays = (): DerivedArrays => {
		if (cacheKey === doc && cacheVal) return cacheVal;
		cacheVal = fromTimelineDoc(doc);
		cacheKey = doc;
		return cacheVal;
	};

	const setDoc = (next: EditorDoc | DocUpdater): void => {
		// SAFETY: an `EditorDoc` is a plain object, so a function is the updater form.
		const resolved = typeof next === "function" ? (next as DocUpdater)(doc) : next;
		if (resolved === doc) return; // identical reference → no change, no notify
		doc = resolved;
		for (const l of listeners) l();
	};

	const subscribe = (listener: () => void): (() => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};

	return { getDoc, setDoc, deriveArrays, getMarkers, subscribe };
}

/** The editor's per-type views, projected from the canonical clip document by the
 *  store (memoized on doc identity). Module-scoped so the `useDocumentSelector`
 *  identity is stable across renders — shared by every editor read consumer. */
export const selectDerivedArrays = (store: TimelineDocumentStore): DerivedArrays =>
	store.deriveArrays();

/** The document's caption config, defaulted. Module-scoped for the same reason
 *  as the projection above: a stable selector identity across renders. */
export const selectDocCaptions = (store: TimelineDocumentStore): CaptionConfig =>
	store.getDoc().captions ?? DEFAULT_CAPTIONS;

/** The document's track flags, defaulted. `EMPTY_TRACK_FLAGS` rather than a fresh
 *  `{}`: a selector that allocates returns a new reference on every read, which
 *  `useSyncExternalStore` treats as a change and loops. */
const EMPTY_TRACK_FLAGS: TrackFlags = {};
export const selectDocTrackFlags = (store: TimelineDocumentStore): TrackFlags =>
	store.getDoc().trackFlags ?? EMPTY_TRACK_FLAGS;

/** The document's chapters. `EMPTY_CHAPTERS` rather than a fresh `[]` for the
 *  same reason as the track flags above: a selector that allocates returns a new
 *  reference every read, which `useSyncExternalStore` treats as a change and
 *  loops on. Null and empty both read as empty HERE — the distinction between
 *  them belongs to the document, and a reader only needs the list. */
const EMPTY_CHAPTERS: readonly Chapter[] = [];
export const selectDocChapters = (store: TimelineDocumentStore): readonly Chapter[] =>
	store.getDoc().chapters ?? EMPTY_CHAPTERS;

/** The project's materials, defaulted. Same stable-identity rule as above:
 *  `EMPTY_PROJECT_MATERIALS` is a module constant, not a fresh object per read. */
export const selectDocMaterials = (store: TimelineDocumentStore): ProjectMaterials =>
	store.getDoc().materials ?? EMPTY_PROJECT_MATERIALS;

/** Subscribe a component to a slice of the store. `selector` reads from the store on
 *  each change; return a stable value (e.g. `deriveArrays()`) to avoid render churn. */
export function useDocumentSelector<T>(
	store: TimelineDocumentStore,
	selector: (s: TimelineDocumentStore) => T,
): T {
	const getSnapshot = useCallback(() => selector(store), [store, selector]);
	return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
