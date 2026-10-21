import { Img, useCurrentFrame } from "remotion";
import { evalMotion, fromLegacy, type KeyframeMotion } from "../lib/motion-keyframes";

type Props = {
	src: string;
	durationInFrames: number;
	from?: { scale: number; x: number; y: number };
	to?: { scale: number; x: number; y: number };
	/** Custom keyframe motion. Overrides from/to when present. */
	motion?: KeyframeMotion | null;
};

export const KenBurnsImage: React.FC<Props> = ({
	src,
	durationInFrames,
	from = { scale: 1.0, x: 0, y: 0 },
	to = { scale: 1.18, x: -30, y: -20 },
	motion,
}) => {
	const frame = useCurrentFrame();
	const keyframes = motion ?? fromLegacy({ from, to });
	const progress = durationInFrames > 0 ? frame / durationInFrames : 1;
	const { scale, x, y, rotate } = evalMotion(keyframes, progress);

	return (
		<div
			style={{ width: "100%", height: "100%", overflow: "hidden", position: "absolute", inset: 0 }}
		>
			<Img
				src={src}
				style={{
					width: "100%",
					height: "100%",
					objectFit: "cover",
					scale,
					translate: `${x}px ${y}px`,
					rotate: rotate ? `${rotate}deg` : undefined,
					transformOrigin: "center",
				}}
			/>
		</div>
	);
};
