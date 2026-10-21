import type { JSX, ReactNode } from "react";
import "./sidebar-navigation.css";
export interface SidebarNavigationItem {
	id: string;
	label: string;
	icon?: ReactNode;
	onNavigate: () => void;
}
export interface SidebarNavigationGroup {
	label?: string;
	items: readonly SidebarNavigationItem[];
}
export function SidebarNavigation({
	header,
	groups,
	footer,
	footerItems = [],
	current,
	variant = "expanded",
	label = "Navigation",
}: {
	header?: ReactNode;
	groups: readonly SidebarNavigationGroup[];
	footer?: ReactNode;
	footerItems?: readonly SidebarNavigationItem[];
	current?: string;
	variant?: "expanded" | "rail" | "hidden" | "drawer";
	label?: string;
}): JSX.Element {
	return (
		<div className="ui-sidebar-navigation" data-variant={variant}>
			{header && <div className="ui-sidebar-header">{header}</div>}
			<nav aria-label={label} className="ui-sidebar-body">
				{groups.map((group, index) => (
					<div key={group.label ?? index} className="ui-sidebar-group">
						{group.label && variant !== "rail" && (
							<div className="ui-sidebar-group-label">{group.label}</div>
						)}
						{group.items.map((item) => (
							<button
								type="button"
								key={item.id}
								className="ui-sidebar-item"
								aria-current={current === item.id ? "page" : undefined}
								aria-label={item.label}
								title={item.label}
								onClick={item.onNavigate}
							>
								{item.icon && <span className="ui-sidebar-icon">{item.icon}</span>}
								{variant !== "rail" && <span className="ui-sidebar-label">{item.label}</span>}
							</button>
						))}
					</div>
				))}
			</nav>
			{(footer || footerItems.length > 0) && (
				<div className="ui-sidebar-footer-region">
					<nav aria-label={`${label} footer`}>
						{footerItems.map((item) => (
							<button
								type="button"
								key={item.id}
								className="ui-sidebar-item"
								aria-label={item.label}
								title={item.label}
								aria-current={current === item.id ? "page" : undefined}
								onClick={item.onNavigate}
							>
								{item.icon && <span className="ui-sidebar-icon">{item.icon}</span>}
								{variant !== "rail" && <span className="ui-sidebar-label">{item.label}</span>}
							</button>
						))}
					</nav>
					{footer && <div className="ui-sidebar-footer">{footer}</div>}
				</div>
			)}
		</div>
	);
}
