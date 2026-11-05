/* The phone timeline: the playhead stays in the middle and the timeline moves.
 *
 * On a phone the lane area is the pan surface (see `timeline-tracks.tsx`), so
 * panning and seeking are one gesture: the time under the centre line IS the
 * playhead. That only works if both ends of the project can reach the centre,
 * so the scroller is padded by half its own width on each side. With that
 * padding, time `t` sits under the centre exactly when `scrollLeft === t *
 * pxPerSec` — one equation, read in both directions:
 *
 *  - the playhead moves (playback, a ruler tap, a seek from anywhere) → write
 *    `scrollLeft`;
 *  - the operator scrolls (a drag, the momentum after it) → seek.
 *
 * The padding is measured rather than declared: `50%` padding resolves against
 * the scroller's containing block, which includes the label gutter when it is
 * shown, so it would centre on the wrong line.
 *
 * The line itself is drawn by the scroller's parent, at the scroller's centre,
 * and the playhead inside the scrolled content is hidden. Inside the content it
 * moved with every scroll and only came back when the seek it caused arrived —
 * late, and snapped to a frame — so under a finger it wobbled about the centre.
 * Outside, nothing moves it.
 *
 * Replaces `useFollowPlayhead` on this surface. Following keeps the playhead
 * somewhere in view; this keeps it in one place, which is the stronger claim. */
import { useEffect, useRef } from "react";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { usePlayheadEffect } from "./use-playhead.ts";

/** Marks a scroller whose playhead is pinned to its centre. The zoom hook reads
 *  it to anchor zoom on the playhead rather than on the fingers. */
export const CENTRED_PLAYHEAD_ATTR = "data-centred-playhead";
/** Marks the scroller's parent, which draws the fixed line at
 *  `--centred-playhead-x`. */
const CENTRED_HOST_ATTR = "data-centred-playhead-host";

/** How long after a scroll-driven seek the playhead's updates are treated as
 *  its echoes rather than as moves of their own. */
const ECHO_MS = 250;
/** How long after the operator's last touch, wheel or scroll a scroll is still
 *  theirs — the momentum of a fling arrives with no input event of its own. */
const SETTLE_MS = 300;

export interface CentredPlayheadInput {
	scroller: HTMLElement | null;
	playhead: PlayheadHandle;
	playing: boolean;
	pxPerSec: number;
	total: number;
	enabled: boolean;
	/** The frame rate seeks snap to. */
	fps: number;
	seek: (sec: number) => void;
	togglePlay: () => void;
}

/** The time under the centre line for a scroll offset, clamped to the project. */
export function centredTimeAt(scrollLeft: number, pxPerSec: number, total: number): number {
	if (pxPerSec <= 0) return 0;
	return Math.max(0, Math.min(total, scrollLeft / pxPerSec));
}

