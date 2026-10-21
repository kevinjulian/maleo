import { AbsoluteFill } from "remotion";
import { KenBurnsImage } from "../components/KenBurnsImage";
import { AnimatedText } from "../components/AnimatedText";
import type { Product } from "../schema";

type Props = { product: Product; durationInFrames: number; imageIndex: number };

export const FeatureScene: React.FC<Props> = ({ product, durationInFrames, imageIndex }) => {
	const src = product.images[imageIndex % product.images.length]!;
	return (
		<AbsoluteFill style={{ background: product.bgColor }}>
			<KenBurnsImage
				src={src}
				durationInFrames={durationInFrames}
				from={{ scale: 1.15, x: 20, y: 10 }}
				to={{ scale: 1.0, x: 0, y: 0 }}
			/>
			<AbsoluteFill
				style={{
					background: "linear-gradient(0deg, rgba(0,0,0,0.0) 50%, rgba(0,0,0,0.75) 100%)",
				}}
			/>
			<AbsoluteFill style={{ padding: 80, gap: 24 }}>
				{product.bullets.map((b, i) => (
					<div key={i} style={{ display: "flex", alignItems: "center", gap: 16 }}>
						<div
							style={{
								width: 14,
								height: 14,
								borderRadius: 999,
								background: product.accentColor,
								boxShadow: `0 0 24px ${product.accentColor}`,
							}}
						/>
						<AnimatedText
							text={b}
							size={48}
							color={product.fgColor}
							weight={600}
							delay={4 + i * 10}
						/>
					</div>
				))}
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
