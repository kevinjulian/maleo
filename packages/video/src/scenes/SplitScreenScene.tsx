import { AbsoluteFill } from "remotion";
import { KenBurnsImage } from "../components/KenBurnsImage";
import { AnimatedText } from "../components/AnimatedText";
import type { Product } from "../schema";

type Props = { product: Product; durationInFrames: number };

export const SplitScreenScene: React.FC<Props> = ({ product, durationInFrames }) => {
	const a = product.images[0]!;
	const b = product.images[1] ?? a;
	return (
		<AbsoluteFill style={{ background: product.bgColor, flexDirection: "column" }}>
			<div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
				<KenBurnsImage src={a} durationInFrames={durationInFrames} />
				<AbsoluteFill
					style={{
						justifyContent: "flex-end",
						padding: 48,
						background: "linear-gradient(0deg, rgba(0,0,0,0.7), transparent 60%)",
					}}
				>
					<AnimatedText text="BEFORE" size={56} color={product.fgColor} delay={4} />
				</AbsoluteFill>
			</div>
			<div
				style={{
					height: 6,
					background: product.accentColor,
					boxShadow: `0 0 24px ${product.accentColor}`,
				}}
			/>
			<div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
				<KenBurnsImage
					src={b}
					durationInFrames={durationInFrames}
					from={{ scale: 1.18, x: 20, y: 0 }}
					to={{ scale: 1.0, x: -20, y: 0 }}
				/>
				<AbsoluteFill
					style={{
						justifyContent: "flex-start",
						padding: 48,
						background: "linear-gradient(180deg, rgba(0,0,0,0.7), transparent 60%)",
					}}
				>
					<AnimatedText text="AFTER" size={56} color={product.accentColor} delay={20} />
				</AbsoluteFill>
			</div>
		</AbsoluteFill>
	);
};
