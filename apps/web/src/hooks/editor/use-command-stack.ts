/* Command-stack undo/redo (D2) — replaces the debounced snapshot ring.
 *
 * Two ways an edit enters the stack:
 *  1. `run(cmd)` — the video document mutations (translated to typed clip/marker/doc
 *     commands by `diffScopeToCommand`, group 5) and the agent apply path push typed
 *     commands directly; the stack applies and records them.
 *  2. Direct manipulation of the array-backed `slides`/`posts` surfaces still mutates
 *     via plain setters, so a 400ms-debounced watcher coalesces those changes into ONE
 *     `replaceScope` command (a burst = one undo step). The watcher only tracks
 *     slides/posts now — document edits arrive as typed commands via path 1.
 *
 * Undo inverts the most recent command; redo re-applies it; a new edit clears redo.
 * Command-driven changes are flagged so the direct-manipulation watcher does not
 * double-record them. Keybinding guards (input/textarea/contenteditable + studio
 * modal) are ported verbatim from use-edit-history. */
import { useEffect, useRef, useState } from "react";
import { isStudioModalActive } from "@models/timeline/studio-modal-active.ts";
import { createCommandLedger, type CommandLedger } from "@models/chat/command-ledger.ts";
import {
	EngineCommandError,
	replaceScope,
	type CommandExecutor,
	type EditorCommand,
	type EditScope,
} from "@maleo/shared/editor";
import { acceptsDocumentUndo, isTypingTarget } from "@models/timeline/editor-chrome.ts";

export interface CommandStack {
	/** Apply a command, commit it, and record it for undo (clears redo).
	 *  Pass `before` when the caller already built the command against a specific
	 *  scope (e.g. `diffScopeToCommand` off the live store) so the command is
	 *  applied AND inverted against that exact state — the React-mirrored `scope`
	 *  can be a render behind during a burst of synchronous commits.
	 *  Returns the recorded step id, or null when the command changed nothing. */
	run: (cmd: EditorCommand, before?: EditScope) => string | null;
	/** Open a gesture: every command run until `endGesture` collapses into ONE undo
	 *  step that inverts to the state the gesture started from. A drag emits a
	 *  command per animation frame, and a drop can emit one per relocated clip;
	 *  without this a single drag fills and evicts the whole undo stack. */
	beginGesture: () => void;
	endGesture: () => void;
	/** Whether this exact document is the one undo or redo just produced.
	 *
	 * An effect that NORMALISES the document — row compaction, collision
	 * resolution — writes in response to the document changing, so it cannot tell
	 * an undo from a user edit. Undoing a track reorder restored the tracks and
	 * the compactor wrote them straight back, which both defeated the undo and
	 * cleared the redo stack, since a fresh record clears redo.
	 *
	 * Asked as an identity question, not a timing one. "Is a command being
	 * applied right now" is a race against React's effect scheduling: the
	 * `applyingRef` the watcher uses is cleared on a `setTimeout(0)` while
	 * compaction re-runs on later renders, so it reads false by the time it
	 * matters. The document object undo committed stays identical until something
	 * writes again, so comparing against it has no window to miss.
	 *
	 * An undone document is a state that already existed and was already
	 * normalised, so declining to normalise it again is correct rather than a
	 * suppression. `applyingRef` is left alone — the watcher still needs it. */
	isCommandResult: (doc: unknown) => boolean;
	/** Whether `step` (an id `run` returned) is still the step the next undo
	 *  would reverse — so an agent result can offer Undo only while undoing it
	 *  undoes nothing else. */
	isLatest: (step: string) => boolean;
	doUndo: () => void;
	doRedo: () => void;
	canUndo: boolean;
	canRedo: boolean;
}

/** The undo stack as a surface renders it: two actions and whether each is
 *  available. Passed as one value so a toolbar takes an undo stack, not four
 *  loose props that can drift apart. */
export interface UndoStack {
	undo: () => void;
	redo: () => void;
	canUndo: boolean;
	canRedo: boolean;
}

/* An engine refusal is a refused edit, not a crash: nothing commits and the
 * reason is logged. Any other error is a bug and propagates. */
function refusedAsNull<T>(run: () => T | null): T | null {
	try {
		return run();
	} catch (error) {
		if (!(error instanceof EngineCommandError)) throw error;
		console.error("the editor engine refused an edit", error);
		return null;
	}
}

const executeOrRefuse = (executor: CommandExecutor, before: EditScope, command: EditorCommand) =>
	refusedAsNull(() => executor.execute(before, command));

