/* Whether the timeline's track gutter is showing, and how that is decided.
 *
 * The gutter is a fixed 176px. On a 390px phone that is 45% of the screen spent
 * on lane labels, leaving about five seconds of timeline — and per-group lane
 * heights have since made most of what it says redundant, because a 26px lane
 * with a waveform in it is audio without anything having to write "Audio".
 *
 * So it is hidden by DEFAULT on a coarse pointer and shown by default on a fine
 * one, and the operator can say otherwise. Two facts follow from that:
 *
 *   - The default is keyed on pointer type, not viewport width — the same axis
 *     `tracks.css` uses for density. A touch laptop needs the space and the
 *     larger targets; a desktop window dragged to 390px does not.
 *   - The preference is stored PER POINTER TYPE. One value would mean showing
 *     the gutter on a desktop silently hid it on the phone next time, or the
 *     reverse, and neither is what the operator asked for.
 *
 * Absence is meaningful here: nothing stored means "use the default for this
 * pointer", not "hidden".
 */
const STORAGE_KEY = "maleo.timeline.gutter";

export type PointerKind = "coarse" | "fine";

export function pointerKind(coarse: boolean): PointerKind {
	return coarse ? "coarse" : "fine";
}

/** What the gutter does when the operator has never said. */
export function defaultGutterVisible(pointer: PointerKind): boolean {
	return pointer === "fine";
}

interface Stored {
	coarse?: boolean;
	fine?: boolean;
}

function read(): Stored {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return {};
		const value = parsed as Record<string, unknown>;
		return {
			...(typeof value.coarse === "boolean" ? { coarse: value.coarse } : {}),
			...(typeof value.fine === "boolean" ? { fine: value.fine } : {}),
		};
	} catch {
		return {}; // private mode, a disabled store, or unparseable leftovers
	}
}

/** The stored preference for this pointer, or the default when there is none. */
export function gutterVisibleFor(pointer: PointerKind): boolean {
	return read()[pointer] ?? defaultGutterVisible(pointer);
}

export function storeGutterVisible(pointer: PointerKind, visible: boolean): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...read(), [pointer]: visible }));
	} catch {
		/* ignore quota / disabled storage */
	}
}
