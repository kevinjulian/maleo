/* The large preview a media cell shows on hover.
 *
 * The cells are deliberately small — a panel's job is to let an operator scan
 * what is there, and a grid of thumbnails big enough to identify a shot would
 * show four of them. Hover restores the detail the thumbnail drops, without a
 * click and without taking over the panel the way the lightbox does.
 *
 * Shared by All Media and Stock. Their cells disagree about shape — All Media
 * frames match the project's aspect, Stock cells are square — so this cannot
 * take the cell's proportions as the media's. It measures the real thing once
 * loaded and sizes to that, which is also what makes a portrait stock photo
 * preview portrait instead of letterboxed inside a square.
 *
 * Rendered in a portal rather than nested in the cell: the panel scrolls and
 * clips its overflow, so a preview drawn in flow would be cut off at the rail's
 * edge — which is exactly where it needs to escape to.
 *
 * `pointer-events: none` throughout. This floats over the grid under the
 * operator's cursor; if it could take the pointer it would swallow the drag that
 * starts on the cell beneath it, and dragging onto the timeline is the primary
 * action here. On Stock it would also cover the `+` button. */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { createPortal } from "react-dom";
import { assetUrl } from "@api/client.ts";
import "./media-hover-preview.css";
import { cssVars } from "@models/core/css-vars.ts";

/** Long enough that sweeping the cursor across the grid to reach something else
 *  does not flash a preview per cell; short enough to feel like hovering rather
 *  than waiting. */
const OPEN_DELAY_MS = 320;

export interface HoverTarget {
	/** The full-size file. Stock cells show a thumbnail, so this is the first
	 *  time the operator sees the actual asset. */
	url?: string;
	thumb?: string;
	label: string;
	kind: "image" | "video" | "audio";
	/** The cell's viewport rect. Sets the vertical anchor, and the assumed
	 *  proportions until the media reports its own. */
	rect: DOMRect;
	/** The panel's viewport rect. The preview clears the whole panel rather than
	 *  just the cell — anchored to the cell it lands on the neighbouring columns,
	 *  hiding the grid the operator is scanning. */
	host: { left: number; right: number };
}

/** The preview's bounds. Big enough to read a shot's composition, capped so it
 *  never becomes a modal by accident. */
const MAX_W = 420;
const MAX_H = 460;
const GAP = 12;

/** Clear of the panel on whichever side has room, vertically centred on the cell
 *  and always within the viewport. The panels are docked left, so this is
 *  usually the right edge. */
function place(rect: DOMRect, host: HoverTarget["host"], w: number, h: number) {
	const left =
		window.innerWidth - host.right - GAP >= w
			? host.right + GAP
			: Math.max(GAP, host.left - GAP - w);
	const top = Math.min(
		Math.max(GAP, rect.top + rect.height / 2 - h / 2),
		Math.max(GAP, window.innerHeight - h - GAP),
	);
	return { left, top };
}

export function MediaHoverPreview({ target }: { target: HoverTarget | null }): JSX.Element | null {
	// Delayed in state rather than by rendering-then-hiding, so nothing is
	// mounted (and no video decodes, and no full-size stock image is fetched)
	// until the operator has actually settled on a cell.
	const [shown, setShown] = useState<HoverTarget | null>(null);
	// Width over height, once the media says. Carries the URL it describes rather
	// than being cleared by an effect on change: a cached image reports its size
	// during the same commit that mounts it, before any effect runs, so a reset
	// effect would throw the measurement away and leave every preview square.
	const [natural, setNatural] = useState<{ url: string; aspect: number } | null>(null);

	useEffect(() => {
		if (!target) {
			setShown(null);
			return;
		}
		const t = setTimeout(() => setShown(target), OPEN_DELAY_MS);
		return () => clearTimeout(t);
	}, [target]);

	if (!shown || !shown.url || shown.kind === "audio") return null;
	const url = shown.url;
	// Returns the previous value unchanged when the measurement has not moved, so
	// React bails out of the re-render. Without that the inline `ref` below —
	// a new function identity every render, so React reattaches it every render —
	// measures, sets state, rerenders, measures, forever.
	const measure = (w: number, h: number): void => {
		if (w <= 0 || h <= 0) return;
		const next = w / h;
		setNatural((prev) =>
			prev && prev.url === url && Math.abs(prev.aspect - next) < 1e-4
				? prev
				: { url, aspect: next },
		);
	};

	// The cell's shape is the guess that holds for the frame or two before the
	// media loads. It is right for All Media (its cells carry the project aspect)
	// and wrong for Stock (square), which is why the measurement replaces it.
	const fallback = shown.rect.height > 0 ? shown.rect.width / shown.rect.height : 9 / 16;
	const aspect = natural?.url === url ? natural.aspect : fallback;
	const w = Math.min(MAX_W, MAX_H * aspect);
	const h = w / aspect;
	const { left, top } = place(shown.rect, shown.host, w, h);

	return createPortal(
		<div className="fc-hoverprev" style={{ left, top, width: w }}>
			<div className="fc-hoverprev-media" style={cssVars({ "--fc-asp": String(aspect) })}>
				{shown.kind === "video" ? (
					<video
						// The ref covers the case the event misses: a file already in the
						// media cache can be ready before React binds the handler.
						ref={(v) => {
							if (v?.videoWidth) measure(v.videoWidth, v.videoHeight);
						}}
						autoPlay
						muted
						loop
						playsInline
						preload="metadata"
						poster={shown.thumb}
						src={assetUrl(url)}
						onLoadedMetadata={(e) =>
							measure(e.currentTarget.videoWidth, e.currentTarget.videoHeight)
						}
					/>
				) : (
					<img
						ref={(img) => {
							if (img?.complete) measure(img.naturalWidth, img.naturalHeight);
						}}
						src={assetUrl(url)}
						alt={shown.label}
						onLoad={(e) => measure(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
					/>
				)}
			</div>
			<div className="fc-hoverprev-cap">{shown.label}</div>
		</div>,
		document.body,
	);
}
