/* Shimmer overlay, shown while a frame is generating. */
import type { JSX } from "react";
import "./shimmer.css";

interface ShimmerProps {
	radius?: string;
}

/* Shimmer overlay (generating) */
export function Shimmer({ radius = "var(--r-2)" }: ShimmerProps): JSX.Element {
	return (
		<div
			className="cv-shimmer"
			style={{ position: "absolute", inset: 0, borderRadius: radius, zIndex: 3 }}
		/>
	);
}
