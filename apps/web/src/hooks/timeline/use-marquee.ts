/* Marquee box-select: drag a rectangle over the empty timeline; any clip whose
 * box intersects it gets selected (Shift adds). A drag under the move threshold
 * falls back to a scrub. Extracted verbatim from TimelineEditor. */
import { useState } from "react";
import type { Dispatch, SetStateAction, PointerEvent as ReactPointerEvent } from "react";

interface MarqueeRect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

interface MarqueeOptions {
	selectedFreeIds: Set<string>;
	setSelectedFreeIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
	scrubTo: (clientX: number) => void;
}

export interface Marquee {
	marquee: MarqueeRect | null;
	startMarquee: (e: ReactPointerEvent) => void;
}

export function useMarquee(opts: MarqueeOptions): Marquee {
	const { selectedFreeIds, setSelectedFreeIds, scrubTo } = opts;
	const [marquee, setMarquee] = useState<MarqueeRect | null>(null);

	// Marquee box-select: drag a rectangle over empty timeline; clips whose box
	// intersects it get selected (Shift adds to the current selection).
	const selectClipsInRect = (
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		add: boolean,
	): void => {
		const left = Math.min(x0, x1),
			right = Math.max(x0, x1),
			top = Math.min(y0, y1),
			bottom = Math.max(y0, y1);
		const hit = new Set<string>(add ? selectedFreeIds : []);
		for (const el of document.querySelectorAll<HTMLElement>(
			".tl2-lane-free > .tl2-clip[data-clipid]",
		)) {
			const r = el.getBoundingClientRect();
			if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) {
				const id = el.dataset.clipid;
				if (id) hit.add(id);
			}
		}
		setSelectedFreeIds(hit);
	};
	// Start a marquee on an empty free-lane background (vs a click that scrubs).
	// A pure scrub (no drag) keeps the current selection — moving the playhead
	// across/inside a selected clip must not deselect it. A real drag replaces
	// the selection via selectClipsInRect (empty drag → empty set → clears).
	const startMarquee = (e: ReactPointerEvent): void => {
		const x0 = e.clientX,
			y0 = e.clientY,
			addShift = e.shiftKey;
		let moved = false;
		const onMove = (ev: PointerEvent): void => {
			if (Math.abs(ev.clientX - x0) > 3 || Math.abs(ev.clientY - y0) > 3) moved = true;
			if (moved) setMarquee({ x0, y0, x1: ev.clientX, y1: ev.clientY });
		};
		const onUp = (ev: PointerEvent): void => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			if (moved) selectClipsInRect(x0, y0, ev.clientX, ev.clientY, addShift);
			else scrubTo(x0);
			setMarquee(null);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	return { marquee, startMarquee };
}
