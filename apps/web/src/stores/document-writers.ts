/* The document's write interface — one place a timeline edit can enter the store.
 *
 * There used to be two entry points. `CreateContent` wrote through `updateArrays`
 * + `commitDoc`; the timeline editor wrote through its own `mutateDoc`; and each
 * defined the same eight `setX` shims and its own copy of `resolveNext`. The
 * shims are the panels' interface (they consume `SetStateAction` setters, and
 * that stays), but there is no reason for two modules to own them.
 *
 * `commit` is the seam: in the app it diffs the next document into a typed
 * command and pushes it on the undo ledger. Here it is just a function, which is
 * what makes this whole module testable without mounting the editor. */
import type { Dispatch, SetStateAction } from "react";
import {
	EMPTY_PROJECT_MATERIALS,
	EMPTY_PROJECT_SELECTION,
	rebuildDocWith,
	pruneBrokenTransitions,
	type ProjectMaterials,
	type ProjectSelection,
	DEFAULT_CAPTIONS,
} from "@maleo/shared";
import type {
	AudioOverlay,
	EffectClip,
	InfographicOverlay,
	Scene,
	TextOverlay,
	TransitionClip,
	VideoOverlay,
	CaptionConfig,
	TrackFlags,
} from "@maleo/shared";

/** Shared empty value, so a document with no flags yet does not get a fresh
 *  object per read — a new reference would look like a change to subscribers. */
const EMPTY_TRACK_FLAGS: TrackFlags = {};
import { applyCommand as applyEditorCommand, type EditScope } from "@maleo/shared/editor";
import { resolveEdit, type CommandEdit } from "@models/timeline/command-edit.ts";
import type { DerivedArrays, EditorDoc, TimelineDocumentStore } from "./timeline-document-store.ts";
import { resolveSetState } from "@models/core/set-state.ts";

export interface DocumentWriters {
	setScenes: Dispatch<SetStateAction<Scene[]>>;
	setOverlays: Dispatch<SetStateAction<TextOverlay[]>>;
	setAudioOverlays: Dispatch<SetStateAction<AudioOverlay[]>>;
	setVideoOverlays: Dispatch<SetStateAction<VideoOverlay[]>>;
	setInfographicOverlays: Dispatch<SetStateAction<InfographicOverlay[]>>;
	setEffects: Dispatch<SetStateAction<EffectClip[]>>;
	setTransitions: Dispatch<SetStateAction<TransitionClip[]>>;
	setProjectReferences: Dispatch<SetStateAction<ProjectSelection>>;
	setCaptions: Dispatch<SetStateAction<CaptionConfig>>;
	/** The project's generation context. On the document, so an edit versions with
	 *  the storyboard it generated from. */
	setMaterials: Dispatch<SetStateAction<ProjectMaterials>>;
	/** Per-track hide/mute/lock, on the document for the same reason captions are:
	 *  it persists with the storyboard and decides what a render contains. */
	setTrackFlags: Dispatch<SetStateAction<TrackFlags>>;
	/** Apply a pure `doc -> doc` edit. The raw seam the setters are built on. */
	mutate: (edit: (doc: EditorDoc) => EditorDoc) => void;
	/** Edit the per-type projection and rebuild the document from it. */
	updateArrays: (edit: (views: DerivedArrays) => DerivedArrays) => void;
	/** The same, for bookkeeping the operator did not perform.
	 *
	 *  Recording which asset a clip already plays is not an edit. Sent through
	 *  `commit` it would land on the undo ledger, and undo would un-record it —
	 *  turning a repair into a user-visible mutation they did not make and cannot
	 *  meaningfully reverse. This writes the document straight to the store.
	 *
	 *  Not a general-purpose escape hatch: anything an operator would expect undo
	 *  to reverse belongs in `updateArrays`. */
	reviseArrays: (edit: (views: DerivedArrays) => DerivedArrays) => void;
	/** Commit an edit the caller already knows the shape of.
	 *
	 *  The other writers hand a whole document to `commit`, which then compares it
	 *  against the previous one to work out what changed. A caller that already
	 *  knows — a drag knows a clip moved — says so here instead, and the structural
	 *  comparison never runs for that edit. */
	apply: (edit: CommandEdit) => void;
	/** Bracket a continuous interaction so every edit inside it is ONE undo step.
	 *
	 *  A drag emits a command per animation frame and its drop can emit one per
	 *  relocated clip. Recorded individually, one sustained drag fills and evicts
	 *  the whole undo stack, and undo then walks back through it a frame at a time.
	 *  Callers that know they are one user action say so. */
	beginGesture: () => void;
	endGesture: () => void;
	/** Whether the CURRENT document is the one undo or redo just produced.
	 *
	 *  An effect that normalises the document — row compaction, collision
	 *  resolution — writes because the document changed, so it cannot tell an
	 *  undo apart from a user edit and will write the undone state straight back.
	 *  Any effect that edits in response to an edit asks this first.
	 *
	 *  Identity, not timing: the document undo committed stays identical until the
	 *  next write, so there is no window to miss however late the effect runs. */
	isCommandResult: () => boolean;
}

