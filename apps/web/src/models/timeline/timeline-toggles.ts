/* The timeline's two editing modes, remembered per browser.
 *
 * Snapping defaults ON and ripple editing OFF, which is how the timeline
 * behaved before either was a choice, so an operator who never touches them
 * sees no change. Storage can be absent, full, or refused (private mode), and
 * none of those may break the editor: a read that fails is the default, and a
 * write that fails is forgotten.
 */
const SNAP_KEY = "maleo.timeline.snapping";
const RIPPLE_KEY = "maleo.timeline.ripple";

function readFlag(key: string, fallback: boolean): boolean {
	try {
		const raw = window.localStorage.getItem(key);
		return raw === "true" ? true : raw === "false" ? false : fallback;
	} catch {
		return fallback;
	}
}

function writeFlag(key: string, value: boolean): void {
	try {
		window.localStorage.setItem(key, String(value));
	} catch {
		/* ignore quota / disabled storage */
	}
}

export const snapEnabled = (): boolean => readFlag(SNAP_KEY, true);
export const storeSnapEnabled = (on: boolean): void => writeFlag(SNAP_KEY, on);
export const rippleEnabled = (): boolean => readFlag(RIPPLE_KEY, false);
export const storeRippleEnabled = (on: boolean): void => writeFlag(RIPPLE_KEY, on);

/** What a Delete does: ripple mode closes the gap, and Shift inverts the mode
 *  for that one press, so either delete is one key away in either mode. */
export function deleteModeFor(rippleEditing: boolean, shift: boolean): "ripple" | "plain" {
	return rippleEditing !== shift ? "ripple" : "plain";
}
