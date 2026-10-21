/* The main timeline's playhead: drawn by direct writes, and operable as a slider.
 *
 * Subscribed rather than rendered: the position changes thirty times a second
 * during playback and the only thing that changes with it is this element's
 * transform. Its slider value is written in the same place, so the announced
 * time is current during playback without a render. Re-drawn on `pxPerSec` as
 * well, because zooming moves it without the time moving. */
import {
	useCallback,
	useEffect,
	useRef,
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
} from "react";
import { fmtMMSS } from "@models/core/measures.ts";
import { CONTENT_FPS } from "@models/timeline/content-document-adapter.ts";
import { contentTimeToPixels } from "@models/timeline/content-vui-adapter.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { usePlayheadEffect } from "./use-playhead.ts";

/** The playhead's spoken value: `M:SS` and the frame within the second. */
export function playheadValueText(sec: number): string {
	const frames = Math.floor(sec * CONTENT_FPS + 1e-6);
	return `${fmtMMSS(Math.floor(frames / CONTENT_FPS))} frame ${frames % CONTENT_FPS}`;
}

export interface PlayheadSlider {
	ref: RefObject<HTMLDivElement | null>;
	/** ←/→ step one frame, clamped to the project. */
	onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
}

export function usePlayheadSlider(
	playhead: PlayheadHandle,
	pxPerSec: number,
	total: number,
	seek: (sec: number) => void,
): PlayheadSlider {
	const ref = useRef<HTMLDivElement | null>(null);
	const draw = useCallback(
		(sec: number): void => {
			const el = ref.current;
			if (!el) return;
			el.style.transform = `translateX(${contentTimeToPixels(sec, pxPerSec)}px)`;
			el.setAttribute("aria-valuenow", String(Math.round(sec * 100) / 100));
			el.setAttribute("aria-valuetext", playheadValueText(sec));
		},
		[pxPerSec],
	);
	usePlayheadEffect(playhead, draw);
	useEffect(() => draw(playhead.get()), [draw, playhead]);
	/* Default prevented, so the editor's shortcuts — which would nudge a selected
	 * clip — stand aside. */
	const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
		if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
		e.preventDefault();
		const frame = 1 / CONTENT_FPS;
		const next = playhead.get() + (e.key === "ArrowRight" ? frame : -frame);
		seek(Math.min(total, Math.max(0, Math.round(next * CONTENT_FPS) / CONTENT_FPS)));
	};
	return { ref, onKeyDown };
}
