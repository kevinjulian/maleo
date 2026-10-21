import { Sheet } from "@design-system/components/sheet.tsx";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { VideoPage } from "@pages/video.tsx";
import { ImageLabPage } from "@pages/image-lab.tsx";
import { ImagesPage } from "@pages/images.tsx";
import { SpeechPage } from "@pages/speech.tsx";
import { SpeechLabPage } from "@pages/speech-lab.tsx";
import { WorkspacePage } from "@pages/workspace.tsx";
import { CreateFormPage } from "@pages/create-form.tsx";
import { ContentEditorPage } from "@pages/content-editor.tsx";
import { LibraryPage } from "@pages/library.tsx";
import { ContentPage } from "@pages/content.tsx";
import { AccountPage, ACCOUNT_TITLE } from "@pages/account.tsx";
import { GodModePage } from "@pages/god-mode.tsx";
import { CommandPalette } from "./command-palette.tsx";
import { Toast } from "./toast.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { AppSidebar, type NavTarget, type SidebarTab } from "@components/shell/app-sidebar.tsx";
import { BareShell } from "@components/shell/bare-shell.tsx";
import { Breadcrumb, type CrumbSeg } from "@components/shell/breadcrumb.tsx";
import { TopBar } from "@components/shell/top-bar.tsx";
import { WorkspaceSwitcher } from "@components/workspace/workspace-switcher.tsx";
import {
	pathToView,
	type AccountSection,
	type LibraryType,
	type View,
	type WorkspacePanel,
} from "@models/core/routing.ts";
import { accountBackTarget } from "@models/core/shell.ts";
import { useHistorySync } from "./history-sync.ts";
import { useActiveWorkspace } from "@hooks/workspace/use-active-workspace.ts";
import { useSidebarCollapsed } from "@hooks/ui/use-sidebar-collapsed.ts";
import { forgetStoredWorkspace, initActiveWorkspace } from "@models/core/active-workspace.ts";
import type { SessionUser } from "@api/auth.ts";

/* The bottom nav's tabs. An array literal, so the element type is declared once
 * rather than asserted on each entry. A misspelled tab fails to compile instead
 * of narrowing to a member it is not. */
const NAV_ITEMS: ReadonlyArray<{ tab: MobileTab; label: string; icon: JSX.Element }> = [
	{ tab: "content", label: "Projects", icon: Ic.book(ICON.md) },
	{ tab: "create", label: "New project", icon: Ic.plus(ICON.md) },
	{ tab: "images", label: "Images", icon: Ic.image(ICON.md) },
	{ tab: "speech", label: "Speech", icon: Ic.chat(ICON.md) },
	{ tab: "video", label: "Video", icon: Ic.video(ICON.md) },
];

/* Resolved before the first render, and before any request goes out: the api
 * client reads this on every scoped call, so a component that fetches on mount
 * would otherwise send `default` and be corrected a tick later — showing the
 * wrong tenant's work first. */
initActiveWorkspace();

/** Panel names, written once so the crumb and the inner nav cannot disagree. */
export const WORKSPACE_PANEL_LABEL: Record<WorkspacePanel, string> = {
	general: "General",
	members: "Members",
	danger: "Danger Zone",
};

const LIBRARY_LABEL = {
	references: "References",
	voices: "Voices",
	presets: "Project Presets",
	materials: "Materials",
	templates: "Video Templates",
	elements: "Elements",
} satisfies Record<LibraryType, string>;

/* ─── Active entry derivation ─── */

function sidebarTab(v: View): SidebarTab {
	switch (v.kind) {
		/* The script and storyboard are their own routes but the same place in
		 * the nav — an operator moving between a project and its script has not
		 * left Projects. */
		case "content":
		case "content-edit":
		case "content-script":
		case "content-storyboard":
			return "content";
		case "create":
			return "create";
		case "library":
			return v.type;
		case "video":
			return "video";
		// The gallery and the lab are two destinations under one nav entry.
		case "images":
		case "imagelab":
			return "images";
		case "speech":
		case "speechlab":
			return "speech";
		/* Every panel of the workspace surface lights the switcher. An operator
		 * inside Members has not left Workspace, and the inner nav says which
		 * panel they are on. */
		case "workspace":
			return "workspace";
		case "god":
		case "account":
			return "none";
	}
}

