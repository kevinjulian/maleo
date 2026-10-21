import type { JSX } from "react";
import { VideoPlayer as Player, CompatVideoSkin, Video } from "@videojs/react/video";
import "./video-player.css";

export interface VideoPlayerProps {
	src: string;
	poster?: string;
	title: string;
	onError?: () => void;
}

/** Stored media playback; the owning overlay retains navigation and dismissal. */
export function VideoPlayer({ src, poster, title, onError }: VideoPlayerProps): JSX.Element {
	return (
		<Player key={src} title={title} poster={poster}>
			<CompatVideoSkin className="ui-video-player">
				<Video
					src={src}
					poster={poster}
					aria-label={title}
					playsInline
					preload="metadata"
					onError={onError}
				/>
			</CompatVideoSkin>
		</Player>
	);
}
