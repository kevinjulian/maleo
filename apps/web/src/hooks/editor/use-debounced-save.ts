/* Debounced "save on change" effect with a skip-first-run guard.
 *
 * Each editor autosave (storyboard, editor-state, project-meta) shares the same
 * shape: when enabled, debounce `save` after `deps` change, but skip the first
 * enabled run so a freshly-loaded project isn't immediately re-saved. The save
 * closure stays in the component so it keeps direct access to state/setters. */
import { useEffect, useRef } from "react";

export function useDebouncedSave(
	enabled: boolean,
	deps: unknown[],
	delayMs: number,
	save: () => void,
): void {
	const skip = useRef(true);
	useEffect(() => {
		if (!enabled) return;
		if (skip.current) {
			skip.current = false;
			return;
		}
		const handle = setTimeout(save, delayMs);
		return () => clearTimeout(handle);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
}
