import { Freeze, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import type { ComponentProps } from "react";

export const VIDEO_PREMOUNT_SEC = 2;

export function videoPremountFrames(fps: number): number {
	return Math.round(VIDEO_PREMOUNT_SEC * fps);
}

/** Hold selected source endpoint through narration/transition gaps, without sound. */
export function SourceVideo({
	sourceDurationSec,
	...props
}: ComponentProps<typeof OffthreadVideo> & { sourceDurationSec?: number }) {
	const frame = useCurrentFrame(),
		{ fps } = useVideoConfig();
	if (sourceDurationSec == null) return <OffthreadVideo {...props} />;
	// Leave one decoded source frame inside the exclusive endpoint at slow rates.
	const end = Math.max(
		0,
		Math.floor(sourceDurationSec * fps - Math.max(1, 1 / (props.playbackRate ?? 1))),
	);
	return (
		<Freeze frame={end} active={frame > end}>
			<OffthreadVideo {...props} muted={props.muted || frame > end} />
		</Freeze>
	);
}
