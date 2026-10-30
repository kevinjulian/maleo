/* TransportControls — play or pause, and where the playhead is.
 *
 * One component for the content editor and both studios, so the control and
 * the readout are the same wherever a timeline plays. It owns no clock: the
 * surface passes the playing state and the two times it already holds, and the
 * renderer stays the only thing that advances them.
 *
 * `before` and `after` sit either side of Play inside the same group, because
 * the content editor's row is rate, jump to start, PLAY, jump to end — and a
 * transport that could only append would have reordered it.
 */
import type { JSX, ReactNode, MouseEventHandler } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { fmtTC } from "@models/timeline/timeline-editor-model.ts";
import { ToolbarGroup } from "./toolbar.tsx";

export interface TransportControlsProps {
	playing: boolean;
	onTogglePlay: MouseEventHandler<HTMLButtonElement>;
	currentSec: number;
	durationSec: number;
	/** Playback cannot start yet: nothing loaded, or the renderer is not ready. */
	disabled?: boolean;
	"aria-describedby"?: string;
	before?: ReactNode;
	after?: ReactNode;
}

export function TransportControls({
	playing,
	onTogglePlay,
	currentSec,
	durationSec,
	disabled,
	"aria-describedby": describedBy,
	before,
	after,
}: TransportControlsProps): JSX.Element {
	return (
		<>
			<ToolbarGroup label="Transport">
				{before}
				{/* Named for what a press does, not for the glyph. Ink rather than the
				    quiet icon tone: it is the one control the strip exists for. */}
				<IconButton
					size="sm"
					data-transport="play"
					aria-label={playing ? "Pause" : "Play"}
					title={playing ? "Pause (Space / K)" : "Play (Space / K)"}
					disabled={disabled}
					aria-describedby={describedBy}
					className="tw:rounded-full! tw:text-foreground!"
					onClickCapture={onTogglePlay}
				>
					{playing ? Ic.pause(ICON.md) : Ic.play(ICON.md)}
				</IconButton>
				{after}
			</ToolbarGroup>
			{/* A fixed minimum so the strip does not shift as digits change width. */}
			<span
				data-transport="timecode"
				className="tw:min-w-[132px] tw:whitespace-nowrap tw:text-[length:var(--type-body-size)] tw:font-semibold tw:tracking-[0.02em] tw:tabular-nums tw:text-foreground"
			>
				{fmtTC(currentSec)}
				<span className="tw:font-normal tw:text-muted-foreground"> / {fmtTC(durationSec)}</span>
			</span>
		</>
	);
}
