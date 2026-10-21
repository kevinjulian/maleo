/* Maleo — correct a menu that rendered partly offscreen.
 *
 * The placement maths lives in `models/timeline/editor-chrome.ts` and is pure;
 * this is the DOM half, which measures the element and writes the corrected
 * position back. Kept out of the model layer for that reason: it touches
 * `getBoundingClientRect` and `style`. */
import { clampMenuToViewport as clampMenuPoint } from "@models/timeline/editor-chrome.ts";

export function useClampMenu(): (el: HTMLDivElement | null) => void {
	return (el: HTMLDivElement | null): void => {
		if (!el) return;
		const r = el.getBoundingClientRect();
		const next = clampMenuPoint(
			{ x: r.left, y: r.top },
			{ width: r.width, height: r.height },
			{ width: window.innerWidth, height: window.innerHeight },
		);
		if (next.x !== r.left) el.style.left = `${next.x}px`;
		if (next.y !== r.top) el.style.top = `${next.y}px`;
	};
}
