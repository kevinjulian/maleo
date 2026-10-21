import { Sheet } from "@design-system/components/sheet.tsx";
import { SidebarNavigation } from "@design-system/patterns/sidebar-navigation.tsx";
import { lazy, Suspense, useEffect, useState, type JSX } from "react";
import type { AccountSection, GodSection, View, NavigationMode } from "@models/core/routing.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { TopBar } from "@components/shell/top-bar.tsx";
import { useSidebarCollapsed } from "@hooks/ui/use-sidebar-collapsed.ts";
import type { SessionUser } from "@api/auth.ts";
import { GodDirectory } from "./god-directory.tsx";
import { GodInstance } from "./god-instance.tsx";
import "./god-mode.css";

type GodView = Extract<View, { kind: "god" }>;
const TemplateExplorer = lazy(() => import("./template-explorer.tsx"));

const MANAGEMENT: Array<{ id: GodSection; label: string }> = [
	{ id: "users", label: "Users" },
	{ id: "workspaces", label: "Workspaces" },
	{ id: "projects", label: "Projects" },
];
const INSTANCE: Array<{ id: GodSection; label: string }> = [
	{ id: "pipelines", label: "AI Explorer" },
	{ id: "general", label: "General" },
	{ id: "authentication", label: "Authentication" },
	{ id: "providers", label: "Providers" },
	{ id: "security", label: "Security & Storage" },
	{ id: "usage", label: "Usage" },
	{ id: "audit", label: "Audit log" },
];

export function GodModePage({
	view,
	isOwner,
	onNavigate,
	onBack,
	user,
	onOpenAccount,
	onSearch,
}: {
	view: GodView;
	isOwner: boolean;
	onNavigate: (next: GodView, mode?: NavigationMode) => void;
	onBack: () => void;
	user: SessionUser;
	onOpenAccount: (section: AccountSection) => void;
	onSearch: () => void;
}): JSX.Element {
	const [menuOpen, setMenuOpen] = useState(false);
	const [collapsed, toggleCollapsed] = useSidebarCollapsed();
	useEffect(() => {
		setMenuOpen(false);
	}, [view.section, view.detail]);

	const navigate = (section: GodSection, detail?: string, provider?: string) => {
		setMenuOpen(false);
		onNavigate({
			kind: "god",
			section,
			...(detail ? { detail } : {}),
			...(provider ? { provider } : {}),
		});
	};

	if (!isOwner) {
		return (
			<div className="god-denied">
				<p className="god-eyebrow">God Mode</p>
				<h1>Instance owner access required</h1>
				<p>This account cannot open deployment administration.</p>
				<button type="button" onClick={onBack}>
					Back to app
				</button>
			</div>
		);
	}

	const navigation = (
		<SidebarNavigation
			label="God Mode sections"
			current={view.section}
			header={
				<div className="tw:flex tw:items-center tw:gap-2">
					<img className="god-mark" src="/maleo-icon-192.png" alt={collapsed ? "Maleo" : ""} />
					<strong>Maleo · God Mode</strong>
				</div>
			}
			groups={[
				{
					items: [
						{ id: "back", label: "Back to app", icon: Ic.chevronLeft(ICON.sm), onNavigate: onBack },
					],
				},
				{
					label: "Management",
					items: MANAGEMENT.map((item) => ({
						id: item.id,
						label: item.label,
						onNavigate: () => navigate(item.id),
					})),
				},
				{
					label: "Instance",
					items: INSTANCE.map((item) => ({
						id: item.id,
						label: item.label,
						onNavigate: () => navigate(item.id),
					})),
				},
			]}
			footer={<span>Instance administration</span>}
		/>
	);
	return (
		<div className={`god-shell${collapsed ? " god-collapsed" : ""}`}>
			<aside className="god-sidebar" aria-label="God Mode navigation">
				{navigation}
			</aside>
			<Sheet
				open={menuOpen}
				onClose={() => setMenuOpen(false)}
				edge="left"
				size="min(82vw, 300px)"
				label="God Mode navigation"
			>
				{navigation}
			</Sheet>
			<div className="god-main">
				{/* The app shell's bar: the same user menu, search and theme, and no
				    credits — those belong to a workspace, and God Mode has none. */}
				<TopBar
					title={<span className="crumb-cur">God Mode</span>}
					user={user}
					onOpenAccount={onOpenAccount}
					onSearch={onSearch}
					onOpenDrawer={() => setMenuOpen(true)}
					onToggleSidebar={toggleCollapsed}
					sidebarCollapsed={collapsed}
					credits={false}
				/>
				<main className="god-main-content">
					{view.section === "pipelines" ? (
						<Suspense fallback={<p>Loading definitions…</p>}>
							<TemplateExplorer
								selection={view.template}
								onNavigate={(template, mode) =>
									onNavigate(
										{ kind: "god", section: "pipelines", ...(template ? { template } : {}) },
										mode,
									)
								}
							/>
						</Suspense>
					) : view.section === "users" ||
					  view.section === "workspaces" ||
					  view.section === "projects" ? (
						<GodDirectory
							kind={view.section}
							id={view.detail}
							onSelect={(id) => navigate(view.section, id)}
							onOpenWorkspace={(name) => navigate("workspaces", name)}
						/>
					) : (
						<GodInstance
							section={view.section}
							detail={view.detail}
							provider={view.provider}
							navigate={navigate}
						/>
					)}
				</main>
			</div>
		</div>
	);
}
