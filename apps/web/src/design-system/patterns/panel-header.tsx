/* PanelHeader: names a panel and places its actions and its close control.
 *
 * Specified in docs/design-system/patterns/panel-header.md. It replaces
 * `tl2-panel-h` and four other spellings of the same row — a title, sometimes
 * a second line, sometimes actions, usually a close — each with its own
 * padding, type size and border.
 *
 * Densities, each a job:
 *   panel    a rail panel or a sheet: the Panel title role, on the top bar's
 *            height so a panel's header lines up with the chrome beside it
 *   compact  an inspector column or a popover: the Section title role
 *   tool     an editor tool destination: quiet desktop chrome, phone sheet title
 *
 * The title is a heading, so the region it names can be reached by heading
 * navigation. Close is named (`closeLabel`), is always last, and is absent
 * when the panel cannot be closed. The pattern owns no dismissal: `onClose`
 * is the feature's.
 */
import type { JSX, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { cn } from "@models/core/cn.ts";
import "./panel-header.css";

export type PanelHeaderProps = {
	title: ReactNode;
	/** A second line under the title: what this panel is showing right now. */
	sub?: ReactNode;
	/** Contextual actions, before the close control. IconButtons, usually. */
	actions?: ReactNode;
	onClose?: () => void;
	/** The close control's name. "Close" for a sheet or popover, "Hide panel"
	 *  for a rail panel that can be reopened from its rail button. */
	closeLabel?: string;
	density?: "panel" | "compact" | "tool";
	className?: string;
};

export function PanelHeader({
	title,
	sub,
	actions,
	onClose,
	closeLabel = "Close",
	density = "panel",
	className,
}: PanelHeaderProps): JSX.Element {
	return (
		<header data-slot="panel-header" data-density={density} className={cn("ui-phead", className)}>
			<div className="ui-phead-text">
				<h2 data-slot="panel-header-title" className="ui-phead-title">
					{title}
				</h2>
				{sub != null && (
					<p data-slot="panel-header-sub" className="ui-phead-sub">
						{sub}
					</p>
				)}
			</div>
			{(actions != null || onClose) && (
				<div className="ui-phead-actions">
					{actions}
					{onClose && (
						<IconButton size="xs" aria-label={closeLabel} title={closeLabel} onClick={onClose}>
							{Ic.x(ICON.md)}
						</IconButton>
					)}
				</div>
			)}
		</header>
	);
}
