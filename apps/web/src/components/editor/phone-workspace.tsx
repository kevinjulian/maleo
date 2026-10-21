/* The phone's two views of one content workspace: Editor and Chat.
 *
 * Chat used to be a 72svh sheet over the stage and timeline. That fit chat as
 * something consulted; it does not fit chat as a workspace, where the keyboard,
 * a pinned decision and the composer together outgrow what a partial sheet
 * leaves, and a required decision ends up behind the keyboard.
 *
 * Both views stay MOUNTED, stacked in one grid cell. The hidden one is
 * `visibility: hidden`, not unmounted and not `display: none`:
 * unmounting would drop the composer draft, the queued instruction and the
 * editor's own geometry, and `display: none` throws away scroll offsets and
 * hands the timeline a zero-sized box to measure. Switching is not a route —
 * a route remounts, which loses exactly this state.
 *
 * Above the breakpoint this renders its editor child and nothing else, through
 * `display: contents`, so crossing the breakpoint does not move the editor in
 * the tree and remount it. */
import { useEffect, useRef } from "react";
import type { FocusEvent, JSX, KeyboardEvent, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { cn } from "@models/core/cn.ts";
import type { RunIndicator } from "@models/chat/chat-feed.ts";
import "./phone-workspace.css";

export type WorkspaceView = "editor" | "chat";

const VIEWS: readonly WorkspaceView[] = ["editor", "chat"];
const VIEW_LABEL: Record<WorkspaceView, string> = { editor: "Editor", chat: "Chat" };
const INDICATOR_LABEL: Record<RunIndicator, string> = {
	running: "Chat working",
	input: "Chat needs your input",
	failed: "Chat run failed",
};

export interface PhoneWorkspaceProps {
	/** False above the breakpoint: the editor renders as if this were absent. */
	enabled: boolean;
	view: WorkspaceView;
	onViewChange: (view: WorkspaceView) => void;
	indicator: RunIndicator | null;
	chat: ReactNode;
	/** Sizes the workspace as a page region rather than a flex child. */
	page?: boolean;
	children: ReactNode;
}

export function PhoneWorkspace({
	enabled,
	view,
	onViewChange,
	indicator,
	chat,
	page,
	children,
}: PhoneWorkspaceProps): JSX.Element {
	const layers = {
		editor: useRef<HTMLDivElement | null>(null),
		chat: useRef<HTMLDivElement | null>(null),
	};
	const tabs = {
		editor: useRef<HTMLButtonElement | null>(null),
		chat: useRef<HTMLButtonElement | null>(null),
	};
	const lastFocus = useRef<Partial<Record<WorkspaceView, HTMLElement>>>({});
	/** A selector to focus inside the incoming view, set by the run indicator. */
	const focusNext = useRef<string | null>(null);
	const mounted = useRef(false);

	/* Focus follows the view only when the switch stranded it. A tab keeps
	 * focus, which is what a keyboard user expects of a tab; a switch caused
	 * from inside a view — `Show changes`, the chat's own close — leaves focus
	 * in a layer that just became hidden, so it returns to where the user last was
	 * in the incoming view. */
	useEffect(() => {
		if (!mounted.current) {
			mounted.current = true;
			return;
		}
		if (!enabled) return;
		const layer = layers[view].current;
		const other = layers[view === "editor" ? "chat" : "editor"].current;
		if (!layer) return;
		const wanted = focusNext.current ? layer.querySelector<HTMLElement>(focusNext.current) : null;
		focusNext.current = null;
		if (wanted) {
			wanted.focus();
			return;
		}
		const active = document.activeElement;
		if (active && active !== document.body && !other?.contains(active)) return;
		const previous = lastFocus.current[view];
		(previous?.isConnected ? previous : layer).focus({ preventScroll: true });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [view, enabled]);

	const select = (next: WorkspaceView): void => {
		if (next !== view) onViewChange(next);
	};
	const onTabKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
		const index = VIEWS.indexOf(view);
		const next =
			e.key === "ArrowRight"
				? VIEWS[(index + 1) % VIEWS.length]
				: e.key === "ArrowLeft"
					? VIEWS[(index + VIEWS.length - 1) % VIEWS.length]
					: e.key === "Home"
						? VIEWS[0]
						: e.key === "End"
							? VIEWS[VIEWS.length - 1]
							: undefined;
		if (!next) return;
		e.preventDefault();
		select(next);
		tabs[next].current?.focus();
	};
	const openFromIndicator = (): void => {
		// Required input must be reachable without hunting for it.
		focusNext.current = indicator === "input" ? ".fc-pinned" : null;
		select("chat");
	};
	const showIndicator = view === "editor" && indicator != null;

	/* One tree for both widths. The editor layer keeps its key and position
	 * whether or not the phone chrome around it renders, so a rotation across
	 * the breakpoint re-renders the editor rather than remounting it. */
	return (
		<div
			className={cn("cv-phonews", enabled && "is-phone", enabled && page && "cv-phonews--page")}
			data-view={enabled ? view : undefined}
		>
			{enabled && (
				<div key="bar" className="cv-phonews-bar" data-app-overlay-persistent>
					<div className="cv-phonews-tabs" role="tablist" aria-label="Workspace view">
						{VIEWS.map((v) => (
							<button
								key={v}
								ref={tabs[v]}
								type="button"
								role="tab"
								id={`cv-phonews-tab-${v}`}
								aria-selected={view === v}
								aria-controls={`cv-phonews-${v}`}
								tabIndex={view === v ? 0 : -1}
								className="cv-phonews-tab"
								onClick={() => select(v)}
								onKeyDown={onTabKey}
							>
								{VIEW_LABEL[v]}
							</button>
						))}
					</div>
					{showIndicator && (
						<button
							type="button"
							className="cv-phonews-run"
							data-state={indicator}
							onClick={openFromIndicator}
						>
							<span aria-hidden="true">
								{indicator === "running" ? (
									<span className="cv-spin" />
								) : indicator === "input" ? (
									Ic.info(ICON.sm)
								) : (
									Ic.alertCircle(ICON.sm)
								)}
							</span>
							<span>{INDICATOR_LABEL[indicator]}</span>
						</button>
					)}
					{/* The chat's own live region is inert while Chat is hidden, so the
					    Editor view announces run state itself — the state, not a feed. */}
					<div className="fc-sr-only" role="status" aria-live="polite" aria-atomic="true">
						{showIndicator ? INDICATOR_LABEL[indicator] : ""}
					</div>
				</div>
			)}
			{(enabled ? VIEWS : (["editor"] as const)).map((v) => (
				<div
					key={v}
					ref={layers[v]}
					className={`cv-phonews-layer cv-phonews-${v}`}
					{...(enabled && {
						id: `cv-phonews-${v}`,
						role: "tabpanel",
						"aria-labelledby": `cv-phonews-tab-${v}`,
						tabIndex: -1,
						"data-active": view === v || undefined,
						onFocus: (e: FocusEvent<HTMLDivElement>) => {
							if (e.target instanceof HTMLElement && e.target !== e.currentTarget)
								lastFocus.current[v] = e.target;
						},
					})}
				>
					{v === "editor" ? children : chat}
				</div>
			))}
		</div>
	);
}
