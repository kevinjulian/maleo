import type { ReactNode } from "react";
import { useVideoConfig } from "remotion";
import { clipMaskImage, type ClipCompositing } from "@maleo/shared";

/** Color changes cropped source pixels; the local mask then clips those pixels. */
export function ClipCompositingFrame({
	layout,
	children,
}: {
	layout?: ClipCompositing & { widthPct?: number; heightPct?: number | null };
	children: ReactNode;
}) {
	const { width, height } = useVideoConfig();
	const color = layout?.color;
	const corrected =
		color && Object.values(color).some((v) => v !== 1) ? (
			<div
				style={{
					position: "absolute",
					inset: 0,
					filter: `brightness(${color.brightness}) contrast(${color.contrast}) saturate(${color.saturation})`,
				}}
			>
				{children}
			</div>
		) : (
			children
		);
	if (!layout?.mask) return <>{corrected}</>;
	const maskImage = clipMaskImage(
		layout.mask,
		(width * (layout.widthPct ?? 100)) / 100,
		(height * (layout.heightPct ?? 100)) / 100,
	);
	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				maskImage,
				maskMode: "luminance",
				maskSize: "100% 100%",
				maskRepeat: "no-repeat",
			}}
		>
			{corrected}
		</div>
	);
}
