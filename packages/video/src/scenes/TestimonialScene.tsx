import { AbsoluteFill } from "remotion";
import { KenBurnsImage } from "../components/KenBurnsImage";
import { AnimatedText } from "../components/AnimatedText";
import type { Product } from "../schema";

type Props = { product: Product; durationInFrames: number; quote?: string; author?: string };

export const TestimonialScene: React.FC<Props> = ({ product, durationInFrames, quote, author }) => {
	const text = quote ?? product.bullets[0] ?? product.subtitle ?? product.title;
	const by = author ?? `@${product.brand.toLowerCase()}_fan`;
	return (
		<AbsoluteFill style={{ background: product.bgColor }}>
			<KenBurnsImage src={product.images[0]!} durationInFrames={durationInFrames} />
			<AbsoluteFill style={{ background: "rgba(0,0,0,0.55)" }} />
			<AbsoluteFill style={{ padding: 100, justifyContent: "center", gap: 48 }}>
				<div
					style={{
						fontSize: 160,
						color: product.accentColor,
						fontFamily: "Georgia, serif",
						lineHeight: 0.8,
					}}
				>
					“
				</div>
				<AnimatedText text={text} size={68} color={product.fgColor} weight={700} delay={4} />
				<AnimatedText
					text={`— ${by}`}
					size={40}
					color={product.accentColor}
					weight={500}
					delay={28}
				/>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
