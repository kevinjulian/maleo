/* Studio-modal keyboard ownership. While a Motion/Template studio modal is open
 * it owns the keyboard: the Main Editor's global window shortcuts (undo/redo,
 * split, delete, playback…) must bail so timeline edits + undo inside the modal
 * don't leak to the main timeline (studio AGENTS.md invariant).
 *
 * A ref-counter (not a boolean) so nested/overlapping modals compose correctly. */
import { useEffect } from "react";

let openCount = 0;

/** True while any studio modal is mounted. Global keydown handlers check this. */
export function isStudioModalActive(): boolean {
	return openCount > 0;
}

/** Mark a studio modal open for its lifetime. Call from the modal component. */
export function useStudioModalActive(): void {
	useEffect(() => {
		openCount += 1;
		return () => {
			openCount = Math.max(0, openCount - 1);
		};
	}, []);
}
