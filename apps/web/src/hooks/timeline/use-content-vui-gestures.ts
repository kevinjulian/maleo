/* The ruler's scrub, and the range a coarse sweep marks.
 *
 * One gesture, and it is the last one the editor drives itself. Clips — free
 * lanes and the base track alike — are on `@maleo/vui`'s surface, which holds
 * capture on the scroller and keeps the gesture in the kernel. The ruler is not,
 * and deliberately so: a scrub writes no document, it moves the playhead and
 * marks a span, and routing it through a transaction would model an edit that
 * never happens.
 *
 * What it decides is still Maleo's: `content-vui-adapter.ts` says when a drag
 * is long enough to be a range rather than a seek, and what the previous range
 * does when it is not. */
import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
	contentScrubDecision,
	type ContentGesturePhase,
	type ContentTimelineRange,
} from "@models/timeline/content-vui-adapter.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";

export interface ContentVuiGestureOptions {
	total: number;
	pxPerSec: number;
	coarse: boolean;
	playhead: PlayheadHandle;
	timelineRange: ContentTimelineRange | null;
	setTimelineRange: (range: ContentTimelineRange | null) => void;
	seekPreview: (sec: number) => void;
	/** Viewport x → timeline seconds, clamped to the project. */
	timeAt: (clientX: number) => number;
	/* A ruler drag shorter than this is a seek, not a range. */
	minimumRangePx: number;
}

export interface ContentVuiGestures {
	/** Press-and-drag the ruler or playhead to scrub, and on a coarse pointer to
	 *  mark the span the drag covered as the timeline range. */
	scrubDrag: (event: ReactPointerEvent<HTMLElement>) => void;
}

export function useContentVuiGestures(options: ContentVuiGestureOptions): ContentVuiGestures {
	const {
		total,
		pxPerSec,
		coarse,
		playhead,
		timelineRange,
		setTimelineRange,
		seekPreview,
		timeAt,
		minimumRangePx,
	} = options;
	/* The pointer currently scrubbing, and how to stop listening for it.
	 *
	 * Held as one object rather than as an id plus a teardown, because the two
	 * are only ever set and cleared together and a pair that can disagree is a
	 * listener that outlives its gesture. */
	const scrubRef = useRef<{ pointerId: number; stop(): void } | null>(null);
	useEffect(() => () => scrubRef.current?.stop(), []);
	void total;
	void pxPerSec;

	const scrubDrag = (event: ReactPointerEvent<HTMLElement>): void => {
		event.preventDefault();
		event.stopPropagation();
		scrubRef.current?.stop();
		const target = event.currentTarget;
		const pointerId = event.pointerId;
		const anchorClientX = event.clientX;
		const anchorTimeSec = timeAt(anchorClientX);
		const initialPlayheadSec = playhead.get();
		const previousRange = timelineRange;

		const apply = (clientX: number, phase: ContentGesturePhase): void => {
			const decision = contentScrubDecision({
				phase,
				initialPlayheadSec,
				anchorTimeSec,
				currentTimeSec: timeAt(clientX),
				distancePx: Math.abs(clientX - anchorClientX),
				coarse,
				previousRange,
				minimumRangePx,
			});
			seekPreview(decision.seekSec);
			if (decision.range !== undefined) setTimelineRange(decision.range);
		};

		const onMove = (moved: PointerEvent): void => {
			if (moved.pointerId === pointerId) apply(moved.clientX, "update");
		};
		const onUp = (ended: PointerEvent): void => {
			if (ended.pointerId === pointerId) {
				apply(ended.clientX, "commit");
				stop();
			}
		};
		const onCancel = (ended: PointerEvent): void => {
			if (ended.pointerId === pointerId) {
				apply(ended.clientX, "cancel");
				stop();
			}
		};
		function stop(): void {
			target.removeEventListener("pointermove", onMove);
			target.removeEventListener("pointerup", onUp);
			target.removeEventListener("pointercancel", onCancel);
			target.removeEventListener("lostpointercapture", onCancel);
			/* Releasing a capture the browser already took away throws, and the throw
			 * would escape into whichever handler ran `stop`. */
			try {
				target.releasePointerCapture(pointerId);
			} catch {
				/* already released */
			}
			scrubRef.current = null;
		}

		/* Capture on the ruler itself, which is what makes a scrub that leaves the
		 * ruler keep scrubbing instead of stopping at its edge. */
		try {
			target.setPointerCapture(pointerId);
		} catch {
			/* a pointer the browser no longer tracks */
		}
		target.addEventListener("pointermove", onMove);
		target.addEventListener("pointerup", onUp);
		target.addEventListener("pointercancel", onCancel);
		target.addEventListener("lostpointercapture", onCancel);
		scrubRef.current = { pointerId, stop };
		apply(event.clientX, "begin");
	};

	return { scrubDrag };
}
