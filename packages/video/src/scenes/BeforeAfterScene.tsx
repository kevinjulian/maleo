import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { AnimatedText } from "../components/AnimatedText";
import type { Product } from "../schema";

type Props = { product: Product; durationInFrames: number };

export const BeforeAfterScene: React.FC<Props> = ({ product, durationInFrames }) => {
	const frame = useCurrentFrame();
	const a = product.images[0]!;
	const b = product.images[1] ?? a;
	const wipe = interpolate(frame, [0, durationInFrames], [0, 100], {
		extrapolateRight: "clamp",
	});

	return (
		<AbsoluteFill style={{ background: product.bgColor }}>
			<Img
				src={b}
				style={{
					width: "100%",
					height: "100%",
					objectFit: "cover",
					position: "absolute",
					inset: 0,
				}}
			/>
			<div
				style={{
					position: "absolute",
					inset: 0,
					width: `${wipe}%`,
					overflow: "hidden",
				}}
			>
				<Img src={a} style={{ width: "100vw", height: "100%", objectFit: "cover" }} />
			</div>
			<div
				style={{
					position: "absolute",
					top: 0,
					bottom: 0,
					left: `${wipe}%`,
					width: 6,
					background: product.accentColor,
					boxShadow: `0 0 24px ${product.accentColor}`,
				}}
			/>
			<AbsoluteFill style={{ padding: 80, justifyContent: "flex-end" }}>
				<AnimatedText text={product.title} size={88} color={product.fgColor} delay={6} />
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
