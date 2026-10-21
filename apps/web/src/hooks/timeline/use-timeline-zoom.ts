/* Timeline zoom: continuous pixels-per-second scale with Ctrl/⌘-wheel (and
 * trackpad pinch) cursor-anchored zoom, stepped toolbar zoom, and fit-to-width. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { contentZoomCommand } from "@models/timeline/content-vui-adapter.ts";

// Zoom bounds in pixels-per-second; clip widths and the ruler derive from it.
const MIN_PX_PER_SEC = 4;
const MAX_PX_PER_SEC = 240;
const DEFAULT_PX_PER_SEC = 36;
// One toolbar/keyboard zoom step multiplies the scale by this factor.
const STEP_FACTOR = 1.35;
// One wheel notch (or pinch increment) multiplies by this factor.
const WHEEL_FACTOR = 1.12;
// Breathing room subtracted from the viewport when fitting the whole timeline.
const FIT_PADDING_PX = 24;

const clampPx = (px: number): number => Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, px));

export interface TimelineZoom {
	pxPerSec: number;
	zoomPercent: number;
	setZoomPercent: (pct: number) => void;
	zoomIn: () => void;
	zoomOut: () => void;
	canZoomIn: boolean;
	canZoomOut: boolean;
	/** Fit the whole timeline into the scroll viewport (clamped to the zoom bounds). */
	fitToWidth: (totalSec: number) => void;
}

