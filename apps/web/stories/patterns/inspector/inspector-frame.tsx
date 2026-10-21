/* A stand-in for the inspector column, so stories render at the widths the
 * pattern actually lives at. The frame only supplies the panel surface and a
 * width; every measure inside comes from the patterns themselves.
 *
 * Widths measured in the running editor at 1440px and from the timeline
 * sheets, not chosen for the story:
 *   docked  the clip inspector's content column beside its 48px icon rail
 *   rail    `--tl2-panel-w` for the rail panels (rail.css)
 *   narrow  the compact `--tl2-panel-w` (media.css) minus the icon rail
 *   phone   the inspector as a bottom sheet at 320px */
import type { JSX, ReactNode } from "react";

export const INSPECTOR_WIDTHS = { docked: 332, rail: 312, narrow: 212, phone: 320 } as const;
export type InspectorWidth = keyof typeof INSPECTOR_WIDTHS;

export function InspectorFrame({
	width = "docked",
	children,
}: {
	width?: InspectorWidth;
	children: ReactNode;
}): JSX.Element {
	return (
		<div
			className="tw:flex tw:max-w-full tw:flex-col tw:border tw:border-border tw:bg-background"
			style={{ width: INSPECTOR_WIDTHS[width] }}
			data-inspector-width={width}
		>
			{children}
		</div>
	);
}
