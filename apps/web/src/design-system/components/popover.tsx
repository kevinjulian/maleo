/* The popover: an anchored floating surface for a small task — a picker, a
 * short form, a preview — that closes when the task is done or abandoned.
 *
 * Base UI owns placement, focus, dismissal (Escape, outside press) and ARIA.
 * This file owns how it looks, on the foundation roles: `--surface-overlay`,
 * the md radius, the overlay elevation, a subtle border, `--z-floating`, and a
 * fast fade-and-scale entrance that reduced motion skips. Callers add only
 * their own size limits. It lived in components/timeline/ with its look in a
 * timeline sheet; it moved here when the second kind of popover needed it.
 */
import type { ComponentProps, JSX, ReactElement } from "react";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { FLOATING_ATTR, useFloatingContainer } from "@hooks/ui/use-overlay.ts";
import { cn } from "@models/core/cn.ts";

const SURFACE =
	"tw:max-h-[70vh] tw:overflow-auto tw:rounded-lg tw:border tw:border-[var(--border-subtle)] tw:bg-popover tw:p-3 tw:text-foreground tw:shadow-md tw:outline-none tw:transition-[opacity,transform] tw:duration-[var(--d-fast)] tw:ease-[var(--ease-out)] tw:data-starting-style:scale-95 tw:data-starting-style:opacity-0 tw:data-ending-style:opacity-0 tw:motion-reduce:transition-none";

function Popover(props: ComponentProps<typeof BasePopover.Root>): JSX.Element {
	return <BasePopover.Root {...props} />;
}

function PopoverTrigger({
	asChild,
	children,
	...props
}: Omit<ComponentProps<typeof BasePopover.Trigger>, "render"> & {
	asChild?: boolean;
	children: ReactElement;
}): JSX.Element {
	return (
		<BasePopover.Trigger
			data-slot="popover-trigger"
			render={asChild ? children : undefined}
			{...props}
		>
			{asChild ? undefined : children}
		</BasePopover.Trigger>
	);
}

type PositionProps = Pick<
	ComponentProps<typeof BasePopover.Positioner>,
	"align" | "side" | "sideOffset"
>;
type ContentProps = Omit<ComponentProps<typeof BasePopover.Popup>, "className"> &
	PositionProps & { className?: string };

function PopoverContent({
	className,
	align = "center",
	sideOffset = 4,
	side,
	...props
}: ContentProps): JSX.Element {
	const container = useFloatingContainer();
	return (
		<BasePopover.Portal container={container}>
			<BasePopover.Positioner
				{...{ [FLOATING_ATTR]: "" }}
				positionMethod="fixed"
				className="tw:z-[var(--z-floating)]"
				align={align}
				side={side}
				sideOffset={sideOffset}
				collisionPadding={8}
			>
				<BasePopover.Popup
					data-slot="popover-content"
					className={cn(SURFACE, className)}
					{...props}
				/>
			</BasePopover.Positioner>
		</BasePopover.Portal>
	);
}

function PopoverHeader({ className, ...props }: ComponentProps<"div">): JSX.Element {
	return (
		<div
			data-slot="popover-header"
			className={cn("tw:mb-2 tw:flex tw:items-center tw:gap-2", className)}
			{...props}
		/>
	);
}

/* The Section title role. */
function PopoverTitle({ className, ...props }: ComponentProps<"div">): JSX.Element {
	return (
		<div
			data-slot="popover-title"
			className={cn("tw:text-[length:var(--type-caption-size)] tw:font-semibold", className)}
			{...props}
		/>
	);
}

export { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle };
