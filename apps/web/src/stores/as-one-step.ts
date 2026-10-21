/* One user action is one undo step, even when it edits several clips.
 *
 * A ripple delete rewrites five families, a z-order change moves every selected
 * clip, a paste inserts a clip per item — each of those is a loop over the
 * writers, so each recorded one ledger entry per clip. Undoing a ripple delete
 * meant pressing undo once per affected clip, in reverse.
 *
 * The bracket lives outside the ops on purpose: "this is one action" is a fact
 * about the gesture the user made, not about the loop that carries it out.
 */
import type { DocumentWriters } from "@stores/document-writers.ts";

/** Wrap an op so everything it writes lands in a single undo entry. */
export function asOneStep<A extends unknown[]>(writers: DocumentWriters, op: (...args: A) => void) {
	return (...args: A): void => {
		writers.beginGesture();
		try {
			op(...args);
		} finally {
			writers.endGesture();
		}
	};
}
