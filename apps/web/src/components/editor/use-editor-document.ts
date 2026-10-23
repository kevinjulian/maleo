/* The editor's document: the canonical timeline store, the image and text
 * arrays beside it, the command stack every edit runs through, and the writers
 * that put an edit back into the document.
 *
 * Split out of `create-content.tsx`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { type Post, type Slide } from "@models/content/content-types.ts";
import { EMPTY_PROJECT_SELECTION } from "@maleo/shared";
import { createDocumentWriters, type DocumentWriters } from "@stores/document-writers.ts";
import {
	createTimelineDocumentStore,
	selectDerivedArrays,
	selectDocCaptions,
	selectDocChapters,
	selectDocTrackFlags,
	type EditorDoc,
	type TimelineDocumentStore,
	useDocumentSelector,
} from "@stores/timeline-document-store.ts";
import type { ReferenceLibraryState } from "@hooks/editor/use-reference-library.ts";
import { useCommandStack, type CommandStack } from "@hooks/editor/use-command-stack.ts";
import type { CommandExecutor, EditorCommand, EditScope } from "@maleo/shared/editor";
import { resolveEdit } from "@models/timeline/command-edit.ts";
import { diffScopeToCommand } from "@maleo/shared/editor";
import { createSyncBridge, type SyncBridge } from "@models/editor/sync-bridge.ts";

type Derived = ReturnType<typeof selectDerivedArrays>;

export interface EditorDocument {
	store: TimelineDocumentStore;
	slides: Slide[];
	setSlides: Dispatch<SetStateAction<Slide[]>>;
	posts: Post[];
	setPosts: Dispatch<SetStateAction<Post[]>>;
	captions: ReturnType<typeof selectDocCaptions>;
	chapters: ReturnType<typeof selectDocChapters>;
	scenes: Derived["scenes"];
	overlays: Derived["textOverlays"];
	audioOverlays: Derived["audioOverlays"];
	videoOverlays: Derived["videoOverlays"];
	infographicOverlays: Derived["infographicOverlays"];
	effects: Derived["effects"];
	transitions: Derived["transitions"];
	projectReferences: NonNullable<Derived["projectReferences"]>;
	runCommand: CommandStack["run"];
	isLatest: CommandStack["isLatest"];
	doUndo: CommandStack["doUndo"];
	undoStack: {
		undo: CommandStack["doUndo"];
		redo: CommandStack["doRedo"];
		canUndo: boolean;
		canRedo: boolean;
	};
	writers: DocumentWriters;
	trackFlags: ReturnType<typeof selectDocTrackFlags>;
	/** What the command log needs from the document (`use-command-log.ts`). */
	log: {
		bridge: SyncBridge;
		ledgerHandle: number;
		/** Write a resolved scope back onto the editor. */
		commit: (scope: EditScope) => void;
		/** Called whenever something is enqueued; the log hook schedules the flush. */
		onEnqueued: { current: () => void };
	};
}

const selectDoc = (store: TimelineDocumentStore): EditorDoc => store.getDoc();

