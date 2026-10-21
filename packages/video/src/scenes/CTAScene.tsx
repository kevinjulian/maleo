import { AbsoluteFill } from "remotion";
import { KenBurnsImage } from "../components/KenBurnsImage";
import { AnimatedText } from "../components/AnimatedText";
import { PriceTag } from "../components/PriceTag";
import type { Product } from "../schema";

type Props = { product: Product; durationInFrames: number };

export const CTAScene: React.FC<Props> = ({ product, durationInFrames }) => {
	const last = product.images[product.images.length - 1]!;
	return (
		<AbsoluteFill style={{ background: product.bgColor }}>
			<KenBurnsImage src={last} durationInFrames={durationInFrames} />
			<AbsoluteFill style={{ background: "rgba(0,0,0,0.55)" }} />
			<AbsoluteFill
				style={{
					padding: 80,
					justifyContent: "center",
					alignItems: "center",
					gap: 32,
					textAlign: "center",
				}}
			>
				<AnimatedText text={product.cta} size={120} color={product.fgColor} delay={2} />
				{product.price ? (
					<div style={{ marginTop: 12 }}>
						<PriceTag
							price={product.price}
							currency={product.currency}
							accentColor={product.accentColor}
							delay={14}
						/>
					</div>
				) : null}
				<AnimatedText
					text={`@${product.brand.toLowerCase()}`}
					size={36}
					color={product.fgColor}
					weight={500}
					letterSpacing={2}
					delay={24}
				/>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
