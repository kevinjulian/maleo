import { SidebarNavigation } from "@design-system/patterns/sidebar-navigation.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
/* The workspace sidebar, shared by the desktop rail and the phone drawer.
 *
 * Three parts, in the reference shape: the workspace switcher as the header
 * (its menu is also the way into workspace settings and members), the work
 * navigation as the body, and a footer holding God Mode for the instance owner
 * and the product mark with the running version. Search, theme and credits are
 * the top bar's and are not repeated here. */
import type { JSX } from "react";
import { version } from "../../../../../package.json";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { WorkspaceSwitcher } from "@components/workspace/workspace-switcher.tsx";
import type { LibraryType, WorkspacePanel } from "@models/core/routing.ts";

export type SidebarTab =
	| "content"
	| "create"
	| "video"
	| "images"
	| "speech"
	| "workspace"
	| LibraryType
	| "none";

/** An entry that leads somewhere by itself; workspace is reached through the switcher. */
export type NavTarget = Exclude<SidebarTab, "workspace" | "none">;

type NavEntry = { tab: NavTarget; label: string; icon: JSX.Element };

const WORK: readonly NavEntry[] = [
	{ tab: "content", label: "Projects", icon: Ic.book(ICON.md) },
	{ tab: "create", label: "New project", icon: Ic.plus(ICON.md) },
];
/* Video structure and reusable placed blocks sit in Library: a record every
 * project draws on should not need a project opened to find. */
const LIBRARY: readonly NavEntry[] = [
	{ tab: "references", label: "References", icon: Ic.layers(ICON.md) },
	{ tab: "voices", label: "Voices", icon: Ic.chat(ICON.md) },
	{ tab: "presets", label: "Project Presets", icon: Ic.star(ICON.md) },
	{ tab: "materials", label: "Materials", icon: Ic.book(ICON.md) },
	{ tab: "templates", label: "Video Templates", icon: Ic.layers(ICON.md) },
	{ tab: "elements", label: "Elements", icon: Ic.elements(ICON.md) },
];
/* Speech beside Images: both are a gallery of generated output plus the lab
 * that made it. Library > Voices stays the catalogue of voice identities. */
const TOOLS: readonly NavEntry[] = [
	{ tab: "video", label: "Video", icon: Ic.video(ICON.md) },
	{ tab: "images", label: "Images", icon: Ic.image(ICON.md) },
	{ tab: "speech", label: "Speech", icon: Ic.chat(ICON.md) },
];

export interface AppSidebarProps {
	tab: SidebarTab;
	onNavigate: (tab: NavTarget) => void;
	onWorkspacePanel: (panel: WorkspacePanel) => void;
	onGodMode: () => void;
	isInstanceOwner: boolean;
	collapsed?: boolean;
	/** Called after any entry is chosen; the drawer closes itself with it. */
	afterNav?: () => void;
	/** Renders a close control in the header (drawer only). */
	onClose?: () => void;
}

export function AppSidebar(props: AppSidebarProps): JSX.Element {
	const { tab, collapsed, afterNav } = props;
	const go = (fn: () => void) => () => {
		fn();
		afterNav?.();
	};

	const groups = [
		{
			items: WORK.map((entry) => ({
				id: entry.tab,
				label: entry.label,
				icon: entry.icon,
				onNavigate: go(() => props.onNavigate(entry.tab)),
			})),
		},
		{
			label: "Library",
			items: LIBRARY.map((entry) => ({
				id: entry.tab,
				label: entry.label,
				icon: entry.icon,
				onNavigate: go(() => props.onNavigate(entry.tab)),
			})),
		},
		{
			label: "Tools",
			items: TOOLS.map((entry) => ({
				id: entry.tab,
				label: entry.label,
				icon: entry.icon,
				onNavigate: go(() => props.onNavigate(entry.tab)),
			})),
		},
	];

	return (
		<SidebarNavigation
			variant={collapsed ? "rail" : props.onClose ? "drawer" : "expanded"}
			current={tab}
			groups={groups}
			footerItems={
				props.isInstanceOwner
					? [
							{
								id: "god",
								label: "God Mode",
								icon: Ic.shield(ICON.md),
								onNavigate: go(props.onGodMode),
							},
						]
					: []
			}
			label="Workspace navigation"
			header={
				<div className="tw:flex tw:items-center tw:gap-1">
					<div className="tw:min-w-0 tw:flex-1">
						<WorkspaceSwitcher
							collapsed={collapsed}
							current={tab === "workspace"}
							onNavigate={(panel) => {
								props.onWorkspacePanel(panel);
								afterNav?.();
							}}
						/>
					</div>
					{props.onClose && (
						<IconButton onClick={props.onClose} aria-label="close menu">
							{Ic.x(ICON.lg)}
						</IconButton>
					)}
				</div>
			}
			footer={
				<>
					<img
						src="/maleo-icon-192.png"
						alt={collapsed ? "Maleo" : ""}
						className="tw:size-6 tw:shrink-0 tw:rounded-sm"
					/>
					{!collapsed && <span className="tw:font-semibold">Maleo</span>}
					{!collapsed && (
						<span className="tw:ml-auto tw:text-xs tw:text-muted-foreground">v{version}</span>
					)}
				</>
			}
		/>
	);
}
