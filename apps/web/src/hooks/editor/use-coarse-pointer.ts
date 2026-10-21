/* Is the primary pointer a finger rather than a mouse?
 *
 * Deliberately NOT a width question — `usePhoneLayout` is that one, and the two
 * answer different things. Width decides whether the editor's panes fit as
 * columns; this decides whether the operator has hover, a button and pixel
 * precision. A touch laptop at 1400px has neither hover nor precision while its
 * panes fit fine, and a desktop window dragged to 390px has both while they do
 * not. Keying gestures off width would get both cases wrong.
 *
 * `pointer: coarse` reports the PRIMARY pointer, so a phone answers true and a
 * mouse-driven desktop answers false even with a touchscreen attached. That is
 * the right side of the trade: a device with both should keep the desktop
 * interaction its owner is most likely using.
 */
import { useEffect, useState } from "react";

const QUERY = "(pointer: coarse)";

export function useCoarsePointer(): boolean {
	/* Initialised from a real read for the same reason `usePhoneLayout` is:
	 * starting false arms direct-manipulation drag on a phone for one frame,
	 * and that frame is long enough to catch a press. */
	const [coarse, setCoarse] = useState<boolean>(() =>
		typeof window === "undefined" ? false : (window.matchMedia?.(QUERY).matches ?? false),
	);

	useEffect(() => {
		const mq = window.matchMedia?.(QUERY);
		if (!mq) return;
		const onChange = (e: MediaQueryListEvent): void => setCoarse(e.matches);
		mq.addEventListener("change", onChange);
		setCoarse(mq.matches);
		return () => mq.removeEventListener("change", onChange);
	}, []);

	return coarse;
}
