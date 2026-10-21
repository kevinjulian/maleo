/* Pacing-insights strip drawn to a single canvas (retention heatmap + density
 * bars). Replaces the per-second DOM spans — a 10-minute timeline needs 2 draw
 * loops instead of ~1200 absolutely-positioned elements. Lint badges stay as
 * DOM buttons (clickable) on top of this canvas. */
import { useEffect, useRef } from "react";
import type { JSX } from "react";
import { fmtMMSS } from "@models/core/measures.ts";

interface InsightsCanvasProps {
	/** Predicted retention 0..1 per second. */
	retention: number[];
	/** Cut/overlay density per second (0..~4). */
	density: number[];
	pxPerSec: number;
}

const DENSITY_MAX = 6;

export function InsightsCanvas({ retention, density, pxPerSec }: InsightsCanvasProps): JSX.Element {
	const ref = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const cssW = Math.max(1, Math.ceil(retention.length * pxPerSec));
		const cssH = canvas.parentElement?.clientHeight || 26;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.ceil(cssW * dpr);
		canvas.height = Math.ceil(cssH * dpr);
		canvas.style.width = `${cssW}px`;
		canvas.style.height = `${cssH}px`;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, cssW, cssH);
		// Retention heat cells (same hue ramp as the old DOM cells).
		for (let sec = 0; sec < retention.length; sec++) {
			const r = retention[sec]!;
			ctx.fillStyle = `hsl(${Math.round(r * 120)} 72% 38% / 0.35)`;
			ctx.fillRect(sec * pxPerSec, 0, pxPerSec, cssH);
		}
		// Density bars, bottom-anchored, drawn in the theme foreground color.
		const styles = getComputedStyle(canvas);
		const fg = styles.getPropertyValue("--fg").trim() || "oklch(0.94 0.01 260)";
		const warn = styles.getPropertyValue("--warn").trim() || "oklch(0.74 0.15 75)";
		const err = styles.getPropertyValue("--err").trim() || "oklch(0.65 0.2 25)";
		ctx.globalAlpha = 0.35;
		for (let sec = 0; sec < density.length; sec++) {
			const value = density[sec] ?? 0;
			ctx.fillStyle = value >= 4.2 ? err : value >= 3.2 ? warn : fg;
			const h = Math.min(1, value / DENSITY_MAX) * cssH;
			if (h > 0) ctx.fillRect(sec * pxPerSec + 1, cssH - h, Math.max(2, pxPerSec - 2), h);
		}
		ctx.globalAlpha = 1;
	}, [retention, density, pxPerSec]);

	return (
		<canvas
			ref={ref}
			className="tl2-insights-canvas"
			onMouseMove={(e) => {
				const rect = e.currentTarget.getBoundingClientRect();
				const sec = Math.floor((e.clientX - rect.left) / pxPerSec);
				const r = retention[sec];
				const load = density[sec];
				const state =
					load == null
						? ""
						: load >= 4.2
							? "overloaded"
							: load >= 3.2
								? "busy"
								: load < 0.35
									? "quiet"
									: "balanced";
				e.currentTarget.title =
					r != null
						? `${fmtMMSS(sec)} · load ${load?.toFixed(1)} (${state}) · ~${Math.round(r * 100)}% predicted retention`
						: "";
			}}
		/>
	);
}