const resolveNext = resolveSetState;

export function createDocumentWriters(input: {
	store: TimelineDocumentStore;
	/** Commit a new document. The app passes the command-ledger commit. */
	commit: (next: EditorDoc) => void;
	/** Commit a command the caller constructed. The app passes the ledger's `run`.
	 *
	 *  Optional so the module stays testable without a ledger: when it is absent,
	 *  a command is applied to the current document and committed the document way,
	 *  which is the same end state by a longer road. */
	applyCommand?: (edit: CommandEdit) => void;
	/** Bracket a gesture on the ledger. Absent in the test wiring, where there is
	 *  no ledger to coalesce against. */
	gesture?: { begin: () => void; end: () => void };
	/** Whether a given document is the one undo/redo just committed. Absent in the
	 *  test wiring, where nothing undoes. */
	isCommandResult?: (doc: EditorDoc) => boolean;
}): DocumentWriters {
	const { store, commit, applyCommand, gesture, isCommandResult } = input;
	let gestureDepth = 0;
	const beginGesture = (): void => {
		if (gestureDepth++ === 0) gesture?.begin();
	};
	const endGesture = (): void => {
		if (gestureDepth === 0 || --gestureDepth > 0) return;
		try {
			const doc = store.getDoc(),
				next = pruneBrokenTransitions(doc);
			if (next !== doc) commit(next);
		} finally {
			gesture?.end();
		}
	};
	const commitValid = (next: EditorDoc): void =>
		commit(gestureDepth ? next : pruneBrokenTransitions(next));

	const mutate = (edit: (doc: EditorDoc) => EditorDoc): void => commitValid(edit(store.getDoc()));

	const apply = (edit: CommandEdit): void => {
		if (applyCommand) {
			beginGesture();
			try {
				applyCommand(edit);
			} finally {
				endGesture();
			}
			return;
		}
		// No ledger wired (tests): apply the command and commit the result.
		const scope: EditScope = { doc: store.getDoc(), slides: [], posts: [], mediaAssets: [] };
		commitValid(applyEditorCommand(scope, resolveEdit(edit, scope)).doc);
	};

	// Project modified arrays back into the document (lossless bridge round-trip).
	// Marker ranges/clipIds re-derive from the current clips; authoritative marker
	// metadata (title/beat/vo) is carried across the rebuild.
	const rebuiltFrom = (edit: (views: DerivedArrays) => DerivedArrays): EditorDoc => {
		const doc = store.getDoc();
		const views = edit(store.deriveArrays());
		return rebuildDocWith(doc, {
			scenes: views.scenes,
			videoOverlays: views.videoOverlays,
			textOverlays: views.textOverlays,
			audioOverlays: views.audioOverlays,
			infographicOverlays: views.infographicOverlays,
			effects: views.effects,
			transitions: views.transitions,
			projectReferences: views.projectReferences,
		});
	};

	const updateArrays = (edit: (views: DerivedArrays) => DerivedArrays): void =>
		commitValid(rebuiltFrom(edit));
	const reviseArrays = (edit: (views: DerivedArrays) => DerivedArrays): void =>
		store.setDoc(rebuiltFrom(edit));

	/** Build one per-type setter: same `SetStateAction` signature the panels
	 *  already consume, folded into the canonical document. */
	const family =
		<K extends keyof DerivedArrays>(key: K): Dispatch<SetStateAction<DerivedArrays[K]>> =>
		(next) =>
			updateArrays((views) => ({ ...views, [key]: resolveNext(next, views[key]) }));

	return {
		setScenes: family("scenes"),
		setOverlays: family("textOverlays"),
		setAudioOverlays: family("audioOverlays"),
		setVideoOverlays: family("videoOverlays"),
		setInfographicOverlays: family("infographicOverlays"),
		setEffects: family("effects"),
		setTransitions: family("transitions"),
		setProjectReferences: (next) =>
			updateArrays((views) => ({
				...views,
				projectReferences: resolveNext(next, views.projectReferences ?? EMPTY_PROJECT_SELECTION),
			})),
		setCaptions: (next) =>
			mutate((doc) => ({ ...doc, captions: resolveNext(next, doc.captions ?? DEFAULT_CAPTIONS) })),
		setMaterials: (next) =>
			mutate((doc) => ({
				...doc,
				materials: resolveNext(next, doc.materials ?? EMPTY_PROJECT_MATERIALS),
			})),
		setTrackFlags: (next) =>
			mutate((doc) => ({
				...doc,
				trackFlags: resolveNext(next, doc.trackFlags ?? EMPTY_TRACK_FLAGS),
			})),
		mutate,
		updateArrays,
		reviseArrays,
		apply,
		beginGesture,
		endGesture,
		isCommandResult: () => isCommandResult?.(store.getDoc()) ?? false,
	};
}
