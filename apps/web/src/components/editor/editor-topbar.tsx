import {
	Topbar,
	TopbarLeading,
	TopbarStatus,
	TopbarActions,
} from "@design-system/patterns/topbar.tsx";
/* The editor's topbar: breadcrumbs, save badge, editor mode, export, submit.
 *
 * Extractable at nine props because the chrome it draws is in a store. Before
 * that it read `saveState`, `editorMode`, `submitting`, `rendering`,
 * `renderStatus` and `exportMenuOpen` out of the shell's `useState`s, so pulling
 * it out meant a signature with those six plus their setters — the shape
 * `AGENTS.md` calls renaming rather than decomposing. It subscribes to them
 * instead, and takes only what it genuinely does not own: where the crumbs
 * point, what the preflight says, and what the four controls do.
 */
import { Fragment } from "react";
import type { JSX, RefObject } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button } from "@design-system/components/button.tsx";
import { TabsList, TabsRoot, TabsTab } from "@design-system/components/tabs.tsx";
import { oneOf } from "@maleo/shared";
import { ExportMenu } from "./export-menu.tsx";
import type { ExportSource } from "@models/render/export-coverage.ts";
import { useShellChrome, type ShellChromeStore } from "@stores/shell-chrome-store.ts";
import type { ContentType } from "@maleo/shared";
import type { RenderPreflight } from "@models/core/cc-helpers.ts";
import type { CrumbSeg } from "./create-content.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";

export interface EditorTopbarProps {
	chrome: ShellChromeStore;
	crumbs: CrumbSeg[];
	type: ContentType | null;
	/** The completion card is showing, so the editing controls are not. */
	submitted: boolean;
	onOpenNav?: () => void;
	/** Whether the references rail toggle applies to this content type. */
	showRail: boolean;
	onToggleRail: () => void;
	/** Video only: the export control and the menu it opens. */
	exportMenuRef: RefObject<HTMLDivElement | null>;
	preflight: RenderPreflight;
	onRenderClick: () => void;
	onLocalRender: () => void;
	onConfirmRender: () => void;
	onOpenRenderStatus: () => void;
	readExportSource: () => ExportSource | null;
	/** Image and text submit from here; video submits through the export menu. */
	onSubmit: () => void;
}

function SaveBadge({ chrome }: { chrome: ShellChromeStore }): JSX.Element | null {
	const saveState = useShellChrome(chrome, "saveState");
	if (saveState === "idle") return null;
	return (
		<span
			className={`cv-savebadge ${saveState}`}
			role="status"
			aria-live="polite"
			title={
				saveState === "failed" ? "Save failed — retried automatically on next edit" : undefined
			}
		>
			{saveState === "saving" ? (
				<>
					<span className="cv-spin" /> Saving…
				</>
			) : saveState === "saved" ? (
				<>{Ic.check(ICON.xs)} Saved</>
			) : (
				<>{Ic.x(ICON.xs)} Save failed</>
			)}
		</span>
	);
}

/* The editor's four views of one project. Local tabs, not navigation: the mode
 * is chrome state, not an address. Arrows move focus and Enter selects, because
 * each mode mounts a whole editor and should not flash past on the way. The
 * panels are the editor body, rendered by create-content.tsx. */
const MODES = [
	{ mode: "storyboard", label: "Storyboard", title: "Storyboard authoring", icon: Ic.layers },
	{ mode: "script", label: "Script", title: "Script", icon: Ic.layers },
	{ mode: "timeline", label: "Timeline", title: "Timeline editor", icon: Ic.film },
	{ mode: "studio", label: "Studio", title: "Studio editor", icon: Ic.layers },
] as const;
const MODE_IDS = MODES.map((entry) => entry.mode);

