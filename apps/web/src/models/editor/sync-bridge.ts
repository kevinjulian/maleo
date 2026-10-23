/* Which editor writes reach the command log, and how (`p1-command-log` D4).
 *
 * The bridge remembers the last scope it handed to the log. A command the
 * stack ran is enqueued as itself; an undo, a redo, or any write that went
 * around the stack (script-view chapters, media reconciliation, the slide and
 * post panels) is enqueued as a whole-scope replace from that scope. Writes made
 * inside `localOnly` — an agent run's preview and settled merge — are never
 * enqueued: the run's own version arrives from the log and replaces them.
 *
 * The media library is not compared: a storyboard does not hold it (D3). */
import type { EditorCommand, EditScope } from "@maleo/shared/editor";
import type { CommandSync } from "./command-sync.ts";

export interface SyncBridge {
	/** Start submitting, from the scope the editor holds now. */
	attach: (sync: CommandSync) => void;
	detach: () => void;
	sync: () => CommandSync | null;
	/** The stack ran `command` on `before`. */
	applied: (
		before: EditScope,
		command: EditorCommand,
		inverse: EditorCommand,
		after: EditScope,
	) => void;
	/** The stack moved the scope from `before` to `after` without a command (undo, redo). */
	replaced: (before: EditScope, after: EditScope) => void;
	/** Enqueue whatever changed since the last enqueue; called after writes settle. */
	catchUp: () => void;
	/** Run `write` without submitting what it writes. */
	localOnly: <T>(write: () => T) => T;
	/** A resolved reply landed on the editor: it is what the log holds now. */
	resolved: (scope: EditScope) => void;
}

const sameStoryboard = (a: EditScope, b: EditScope): boolean =>
	a.doc === b.doc && a.slides === b.slides && a.posts === b.posts;

export function createSyncBridge(input: {
	scope: () => EditScope;
	/** Something was enqueued; the caller schedules a flush. */
	enqueued: () => void;
}): SyncBridge {
	let sync: CommandSync | null = null;
	let synced: EditScope | null = null;
	let local = 0;

	/* Anything written around the stack since the last enqueue goes first, so
	 * the server sees the writes in the order they happened. */
	const flushGap = (now: EditScope): void => {
		if (sync && synced && !sameStoryboard(synced, now)) {
			sync.enqueueReplace(synced, now);
			input.enqueued();
		}
	};

	return {
		attach(next) {
			sync = next;
			synced = input.scope();
		},
		detach() {
			sync = null;
			synced = null;
		},
		sync: () => sync,
		applied(before, command, inverse, after) {
			if (!sync) return;
			if (local) {
				synced = after;
				return;
			}
			flushGap(before);
			sync.enqueue(command, inverse);
			synced = after;
			input.enqueued();
		},
		replaced(before, after) {
			if (!sync) return;
			if (local) {
				synced = after;
				return;
			}
			flushGap(before);
			if (!sameStoryboard(before, after)) {
				sync.enqueueReplace(before, after);
				input.enqueued();
			}
			synced = after;
		},
		catchUp() {
			if (local) return;
			flushGap(input.scope());
			if (sync) synced = input.scope();
		},
		localOnly(write) {
			local++;
			try {
				return write();
			} finally {
				local--;
				// What the write left is the baseline; it is not submitted.
				if (sync && !local) synced = input.scope();
			}
		},
		resolved(scope) {
			if (sync) synced = scope;
		},
	};
}
