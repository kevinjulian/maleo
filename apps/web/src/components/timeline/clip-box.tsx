/* The box drawn over the selection on the preview canvas, from the engine's
 * overlay (`p2-preview-editing`): its position, size, rotation and scale, the
 * resize and rotate handles, and the snap guides.
 *
 * The engine owns the geometry. Pointer input reaches it through the canvas
 * surface (`use-canvas-engine.ts`); the handles stay buttons so focus, labels
 * and the keyboard work, and their arrow keys go to the engine as nudges. */
import type { JSX } from "react";
import type { CanvasBox, CanvasHandleId, CanvasOverlay } from "@maleo/shared/editor";
import { ICON, Ic } from "@design-system/icons/index.tsx";

const CORNERS = ["nw", "ne", "sw", "se"] as const;

export function SnapGuides({ guides }: { guides: CanvasOverlay["guides"] }): JSX.Element | null {
	if (guides.x == null && guides.y == null) return null;
	return (
		<div className="tl2-snapguides">
			{guides.x != null && <span className="tl2-snapguide v" style={{ left: `${guides.x}%` }} />}
			{guides.y != null && <span className="tl2-snapguide h" style={{ top: `${guides.y}%` }} />}
		</div>
	);
}

const boxStyle = (box: CanvasBox) => ({
	left: `${box.xPct}%`,
	top: `${box.yPct}%`,
	width: `${box.widthPct}%`,
	height: `${box.heightPct}%`,
	rotate: `${box.rotationDeg}deg`,
	scale: box.scale,
});

/** A member's outline inside a group box. */
export function MemberOutline({ box }: { box: CanvasBox }): JSX.Element {
	return <div className="tl2-clipbox member" style={boxStyle(box)} aria-hidden />;
}

export function ClipBox({
	box,
	onKey,
	onActivate,
	subject = "selected clip",
}: {
	box: CanvasBox;
	onKey: (handle: CanvasHandleId, event: React.KeyboardEvent) => void;
	onActivate?: () => void;
	subject?: string;
}): JSX.Element {
	const locked = box.locked;
	const key = (handle: CanvasHandleId) => (e: React.KeyboardEvent) => {
		if (!locked) onKey(handle, e);
	};
	return (
		<div
			className={`tl2-clipbox ${locked ? "locked" : ""}`}
			style={boxStyle(box)}
			data-local-box={box.kind === "mask" || undefined}
			role="group"
			aria-label={
				locked
					? `${subject === "selected clip" ? "Selected clip" : subject}, track locked`
					: subject === "selected clip"
						? "Selected clip transform"
						: `${subject} transform`
			}
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
					{CORNERS.map((corner) => (
						<button
							type="button"
							key={corner}
							aria-label={`Resize ${subject} ${corner}`}
							className={`tl2-clipbox-h ${corner}`}
							onKeyDown={key(corner)}
						/>
					))}
					<button
						type="button"
						className="tl2-clipbox-h rotate"
						aria-label={`Rotate ${subject}`}
						onKeyDown={key("rotate")}
					>
						{Ic.regen(ICON.sm)}
					</button>
				</>
			)}
		</div>
	);
}
