/* The spinner: work in progress with no measurable amount.
 *
 * The registry's loader glyph, turned (spinner.css). Decorative by default —
 * it usually sits beside text that already says what is happening; give it a
 * `label` when it stands alone and it becomes a polite status. Sizes are the
 * icon scale. It replaces four hand-drawn spinners (`.cv-spin`, two `.spinner`
 * rules and the image-lab one) as their surfaces migrate. */
import type { JSX } from "react";
import { ICON, Ic, type IconSize } from "@design-system/icons/index.tsx";
import { cn } from "@models/core/cn.ts";
import "./spinner.css";

export type SpinnerProps = { size?: IconSize; label?: string; className?: string };

export function Spinner({ size = "sm", label, className }: SpinnerProps): JSX.Element {
	const glyph = (
		<span data-slot="spinner" aria-hidden="true" className={cn("ui-spinner", className)}>
			{Ic.loader(ICON[size])}
		</span>
	);
	return label ? (
		<span role="status" aria-label={label} className="tw:inline-flex">
			{glyph}
		</span>
	) : (
		glyph
	);
}
