import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

type Props = {
	text: string;
	delay?: number;
	size?: number;
	color?: string;
	weight?: number;
	letterSpacing?: number;
};

export const AnimatedText: React.FC<Props> = ({
	text,
	delay = 0,
	size = 64,
	color = "#fff",
	weight = 800,
	letterSpacing = -1,
}) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const local = Math.max(0, frame - delay);
	const s = spring({ frame: local, fps, config: { damping: 18, stiffness: 120 } });
	const y = interpolate(s, [0, 1], [40, 0]);
	const opacity = interpolate(s, [0, 1], [0, 1]);

	return (
		<div
			style={{
				fontSize: size,
				fontWeight: weight,
				color,
				letterSpacing,
				lineHeight: 1.05,
				translate: `0 ${y}px`,
				opacity,
				fontFamily: "Inter, system-ui, -apple-system, sans-serif",
			}}
		>
			{text}
		</div>
	);
};
