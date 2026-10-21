/* Toolbar, ToolbarGroup, ToolbarAction — the actions of one work region.
 *
 * Three parts because three things kept being decided locally: where a strip
 * wraps, where the rule between groups of actions goes, and what a toolbar
 * button looks like. The timeline bar spelled the rule as a `<span>` between
 * buttons and drew three of its buttons by hand; each Library strip wrapped its
 * own way.
 *
 * `role="group"`, not `role="toolbar"`: a toolbar promises one tab stop and
 * arrow-key movement, and these strips hold sliders, search fields and popover
 * triggers that need the arrows themselves. Every action stays a tab stop.
 */
import type { JSX, ReactNode } from "react";
import { cn } from "@models/core/cn.ts";
import { Button } from "@design-system/components/button.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import "./toolbar.css";

export function Toolbar({
	label,
	className,
	children,
}: {
	/** Names the region: "Timeline tools", "Search and filter". */ label: string;
	className?: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<div data-slot="toolbar" role="group" aria-label={label} className={cn("ui-tbar", className)}>
			{children}
		</div>
	);
}

export function ToolbarGroup({
	label,
	className,
	children,
}: {
	/** Announced when the group needs a name of its own, such as "Zoom". */ label?: string;
	className?: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<div
			data-slot="toolbar-group"
			role={label ? "group" : undefined}
			aria-label={label}
			className={cn("ui-tbar-group", className)}
		>
			{children}
		</div>
	);
}

/* A labelled toggle's selected look: the selection role, as IconButton's `on`.
 * Important, because it has to replace the ghost button's own paint and `cn`
 * does not resolve two utilities for one property. */
const PRESSED = "tw:bg-[var(--ai-bg)]! tw:text-ai!";

export interface ToolbarActionProps {
	/** The accessible name of an icon-only action, short: "Undo", "Split clip".
	 *  A labelled action is named by its text. */
	label: string;
	/** The pointer hint, where it says more than the name: a shortcut, a reason. */
	hint?: string;
	icon?: ReactNode;
	/** Visible text. Without it the action is icon-only and `label` is its name. */
	children?: ReactNode;
	/** A toggle's state. Given (true or false), the action announces `aria-pressed`. */
	on?: boolean;
	danger?: boolean;
	disabled?: boolean;
	/** The command is running: presses are ignored and a labelled action shows it. */
	busy?: boolean;
	onAction: () => void;
	className?: string;
}

export function ToolbarAction({
	label,
	hint,
	icon,
	children,
	on,
	danger,
	disabled,
	busy,
	onAction,
	className,
}: ToolbarActionProps): JSX.Element {
	const press = (): void => {
		if (!busy) onAction();
	};
	if (children == null) {
		return (
			<IconButton
				size="xs"
				aria-label={label}
				title={hint ?? label}
				on={on}
				danger={danger}
				disabled={disabled}
				aria-busy={busy || undefined}
				className={className}
				onClick={press}
			>
				{icon}
			</IconButton>
		);
	}
	return (
		<Button
			variant="ghost"
			size="xs"
			title={hint}
			aria-pressed={on}
			disabled={disabled}
			loading={busy}
			className={cn(on && PRESSED, className)}
			onClick={press}
		>
			{icon}
			{children}
		</Button>
	);
}
