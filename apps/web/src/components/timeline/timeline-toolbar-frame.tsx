/* The strip between the preview and the timeline, as one shape for all three
 * editor surfaces.
 *
 * A grid with three named tracks rather than a flex row with spacers, and that
 * is the whole point of sharing it. The studios positioned their timecode with
 * `<span style={{ flex: 1 }} />`, which makes position a function of content:
 * Motion Studio's sat further right than Template Studio's because three
 * add-layer buttons preceded it. A fixed centre track puts the transport in the
 * same place on every surface whatever the sides hold, so a near-empty leading
 * region is fine rather than a gap to fill.
 *
 * It carries the chrome too — padding, the rule beneath it, the tinted ground —
 * which the studios had none of, and which is most of why their strip read as
 * unfinished beside the editor's.
 */
import type { JSX, ReactNode } from "react";

export interface TimelineToolbarFrameProps {
	/** Edit operations: undo/redo on the main editor, add-layer in Motion Studio. */
	leading?: ReactNode;
	/** The transport. Centred by track, so it does not move with its neighbours. */
	centre?: ReactNode;
	/** View operations: zoom, and on the main editor density, gutter and the rest. */
	trailing?: ReactNode;
	className?: string;
}

export function TimelineToolbarFrame({
	leading,
	centre,
	trailing,
	className,
}: TimelineToolbarFrameProps): JSX.Element {
	return (
		<div
			className={className ? `tl2-tlbar ${className}` : "tl2-tlbar"}
			data-vui-slot="timeline-toolbar"
			role="group"
			aria-label="Timeline tools"
		>
			<div className="tl2-tlbar-l">{leading}</div>
			<div className="tl2-tlbar-c">{centre}</div>
			<div className="tl2-tlbar-r">{trailing}</div>
		</div>
	);
}
