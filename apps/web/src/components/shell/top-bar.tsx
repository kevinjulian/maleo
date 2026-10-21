import { Topbar, TopbarActions } from "@design-system/patterns/topbar.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
/* The slim bar every non-editor shell shares: sidebar toggle, where you are,
 * search, credits, theme, and who you are. One component for both widths —
 * at phone width it condenses to the drawer toggle, the title, search, the
 * workspace chip and the user menu. */
import type { JSX, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { ThemeToggle } from "@design-system/components/theme-toggle.tsx";
import type { SessionUser } from "@api/auth.ts";
import type { AccountSection } from "@models/core/routing.ts";
import { CreditPill } from "./credit-pill.tsx";
import { UserMenu } from "./user-menu.tsx";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const PALETTE_SHORTCUT = IS_MAC ? "⌘K" : "Ctrl K";

export interface TopBarProps {
	title: ReactNode;
	user: SessionUser;
	onOpenAccount: (section: AccountSection) => void;
	onSearch: () => void;
	/** Phone: opens the navigation drawer. */
	onOpenDrawer: () => void;
	/** Desktop: collapses the sidebar to its rail. */
	onToggleSidebar: () => void;
	sidebarCollapsed: boolean;
	/** Credits are a workspace's; God Mode has none to show. */
	credits: boolean;
	/** Shown at phone width only, where the sidebar that carries it is hidden. */
	phoneExtra?: ReactNode;
}

export function TopBar(props: TopBarProps): JSX.Element {
	return (
		<Topbar>
			<span className="tw:flex tw:lg:hidden">
				<IconButton onClick={props.onOpenDrawer} aria-label="toggle menu">
					{Ic.menu(ICON.lg)}
				</IconButton>
			</span>
			<span className="tw:hidden tw:lg:flex">
				<IconButton
					type="button"
					onClick={props.onToggleSidebar}
					aria-label={props.sidebarCollapsed ? "expand sidebar" : "collapse sidebar"}
					title={props.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
				>
					{Ic.panelLeft(ICON.md)}
				</IconButton>
			</span>
			<nav className="crumbs" aria-label="Breadcrumb">
				{props.title}
			</nav>
			<TopbarActions>
				<button
					type="button"
					onClick={props.onSearch}
					aria-label={`Search (${PALETTE_SHORTCUT})`}
					className="tw:inline-flex tw:size-8 tw:shrink-0 tw:items-center tw:justify-center tw:gap-2 tw:whitespace-nowrap tw:rounded-md tw:border tw:border-border tw:bg-transparent tw:text-sm tw:text-muted-foreground tw:cursor-pointer tw:transition-colors tw:hover:bg-accent tw:focus-visible:outline-2 tw:focus-visible:outline-ring tw:lg:w-64 tw:lg:justify-start tw:lg:px-3"
				>
					{Ic.search(ICON.sm)}
					<span className="tw:hidden tw:min-w-0 tw:truncate tw:lg:inline">
						Search or run a command…
					</span>
					<kbd className="tw:ml-auto tw:hidden tw:rounded tw:bg-secondary tw:px-1.5 tw:text-xs tw:lg:inline">
						{PALETTE_SHORTCUT}
					</kbd>
				</button>
				{props.credits && <CreditPill />}
				{props.phoneExtra && <div className="tw:flex tw:lg:hidden">{props.phoneExtra}</div>}
				<span className="tw:hidden tw:lg:flex">
					<ThemeToggle />
				</span>
				<UserMenu user={props.user} onOpenAccount={props.onOpenAccount} />
			</TopbarActions>
		</Topbar>
	);
}
