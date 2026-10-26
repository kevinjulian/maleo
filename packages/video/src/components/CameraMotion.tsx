import { Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { evalMotion, fromLegacy, type KeyframeMotion } from "../lib/motion-keyframes";
import { resolveMotion } from "../lib/motion-presets";

// Local prepped images arrive as public-relative paths (e.g. "images/x.jpg").
// Wrap those with staticFile so Remotion serves them; pass URLs/data through.
function resolveSrc(src: string): string {
	return /^(https?:|data:|blob:|file:)/.test(src) ? src : staticFile(src);
}

type Props = {
	src: string;
	durationInFrames: number;
	movement?: string;
	/** Custom keyframe motion. Overrides `movement` when present. */
	motion?: KeyframeMotion | null;
	/** Zoom/pan anchor (percent of the image) — defaults to center. */
	focalPoint?: { xPct: number; yPct: number } | null;
};

export function glitchOffset(frame: number, fps: number) {
	const sec = frame / fps;
	const burst = Math.sin(sec * 47) > 0.85;
	if (!burst) return { x: 0, y: 0, opacity: 1 };
	const seed = Math.floor(frame * 7.3);
	const x = ((seed * 13) % 17) - 8;
	const y = ((seed * 7) % 11) - 5;
	const opacity = (seed * 3) % 5 > 1 ? 0.7 : 1;
	return { x, y, opacity };
}

export const CameraMotion: React.FC<Props> = ({
	src,
	durationInFrames,
	movement,
	motion,
	focalPoint,
}) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const keyframes = motion ?? fromLegacy(resolveMotion(movement));
	const progress = durationInFrames > 0 ? frame / durationInFrames : 1;
	const { scale, x, y, rotate } = evalMotion(keyframes, progress);
	const isGlitch =
		movement === "Glitch" || movement === "Glitch / Flicker" || movement === "glitch";

	const glitch = isGlitch ? glitchOffset(frame, fps) : { x: 0, y: 0, opacity: 1 };

	return (
		<div
			style={{
				width: "100%",
				height: "100%",
				overflow: "hidden",
				position: "absolute",
				inset: 0,
			}}
		>
			<Img
				src={resolveSrc(src)}
				style={{
					width: "100%",
					height: "100%",
					objectFit: "cover",
					scale,
					translate: `${x + glitch.x}px ${y + glitch.y}px`,
					rotate: rotate ? `${rotate}deg` : undefined,
					transformOrigin: focalPoint ? `${focalPoint.xPct}% ${focalPoint.yPct}%` : "center",
					opacity: glitch.opacity,
				}}
			/>
		</div>
	);
};
