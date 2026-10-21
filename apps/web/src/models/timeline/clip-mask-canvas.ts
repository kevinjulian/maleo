import type { ClipLayout, ClipMask } from "@maleo/shared";

/** Convert local mask geometry to the existing project-space gesture box. */
export function maskCanvasLayout(
	layout: ClipLayout,
	mask: ClipMask,
	canvas: { w: number; h: number },
	scale: number,
): ClipLayout {
	const w = (layout.widthPct * canvas.w) / 100,
		h = ((layout.heightPct ?? 100) * canvas.h) / 100;
	const angle = ((layout.rotationDeg ?? 0) * Math.PI) / 180;
	const dx = ((mask.xPct + mask.widthPct / 2) / 100 - 0.5) * w * scale;
	const dy = ((mask.yPct + mask.heightPct / 2) / 100 - 0.5) * h * scale;
	const cx =
		((layout.xPct + layout.widthPct / 2) * canvas.w) / 100 +
		Math.cos(angle) * dx -
		Math.sin(angle) * dy;
	const cy =
		((layout.yPct + (layout.heightPct ?? 100) / 2) * canvas.h) / 100 +
		Math.sin(angle) * dx +
		Math.cos(angle) * dy;
	const widthPct = ((layout.widthPct * mask.widthPct) / 100) * scale,
		heightPct = (((layout.heightPct ?? 100) * mask.heightPct) / 100) * scale;
	return {
		xPct: (cx / canvas.w) * 100 - widthPct / 2,
		yPct: (cy / canvas.h) * 100 - heightPct / 2,
		widthPct,
		heightPct,
		rotationDeg: (layout.rotationDeg ?? 0) + mask.rotationDeg,
		fit: "stretch",
	};
}

export function maskFromCanvas(
	layout: ClipLayout,
	mask: ClipMask,
	box: ClipLayout,
	canvas: { w: number; h: number },
	scale: number,
): ClipMask {
	const dx = ((box.xPct + box.widthPct / 2 - layout.xPct - layout.widthPct / 2) * canvas.w) / 100;
	const dy =
		((box.yPct + (box.heightPct ?? 100) / 2 - layout.yPct - (layout.heightPct ?? 100) / 2) *
			canvas.h) /
		100;
	const angle = ((layout.rotationDeg ?? 0) * Math.PI) / 180;
	const cx =
		50 +
		((Math.cos(angle) * dx + Math.sin(angle) * dy) /
			(((layout.widthPct * canvas.w) / 100) * scale)) *
			100;
	const cy =
		50 +
		((-Math.sin(angle) * dx + Math.cos(angle) * dy) /
			((((layout.heightPct ?? 100) * canvas.h) / 100) * scale)) *
			100;
	const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
	const widthPct = clamp((box.widthPct / layout.widthPct / scale) * 100, 0.01, 100),
		heightPct = clamp(
			((box.heightPct ?? 100) / (layout.heightPct ?? 100) / scale) * 100,
			0.01,
			100,
		);
	return {
		...mask,
		xPct: clamp(cx - widthPct / 2, 0, 100 - widthPct),
		yPct: clamp(cy - heightPct / 2, 0, 100 - heightPct),
		widthPct,
		heightPct,
		rotationDeg:
			(((((box.rotationDeg ?? 0) - (layout.rotationDeg ?? 0) + 180) % 360) + 360) % 360) - 180,
	};
}
