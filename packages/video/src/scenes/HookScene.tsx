import { AbsoluteFill } from "remotion";
import { KenBurnsImage } from "../components/KenBurnsImage";
import { AnimatedText } from "../components/AnimatedText";
import type { Product } from "../schema";

type Props = { product: Product; durationInFrames: number };

export const HookScene: React.FC<Props> = ({ product, durationInFrames }) => {
	return (
		<AbsoluteFill style={{ background: product.bgColor }}>
			<KenBurnsImage src={product.images[0]!} durationInFrames={durationInFrames} />
			<AbsoluteFill
				style={{
					background:
						"linear-gradient(180deg, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0.85) 100%)",
				}}
			/>
			<AbsoluteFill
				style={{ padding: 80, justifyContent: "flex-end", alignItems: "flex-start", gap: 16 }}
			>
				<AnimatedText
					text={product.brand.toUpperCase()}
					size={36}
					color={product.accentColor}
					letterSpacing={6}
					weight={700}
					delay={2}
				/>
				<AnimatedText text={product.title} size={96} color={product.fgColor} delay={8} />
				{product.subtitle ? (
					<AnimatedText
						text={product.subtitle}
						size={44}
						color={product.fgColor}
						weight={500}
						delay={16}
					/>
				) : null}
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
