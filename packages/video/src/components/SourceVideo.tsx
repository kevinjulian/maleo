import { heldVideoFrame } from "@maleo/shared";
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
	const [held, frozen] = heldVideoFrame(sourceDurationSec, props.playbackRate ?? 1, fps, frame);
	return (
		<Freeze frame={held} active={frozen}>
			<OffthreadVideo {...props} muted={props.muted || frozen} />
		</Freeze>
	);
}
