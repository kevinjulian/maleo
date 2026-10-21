/* Is the viewport too narrow to hold the editor's panes side by side?
 *
 * The editor commits 726px of fixed width before the stage is allocated
 * anything — a 360px chat pane, a 54px rail and a 312px panel. Below the
 * breakpoint those panes stop being columns: the panel becomes a sheet, chat
 * becomes the workspace's Chat view, and the rail rotates to a bottom bar.
 *
 * This is a WIDTH question, deliberately, and the only one in this change that
 * is. Touch density keys off `pointer: coarse` instead, because a touch laptop
 * at 1400px needs the bigger hit targets while a desktop window dragged to
 * 390px does not. Here the opposite holds: the panes fit or they do not, and
 * the pointer has no bearing on it.
 *
 * A JS media query rather than pure CSS because a sheet portals to
 * document.body and carries open state — there is no CSS that turns a column
 * into a portalled overlay.
 */
import { useEffect, useState } from "react";

/* 860px, not 768 or 1024. Below this the three fixed panes plus a stage wide
 * enough to judge a frame stop coexisting; above it the desktop composition
 * still has room. Kept here rather than in a stylesheet because the CSS and
 * this hook must agree, and one exported constant is the only way to say so
 * once — see `--tl2-phone-max` in rail.css, which mirrors it. */
export const PHONE_MAX_WIDTH = 860;

const QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;

/* One answer for every editor surface that chooses between columns and sheets.
 *
 * The main editor, Template Studio and Motion Studio all read this. The studios
 * used to declare `(max-width: 700px), (max-height: 500px) and (pointer: coarse)`
 * in their own components — the same string in two files — so between 700 and
 * 860 the editor composed as a phone while the studios composed as desktops, in
 * the same window, and a change to either copy would have widened the gap rather
 * than closed it. Short landscape needs no separate arm here: 852 is under the
 * breakpoint, so the width answers it.
 *
 * `useCompactWorkspace` inside `@maleo/vui` answers a DIFFERENT question and is
 * deliberately not this: it measures the workspace's own width, so an editor
 * embedded in a narrow column composes as narrow whatever the viewport is doing.
 * That is a container question; this is a viewport one.
 */
/** The same answer, read once and synchronously — for state that must START
 *  right on a phone rather than be corrected by an effect after it has
 *  rendered, such as chat opening by default. */
export function isPhoneViewport(): boolean {
	return typeof window === "undefined" ? false : (window.matchMedia?.(QUERY).matches ?? false);
}

export function usePhoneLayout(): boolean {
	/* Initialised from a real read, not from `false`. Starting false would mount
	 * the desktop composition on a phone and swap it on the first effect, which
	 * is a visible reflow on the slowest devices in the fleet. */
	const [phone, setPhone] = useState<boolean>(isPhoneViewport);

	useEffect(() => {
		const mq = window.matchMedia?.(QUERY);
		if (!mq) return;
		const onChange = (e: MediaQueryListEvent): void => setPhone(e.matches);
		mq.addEventListener("change", onChange);
		/* Re-read on mount: the query can have flipped between the initial state
		 * and this effect, and a rotation is exactly that case. */
		setPhone(mq.matches);
		return () => mq.removeEventListener("change", onChange);
	}, []);

	return phone;
}
