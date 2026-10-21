/* Keep the playhead in view while the renderer plays.
 *
 * This lived inside `use-clip-position.ts`, a hook about committing a dragged
 * clip's position, where only the content editor could reach it. Both studios
 * therefore did not follow at all: playing past the visible width left the
 * operator watching a timeline that no longer showed where playback was, on a
 * surface whose entire purpose is to show where playback is.
 *
 * Two things had to change for it to be shared, and the second is the one that
 * would have failed silently. The gutter is a parameter rather than a
 * `.tl2-gutter` lookup — the studios draw `.vui-timeline-gutter`, so a lifted
 * copy would have measured zero and followed to a position short of the real
 * one by the gutter's width, which reads as "follows, but wrongly" rather than
 * as a broken selector.
 *
 * Driven by a subscription rather than by a render: this was once an effect
 * keyed on a `playheadSec` state, which is to say the editor re-rendered thirty
 * times a second so that this could set `scrollLeft`. It always wrote
 * imperatively; only the trigger was expensive. See `playhead-handle.ts`.
 */
import { useEffect, useRef } from "react";
import { nextTimelineFollowScroll } from "@models/timeline/timeline-editor-model.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { usePlayheadEffect } from "./use-playhead.ts";

export interface FollowPlayheadInput {
	/** The element that scrolls, or `null` before it mounts.
	 *  An element rather than a ref: the surfaces that own a scroller hold it in
	 *  state behind a callback ref, for the same reason `use-remotion-playhead.ts`
	 *  does — an effect keyed on a ref never re-runs when the ref is assigned. */
	scroller: HTMLElement | null;
	playhead: PlayheadHandle;
	playing: boolean;
	pxPerSec: number;
	/** The sticky gutter inside the scroller, as a selector resolved against it.
	 *  Visible width the playhead can never occupy, so it is subtracted before
	 *  the playhead is judged in or out of view. `null` for a surface with no
	 *  gutter, which is not the same as a selector that fails to match — the
	 *  first is a fact about the surface, the second is a bug that reads like
	 *  one. */
	gutterSelector: string | null;
	/** How close to an edge the playhead may drift before the view moves. */
	padding?: number;
	/** True while the surface itself knows a gesture is running — an item drag,
	 *  say. Optional, and NOT the main defence: the studios pan by scrolling the
	 *  element natively, which their gesture state does not describe at all, so a
	 *  hook that trusted this alone followed out from under a held pointer. That
	 *  was measured, not assumed. */
	suspended?: boolean;
	/** How long after a wheel or a touch-scroll the view stays the operator's,
	 *  before following resumes. */
	settleMs?: number;
}

export function useFollowPlayhead({
	scroller,
	playhead,
	playing,
	pxPerSec,
	gutterSelector,
	padding = 96,
	suspended = false,
	settleMs = 700,
}: FollowPlayheadInput): void {
	/* Whether the view currently belongs to the operator.
	 *
	 * A ref, not state: this is read inside a playhead subscription that runs at
	 * frame rate and must not render anything, and it is written from DOM events
	 * that must not either.
	 *
	 * The surfaces that own a scroller report a `gesture` only for item drags —
	 * panning the viewport is plain native scrolling, which no gesture state
	 * describes. So the hook watches the operator directly: the pointer being
	 * down on the scroller is the signal, and a wheel or touch scroll holds the
	 * view for `settleMs` after it stops, because those have no release event. */
	const operatorOwns = useRef(false);
	useEffect(() => {
		const el = scroller;
		if (!el) return;
		let idle: ReturnType<typeof setTimeout> | undefined;
		const hold = (): void => {
			if (idle) clearTimeout(idle);
			operatorOwns.current = true;
		};
		const release = (): void => {
			operatorOwns.current = false;
		};
		/* Wheel and touch scrolling end with no event of their own, so they are
		 * held open on a timer that each new event restarts. */
		const settle = (): void => {
			operatorOwns.current = true;
			if (idle) clearTimeout(idle);
			idle = setTimeout(() => {
				operatorOwns.current = false;
			}, settleMs);
		};
		el.addEventListener("pointerdown", hold);
		el.addEventListener("wheel", settle, { passive: true });
		el.addEventListener("touchmove", settle, { passive: true });
		/* On the window, because a drag that starts on the timeline routinely ends
		 * with the pointer somewhere else entirely. */
		window.addEventListener("pointerup", release);
		window.addEventListener("pointercancel", release);
		return () => {
			if (idle) clearTimeout(idle);
			el.removeEventListener("pointerdown", hold);
			el.removeEventListener("wheel", settle);
			el.removeEventListener("touchmove", settle);
			window.removeEventListener("pointerup", release);
			window.removeEventListener("pointercancel", release);
		};
	}, [scroller, settleMs]);

	usePlayheadEffect(playhead, (sec) => {
		if (!playing) return;
		/* The operator outranks the follow. A view that fights the finger is worse
		 * than one that does not follow at all. */
		if (suspended || operatorOwns.current) return;
		const el = scroller;
		if (!el) return;
		const gutterWidth = gutterSelector
			? (el.querySelector<HTMLElement>(gutterSelector)?.offsetWidth ?? 0)
			: 0;
		const next = nextTimelineFollowScroll({
			scrollLeft: el.scrollLeft,
			clientWidth: el.clientWidth,
			scrollWidth: el.scrollWidth,
			gutterWidth,
			playheadX: sec * pxPerSec,
			padding,
		});
		if (next !== el.scrollLeft) el.scrollLeft = next;
	});
}
