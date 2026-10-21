/* Toggles: a pressed state on a button.
 *
 *   ToggleGroup + ToggleGroupItem  a segmented single choice — fit, align,
 *                                  a filter scope. Exactly one stays pressed.
 *   Toggle                         one on/off flag beside other actions —
 *                                  Reverse, Snap, Loop.
 *
 * Base UI owns pressed state, roving focus inside the group and the ARIA
 * (`aria-pressed`, a labelled `group`). This owns the look: pressed is the
 * selection role from foundations (accent wash and ink), the same as IconButton
 * and ChipButton `on`, so "selected" reads one way across the app. They replace
 * the hand-pressed `cv-chip ... active` fit and align buttons, the `.active`
 * outline on Buttons, and the hand-rolled `aria-pressed` filter rows as those
 * surfaces migrate. */
import { createContext, useContext } from "react";
import type { JSX, ReactNode } from "react";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { cn } from "@models/core/cn.ts";

export type ToggleSize = "xs" | "sm";

const SIZE: Record<ToggleSize, string> = {
	xs: "tw:min-h-[var(--control-h-xs)] tw:px-2",
	sm: "tw:min-h-[var(--control-h-sm)] tw:px-3",
};
const ITEM =
	"tw:inline-flex tw:items-center tw:justify-center tw:gap-1 tw:rounded-md tw:border tw:border-transparent tw:font-sans tw:text-xs tw:font-medium tw:whitespace-nowrap tw:text-muted-foreground tw:cursor-pointer tw:transition-colors tw:hover:text-foreground tw:hover:bg-accent tw:active:bg-pressed tw:data-pressed:bg-[var(--ai-bg)] tw:data-pressed:text-ai tw:focus-visible:outline-2 tw:focus-visible:-outline-offset-2 tw:focus-visible:outline-ring tw:data-disabled:cursor-not-allowed tw:data-disabled:opacity-50 tw:pointer-coarse:min-h-[var(--control-h-touch)]";

export type ToggleGroupProps<T extends string> = {
	value: T;
	onValueChange: (value: T) => void;
	"aria-label": string;
	size?: ToggleSize;
	layout?: "segmented" | "tiles";
	disabled?: boolean;
	className?: string;
	children: ReactNode;
};

/* Base UI's group holds an array; a segmented choice holds one value and never
 * none, so pressing the pressed item again keeps it. */
export function ToggleGroup<T extends string>({
	value,
	onValueChange,
	size = "xs",
	layout = "segmented",
	disabled,
	className,
	children,
	...rest
}: ToggleGroupProps<T>): JSX.Element {
	return (
		<BaseToggleGroup
			data-slot="toggle-group"
			data-size={size}
			value={[value]}
			onValueChange={(next) => {
				const picked = next.find((v) => v !== value) ?? next[0];
				if (picked === undefined || picked === value) return;
				// SAFETY: Base UI only reports values its items carry, and every item is a ToggleGroupItem the caller rendered from its own `T` options.
				onValueChange(picked as T);
			}}
			disabled={disabled}
			className={cn(
				layout === "tiles"
					? "tw:grid tw:grid-cols-2 tw:gap-2"
					: "tw:inline-flex tw:items-center tw:gap-0.5 tw:rounded-md tw:bg-secondary tw:p-0.5",
				className,
			)}
			{...rest}
		>
			<ToggleGroupContext.Provider value={{ size, layout }}>{children}</ToggleGroupContext.Provider>
		</BaseToggleGroup>
	);
}

/* Items read the group's size without every call site repeating it. */
const ToggleGroupContext = createContext<{ size: ToggleSize; layout: "segmented" | "tiles" }>({
	size: "xs",
	layout: "segmented",
});

export function ToggleGroupItem({
	value,
	disabled,
	className,
	children,
}: {
	value: string;
	disabled?: boolean;
	className?: string;
	children: ReactNode;
}): JSX.Element {
	const { size, layout } = useContext(ToggleGroupContext);
	return (
		<BaseToggle
			data-slot="toggle-group-item"
			value={value}
			disabled={disabled}
			className={cn(ITEM, SIZE[size], layout === "tiles" && "tw:bg-secondary tw:py-2", className)}
		>
			{children}
		</BaseToggle>
	);
}

export type ToggleProps = {
	pressed: boolean;
	onPressedChange: (pressed: boolean) => void;
	size?: ToggleSize;
	disabled?: boolean;
	className?: string;
	"aria-label"?: string;
	title?: string;
	children: ReactNode;
};

/* A lone toggle stands among other buttons, so it carries a border at rest
 * where a group item relies on the group's track. */
export function Toggle({
	pressed,
	onPressedChange,
	size = "xs",
	className,
	children,
	...rest
}: ToggleProps): JSX.Element {
	return (
		<BaseToggle
			data-slot="toggle"
			pressed={pressed}
			onPressedChange={(next) => onPressedChange(next)}
			className={cn(
				ITEM,
				SIZE[size],
				"tw:border-border tw:data-pressed:border-ai-border",
				className,
			)}
			{...rest}
		>
			{children}
		</BaseToggle>
	);
}
