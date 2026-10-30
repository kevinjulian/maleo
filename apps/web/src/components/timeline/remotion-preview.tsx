import { clampFrameTo } from "@controllers/playback/remotion-renderer.ts";
import { Player, type PlayerRef } from "@remotion/player";
import {
	useEffect,
	useRef,
	type ComponentType,
	type CSSProperties,
	type RefObject,
	type ReactElement,
} from "react";
type PlayerInputProps = Parameters<typeof Player>[0] extends { inputProps: infer Props }
	? Props
	: object;

export interface VuiRemotionPreviewProps<T extends object> {
	component: ComponentType<T>;
	inputProps: T;
	durationInFrames: number;
	fps: number;
	compositionWidth: number;
	compositionHeight: number;
	playerRef?: RefObject<PlayerRef | null>;
	currentFrame?: number;
	loop?: boolean;
	initiallyMuted?: boolean;
	playbackRate?: number;
	clickToPlay?: boolean;
	spaceKeyToPlayOrPause?: boolean;
	playbackReady?: boolean;
	style?: CSSProperties;
	acknowledgeRemotionLicense?: boolean;
	onFrame?: (frame: number) => void;
	onPlayingChange?: (playing: boolean) => void;
}
export function VuiRemotionPreview<T extends object>({
	component,
	inputProps,
	durationInFrames,
	fps,
	compositionWidth,
	compositionHeight,
	playerRef,
	currentFrame,
	loop = false,
	initiallyMuted = false,
	playbackRate = 1,
	clickToPlay = true,
	spaceKeyToPlayOrPause = true,
	playbackReady = true,
	style,
	acknowledgeRemotionLicense = false,
	onFrame,
	onPlayingChange,
}: VuiRemotionPreviewProps<T>): ReactElement {
	const latestFrameRef = useRef<number | null>(null);
	const requestedFrameRef = useRef<number | null>(null);
	useEffect(() => {
		const player = playerRef?.current;
		if (!player) return;
		const onFrameUpdate = (event: { detail: { frame: number } }): void => {
			latestFrameRef.current = clampFrameTo(event.detail.frame, durationInFrames);
			onFrame?.(event.detail.frame);
		};
		const onPlay = (): void => onPlayingChange?.(true);
		const onPause = (): void => onPlayingChange?.(false);
		const onEnded = (): void => onPlayingChange?.(false);
		player.addEventListener("frameupdate", onFrameUpdate);
		player.addEventListener("play", onPlay);
		player.addEventListener("pause", onPause);
		player.addEventListener("ended", onEnded);
		return () => {
			player.removeEventListener("frameupdate", onFrameUpdate);
			player.removeEventListener("play", onPlay);
			player.removeEventListener("pause", onPause);
			player.removeEventListener("ended", onEnded);
		};
	}, [durationInFrames, onFrame, onPlayingChange, playerRef]);
	useEffect(() => {
		if (currentFrame == null) return;
		const player = playerRef?.current;
		if (!player) return;
		const nextFrame = clampFrameTo(currentFrame, durationInFrames);
		if (latestFrameRef.current === nextFrame || requestedFrameRef.current === nextFrame) return;
		requestedFrameRef.current = nextFrame;
		player.seekTo(nextFrame);
	}, [currentFrame, durationInFrames, playerRef]);
	// SAFETY: Player's untyped boundary accepts opaque renderer-owned props.
	// SAFETY: generic renderer props are narrowed to Remotion's component boundary here.
	return (
		<Player
			ref={playerRef}
			component={component as never}
			inputProps={inputProps as PlayerInputProps}
			durationInFrames={durationInFrames}
			fps={fps}
			compositionWidth={compositionWidth}
			compositionHeight={compositionHeight}
			controls={false}
			loop={loop}
			initiallyMuted={initiallyMuted}
			playbackRate={playbackRate}
			clickToPlay={playbackReady && clickToPlay}
			spaceKeyToPlayOrPause={playbackReady && spaceKeyToPlayOrPause}
			style={style}
			acknowledgeRemotionLicense={acknowledgeRemotionLicense}
			{...(currentFrame == null ? {} : { initialFrame: currentFrame })}
		/>
	);
}