export function useTimelineZoom(trackRef: RefObject<HTMLDivElement | null>): TimelineZoom {
	const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);

	// The scroller holds only the lanes — the gutter is a sibling column — so
	// time zero is the scroller's own left edge and there is no origin offset.
	const LANE_ORIGIN_PX = 0;

	// Ctrl/⌘ + wheel (and trackpad pinch, which reports ctrlKey) zooms the timeline
	// centered on the cursor — the time under the pointer stays put. Native listener
	// so preventDefault works (React's onWheel is passive).
	useEffect(() => {
		const el = trackRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent): void => {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			const rect = el.getBoundingClientRect();
			const cursorX = e.clientX - rect.left;
			setPxPerSec((px) => {
				const command = contentZoomCommand({
					scrollLeft: el.scrollLeft,
					clientWidth: el.clientWidth,
					gutterWidth: LANE_ORIGIN_PX,
					pxPerSec: px,
					factor: e.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR,
					focalClientPx: cursorX,
					minPxPerSec: MIN_PX_PER_SEC,
					maxPxPerSec: MAX_PX_PER_SEC,
				});
				if (command.pxPerSec === px) return px;
				requestAnimationFrame(() => {
					const e2 = trackRef.current;
					if (e2) e2.scrollLeft = command.scrollLeft;
				});
				return command.pxPerSec;
			});
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [trackRef]);

	/* Pinch to zoom.
	 *
	 * Free, in the sense that costs nothing to take: two fingers never means pan,
	 * so unlike every other gesture in this change there is nothing to
	 * disambiguate it from. Worth taking because zoom is otherwise two taps deep
	 * in the More sheet while being the main defence against a phone timeline
	 * showing two to four lanes.
	 *
	 * It reaches us because the scroller declares `touch-action: pan-x`: the
	 * browser keeps the one axis it still scrolls and gives up pinch-zoom, so
	 * both pointers arrive here instead of scaling the page. `none` would have
	 * taken the pan with it; leaving it unset would have let the browser zoom
	 * the document out from under a PWA that disables user scaling anyway.
	 *
	 * Anchored on the midpoint between the fingers, the same way the wheel path
	 * anchors on the cursor — the time you pinch around is the time that stays
	 * still, which is what makes a zoom feel like it obeyed you. */
	const pxRef = useRef(pxPerSec);
	pxRef.current = pxPerSec;
	useEffect(() => {
		const el = trackRef.current;
		if (!el) return;
		const pts = new Map<number, { x: number; y: number }>();
		/* Captured when the second finger lands, not recomputed per frame: scaling
		 * from the ORIGINAL span makes the gesture reversible — pinch out and back
		 * returns to where it started. Accumulating per-frame ratios drifts. */
		let baseSpan = 0;
		let basePx = 0;

		const span = (): number => {
			const [a, b] = [...pts.values()];
			return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
		};
		const midX = (): number => {
			const [a, b] = [...pts.values()];
			return a && b ? (a.x + b.x) / 2 : 0;
		};

		const onDown = (e: PointerEvent): void => {
			if (e.pointerType === "mouse") return;
			pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pts.size === 2) {
				baseSpan = span();
				basePx = pxRef.current;
			}
		};
		const onMove = (e: PointerEvent): void => {
			if (!pts.has(e.pointerId)) return;
			pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pts.size !== 2 || baseSpan <= 0) return;
			e.preventDefault();
			const next = clampPx(basePx * (span() / baseSpan));
			const rect = el.getBoundingClientRect();
			const centreX = midX() - rect.left;
			setPxPerSec((px) => {
				if (next === px) return px;
				const command = contentZoomCommand({
					scrollLeft: el.scrollLeft,
					clientWidth: el.clientWidth,
					gutterWidth: LANE_ORIGIN_PX,
					pxPerSec: px,
					factor: next / px,
					focalClientPx: centreX,
					minPxPerSec: MIN_PX_PER_SEC,
					maxPxPerSec: MAX_PX_PER_SEC,
				});
				requestAnimationFrame(() => {
					const e2 = trackRef.current;
					if (e2) e2.scrollLeft = command.scrollLeft;
				});
				return command.pxPerSec;
			});
		};
		const onUp = (e: PointerEvent): void => {
			pts.delete(e.pointerId);
			/* A lifted finger ends the pinch rather than re-basing it. Re-basing on
			 * the remaining finger turns the tail of a pinch into a second gesture
			 * the operator did not make. */
			if (pts.size < 2) baseSpan = 0;
		};

		el.addEventListener("pointerdown", onDown);
		el.addEventListener("pointermove", onMove, { passive: false });
		el.addEventListener("pointerup", onUp);
		el.addEventListener("pointercancel", onUp);
		return () => {
			el.removeEventListener("pointerdown", onDown);
			el.removeEventListener("pointermove", onMove);
			el.removeEventListener("pointerup", onUp);
			el.removeEventListener("pointercancel", onUp);
		};
	}, [trackRef]);

	const zoomIn = useCallback((): void => setPxPerSec((px) => clampPx(px * STEP_FACTOR)), []);
	const zoomOut = useCallback((): void => setPxPerSec((px) => clampPx(px / STEP_FACTOR)), []);
	const setZoomPercent = useCallback((pct: number): void => {
		const safe = Math.max(0, Math.min(100, pct));
		setPxPerSec(clampPx(MIN_PX_PER_SEC + (MAX_PX_PER_SEC - MIN_PX_PER_SEC) * (safe / 100)));
	}, []);
	const fitToWidth = useCallback(
		(totalSec: number): void => {
			const el = trackRef.current;
			if (!el || totalSec <= 0) return;
			setPxPerSec(clampPx((el.clientWidth - LANE_ORIGIN_PX - FIT_PADDING_PX) / totalSec));
			requestAnimationFrame(() => {
				const e2 = trackRef.current;
				if (e2) e2.scrollLeft = 0;
			});
		},
		[trackRef],
	);

	return {
		pxPerSec,
		zoomPercent: Math.round(
			((pxPerSec - MIN_PX_PER_SEC) / (MAX_PX_PER_SEC - MIN_PX_PER_SEC)) * 100,
		),
		setZoomPercent,
		zoomIn,
		zoomOut,
		canZoomIn: pxPerSec < MAX_PX_PER_SEC,
		canZoomOut: pxPerSec > MIN_PX_PER_SEC,
		fitToWidth,
	};
}
