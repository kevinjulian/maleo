/* The audio preview control.
 *
 * Replaced `<audio controls>` at every call site. Two reasons, and the second is
 * the load-bearing one: the native control looks like the browser rather than
 * like the product, and it captures pointer events — so a row containing one
 * cannot itself be dragged. Music and SFX could not be dragged onto the timeline
 * until this existed.
 *
 * No waveform. Provider support for one is uneven, and computing peaks in the
 * client means decoding the audio to draw a decoration. The question an operator
 * has here is how long it is and where they are; a scrub bar answers it. */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { cn } from "@models/core/cn.ts";
import { fmtMMSS } from "@models/core/measures.ts";
import {
	audioPreviewState,
	seekAudioPreview,
	subscribeAudioPreview,
	toggleAudioPreview,
	type AudioPreviewState,
} from "@models/audio/audio-preview-player.ts";
import { IconButton } from "./icon-button.tsx";
import { Slider } from "./slider.tsx";

export interface AudioPreviewProps {
	src?: string;
	/** The length the surface already knows, so the bar has a scale before the
	 *  file has loaded enough to report one. */
	durationSec?: number;
	className?: string;
	/** Named for the operator, since several previews can be on screen at once. */
	label?: string;
}

export function AudioPreview({
	src,
	durationSec,
	className,
	label,
}: AudioPreviewProps): JSX.Element {
	const [shared, setShared] = useState<AudioPreviewState>(audioPreviewState);
	useEffect(() => subscribeAudioPreview(setShared), []);

	// Only the sounding clip reads its position off the shared element; every
	// other control shows its own idle state rather than the current clip's.
	const current = Boolean(src) && shared.url === src;
	const playing = current && shared.playing;
	const total = (current && shared.durationSec) || durationSec || 0;
	const position = current ? Math.min(shared.positionSec, total || shared.positionSec) : 0;

	return (
		<div
			data-slot="audio-preview"
			className={cn("tw:flex tw:w-full tw:min-w-0 tw:items-center tw:gap-2", className)}
		>
			<IconButton
				size="xs"
				disabled={!src}
				aria-label={playing ? `Pause ${label ?? "preview"}` : `Play ${label ?? "preview"}`}
				onClick={() => {
					if (src) toggleAudioPreview(src, durationSec);
				}}
			>
				{playing ? Ic.pause(ICON.xs) : Ic.play(ICON.xs)}
			</IconButton>
			{/* The canonical Slider: a range input, so it keeps keyboard seeking and
			 * the pointer handling a hand-rolled track would reimplement badly. */}
			<Slider
				className="tw:flex-1"
				min={0}
				max={total > 0 ? total : 1}
				step={0.01}
				value={position}
				disabled={!src || total <= 0}
				aria-label={`Seek ${label ?? "preview"}`}
				onChange={(e) => {
					if (src) seekAudioPreview(src, Number(e.target.value));
				}}
			/>
			<span className="tw:shrink-0 tw:whitespace-nowrap tw:text-[length:var(--type-label-size)] tw:tabular-nums tw:text-muted-foreground">
				{fmtMMSS(Math.round(position))}
				{total > 0 ? ` / ${fmtMMSS(Math.round(total))}` : ""}
			</span>
		</div>
	);
}

export default AudioPreview;