/* "none" is a real state: the drawer reaches surfaces the bottom bar does not, and
 * those must leave every tab unlit rather than borrowing one that leads elsewhere. */
type MobileTab = "content" | "create" | "images" | "speech" | "video" | "none";

export function viewToMobileTab(v: View): MobileTab {
	switch (v.kind) {
		case "content":
		case "content-edit":
		case "content-script":
		case "content-storyboard":
			return "content";
		case "create":
			return "create";
		case "video":
			return "video";
		case "images":
		case "imagelab":
			return "images";
		case "speech":
		case "speechlab":
			return "speech";
		/* Drawer-reachable, like References: the bottom bar has five slots and
		 * administration is not one of them, so no tab is lit rather than
		 * borrowing one that leads somewhere else. */
		case "god":
		case "account":
		case "workspace":
			return "none";
		case "library":
			// References is drawer-reachable and must not light a tab that no longer
			// leads to it. It has no tab of its own, so no tab is current.
			return "none";
	}
}

/* ─── App ─── */

export function App({ user: signedIn }: { user: SessionUser }) {
	const [view, setView] = useState<View>(() => pathToView(location.pathname, location.search));
	const navigateView = useHistorySync(view, setView);
	const activeWorkspace = useActiveWorkspace();
	/* Local, so a name saved on the Profile page shows in the user menu without
	 * a reload. */
	const [user, setUser] = useState(signedIn);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [toast, setToast] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);
	const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed();

	/* Where an account page's back control returns to: the last route that was
	 * not an account page. */
	const cameFrom = useRef<View | null>(null);
	useEffect(() => {
		if (view.kind !== "account") cameFrom.current = view;
	}, [view]);

	/* Cmd+K palette, from every shell */
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
				e.preventDefault();
				setPaletteOpen((p) => !p);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	/* Close the mobile drawer whenever the route changes */
	useEffect(() => {
		setDrawerOpen(false);
	}, [view]);

	/* Navigation callbacks */
	const goContent = useCallback(() => setView({ kind: "content" }), []);
	const goContentEdit = useCallback((id: string) => setView({ kind: "content-edit", id }), []);
	const goCreate = useCallback(() => setView({ kind: "create" }), []);
	const goLibrary = useCallback(
		(type: LibraryType, editId?: string) =>
			setView(editId ? { kind: "library", type, editId } : { kind: "library", type }),
		[],
	);
	const goVideo = useCallback(() => setView({ kind: "video" }), []);
	const goImages = useCallback(() => setView({ kind: "images" }), []);
	const goImageLab = useCallback(() => setView({ kind: "imagelab" }), []);
	const goSpeech = useCallback(() => setView({ kind: "speech" }), []);
	const goSpeechLab = useCallback(() => setView({ kind: "speechlab" }), []);
	const goGodMode = useCallback(() => setView({ kind: "god", section: "general" }), []);
	const goWorkspace = useCallback(
		(panel: WorkspacePanel = "general") =>
			setView(panel === "general" ? { kind: "workspace" } : { kind: "workspace", panel }),
		[],
	);
	const goAccount = useCallback(
		(section: AccountSection) => setView({ kind: "account", section }),
		[],
	);
	const openPalette = useCallback(() => setPaletteOpen(true), []);

	const handleMobileNav = useCallback(
		(mtab: MobileTab) => {
			switch (mtab) {
				case "content":
					return goContent();
				case "create":
					return goCreate();
				case "images":
					return goImages();
				case "speech":
					return goSpeech();
				case "video":
					return goVideo();
				case "none":
					return;
			}
		},
		[goContent, goCreate, goImages, goSpeech, goVideo],
	);

	const sidebarNavigate = useCallback(
		(tab: NavTarget) => {
			switch (tab) {
				case "content":
					return goContent();
				case "create":
					return goCreate();
				case "video":
					return goVideo();
				case "images":
					return goImages();
				case "speech":
					return goSpeech();
				case "elements":
				case "materials":
				case "presets":
				case "references":
				case "templates":
				case "voices":
					return goLibrary(tab);
			}
		},
		[goContent, goCreate, goVideo, goImages, goSpeech, goLibrary],
	);

	const tab = sidebarTab(view);
	const mTab = viewToMobileTab(view);
	const isInstanceOwner = user.role === "instance_owner";

	const root: CrumbSeg = { label: "Maleo", go: goContent };
	const crumb: CrumbSeg[] = (() => {
		switch (view.kind) {
			case "content":
				return [{ label: "Projects" }];
			case "content-edit":
				return [{ label: "Projects", go: goContent }, { label: "Editor" }];
			case "content-script":
				return [{ label: "Projects", go: goContent }, { label: "Script" }];
			case "content-storyboard":
				return [{ label: "Projects", go: goContent }, { label: "Storyboard" }];
			case "create":
				return [{ label: "Projects", go: goContent }, { label: "New project" }];
			case "library":
				return [{ label: "Library" }, { label: LIBRARY_LABEL[view.type] }];
			case "video":
				return [root, { label: "Video" }];
			case "images":
				return [root, { label: "Images" }];
			case "imagelab":
				return [root, { label: "Images", go: goImages }, { label: "Lab" }];
			case "speech":
				return [root, { label: "Speech" }];
			case "speechlab":
				return [root, { label: "Speech", go: goSpeech }, { label: "Lab" }];
			case "god":
				return [root, { label: "God Mode" }];
			case "account":
				return [{ label: ACCOUNT_TITLE[view.section] }];
			/* The panel is named only when it is not the default one, matching how
			 * the address works. */
			case "workspace":
				return [
					root,
					{
						label: "Workspace",
						...(view.panel && view.panel !== "general" ? { go: () => goWorkspace() } : {}),
					},
					...(view.panel && view.panel !== "general"
						? [{ label: WORKSPACE_PANEL_LABEL[view.panel] }]
						: []),
				];
		}
	})();

	const palette = paletteOpen && (
		<CommandPalette
			onClose={() => setPaletteOpen(false)}
			onGoContent={() => {
				setPaletteOpen(false);
				goContent();
			}}
			onGoCreate={() => {
				setPaletteOpen(false);
				goCreate();
			}}
			onGoLibrary={(type) => {
				setPaletteOpen(false);
				goLibrary(type);
			}}
			onGoVideo={() => {
				setPaletteOpen(false);
				goVideo();
			}}
			onGoImages={() => {
				setPaletteOpen(false);
				goImages();
			}}
			onGoImageLab={() => {
				setPaletteOpen(false);
				goImageLab();
			}}
			onGoSpeech={() => {
				setPaletteOpen(false);
				goSpeech();
			}}
			onGoSpeechLab={() => {
				setPaletteOpen(false);
				goSpeechLab();
			}}
			onGoGodMode={
				isInstanceOwner
					? () => {
							setPaletteOpen(false);
							goGodMode();
						}
					: undefined
			}
		/>
	);

	if (view.kind === "god") {
		return (
			<>
				<GodModePage
					view={view}
					isOwner={isInstanceOwner}
					onNavigate={navigateView}
					onBack={goContent}
					user={user}
					onOpenAccount={goAccount}
					onSearch={openPalette}
				/>
				{palette}
			</>
		);
	}

	if (view.kind === "account") {
		return (
			<>
				<BareShell onBack={() => setView(accountBackTarget(cameFrom.current))}>
					<AccountPage section={view.section} user={user} onUserChange={setUser} />
				</BareShell>
				{palette}
			</>
		);
	}

	const sidebarProps = {
		tab,
		onNavigate: sidebarNavigate,
		onWorkspacePanel: goWorkspace,
		onGodMode: goGodMode,
		isInstanceOwner,
	};

	// Shared slide-in nav drawer. In fullscreen flows it floats above the editor
	// on desktop too (opened by the editor hamburger); in the normal shell it is
	// the mobile-only drawer.
	const navDrawer = (
		<Sheet
			open={drawerOpen}
			onClose={() => setDrawerOpen(false)}
			edge="left"
			size="min(290px, 86vw)"
			label="Navigation menu"
			className="nav-drawer"
		>
			<AppSidebar
				{...sidebarProps}
				afterNav={() => setDrawerOpen(false)}
				onClose={() => setDrawerOpen(false)}
			/>
		</Sheet>
	);

	// Content-first Create + the content editor are immersive, fullscreen flows
	// with their own topbar. Navigation is reachable via the hamburger drawer.
	if (
		view.kind === "create" ||
		view.kind === "content-edit" ||
		view.kind === "content-script" ||
		view.kind === "content-storyboard"
	) {
		return (
			<div className="shell">
				{navDrawer}
				{view.kind === "create" ? (
					<CreateFormPage
						onProjectCreated={goContentEdit}
						onOpenNav={() => setDrawerOpen((o) => !o)}
						crumbs={[{ label: "Projects", onClick: goContent }]}
					/>
				) : (
					<ContentEditorPage
						projectId={view.id}
						onExit={goContent}
						onOpenNav={() => setDrawerOpen((o) => !o)}
						onOpenLibrary={goLibrary}
						/* The script is one of the editor's views, and its path lands on
						   that view. It is not a separate page. */
						initialEditorMode={
							view.kind === "content-script"
								? "script"
								: view.kind === "content-storyboard"
									? "storyboard"
									: undefined
						}
						initialScriptDensity={view.kind === "content-script" ? view.density : undefined}
						crumbs={[{ label: "Projects", onClick: goContent }]}
					/>
				)}
				{toast && <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />}
			</div>
		);
	}

	return (
		<div className="shell">
			{/* ─── Desktop Sidebar ─── */}
			<aside className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
				<AppSidebar {...sidebarProps} collapsed={sidebarCollapsed} />
			</aside>

			{navDrawer}

			{/* ─── Main Content Area ─── */}
			<div
				className="shell-main"
				style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}
			>
				<TopBar
					title={<Breadcrumb segs={crumb} />}
					user={user}
					onOpenAccount={goAccount}
					onSearch={openPalette}
					onOpenDrawer={() => setDrawerOpen((o) => !o)}
					onToggleSidebar={toggleSidebar}
					sidebarCollapsed={sidebarCollapsed}
					credits
					/* The bottom nav is full at five tabs, and drawer-only would make
					   the active workspace invisible until a menu is opened. Tapping
					   it opens the switcher directly rather than the whole drawer. */
					phoneExtra={<WorkspaceSwitcher collapsed />}
				/>

				{/* Page content.
				    Keyed on the workspace so a switch re-scopes content, materials,
				    references and images TOGETHER and at once. Each page loads on
				    mount with its own effect dependencies, and none of them list the
				    workspace — without the key, a switch would change what the next
				    request returns while leaving the current screen showing the
				    previous tenant's work until something else happened to refetch.
				    Remounting is blunt, and it is the only thing that cannot leave
				    one surface behind. */}
				<main
					key={activeWorkspace}
					style={{ flex: 1, minWidth: 0, paddingBottom: view.kind === "imagelab" ? 0 : 72 }}
				>
					{view.kind === "content" && (
						<ContentPage onOpenProject={goContentEdit} onCreate={goCreate} />
					)}
					{view.kind === "video" && (
						<VideoPage onOpenProject={goContentEdit} onNewProject={goCreate} />
					)}
					{view.kind === "library" && (
						<LibraryPage type={view.type} editId={view.editId} newGroup={view.newGroup} />
					)}
					{view.kind === "images" && (
						<ImagesPage onOpenProject={goContentEdit} onOpenLab={goImageLab} />
					)}
					{view.kind === "imagelab" && <ImageLabPage />}
					{view.kind === "speech" && <SpeechPage onOpenLab={goSpeechLab} />}
					{view.kind === "speechlab" && <SpeechLabPage />}
					{view.kind === "workspace" && (
						<WorkspacePage
							workspace={activeWorkspace}
							panel={view.panel ?? "general"}
							onPanel={(panel) => setView({ kind: "workspace", panel })}
							/* The workspace they were in has just ceased to exist.
							   Forgetting the stored value FIRST is what makes the reload
							   land somewhere real: persistence would otherwise carry the
							   deleted name through it, and every scoped request after
							   that is refused as an unknown workspace. */
							onDeleted={() => {
								forgetStoredWorkspace();
								window.location.href = "/";
							}}
						/>
					)}
				</main>

				{/* Mobile bottom nav */}
				{view.kind !== "imagelab" && view.kind !== "speechlab" && (
					<nav className="bottomnav app-nav">
						{NAV_ITEMS.map((item) => (
							<button
								key={item.tab}
								className={`app-nav-item${mTab === item.tab ? " app-nav-active" : ""}`}
								aria-current={mTab === item.tab ? "page" : undefined}
								onClick={() => handleMobileNav(item.tab)}
							>
								<span className="app-nav-icon">{item.icon}</span>
								<span className="app-nav-label">{item.label}</span>
							</button>
						))}
					</nav>
				)}
			</div>

			{palette}
			{toast && <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />}
		</div>
	);
}
