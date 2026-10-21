/* Are the settings columns side by side, or one at a time?
 *
 * A WIDTH question, like `usePhoneLayout`, and answered the same way — but this
 * one exists for a different reason than layout. The columns themselves collapse
 * in CSS and need no JavaScript. What needs JavaScript is SELECTION:
 *
 *   side by side   a column with nothing chosen is an empty pane beside two full
 *                  ones, so the first item opens by default
 *   one at a time  a chosen item IS the whole screen, so choosing one by default
 *                  skips the list the operator was trying to read
 *
 * There is no CSS that expresses "select something", so the breakpoint has to be
 * readable from both sides.
 */
import { useEffect, useState } from "react";

/* Must equal the `min-width` the settings columns use in settings.css.
 *
 * Kept here rather than in the stylesheet because the CSS and this hook have to
 * agree, and one exported constant is the only way to say so once — the same
 * arrangement `PHONE_MAX_WIDTH` has with `--tl2-phone-max`. Drift is not
 * cosmetic here: a narrow viewport that thinks it is wide selects an item, which
 * hides the list behind it, and the back control that would return to that list
 * belongs to a column the layout has hidden. `settings-breakpoint.test.ts` reads
 * both and fails when they diverge. */
export const SETTINGS_COLUMNS_MIN_WIDTH = 1000;

const QUERY = `(min-width: ${SETTINGS_COLUMNS_MIN_WIDTH}px)`;

export function useSettingsColumns(): boolean {
	/* Initialised from a real read, not from `false`: starting narrow would mount
	 * an empty detail pane on a desktop and fill it on the first effect. */
	const [wide, setWide] = useState<boolean>(() =>
		typeof window === "undefined" ? false : (window.matchMedia?.(QUERY).matches ?? false),
	);

	useEffect(() => {
		const mq = window.matchMedia?.(QUERY);
		if (!mq) return;
		const onChange = (e: MediaQueryListEvent): void => setWide(e.matches);
		mq.addEventListener("change", onChange);
		// Re-read on mount: the query can flip between the initial state and here.
		setWide(mq.matches);
		return () => mq.removeEventListener("change", onChange);
	}, []);

	return wide;
}
