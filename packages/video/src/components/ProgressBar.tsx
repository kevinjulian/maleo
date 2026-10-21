import { useCurrentFrame, useVideoConfig } from "remotion";

type Props = {
	accentColor: string;
	fgColor: string;
};

/** Retention device: a thin bar along the top edge filling with elapsed time, so
 *  the viewer always knows how much video is left. Fill tracks the composition's
 *  own duration — no per-scene wiring needed. */
export const ProgressBar: React.FC<Props> = ({ accentColor, fgColor }) => {
	const frame = useCurrentFrame();
	const { durationInFrames } = useVideoConfig();
	const pct = durationInFrames > 0 ? Math.min(1, frame / durationInFrames) : 0;
	return (
		<div
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				right: 0,
				height: 8,
				background: `${fgColor}26`,
			}}
		>
			<div
				style={{
					width: `${pct * 100}%`,
					height: "100%",
					background: accentColor,
					borderRadius: "0 999px 999px 0",
				}}
			/>
		</div>
	);
};
