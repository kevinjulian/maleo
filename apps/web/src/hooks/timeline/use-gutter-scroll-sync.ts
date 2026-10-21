/* The track gutter and the lanes scroll vertically as one, while only the lanes
 * scroll horizontally.
 *
 * The gutter used to be a sticky child of the one scroller that carried both
 * axes, so the horizontal scrollbar ran under it and lanes slid beneath it. It is
 * a sibling column now, and it SCROLLS rather than being driven by a transform:
 * its rows declare `touch-action: pan-y`, and a gutter that could not scroll
 * would turn a vertical finger drag on it into nothing.
 *
 * Two scrollers kept in step need two things:
 *  - each one's scroll copied to the other, skipped when they already agree so
 *    the copy does not echo back as a scroll of its own;
 *  - the same maximum scroll. The lanes lose their horizontal scrollbar's height
 *    from their viewport and the gutter does not, so a tail spacer at the end of
 *    the gutter makes up whatever difference the two contents leave. Without it
 *    the gutter bottoms out first and every row below drifts off its lane. */
import { useLayoutEffect, type RefObject } from "react";

/** Below this the two positions agree; writing would only start an echo. */
const SYNC_EPSILON_PX = 0.5;

export function useGutterScrollSync(
	gutterRef: RefObject<HTMLElement | null>,
	scrollerRef: RefObject<HTMLElement | null>,
	tailRef: RefObject<HTMLElement | null>,
	enabled: boolean,
): void {
	useLayoutEffect(() => {
		const gutter = gutterRef.current;
		const scroller = scrollerRef.current;
		const tail = tailRef.current;
		if (!enabled || !gutter || !scroller || !tail) return undefined;

		const copy = (from: HTMLElement, to: HTMLElement): void => {
			if (Math.abs(to.scrollTop - from.scrollTop) > SYNC_EPSILON_PX) to.scrollTop = from.scrollTop;
		};
		const fromScroller = (): void => copy(scroller, gutter);
		const fromGutter = (): void => copy(gutter, scroller);

		/* Equal maximum scroll: gutterContent - gutterViewport must equal
		 * lanesContent - lanesViewport. Measured with the tail collapsed so its own
		 * height is not counted as content. */
		const alignExtent = (): void => {
			tail.style.height = "0px";
			const lanesRange = scroller.scrollHeight - scroller.clientHeight;
			const gutterRange = gutter.scrollHeight - gutter.clientHeight;
			tail.style.height = `${Math.max(0, lanesRange - gutterRange)}px`;
			fromScroller();
		};

		alignExtent();
		/* Each side's content is one wrapper element, so observing it catches a lane
		 * added, a band shown, or a density change, without re-subscribing. */
		const observer = new ResizeObserver(alignExtent);
		for (const element of [
			scroller,
			gutter,
			scroller.firstElementChild,
			gutter.firstElementChild,
		]) {
			if (element) observer.observe(element);
		}
		scroller.addEventListener("scroll", fromScroller, { passive: true });
		gutter.addEventListener("scroll", fromGutter, { passive: true });
		return () => {
			observer.disconnect();
			scroller.removeEventListener("scroll", fromScroller);
			gutter.removeEventListener("scroll", fromGutter);
		};
	}, [gutterRef, scrollerRef, tailRef, enabled]);
}
