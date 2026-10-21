/* Progress: work with a measurable amount, or (value null) a known task whose
 * amount is not yet known.
 *
 * Base UI owns the progressbar semantics; this owns the look: a 4px track in
 * `--surface-strong`, the value in the accent, full radius. Indeterminate runs
 * a short sweep (progress.css) that reduced motion holds still. `label` names
 * it for assistive tech and, unless `hideLabel`, shows it above the bar with
 * the percentage. */
import type { JSX } from "react";
import { Progress as BaseProgress } from "@base-ui/react/progress";
import { cn } from "@models/core/cn.ts";
import "./progress.css";

export type ProgressProps = {
	value: number | null;
	label: string;
	hideLabel?: boolean;
	className?: string;
};

export function Progress({
	value,
	label,
	hideLabel = false,
	className,
}: ProgressProps): JSX.Element {
	return (
		<BaseProgress.Root
			data-slot="progress"
			value={value}
			aria-label={label}
			className={cn("tw:flex tw:w-full tw:flex-col tw:gap-1", className)}
		>
			{!hideLabel && (
				<div className="tw:flex tw:items-baseline tw:justify-between tw:gap-2 tw:text-[length:var(--type-label-size)] tw:text-[var(--fg-dim)]">
					<BaseProgress.Label>{label}</BaseProgress.Label>
					{value !== null && <BaseProgress.Value />}
				</div>
			)}
			<BaseProgress.Track className="tw:relative tw:h-1 tw:w-full tw:overflow-hidden tw:rounded-full tw:bg-[var(--surface-strong)]">
				<BaseProgress.Indicator
					className={cn(
						"tw:block tw:h-full tw:rounded-full tw:bg-ai tw:transition-[width] tw:duration-[var(--d-med)]",
						value === null && "ui-progress-sweep",
					)}
				/>
			</BaseProgress.Track>
		</BaseProgress.Root>
	);
}
