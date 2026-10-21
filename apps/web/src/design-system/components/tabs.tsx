/* Tabs: a set of views of one thing, one shown at a time.
 *
 * Base UI owns the tablist semantics: roving focus, arrow keys, Home and End,
 * and the tab-to-panel association when panels are rendered inside the root.
 * This owns the look, in three list variants:
 *
 *   outline    separate bordered tabs; the default, for tabs inside a page
 *   segmented  one track holding its tabs, for a mode switch in chrome
 *
 *   bar        text tabs sharing a baseline, with an accent underline
 *
 * Selected uses accent ink; filled variants add the selection wash, while bar
 * tabs underline the selected label.
 *
 * `activateOnFocus` is on by default (arrowing selects). Pass
 * `activateOnFocus={false}` on the list where switching is expensive, so the
 * arrows move focus and Enter or Space selects.
 */
import { createContext, useContext } from "react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { cn } from "@models/core/cn.ts";

export type TabsVariant = "outline" | "segmented" | "bar";

type RootProps = Omit<BaseTabs.Root.Props, "className"> & { className?: string };
type ListProps = Omit<BaseTabs.List.Props, "className"> & {
	className?: string;
	variant?: TabsVariant;
};
type TabProps = Omit<BaseTabs.Tab.Props, "className"> & { className?: string };
type PanelProps = Omit<BaseTabs.Panel.Props, "className"> & { className?: string };

const VariantContext = createContext<TabsVariant>("outline");

const LIST: Record<TabsVariant, string> = {
	outline: "tw:gap-1",
	bar: "tw:w-full tw:gap-0 tw:border-b tw:border-border tw:overflow-x-auto",
	segmented: "tw:gap-0.5 tw:rounded-md tw:bg-secondary tw:p-0.5",
};
const TAB =
	"tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center tw:gap-1 tw:font-sans tw:text-xs tw:whitespace-nowrap tw:cursor-pointer tw:transition-colors tw:aria-selected:text-ai tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring tw:data-disabled:cursor-not-allowed tw:data-disabled:opacity-50 tw:pointer-coarse:min-h-[var(--control-h-touch)]";
const FILLED_TAB =
	"tw:rounded-md tw:border tw:active:bg-pressed tw:aria-selected:bg-[var(--ai-bg)]";
const TAB_VARIANT: Record<TabsVariant, string> = {
	bar: "tw:min-h-[var(--control-h-sm)] tw:border-0 tw:border-b-2 tw:border-transparent tw:bg-transparent tw:px-2.5 tw:text-muted-foreground tw:hover:text-foreground tw:aria-selected:border-ai tw:pointer-coarse:min-w-[var(--control-h-touch)]",
	outline:
		"tw:min-h-[var(--control-h-sm)] tw:border-input tw:bg-background tw:px-2.5 tw:text-foreground tw:hover:bg-accent tw:aria-selected:border-ai-border",
	segmented:
		"tw:min-h-[var(--control-h-xs)] tw:border-transparent tw:bg-transparent tw:px-2.5 tw:font-medium tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-foreground",
};

export function TabsRoot({ className, ...props }: RootProps): React.JSX.Element {
	return <BaseTabs.Root data-slot="tabs" className={cn("tw:min-w-0", className)} {...props} />;
}

export function TabsList({
	className,
	variant = "outline",
	...props
}: ListProps): React.JSX.Element {
	return (
		<VariantContext.Provider value={variant}>
			<BaseTabs.List
				activateOnFocus
				data-slot="tabs-list"
				data-variant={variant}
				className={cn("tw:inline-flex tw:items-center", LIST[variant], className)}
				{...props}
			/>
		</VariantContext.Provider>
	);
}

export function TabsTab({ className, ...props }: TabProps): React.JSX.Element {
	const variant = useContext(VariantContext);
	return (
		<BaseTabs.Tab
			data-slot="tabs-tab"
			className={cn(TAB, variant !== "bar" && FILLED_TAB, TAB_VARIANT[variant], className)}
			{...props}
		/>
	);
}

export function TabsPanel({ className, ...props }: PanelProps): React.JSX.Element {
	return (
		<BaseTabs.Panel
			data-slot="tabs-panel"
			className={cn(
				"tw:min-w-0 tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring",
				className,
			)}
			{...props}
		/>
	);
}