function ModeTabs({ chrome }: { chrome: ShellChromeStore }): JSX.Element {
	const editorMode = useShellChrome(chrome, "editorMode");
	return (
		<TabsRoot
			className="tw:shrink-0"
			value={editorMode}
			onValueChange={(next) => {
				const mode = oneOf(String(next), MODE_IDS);
				if (mode) chrome.patch("editorMode", mode);
			}}
		>
			<TabsList
				variant="segmented"
				activateOnFocus={false}
				className="cv-modeseg"
				aria-label="Editor mode"
			>
				{MODES.map(({ mode, label, title, icon }) => (
					<TabsTab key={mode} value={mode} title={title}>
						{icon(ICON.sm)}
						<span className="cv-modeseg-label">{label}</span>
					</TabsTab>
				))}
			</TabsList>
		</TabsRoot>
	);
}

function SubmitButton({
	chrome,
	onSubmit,
}: {
	chrome: ShellChromeStore;
	onSubmit: () => void;
}): JSX.Element {
	const submitting = useShellChrome(chrome, "submitting");
	return (
		<Button variant="primary" size="sm" onClick={onSubmit} disabled={submitting}>
			{Ic.send(ICON.sm)} {submitting ? "Submitting…" : "Submit"}
		</Button>
	);
}

export function EditorTopbar(props: EditorTopbarProps): JSX.Element {
	const { chrome, crumbs, type, submitted, onOpenNav, showRail, onToggleRail } = props;
	const editing = !submitted;
	return (
		<Topbar variant="editor">
			<TopbarLeading>
				{onOpenNav && (
					<IconButton
						className="cv-hamburger"
						onClick={onOpenNav}
						title="Toggle menu"
						aria-label="toggle menu"
					>
						{Ic.menu(ICON.lg)}
					</IconButton>
				)}
				{/* The active workspace, in the one flow that had no indicator at all.
				    The editor is fullscreen: it replaces the sidebar and the mobile
				    topbar, so an operator here could not see which tenant they were in
				    without opening the nav drawer — and this is the surface where a
				    generation gets attributed, which makes it the worst place to have
				    to guess. Compact by design; it opens the same switcher.

				    It names the ACTIVE workspace, not the open project's owner. Those
				    can differ (a project opened by direct link), and the project's own
				    workspace stays authoritative for what its generations are billed
				    to — see api/media.ts. */}
				{/*<WorkspaceSwitcher collapsed />*/}
				<nav className="cv-crumbs">
					{crumbs.map((seg, i) => {
						const last = i === crumbs.length - 1;
						return (
							<Fragment key={i}>
								{i > 0 && <span className="cv-crumb-sep">{Ic.chevR(ICON.xs)}</span>}
								{last ? (
									<span className="cur cv-crumb-slug" title={seg.label}>
										{seg.label}
									</span>
								) : seg.onClick ? (
									<Button variant="ghost" size="sm" className="cv-crumb-btn" onClick={seg.onClick}>
										{seg.label}
									</Button>
								) : (
									<span className="cv-crumb-static">{seg.label}</span>
								)}
							</Fragment>
						);
					})}
				</nav>
			</TopbarLeading>
			<TopbarStatus>{editing && <SaveBadge chrome={chrome} />}</TopbarStatus>
			<TopbarActions>
				{editing && type === "video" && <ModeTabs chrome={chrome} />}
				{editing && type === "video" && (
					<ExportMenu
						chrome={chrome}
						menuRef={props.exportMenuRef}
						preflight={props.preflight}
						onRenderClick={props.onRenderClick}
						onLocalRender={props.onLocalRender}
						onConfirmRender={props.onConfirmRender}
						onOpenStatus={props.onOpenRenderStatus}
						readExportSource={props.readExportSource}
					/>
				)}
				{showRail && (
					<Button variant="secondary" size="sm" className="cv-rail-toggle" onClick={onToggleRail}>
						{Ic.layers(ICON.sm)} References
					</Button>
				)}
				{editing && type !== "video" && <SubmitButton chrome={chrome} onSubmit={props.onSubmit} />}
			</TopbarActions>
		</Topbar>
	);
}