export function useCentredPlayhead(input: CentredPlayheadInput): void {
	const el = input.enabled ? input.scroller : null;
	/* Read at call time: the listeners below live as long as the scroller and
	 * must see the current zoom, play state and callbacks without rebinding. */
	const latest = useRef(input);
	latest.current = input;
	const scrollSeekAt = useRef(Number.NEGATIVE_INFINITY);
	/* A pointer is down on the scroller. The view is the operator's until it
	 * lifts: pinning under a finger that is scrubbing the ruler moves the ruler
	 * under it, and the next sample seeks somewhere else again. */
	const held = useRef(false);

	const pin = (sec: number): void => {
		if (!el) return;
		const { pxPerSec, playing, fps } = latest.current;
		/* The view is the operator's while they scroll. The playhead updates that
		 * arrive then are echoes of the seeks the scroll made, landing late and
		 * snapped to a frame; pinning to them drags the view back and stalls a
		 * slow finger or a drag's edge autoscroll. */
		if (held.current) return;
		if (!playing && performance.now() - scrollSeekAt.current < ECHO_MS) return;
		const next = sec * pxPerSec;
		/* Within a pixel is already there. Writing anyway would fire a scroll
		 * event whose rounded offset seeks a hair away from where playback is.
		 * Paused, within half a frame is there too: that is a scroll's own seek
		 * coming back snapped to a frame, and pinning to it nudges the view
		 * after the finger has let go. A deliberate step is a whole frame. */
		const slack = playing ? 1 : Math.max(1, pxPerSec / fps / 2);
		if (Math.abs(el.scrollLeft - next) >= slack) el.scrollLeft = next;
	};
	const pinRef = useRef(pin);
	pinRef.current = pin;

	/* Half the scroller's width on each side, kept current across rotation and
	 * the gutter toggling. */
	useEffect(() => {
		if (!el) return;
		el.setAttribute(CENTRED_PLAYHEAD_ATTR, "");
		const host = el.parentElement;
		host?.setAttribute(CENTRED_HOST_ATTR, "");
		const pad = (): void => {
			/* Measured with the padding off. A flex item cannot shrink below its
			 * own padding, so with it on, the scroller keeps its old width when
			 * the gutter appears beside it, and so would the padding. */
			el.style.paddingInline = "0px";
			const half = Math.round(el.clientWidth / 2);
			el.style.paddingInline = `${half}px`;
			host?.style.setProperty(
				"--centred-playhead-x",
				`${el.getBoundingClientRect().left + el.clientLeft - host.getBoundingClientRect().left - host.clientLeft + half}px`,
			);
			pinRef.current(latest.current.playhead.get());
		};
		pad();
		const observer = new ResizeObserver(pad);
		observer.observe(el);
		if (host) observer.observe(host);
		/* The gutter mounting beside the scroller resizes neither: the padding
		 * holds the scroller's width (see `pad`). */
		const mounts = new MutationObserver(pad);
		if (host) mounts.observe(host, { childList: true });
		return () => {
			observer.disconnect();
			mounts.disconnect();
			host?.removeAttribute(CENTRED_HOST_ATTR);
			host?.style.removeProperty("--centred-playhead-x");
			el.removeAttribute(CENTRED_PLAYHEAD_ATTR);
			el.style.paddingInline = "";
		};
	}, [el]);

	/* Zoom and length change where every time sits and how far the view can
	 * scroll; put the playhead back under the line. */
	useEffect(() => {
		pinRef.current(latest.current.playhead.get());
	}, [input.pxPerSec, input.total]);

	usePlayheadEffect(input.playhead, pin);

	/* The operator's scroll is a seek. Only while paused: during playback the
	 * offsets are ours, and a touch pauses first, as it does in any phone
	 * editor — a timeline that keeps running under a held finger fights it.
	 *
	 * And only the OPERATOR's scroll. The browser fires `scroll` for offsets
	 * nobody chose — a write clamped before the lanes have their full width, the
	 * drag kernel syncing its viewport — and reading those as input seeks to
	 * wherever they landed. So a scroll counts while a pointer is down on the
	 * scroller, or shortly after a touch, a wheel or a release; each counted
	 * scroll extends that window, which carries a fling's momentum. */
	useEffect(() => {
		if (!el) return;
		let ownedUntil = Number.NEGATIVE_INFINITY;
		let playheadAtDown = 0;
		const settle = (): void => {
			ownedUntil = performance.now() + SETTLE_MS;
		};
		const onScroll = (): void => {
			if (!held.current && performance.now() > ownedUntil) return;
			settle();
			const { playing, pxPerSec, total, playhead, seek } = latest.current;
			if (playing) return;
			const t = centredTimeAt(el.scrollLeft, pxPerSec, total);
			if (Math.abs(t - playhead.get()) * pxPerSec < 1) return;
			scrollSeekAt.current = performance.now();
			seek(t);
		};
		const onDown = (): void => {
			held.current = true;
			playheadAtDown = latest.current.playhead.get();
			if (latest.current.playing) latest.current.togglePlay();
		};
		const onUp = (): void => {
			if (!held.current) return;
			held.current = false;
			settle();
			/* A press that moved the playhead without scrolling — a ruler tap —
			 * brings it to the line now. Any other press leaves the view alone:
			 * a tap's click lands after the release, on whatever is under the
			 * finger then, and a pin here would have moved it away. */
			const { playhead } = latest.current;
			if (playhead.get() !== playheadAtDown && performance.now() - scrollSeekAt.current >= ECHO_MS)
				pinRef.current(playhead.get());
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		el.addEventListener("pointerdown", onDown);
		el.addEventListener("wheel", settle, { passive: true });
		el.addEventListener("touchmove", settle, { passive: true });
		/* On the window: a drag that starts on the timeline often ends elsewhere. */
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		return () => {
			el.removeEventListener("scroll", onScroll);
			el.removeEventListener("pointerdown", onDown);
			el.removeEventListener("wheel", settle);
			el.removeEventListener("touchmove", settle);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
		};
	}, [el]);
}