export function useEditorDocument(input: {
	executor: CommandExecutor;
	library: ReferenceLibraryState;
	/** The live slide and post lists, read when a command is applied rather than
	 *  when the writers were made (see use-live-mirrors.ts). */
	liveLists: () => { slides: Slide[]; posts: Post[] };
}): EditorDocument {
	const { executor, library, liveLists } = input;
	// image (slides) / text (posts) stay array-backed — out of scope for the clips[] doc.
	const [slides, setSlides] = useState<Slide[]>([]);
	const [posts, setPosts] = useState<Post[]>([]);

	// ── Canonical timeline document store (D1: source of truth for the video editor) ──
	// The 7 legacy timeline arrays + `captions` + `projectReferences` are no longer
	// independent state — they derive from ONE `EditorDoc`. Panels keep reading the same
	// named arrays via memoized selectors (stable refs between edits); every `setX` shim
	// writes the change back through the document, so the arrays can never drift from it.
	const storeRef = useRef<TimelineDocumentStore | null>(null);
	if (!storeRef.current) storeRef.current = createTimelineDocumentStore();
	const store = storeRef.current;
	// Read the editor's per-type views from the canonical document via the store
	// selector (clip-native source of truth) — no standalone derived-array hook.
	const derived = useDocumentSelector(store, selectDerivedArrays);
	const captions = useDocumentSelector(store, selectDocCaptions);
	/* Subscribed, not read off `getDoc()` in render. A direct read does not
	 * re-render when the document changes, so a chapter edit would update nothing
	 * and — because the autosave watches this value — would never be saved. */
	const chapters = useDocumentSelector(store, selectDocChapters);

	// One undo scope includes media identity alongside document/slides/posts.
	// `writers` is memoised on the store, so it calls the commit through a ref that
	// always holds the current closure (slides/posts change every edit).
	const commitDocRef = useRef<(next: EditorDoc) => void>(() => {
		/* set below */
	});
	const runCommandRef = useRef<(cmd: EditorCommand, before?: EditScope) => string | null>(
		() => null /* set below */,
	);
	const gestureRef = useRef<{ begin: () => void; end: () => void }>({
		begin: () => {
			/* set below */
		},
		end: () => {
			/* set below */
		},
	});
	const isCommandResultRef = useRef<(doc: unknown) => boolean>(() => false);
	/* Every write the stack applies, and every write that goes around it, reaches
	 * the command log through one bridge (`sync-bridge.ts`). */
	const onEnqueuedRef = useRef<() => void>(() => {
		/* set by use-command-log */
	});
	const bridgeRef = useRef<SyncBridge | null>(null);
	if (!bridgeRef.current)
		bridgeRef.current = createSyncBridge({
			scope: () => ({ doc: store.getDoc(), ...liveLists(), mediaAssets: library.getMediaAssets() }),
			enqueued: () => onEnqueuedRef.current(),
		});
	const bridge = bridgeRef.current;
	const commitScope = (s: EditScope): void => {
		store.setDoc(s.doc);
		setSlides(s.slides);
		setPosts(s.posts);
		library.setMediaAssets(s.mediaAssets);
	};
	const editScope: EditScope = {
		doc: store.getDoc(),
		slides,
		posts,
		mediaAssets: library.getMediaAssets(),
	};
	const {
		run: runCommand,
		beginGesture,
		endGesture,
		isCommandResult,
		isLatest,
		doUndo,
		doRedo,
		canUndo,
		canRedo,
		ledgerHandle,
	} = useCommandStack({
		executor,
		scope: editScope,
		deps: [slides, posts],
		commit: commitScope,
		listener: bridge,
	});
	const commitScopeRef = useRef(commitScope);
	commitScopeRef.current = commitScope;
	// Stable, so the command log is opened once per loaded project.
	const log = useMemo(
		() => ({
			bridge,
			ledgerHandle,
			commit: (next: EditScope) => commitScopeRef.current(next),
			onEnqueued: onEnqueuedRef,
		}),
		[bridge, ledgerHandle],
	);
	// A write that went around the stack is enqueued once writes settle.
	const liveDoc = useDocumentSelector(store, selectDoc);
	useEffect(() => {
		const timer = setTimeout(() => bridge.catchUp(), 400);
		return () => clearTimeout(timer);
	}, [bridge, liveDoc, slides, posts]);
	// One value so the editor takes an undo stack rather than four loose props,
	// memoised so it keeps its identity across parent renders.
	const undoStack = useMemo(
		() => ({ undo: doUndo, redo: doRedo, canUndo, canRedo }),
		[doUndo, doRedo, canUndo, canRedo],
	);

	// Commit a new document as a TYPED command: the diff picks the narrowest command
	// (clip.move / clip.update / marker.upsert / …) that reproduces it, falling back to a
	// coarse scope-replace when an edit spans several entities. Final state is always
	// identical to the array mutation, so panels stay unchanged (D1) while undo is precise.
	const commitDoc = (nextDoc: EditorDoc): void => {
		const before: EditScope = {
			doc: store.getDoc(),
			slides,
			posts,
			mediaAssets: library.getMediaAssets(),
		};
		const command = diffScopeToCommand(before, { ...before, doc: nextDoc });
		if (command.type === "noop") return; // no structural change → no undo step
		// Record against the SAME `before` we diffed off the live store — not the
		// render-mirrored scope, which lags during a burst of streaming agent commits
		// and would make the eager inverse target a clip absent from stale state.
		runCommand(command, before);
	};
	/* The document's single write interface. The per-type setter shims, the
	 * projection rebuild and the raw `doc -> doc` seam live in one module, so the
	 * timeline editor writes through the same object rather than redefining them. */
	commitDocRef.current = commitDoc;
	runCommandRef.current = runCommand;
	gestureRef.current = { begin: beginGesture, end: endGesture };
	isCommandResultRef.current = isCommandResult;
	const writers = useMemo(
		// Stable indirection: the writers are memoised on the store, but the commit
		// closes over slides/posts, which change on every edit.
		() =>
			createDocumentWriters({
				store,
				commit: (next) => commitDocRef.current(next),
				// A caller that knows its edit commits the command straight to the ledger.
				// `before` is the live store rather than the render-mirrored scope, for the
				// same reason `commitDoc` passes it: the mirror lags a render during a burst
				// of synchronous commits, and the command has to invert against the state it
				// was computed from.
				applyCommand: (edit) => {
					const live = liveLists();
					const before: EditScope = {
						doc: store.getDoc(),
						slides: live.slides,
						posts: live.posts,
						mediaAssets: library.getMediaAssets(),
					};
					runCommandRef.current(resolveEdit(edit, before), before);
				},
				gesture: { begin: () => gestureRef.current.begin(), end: () => gestureRef.current.end() },
				// So normalising effects can tell an undo from a user edit.
				isCommandResult: (doc) => isCommandResultRef.current(doc),
			}),
		[store],
	);
	// Per-track hide/mute/lock. Document state, not chrome: it persists with the
	// storyboard and decides what a render contains (see editor-doc.ts).
	const trackFlags = useDocumentSelector(store, selectDocTrackFlags);

	return {
		store,
		slides,
		setSlides,
		posts,
		setPosts,
		captions,
		chapters,
		scenes: derived.scenes,
		overlays: derived.textOverlays,
		audioOverlays: derived.audioOverlays,
		videoOverlays: derived.videoOverlays,
		infographicOverlays: derived.infographicOverlays,
		effects: derived.effects,
		transitions: derived.transitions,
		projectReferences: derived.projectReferences ?? EMPTY_PROJECT_SELECTION,
		runCommand,
		isLatest,
		doUndo,
		undoStack,
		writers,
		trackFlags,
		log,
	};
}
