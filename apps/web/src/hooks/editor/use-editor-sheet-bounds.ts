/* Where a phone bottom sheet is allowed to be: from the top of the transport
 * down to the bottom bar — the whole timeline region, toolbar included, so an
 * open sheet replaces the timeline and leaves the stage and the bar.
 *
 * Only ONE boundary is chrome that stays live now, and that is a change worth
 * recording rather than discovering. The bottom bar does: it carries the
 * selection, the way out of it, and the navigation between rail destinations,
 * so a sheet that covered it turned every one of those into three taps.
 *
 * The transport does NOT, by request. It carries undo, redo, play and the
 * timecode — reached for immediately after an edit nobody meant — and it also
 * holds the control that opens the tools sheet. Covering it means tools cannot
 * be opened while any other sheet is up, so switching to it costs a dismiss
 * and a reopen. That was previously reported as a bug and fixed by keeping the
 * toolbar clear; covering it again reintroduces exactly that cost, knowingly.
 *
 * Measured rather than calculated. The first version of this hard-coded the
 * bar's height as `calc(51px + safe-area)`, which was right only while nobody
 * changed its padding, and the transport's position moves with the stage
 * splitter, the marker band and rotation — so there is no constant to write.
 *
 * Published on the documentElement because sheets portal to <body> and cannot
 * see a variable scoped to the editor. Custom properties inherit, so one write
 * reaches every sheet.
 */
import { useEffect } from "react";

/** The transport, and whichever bar currently occupies the bottom slot — one
 *  class, because that is now what "is a bottom bar" means. */
const TOP_EDGE = ".tl2-tlbar";
const BOTTOM_EDGE = ".tl2-bottombar";

/** @param swapKey Changes when the bottom slot swaps one bar for another.
 *  Without it the ResizeObserver goes on watching the element it was given at
 *  setup, which the swap has since detached — so the published height stays
 *  the one the OTHER bar had, and nothing ever fires to correct it. Harmless
 *  only for as long as the two bars are the same height, which is not a
 *  property to depend on silently. */
export function useEditorSheetBounds(enabled: boolean, swapKey: string): void {
	useEffect(() => {
		const root = document.documentElement;
		if (!enabled) {
			/* Cleared rather than left stale. A desktop viewport has no bottom
			 * sheets, but a stale band would apply the moment one is rotated into
			 * existence — with numbers measured from a layout that no longer
			 * exists. */
			root.style.removeProperty("--tl2-sheet-top");
			root.style.removeProperty("--tl2-sheet-bottom");
			root.style.removeProperty("--tl2-sheet-h");
			return;
		}

		const measure = (): void => {
			const top = document.querySelector(TOP_EDGE)?.getBoundingClientRect();
			const bottom = document.querySelector(BOTTOM_EDGE)?.getBoundingClientRect();
			/* The transport's TOP, so a sheet covers the toolbar as well as the
			 * lanes. Measuring its BOTTOM instead left the toolbar uncovered and
			 * live, which kept the tools control reachable while another sheet was
			 * up — see the note on `More` below. */
			if (top) root.style.setProperty("--tl2-sheet-top", `${Math.round(top.top)}px`);
			if (bottom) root.style.setProperty("--tl2-sheet-bottom", `${Math.round(bottom.height)}px`);
			/* The band's HEIGHT, published alongside its two edges rather than left
			 * for CSS to subtract. `calc(100svh - top - bottom)` looks equivalent
			 * and is not: `svh` is the viewport with the browser chrome at its
			 * largest, so on a phone whose address bar has collapsed it overstates
			 * the screen by exactly the amount the bar used to take — and the sheet
			 * ends up taller than the gap it was sized to fill. Measured, the two
			 * always agree because they come from the same layout. */
			if (top && bottom) {
				root.style.setProperty(
					"--tl2-sheet-h",
					`${Math.max(0, Math.round(bottom.top - top.top))}px`,
				);
			}
		};
		measure();

		/* A ResizeObserver on the elements is not enough on its own: the
		 * transport's SIZE never changes, only its position, and it moves when
		 * the splitter resizes the stage above it. Observing the editor body
		 * catches that, and the window listener catches rotation. */
		const observed = [
			document.querySelector(".tl2-body"),
			document.querySelector(TOP_EDGE),
			document.querySelector(BOTTOM_EDGE),
		];
		const ro = new ResizeObserver(measure);
		for (const el of observed) if (el) ro.observe(el);
		window.addEventListener("resize", measure);
		window.addEventListener("orientationchange", measure);
		return () => {
			ro.disconnect();
			window.removeEventListener("resize", measure);
			window.removeEventListener("orientationchange", measure);
			root.style.removeProperty("--tl2-sheet-top");
			root.style.removeProperty("--tl2-sheet-bottom");
			root.style.removeProperty("--tl2-sheet-h");
		};
	}, [enabled, swapKey]);
}
