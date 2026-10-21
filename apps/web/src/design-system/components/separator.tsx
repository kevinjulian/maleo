/* The separator: a quiet rule between groups that spacing alone cannot part —
 * toolbar groups, menu sections, a settings danger zone.
 *
 * `--border-subtle`, 1px, nothing else (foundations: Borders). Vertical spans
 * its row's height; horizontal its container's width. Base UI supplies the
 * role and orientation. It replaces the hand-rolled `-sep` / divider spans as
 * their surfaces migrate. */
import type { JSX } from "react";
import { Separator as BaseSeparator } from "@base-ui/react/separator";
import { cn } from "@models/core/cn.ts";

export type SeparatorProps = { orientation?: "horizontal" | "vertical"; className?: string };

export function Separator({ orientation = "horizontal", className }: SeparatorProps): JSX.Element {
	return (
		<BaseSeparator
			data-slot="separator"
			orientation={orientation}
			className={cn(
				"tw:shrink-0 tw:border-0 tw:bg-[var(--border-subtle)]",
				orientation === "vertical" ? "tw:w-px tw:self-stretch" : "tw:h-px tw:w-full",
				className,
			)}
		/>
	);
}
