/* Undo/redo for the command stack (D2). The stacks and their invariants live in
 * the shared core (`crates/app-core`, OpenSpec `p1-app-core`): undo inverts the
 * last command, redo re-applies it, and any newly recorded command clears the
 * redo stack. This module keeps the editor's API over the engine's ledger
 * calls; the React hook (use-command-stack) owns effects, debouncing, and
 * committing scope back to state. */
import {
	applyDelta,
	editorEngine,
	EngineCommandError,
	engineExecutor,
	isEngineExecutor,
	type CommandExecutor,
	type EditorCommand,
	type EditScope,
	type EngineResult,
	type Execution,
	type ScopeDelta,
} from "@maleo/shared/editor";

function unwrap<T>(result: EngineResult<T>): T {
	if (!result.ok) throw new EngineCommandError(result.error.kind, result.error.message);
	return result.value;
}

/* A ledger's steps hold scopes inside the engine; its handle is closed when the
 * ledger object is collected, so an unmounted editor does not keep them. */
const closing = new FinalizationRegistry<() => void>((close) => close());

export interface CommandLedger {
	/** Record a command already applied to `before` (clears the redo stack).
	 *  Pass `executed` when the caller already ran it, so it is not run twice.
	 *
	 *  `gesture` makes a continuous interaction one undo step. A drag emits a
	 *  command per animation frame; recorded individually, a single sustained drag
	 *  fills and evicts the whole 60-entry stack, and undo walks back through it
	 *  one frame at a time. When a gesture id matches the top entry, this REPLACES
	 *  that entry and keeps its original `before`, so the gesture inverts to where
	 *  it started. The commands this coalesces are absolute (move/resize to a
	 *  position), so the latest one applied to the gesture's start reproduces the
	 *  final state. */
	record: (
		command: EditorCommand,
		before: EditScope,
		gesture?: string,
		executed?: Execution,
	) => string;
	/** Invert the most recent command against `current`; null if nothing to undo. */
	undo: (current: EditScope) => EditScope | null;
	/** Re-apply the most recently undone command against `current`; null if none. */
	redo: (current: EditScope) => EditScope | null;
	canUndo: () => boolean;
	canRedo: () => boolean;
	/** The id of the step the next undo would reverse. A gesture that collapses
	 *  into the top entry gets a new id, so an id handed out before it no longer
	 *  matches. */
	latestStep: () => string | null;
	depths: () => { undo: number; redo: number };
	/** The engine ledger handle, for app-core calls that clear or check it
	 *  alongside a pending queue (`pendingResolve`). */
	readonly handle: number;
}

/** `executor` runs any recorded command whose execution the caller did not
 *  pass. The editor passes the executor `engineExecutor` returns, and the
 *  ledger then records the execution it last ran by handle. Any other executor
 *  gets an engine session of the ledger's own, from the provided engine, and
 *  each record sends both scopes. */
export function createCommandLedger(executor: CommandExecutor, limit = 60): CommandLedger {
	const session = isEngineExecutor(executor) ? executor : engineExecutor(editorEngine());
	const { engine } = session;
	const handle = engine.ledgerOpen(limit);
	const state = (): { undo: string[]; redo: string[] } =>
		JSON.parse(unwrap(engine.ledgerState(handle)));

	/* Undo and redo run on the engine's document handle and answer with a delta;
	 * the executor is told the handle now holds the rebuilt scope. */
	const step = (
		current: EditScope,
		run: (doc: number) => EngineResult<string>,
	): EditScope | null => {
		const out = unwrap(run(session.handleFor(current)));
		if (out === "null") return null;
		// SAFETY: `{"delta"}` as `AppState::ledger_undo` / `ledger_redo` write it.
		const { delta } = JSON.parse(out) as { delta: ScopeDelta };
		const scope = applyDelta(current, delta);
		session.adopt(scope);
		return scope;
	};

	const ledger: CommandLedger = {
		record(command: EditorCommand, before: EditScope, gesture?: string, executed?: Execution) {
			const ran = executed ?? executor.execute(before, command);
			const options = gesture === undefined ? {} : { gesture };
			const last = session.last();
			/* An execution the executor just ran is already in the engine, so only
			 * the gesture crosses. A change the host applied itself (the
			 * slides/posts watcher) sends both scopes. */
			return unwrap(
				last?.execution === ran
					? engine.ledgerRecord(handle, last.handle, JSON.stringify(options))
					: engine.ledgerRecordApplied(
							handle,
							JSON.stringify({
								command,
								inverse: ran.inverse,
								before,
								after: ran.scope,
								...options,
							}),
						),
			);
		},
		undo: (current) =>
			state().undo.length ? step(current, (doc) => engine.ledgerUndo(handle, doc)) : null,
		redo: (current) =>
			state().redo.length ? step(current, (doc) => engine.ledgerRedo(handle, doc)) : null,
		canUndo: () => state().undo.length > 0,
		canRedo: () => state().redo.length > 0,
		latestStep: () => state().undo.at(-1) ?? null,
		depths: () => {
			const { undo, redo } = state();
			return { undo: undo.length, redo: redo.length };
		},
		handle,
	};
	closing.register(ledger, () => engine.ledgerClose(handle));
	return ledger;
}
