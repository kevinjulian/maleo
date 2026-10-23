/* Which editor writes reach the command log, and how (`p1-command-log` D4).
 *
 * The bridge remembers the last scope it handed to the log. A command the
 * stack ran is enqueued as itself; an undo, a redo, or any write that went
 * around the stack (script-view chapters, media reconciliation, the slide and
 * post panels) is enqueued as a whole-scope replace from that scope. Writes made
 * inside `localOnly` — an agent run's preview and settled merge — are never
 * enqueued: the run's own version arrives from the log and replaces them.
 *
 * The media library is server-owned (`p1-media-library`), and a submitted
 * `scope.replace` does not change it, so it is compared on its own. A library
 * write around the stack (an admission through `ensureMediaAsset`, a favorite,
 * a removal) is sent as `media.admit` per new asset when it only added assets —
 * the server deduplicates those by URL against every client's — and as a
 * `media.update` of the whole list otherwise. */
import {
	admitMedia,
	deepEqual,
	setMediaAssets,
	type EditorCommand,
	type EditScope,
	type MediaAsset,
} from "@maleo/shared/editor";
import type { CommandSync } from "./command-sync.ts";

/** What the server holds for the parts of the document a load migration rewrites. */
export interface StoredLayout {
	clips: EditScope["doc"]["clips"];
	markers: EditScope["doc"]["markers"];
	trackFlags?: EditScope["doc"]["trackFlags"];
}

export interface SyncBridge {
	/** Start submitting, from the scope the editor holds now. With `stored`, the
	 *  parts a load migration rewrote start from what the server holds instead,
	 *  so the next catch-up submits the migration. */
	attach: (sync: CommandSync, stored?: StoredLayout) => void;
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

/* The scope as the server holds it: `current`, with the migrated parts put back
 * to their stored form. `current` itself when the load migrated nothing. */
function asStored(current: EditScope, stored: StoredLayout | undefined): EditScope {
	if (
		!stored ||
		(deepEqual(current.doc.clips, stored.clips) &&
			deepEqual(current.doc.markers, stored.markers) &&
			deepEqual(current.doc.trackFlags ?? {}, stored.trackFlags ?? {}))
	)
		return current;
	return {
		...current,
		doc: {
			...current.doc,
			clips: stored.clips,
			markers: stored.markers,
			trackFlags: stored.trackFlags,
		},
	};
}

const sameLibrary = (a: MediaAsset[], b: MediaAsset[]): boolean =>
	a === b || JSON.stringify(a) === JSON.stringify(b);

/** The commands, with inverses, that move the library from `before` to `after`. */
export function libraryCommands(
	before: MediaAsset[],
	after: MediaAsset[],
): { command: EditorCommand; inverse: EditorCommand }[] {
	if (sameLibrary(before, after)) return [];
	const known = new Set(before.map((asset) => asset.id));
	const added = after.filter((asset) => !known.has(asset.id));
	if (
		added.length &&
		sameLibrary(
			after.filter((asset) => known.has(asset.id)),
			before,
		)
	) {
		// Oldest first, so each prepend leaves the order `after` holds.
		let current = before;
		return [...added].reverse().map((asset) => {
			const step = { command: admitMedia(asset), inverse: setMediaAssets(current) };
			current = [asset, ...current];
			return step;
		});
	}
	return [{ command: setMediaAssets(after), inverse: setMediaAssets(before) }];
}

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
		if (sync && synced) enqueueChange(sync, synced, now);
	};
	const enqueueChange = (target: CommandSync, before: EditScope, after: EditScope): void => {
		const media = libraryCommands(before.mediaAssets, after.mediaAssets);
		const storyboard = !sameStoryboard(before, after);
		if (storyboard) target.enqueueReplace(before, after);
		for (const { command, inverse } of media) target.enqueue(command, inverse);
		if (storyboard || media.length) input.enqueued();
	};

	return {
		attach(next, stored) {
			sync = next;
			synced = asStored(input.scope(), stored);
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
			enqueueChange(sync, before, after);
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
