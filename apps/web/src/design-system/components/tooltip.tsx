/* The tooltip: a short supplemental hint for a control, shown on hover AND on
 * keyboard focus.
 *
 * The app carried 217 native `title` attributes for this. A `title` never shows
 * on keyboard focus or on touch, cannot be styled, and appears after a delay the
 * browser picks. Base UI owns the timing, placement, dismissal and ARIA here;
 * this owns the look: the ink surface (`--dark` / `--dark-fg`, so it inverts
 * against whatever it floats over), Label type, the control radius, the
 * floating elevation and `--z-floating`.
 *
 * A tooltip is never the control's name. The child keeps its own `aria-label`;
 * give it a tooltip instead of a `title`, not as well as one, or the browser
 * shows both. */
import type { JSX, ReactElement, ReactNode } from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { useFloatingContainer } from "@hooks/ui/use-overlay.ts";

export type TooltipProps = {
	/** The hint. Keep it to a few words; a shortcut can follow the action. */
	label: ReactNode;
	side?: "top" | "bottom" | "left" | "right";
	/** The control the hint belongs to: one element that takes a ref and props. */
	children: ReactElement;
};

export function Tooltip({ label, side = "top", children }: TooltipProps): JSX.Element {
	const container = useFloatingContainer();
	return (
		<BaseTooltip.Root>
			<BaseTooltip.Trigger render={children} />
			<BaseTooltip.Portal container={container}>
				<BaseTooltip.Positioner
					positionMethod="fixed"
					className="tw:z-[var(--z-floating)]"
					side={side}
					sideOffset={6}
					collisionPadding={8}
				>
					<BaseTooltip.Popup
						data-slot="tooltip"
						className="tw:rounded-md tw:bg-primary tw:px-2 tw:py-1 tw:font-sans tw:text-[length:var(--type-label-size)] tw:font-medium tw:text-primary-foreground tw:shadow-[var(--shadow-1)] tw:transition-opacity tw:duration-[var(--d-fast)] tw:data-starting-style:opacity-0 tw:data-ending-style:opacity-0 tw:motion-reduce:transition-none"
					>
						{label}
					</BaseTooltip.Popup>
				</BaseTooltip.Positioner>
			</BaseTooltip.Portal>
		</BaseTooltip.Root>
	);
}