export function useCommandStack(input: {
	/** Runs every command: the Rust engine in the editor (`useEditorEngine`). */
	executor: CommandExecutor;
	/** The current live editing scope (rebuilt each render from store + slides/posts). */
	scope: EditScope;
	/** Change triggers for the direct-manipulation watcher. */
	deps: unknown[];
	/** Write a scope back onto component state (store doc + slides + posts). */
	commit: (scope: EditScope) => void;
}): CommandStack {
	const { executor, scope, deps, commit } = input;
	const ledgerRef = useRef<CommandLedger | null>(null);
	if (!ledgerRef.current) ledgerRef.current = createCommandLedger(executor);
	const ledger = ledgerRef.current;
	// True while applying a command (run/undo/redo) so the watcher skips the change.
	const applyingRef = useRef(false);
	// The scope as of the last recorded history point (baseline for the next edit).
	const baselineRef = useRef<EditScope | null>(null);
	// The document undo/redo last committed. Held by identity so a normalising
	// effect can recognise it however many renders later it runs.
	const commandDocRef = useRef<unknown>(null);
	// Skip the first debounced fire after mount/load so loading isn't an undo step.
	const primedRef = useRef(false);
	// Live scope mirror so run/undo/redo read the current state, not a stale closure.
	const scopeRef = useRef(scope);
	scopeRef.current = scope;
	// The open gesture, if any. Commands recorded while it is set collapse together.
	const gestureRef = useRef<string | undefined>(undefined);
	const [hist, setHist] = useState({ undo: 0, redo: 0 });
	const sync = (): void => setHist(ledger.depths());

	const run = (command: EditorCommand, before: EditScope = scopeRef.current): string | null => {
		const executed = executeOrRefuse(executor, before, command);
		// A refused command (locked track, out-of-range playhead) returns its input: no commit, no undo step, redo kept.
		if (!executed || executed.scope === before) return null;
		const after = executed.scope;
		applyingRef.current = true;
		commit(after);
		baselineRef.current = after;
		const step = ledger.record(command, before, gestureRef.current, executed);
		sync();
		setTimeout(() => {
			applyingRef.current = false;
		}, 0);
		return step;
	};

	const beginGesture = (): void => {
		gestureRef.current = `g${crypto.randomUUID()}`;
	};
	const endGesture = (): void => {
		gestureRef.current = undefined;
	};

	// Direct-manipulation watcher: coalesce panel edits into one replaceScope command.
	useEffect(() => {
		if (applyingRef.current) return;
		const t = setTimeout(() => {
			const current = scopeRef.current;
			const base = baselineRef.current;
			// First fire after load only primes the baseline (load is not undoable).
			if (!primedRef.current || base === null) {
				primedRef.current = true;
				baselineRef.current = current;
				return;
			}
			if (current === base) return;
			// Already applied by the panel that wrote it: recorded, not executed again.
			ledger.record(replaceScope(current), base, undefined, {
				scope: current,
				inverse: replaceScope(base),
			});
			baselineRef.current = current;
			sync();
		}, 400);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);

	const doUndo = (): void => {
		const after = refusedAsNull(() => ledger.undo(scopeRef.current));
		if (after === null) return;
		applyingRef.current = true;
		commandDocRef.current = after.doc;
		commit(after);
		baselineRef.current = after;
		sync();
		setTimeout(() => {
			applyingRef.current = false;
		}, 0);
	};

	const doRedo = (): void => {
		const after = refusedAsNull(() => ledger.redo(scopeRef.current));
		if (after === null) return;
		applyingRef.current = true;
		commandDocRef.current = after.doc;
		commit(after);
		baselineRef.current = after;
		sync();
		setTimeout(() => {
			applyingRef.current = false;
		}, 0);
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (isStudioModalActive()) return;
			if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
			// The shared helper, rather than a third copy of the same three checks. A
			// field with nothing pending may hand undo to the document: after a keyboard
			// split the caption field is clean, and Cmd+Z there means "undo the split".
			if (isTypingTarget(e.target) && !acceptsDocumentUndo(e.target)) return;
			e.preventDefault();
			if (e.shiftKey) doRedo();
			else doUndo();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return {
		run,
		beginGesture,
		endGesture,
		isCommandResult: (doc) => doc === commandDocRef.current,
		isLatest: (step) => ledger.latestStep() === step,
		doUndo,
		doRedo,
		canUndo: hist.undo > 0,
		canRedo: hist.redo > 0,
	};
}
