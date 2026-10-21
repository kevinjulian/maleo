/* The menu family: Menu (a dropdown from a trigger) and ContextMenu (the same
 * list, opened by right-click or long-press on a region). Base UI supplies
 * keyboard navigation, typeahead, Escape and focus return; both share one popup
 * and one item recipe here, on the foundation roles — `--surface-overlay`, the
 * md radius, the overlay elevation, `--z-floating`. Popups anchored to a
 * trigger or a pointer, not panes, so neither registers with the
 * overlay stack in `@controllers/overlay`. */
import type { JSX, ReactNode } from "react";
import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { FLOATING_ATTR, useFloatingContainer } from "@hooks/ui/use-overlay.ts";
import { cn } from "@models/core/cn.ts";

const POPUP =
	"tw:min-w-56 tw:rounded-lg tw:border tw:border-[var(--border-subtle)] tw:bg-popover tw:p-1 tw:text-foreground tw:shadow-md tw:outline-none";
const ITEM =
	"tw:flex tw:w-full tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-md tw:px-2 tw:py-1.5 tw:text-sm " +
	"tw:outline-none tw:select-none tw:data-highlighted:bg-accent tw:data-disabled:pointer-events-none " +
	"tw:data-disabled:opacity-50 tw:pointer-coarse:min-h-[var(--control-h-touch)]";
const DANGER = "tw:text-destructive tw:data-highlighted:bg-destructive/10";

export interface MenuProps {
	/** What the trigger shows; the trigger itself is a button this owns. */
	trigger: ReactNode;
	/** The trigger's accessible name. */
	label: string;
	triggerClassName?: string;
	align?: "start" | "end";
	children: ReactNode;
}

export function Menu({
	trigger,
	label,
	triggerClassName,
	align = "end",
	children,
}: MenuProps): JSX.Element {
	const container = useFloatingContainer();
	return (
		<BaseMenu.Root>
			<BaseMenu.Trigger
				aria-label={label}
				title={label}
				className={cn(
					"tw:rounded-full tw:outline-none tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring",
					triggerClassName,
				)}
			>
				{trigger}
			</BaseMenu.Trigger>
			<BaseMenu.Portal container={container}>
				{/* Above the sidebar and the sticky bars, as the workspace panel is. */}
				<BaseMenu.Positioner
					{...{ [FLOATING_ATTR]: "" }}
					positionMethod="fixed"
					className="tw:z-[var(--z-floating)]"
					side="bottom"
					align={align}
					sideOffset={6}
					collisionPadding={8}
				>
					<BaseMenu.Popup className={POPUP}>{children}</BaseMenu.Popup>
				</BaseMenu.Positioner>
			</BaseMenu.Portal>
		</BaseMenu.Root>
	);
}

export interface MenuItemProps {
	icon?: ReactNode;
	onSelect: () => void;
	/** False keeps the menu open, for an item that reports its own outcome. */
	closeOnSelect?: boolean;
	disabled?: boolean;
	/** Destroys something: the item reads destructive. */
	danger?: boolean;
	children: ReactNode;
}

export function MenuItem({
	icon,
	onSelect,
	closeOnSelect = true,
	disabled,
	danger,
	children,
}: MenuItemProps): JSX.Element {
	return (
		<BaseMenu.Item
			data-slot="menu-item"
			className={cn(ITEM, danger && DANGER)}
			onClick={onSelect}
			closeOnClick={closeOnSelect}
			disabled={disabled}
		>
			{icon && (
				<span
					className={cn("tw:flex", danger ? "tw:text-destructive" : "tw:text-muted-foreground")}
				>
					{icon}
				</span>
			)}
			{children}
		</BaseMenu.Item>
	);
}

/** Non-interactive text at the top of a menu, such as who is signed in. */
export function MenuLabel({ children }: { children: ReactNode }): JSX.Element {
	return <div className="tw:flex tw:flex-col tw:gap-0.5 tw:px-2 tw:py-1.5">{children}</div>;
}

export function MenuSeparator(): JSX.Element {
	return <BaseMenu.Separator className="tw:-mx-1 tw:my-1 tw:h-px tw:bg-[var(--border-subtle)]" />;
}

export interface ContextMenuProps {
	/** The region that opens the menu on right-click or long-press. */
	children: ReactNode;
	/** The items: MenuItem, MenuLabel, MenuSeparator — the dropdown's own. */
	menu: ReactNode;
	className?: string;
}

/* A context menu is the dropdown's list opened at the pointer. The items are
 * Menu's components (Base UI's context-menu parts are its menu parts), so a
 * right-click menu cannot drift from a dropdown. It replaces three hand-rolled
 * right-click menus that each drew their own scrim and positioning. */
export function ContextMenu({ children, menu, className }: ContextMenuProps): JSX.Element {
	const container = useFloatingContainer();
	return (
		<BaseContextMenu.Root>
			<BaseContextMenu.Trigger data-slot="context-menu-trigger" className={className}>
				{children}
			</BaseContextMenu.Trigger>
			<BaseContextMenu.Portal container={container}>
				<BaseContextMenu.Positioner
					{...{ [FLOATING_ATTR]: "" }}
					positionMethod="fixed"
					className="tw:z-[var(--z-floating)]"
					collisionPadding={8}
				>
					<BaseContextMenu.Popup className={POPUP}>{menu}</BaseContextMenu.Popup>
				</BaseContextMenu.Positioner>
			</BaseContextMenu.Portal>
		</BaseContextMenu.Root>
	);
}
