/* Shared range presentation and keyboard controls for every free clip. */
import type { CSSProperties, JSX, ReactNode, MouseEvent as ReactMouseEvent } from "react";
import { ClipRange, clipCapabilities } from "./clip-range.tsx";
import type { TimelineClip } from "@models/timeline/timeline-clips.ts";
import type { ContentRangeKind } from "@models/timeline/content-vui-adapter.ts";
export interface ClipGeometry {
	style: CSSProperties;
	cls: string;
	/** No room inside it for trim handles. */
	narrow: boolean;
}

interface FreeClipRangeProps {
	geometry: ClipGeometry;
	nudge: (patch: { start?: number; dur?: number; track?: number }) => void;
	clip: TimelineClip;
	kind: ContentRangeKind;
	total: number;
	pxPerSec: number;
	coarse: boolean;
	locked: boolean;
	selected: boolean;
	className: string;
	title?: string;
	/** Where the media starts inside its source, so a trim-in knows its floor. */
	mediaStartSec?: number;
	body: ReactNode;
	/** Decoration that is neither body nor handle — the delete button, the
	 *  resize badge. Rendered inside the range, after the body. */
	extra?: ReactNode;
	onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
	onDoubleClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
	onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

export function FreeClipRange({
	clip: c,
	kind,
	geometry: geom,
	nudge,
	coarse,
	locked,
	selected,
	className,
	title,
	mediaStartSec,
	body,
	extra,
	onSelect,
	onDoubleClick,
	onContextMenu,
}: FreeClipRangeProps): JSX.Element {
	const capabilities = clipCapabilities({
		kind: kind === "scene" ? "scene" : "free",
		locked,
		touchUnselected: coarse && !selected,
		tooNarrowToTrim: geom.narrow,
	});
	void mediaStartSec;
	return (
		<ClipRange
			clip={c}
			selected={selected}
			capabilities={capabilities}
			className={className}
			style={geom.style}
			title={title}
			body={body}
			extra={extra}
			/* The keyboard alternative, which the window-listener version could not
			 * offer at all. It writes straight through: the requested value is
			 * already clamped against the project and the opposite edge. */
			nudge={(patch) => {
				if (locked) return;
				nudge(patch);
			}}
			onSelect={onSelect}
			onDoubleClick={onDoubleClick}
			onContextMenu={onContextMenu}
		/>
	);
}
