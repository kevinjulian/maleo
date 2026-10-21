import { spring, useCurrentFrame, useVideoConfig } from "remotion";

type Props = {
	price: string;
	currency: string;
	accentColor: string;
	delay?: number;
};

export const PriceTag: React.FC<Props> = ({ price, currency, accentColor, delay = 0 }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const local = Math.max(0, frame - delay);
	const s = spring({ frame: local, fps, config: { damping: 12, stiffness: 180 } });

	return (
		<div
			style={{
				display: "inline-flex",
				alignItems: "baseline",
				gap: 8,
				padding: "14px 24px",
				background: accentColor,
				color: "#0B0B0F",
				borderRadius: 999,
				fontWeight: 900,
				fontFamily: "Inter, system-ui, sans-serif",
				scale: s,
				boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
			}}
		>
			<span style={{ fontSize: 28, opacity: 0.7 }}>{currency}</span>
			<span style={{ fontSize: 56 }}>{price}</span>
		</div>
	);
};
