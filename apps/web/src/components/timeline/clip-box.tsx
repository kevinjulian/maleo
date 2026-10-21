/* The interactive bounding box drawn over the selected clip on the preview
 * canvas: drag to move, handles to resize, with anchor and grid snapping.
 *
 * Split out of `clip-canvas.tsx`, which re-exports it. The box owns its drag
 * and its snap guides; nothing outside reads either. */
import type { JSX, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import type { ClipLayout, ClipKind } from "@models/timeline/clip-layout.ts";
import { normalizeLayout } from "@models/timeline/clip-layout.ts";
import {
	resizeCanvasLayout,
	resizeLayoutValue,
	type TransformMode,
} from "@models/timeline/canvas-transform.ts";

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

// Canvas snapping (percent space): a box edge/center within SNAP_THRESHOLD of a
// canvas anchor (left/center/right = 0/50/100) locks to it and draws a guide;
// otherwise the value falls to the nearest GRID step. Hold Alt to bypass both.
const SNAP_ANCHORS = [0, 50, 100] as const;
const SNAP_THRESHOLD = 2;
const SNAP_GRID = 5;
const snapToGrid = (v: number): number => Math.round(v / SNAP_GRID) * SNAP_GRID;

// Snap one axis: given the box's leading position and its size, test left/center/
// right against the anchors and return the adjusted position plus the guide anchor
// that fired (null when only the grid fallback applied).
function snapAxis(pos: number, size: number) {
	const edges = [pos, pos + size / 2, pos + size];
	let best: { delta: number; anchor: number } | null = null;
	for (const edge of edges) {
		for (const anchor of SNAP_ANCHORS) {
			const delta = anchor - edge;
			if (Math.abs(delta) <= SNAP_THRESHOLD && (!best || Math.abs(delta) < Math.abs(best.delta)))
				best = { delta, anchor };
		}
	}
	if (best) return { pos: pos + best.delta, guide: best.anchor };
	return { pos: snapToGrid(pos), guide: null };
}

/* ── Interactive bounding box drawn over the selected clip on the canvas ── */
export function ClipBox({
	layout,
	kind,
	canvasRef,
	onChange,
	onPreview,
	onActivate,
	locked,
	scale = 1,
	subject = "selected clip",
	localBox = false,
}: {
	layout: ClipLayout | undefined;
	kind: ClipKind;
	canvasRef: RefObject<HTMLElement | null>;
	onChange: (patch: Partial<ClipLayout>) => void;
	onPreview: (patch: Partial<ClipLayout> | null) => void;
	onActivate?: () => void;
	locked?: boolean;
	scale?: number;
	subject?: string;
	localBox?: boolean;
}): JSX.Element {
	const L = localBox && layout ? layout : normalizeLayout(layout, kind);
	const preview = useRef(onPreview);
	preview.current = onPreview;
	const drag = useRef<{
		mode: TransformMode;
		pointer: number;
		element: HTMLElement;
		sx: number;
		sy: number;
		box: DOMRect;
		init: ClipLayout;
		patch: Partial<ClipLayout> | null;
	} | null>(null);
	const [draft, setDraft] = useState<Partial<ClipLayout> | null>(null);
	const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({
		x: null,
		y: null,
	});
	const clear = (): void => {
		const d = drag.current;
		drag.current = null;
		if (d?.element.hasPointerCapture(d.pointer)) d.element.releasePointerCapture(d.pointer);
		preview.current(null);
		setDraft(null);
		setGuides({ x: null, y: null });
	};
	useEffect(() => {
		clear();
	}, [locked, layout]);
	useEffect(() => {
		const escape = (e: KeyboardEvent): void => {
			if (e.key === "Escape" && drag.current) {
				e.preventDefault();
				e.stopPropagation();
				clear();
			}
		};
		window.addEventListener("keydown", escape, true);
		return () => {
			window.removeEventListener("keydown", escape, true);
			const d = drag.current;
			drag.current = null;
			if (d?.element.hasPointerCapture(d.pointer)) d.element.releasePointerCapture(d.pointer);
			preview.current(null);
		};
	}, []);
	const down =
		(mode: TransformMode) =>
		(e: React.PointerEvent<HTMLElement>): void => {
			if (locked || drag.current || e.button !== 0) return;
			const box = canvasRef.current?.getBoundingClientRect();
			if (!box?.width || !box.height) return;
			e.preventDefault();
			e.stopPropagation();
			e.currentTarget.setPointerCapture(e.pointerId);
			drag.current = {
				mode,
				pointer: e.pointerId,
				element: e.currentTarget,
				sx: e.clientX,
				sy: e.clientY,
				box,
				init: L,
				patch: null,
			};
		};
	const move = (e: React.PointerEvent): void => {
		const d = drag.current;
		if (!d || d.pointer !== e.pointerId || locked) return;
		const dx = e.clientX - d.sx,
			dy = e.clientY - d.sy;
		let patch: Partial<ClipLayout>;
		if (d.mode === "move") {
			const angle = ((d.init.rotationDeg ?? 0) * Math.PI) / 180;
			const w = ((d.init.widthPct * d.box.width) / 100) * scale,
				h = (((d.init.heightPct ?? 100) * d.box.height) / 100) * scale;
			const rw =
				((Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h) / d.box.width) * 100;
			const rh =
				((Math.abs(Math.sin(angle)) * w + Math.abs(Math.cos(angle)) * h) / d.box.height) * 100;
			const rawX = d.init.xPct + (dx / d.box.width) * 100,
				rawY = d.init.yPct + (dy / d.box.height) * 100;
			const ox = (d.init.widthPct - rw) / 2,
				oy = ((d.init.heightPct ?? 100) - rh) / 2;
			const x = e.altKey ? { pos: rawX + ox, guide: null } : snapAxis(rawX + ox, rw);
			const y = e.altKey ? { pos: rawY + oy, guide: null } : snapAxis(rawY + oy, rh);
			patch = { xPct: clamp(x.pos - ox, -50, 150), yPct: clamp(y.pos - oy, -50, 150) };
			setGuides({ x: x.guide, y: y.guide });
		} else if (d.mode === "rotate") {
			const cx = d.box.left + ((d.init.xPct + d.init.widthPct / 2) / 100) * d.box.width;
			const cy = d.box.top + ((d.init.yPct + (d.init.heightPct ?? 100) / 2) / 100) * d.box.height;
			const delta = Math.atan2(e.clientY - cy, e.clientX - cx) - Math.atan2(d.sy - cy, d.sx - cx);
			let rotationDeg =
				(d.init.rotationDeg ?? 0) + (Math.atan2(Math.sin(delta), Math.cos(delta)) * 180) / Math.PI;
			if (!e.altKey) rotationDeg = Math.round(rotationDeg / 15) * 15;
			patch = { rotationDeg: ((((rotationDeg + 180) % 360) + 360) % 360) - 180 };
		} else {
			patch = resizeCanvasLayout(
				d.init,
				d.mode,
				dx,
				dy,
				{ w: d.box.width, h: d.box.height },
				Boolean(d.init.aspectLocked) || e.shiftKey,
				!e.altKey,
				scale,
			);
			const next = { ...d.init, ...patch };
			setGuides({
				x: e.altKey
					? null
					: (SNAP_ANCHORS.find(
							(a) => Math.abs(a - next.xPct) < 0.5 || Math.abs(a - next.xPct - next.widthPct) < 0.5,
						) ?? null),
				y: e.altKey
					? null
					: (SNAP_ANCHORS.find(
							(a) =>
								Math.abs(a - next.yPct) < 0.5 ||
								Math.abs(a - next.yPct - (next.heightPct ?? 100)) < 0.5,
						) ?? null),
			});
		}
		d.patch = patch;
		setDraft(patch);
		preview.current(patch);
	};
	const up = (e: React.PointerEvent): void => {
		const d = drag.current;
		if (!d || d.pointer !== e.pointerId) return;
		if (
			!locked &&
			d.patch &&
			(["xPct", "yPct", "widthPct", "heightPct", "rotationDeg"] as const).some(
				(key) => d.patch?.[key] !== undefined && L[key] !== d.patch[key],
			)
		)
			onChange(d.patch);
		clear();
	};
	const key =
		(mode: TransformMode) =>
		(e: React.KeyboardEvent): void => {
			if (locked || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
			e.preventDefault();
			e.stopPropagation();
			const delta = (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) * (e.shiftKey ? 10 : 1);
			if (mode === "rotate")
				onChange({ rotationDeg: clamp((L.rotationDeg ?? 0) + delta, -180, 180) });
			else if (mode === "move")
				onChange(
					e.key === "ArrowLeft" || e.key === "ArrowRight"
						? { xPct: clamp(L.xPct + delta, -50, 150) }
						: { yPct: clamp(L.yPct + delta, -50, 150) },
				);
			else
				onChange(
					resizeLayoutValue(
						L,
						e.key === "ArrowLeft" || e.key === "ArrowRight" ? "widthPct" : "heightPct",
						clamp(
							(e.key === "ArrowLeft" || e.key === "ArrowRight"
								? L.widthPct
								: (L.heightPct ?? 100)) + delta,
							2,
							200,
						),
					),
				);
		};
	const shown = { ...L, ...draft };
	return (
		<>
			{(guides.x != null || guides.y != null) && (
				<div className="tl2-snapguides">
					{guides.x != null && (
						<span className="tl2-snapguide v" style={{ left: `${guides.x}%` }} />
					)}
					{guides.y != null && <span className="tl2-snapguide h" style={{ top: `${guides.y}%` }} />}
				</div>
			)}
			<div
				className={`tl2-clipbox ${locked ? "locked" : ""}`}
				style={{
					left: `${shown.xPct}%`,
					top: `${shown.yPct}%`,
					width: `${shown.widthPct}%`,
					height: `${shown.heightPct ?? 100}%`,
					rotate: `${shown.rotationDeg ?? 0}deg`,
					scale,
				}}
				data-local-box={localBox || undefined}
				role="group"
				aria-label={
					locked
						? `${subject === "selected clip" ? "Selected clip" : subject}, track locked`
						: subject === "selected clip"
							? "Selected clip transform"
							: `${subject} transform`
				}
				onPointerDown={down("move")}
				onPointerMove={move}
				onPointerUp={up}
				onPointerCancel={clear}
				onLostPointerCapture={clear}
				onDoubleClick={
					!locked && onActivate
						? (e) => {
								e.stopPropagation();
								onActivate();
							}
						: undefined
				}
			>
				{!locked && (
					<>
						<button
							type="button"
							className="tl2-clipbox-move"
							aria-label={`Move ${subject}`}
							onKeyDown={key("move")}
						/>
						{(["nw", "ne", "sw", "se"] as const).map((corner) => (
							<button
								type="button"
								key={corner}
								aria-label={`Resize ${subject} ${corner}`}
								className={`tl2-clipbox-h ${corner}`}
								onPointerDown={down(corner)}
								onKeyDown={key(corner)}
							/>
						))}
						<button
							type="button"
							className="tl2-clipbox-h rotate"
							aria-label={`Rotate ${subject}`}
							onPointerDown={down("rotate")}
							onKeyDown={key("rotate")}
						>
							{Ic.regen(ICON.sm)}
						</button>
					</>
				)}
			</div>
		</>
	);
}
