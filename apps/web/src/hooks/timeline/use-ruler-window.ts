/* The span of the timeline, in content pixels, that the ruler marks.
 *
 * The visible viewport plus one viewport of buffer each side, snapped to
 * half-viewport steps. Snapping is what keeps scrolling cheap: the window only
 * changes, and the ruler only re-renders, when the scroll crosses a step —
 * not on every scroll event. The buffer is what keeps marks present while a
 * fling outruns the next re-render. */
import { useLayoutEffect, useState, type RefObject } from "react";

export interface RulerWindow {
	readonly fromPx: number;
	readonly toPx: number;
}

/** Before the scroller is measured: wide enough for any first paint. */
const UNMEASURED: RulerWindow = { fromPx: 0, toPx: 4096 };

export function rulerWindowFor(scrollLeft: number, clientWidth: number): RulerWindow {
	const step = Math.max(1, Math.round(clientWidth / 2));
	const fromPx = Math.max(0, Math.floor((scrollLeft - clientWidth) / step) * step);
	const toPx = Math.ceil((scrollLeft + clientWidth * 2) / step) * step;
	return { fromPx, toPx };
}

export function useRulerWindow(scrollerRef: RefObject<HTMLElement | null>): RulerWindow {
	const [window, setWindow] = useState<RulerWindow>(UNMEASURED);
	useLayoutEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return undefined;
		const update = (): void => {
			const next = rulerWindowFor(scroller.scrollLeft, scroller.clientWidth);
			setWindow((current) =>
				current.fromPx === next.fromPx && current.toPx === next.toPx ? current : next,
			);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(scroller);
		scroller.addEventListener("scroll", update, { passive: true });
		return () => {
			observer.disconnect();
			scroller.removeEventListener("scroll", update);
		};
	}, [scrollerRef]);
	return window;
}
