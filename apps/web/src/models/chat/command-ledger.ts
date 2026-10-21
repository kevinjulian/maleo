/* Pure undo/redo bookkeeping for the command stack (D2), framework-agnostic so it
 * can be unit-tested without a DOM. The React hook (use-command-stack) owns effects,
 * debouncing, and committing scope back to state; this ledger owns only the two
 * stacks and their invariants: undo inverts the last command, redo re-applies it,
 * and any newly recorded command clears the redo stack. */
import {
	commandLabel,
	replaceScope,
	type CommandExecutor,
	type EditorCommand,
	type EditScope,
	type Execution,
} from "@maleo/shared/editor";
import { deepEqual } from "@maleo/shared/editor";

interface Entry {
	/** This step's own identity. Two steps recording equal command data are still
	 *  two steps, so "is this still the latest" is answered by id, never by
	 *  comparing commands. */
	id: string;
	command: EditorCommand;
	inverse: EditorCommand;
	/** The scope this entry undoes back to. Kept so a gesture that records again
	 *  can re-invert against where the gesture STARTED, not against the frame
	 *  before it. */
	before: EditScope;
	/** The gesture this entry belongs to, when it belongs to one. */
	gesture?: string;
	/** Only assets changed by this action belong to its undo/redo. */
	mediaIds: Set<string>;
}

function changedMedia(before: EditScope, after: EditScope): Set<string> {
	const old = new Map(before.mediaAssets.map((asset) => [asset.id, asset]));
	const next = new Map(after.mediaAssets.map((asset) => [asset.id, asset]));
	return new Set(
		[...new Set([...old.keys(), ...next.keys()])].filter(
			(id) => !deepEqual(old.get(id), next.get(id)),
		),
	);
}

/** Background staging is separate from document edits, so retain untouched assets. */
function retainUnrelatedMedia(current: EditScope, result: EditScope, ids: Set<string>): EditScope {
	const live = new Map(current.mediaAssets.map((asset) => [asset.id, asset]));
	const restoredIds = new Set(result.mediaAssets.map((asset) => asset.id));
	const restored = result.mediaAssets.flatMap((asset) =>
		ids.has(asset.id) ? [asset] : live.has(asset.id) ? [live.get(asset.id)!] : [],
	);
	return {
		...result,
		mediaAssets: [
			...current.mediaAssets.filter((asset) => !ids.has(asset.id) && !restoredIds.has(asset.id)),
			...restored,
		],
	};
}

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
}

/** `executor` runs undo and redo, and any recorded command whose execution the
 *  caller did not pass; the editor passes the Rust engine's. */
export function createCommandLedger(executor: CommandExecutor, limit = 60): CommandLedger {
	let undoStack: Entry[] = [];
	let redoStack: Entry[] = [];
	let steps = 0;
	const nextId = (): string => `step-${++steps}`;

	return {
		record(command, before, gesture, executed = executor.execute(before, command)) {
			const top = undoStack[undoStack.length - 1];
			if (gesture !== undefined && top?.gesture === gesture) {
				/* A gesture collapses to the two scopes that bracket it, not to its
				 * newest command.
				 *
				 * It used to keep the command's inverse against `top.before`. That is exact for the
				 * case this collapse was written for — a drag emitting a command per
				 * frame, every frame moving the same clip — because inverting the last
				 * frame against the gesture's start restores that clip completely. It
				 * loses everything else: a gesture spanning three clips undid one and
				 * left two where the gesture put them, and seven batched operations
				 * were in that category.
				 *
				 * Both directions need it. Redo re-applies `entry.command`, so a
				 * collapsed entry that kept only the newest command redid one clip. */
				const after = executed.scope;
				const entry: Entry = {
					id: nextId(),
					command: replaceScope(after, commandLabel(command)),
					inverse: replaceScope(top.before, commandLabel(command)),
					before: top.before,
					gesture,
					mediaIds: changedMedia(top.before, after),
				};
				undoStack = [...undoStack.slice(0, -1), entry];
				redoStack = [];
				return entry.id;
			}
			const id = nextId();
			undoStack = [
				...undoStack,
				{
					id,
					command,
					inverse: executed.inverse,
					before,
					gesture,
					mediaIds: changedMedia(before, executed.scope),
				},
			];
			if (undoStack.length > limit) undoStack = undoStack.slice(-limit);
			redoStack = [];
			return id;
		},
		undo(current) {
			const entry = undoStack[undoStack.length - 1];
			if (!entry) return null;
			// Executed first: a refused inverse leaves both stacks as they were.
			const undone = executor.execute(current, entry.inverse).scope;
			undoStack = undoStack.slice(0, -1);
			redoStack = [...redoStack, entry];
			return retainUnrelatedMedia(current, undone, entry.mediaIds);
		},
		redo(current) {
			const entry = redoStack[redoStack.length - 1];
			if (!entry) return null;
			const redone = executor.execute(current, entry.command).scope;
			redoStack = redoStack.slice(0, -1);
			undoStack = [...undoStack, entry];
			return retainUnrelatedMedia(current, redone, entry.mediaIds);
		},
		canUndo: () => undoStack.length > 0,
		latestStep: () => undoStack[undoStack.length - 1]?.id ?? null,
		canRedo: () => redoStack.length > 0,
		depths: () => ({ undo: undoStack.length, redo: redoStack.length }),
	};
}
