/* GenerationCard, GenerationProgress, GenerationError — one run of generation
 * work: what it is doing, how far along, what went wrong.
 *
 * None of them knows a pipeline. The feature maps its own phases to a label, a
 * tone and the one action the run may offer, and passes outputs as children.
 * A run that is history is rendered with no action; nothing here adds one.
 */
import type { JSX, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { cn } from "@models/core/cn.ts";
import { Spinner } from "@design-system/components/spinner.tsx";
import "./generation.css";

export interface GenerationCardProps {
	/** The run's state in the feature's own vocabulary, exposed as `data-phase`. */
	phase: string;
	/** Work is in flight: the region is `aria-busy`. */
	busy?: boolean;
	/** This is the newest run, the only one that may be acted on. */
	frontier?: boolean;
	/** The status line: a GenerationProgress. */
	status: ReactNode;
	className?: string;
	/** Activity, outputs, notes, an error, the result — in the order they read. */
	children?: ReactNode;
}

export function GenerationCard({
	phase,
	busy,
	frontier,
	status,
	className,
	children,
}: GenerationCardProps): JSX.Element {
	return (
		<div
			data-slot="generation-card"
			data-phase={phase}
			data-frontier={frontier ? "" : undefined}
			aria-busy={busy}
			className={cn("ui-gen", className)}
		>
			{status}
			{children}
		</div>
	);
}

export interface GenerationProgressProps {
	/** The stage or outcome in words: "Rewrite narration", "Partly done". */
	label: string;
	/** Still working. Shows activity instead of the settled glyph. */
	running?: boolean;
	/** A measure the feature can vouch for. Without one there is no bar, and no
	 *  percentage is invented. */
	count?: { done: number; total: number; unit: string };
	/** `active` while working; `warn` and `error` for a state that needs the
	 *  user. History takes none: a finished run is not a call to act. */
	tone?: "active" | "warn" | "error";
	/** Announce the stage to a screen reader when it changes. For the run the
	 *  user is waiting on; history stays silent. The count is not announced, so
	 *  a tick does not interrupt. */
	announce?: boolean;
	/** The one action this state allows, if any. */
	action?: ReactNode;
}

export function GenerationProgress({
	label,
	running,
	count,
	tone,
	announce,
	action,
}: GenerationProgressProps): JSX.Element {
	const measured = count && count.total > 0 ? `${count.done}/${count.total} ${count.unit}` : null;
	return (
		<>
			<div className="ui-gen-status" data-tone={tone}>
				<span className="ui-gen-state" aria-hidden="true">
					{running ? <Spinner size="xs" /> : Ic.info(ICON.xs)}
				</span>
				<span data-gen="stage" className="ui-gen-stage" role={announce ? "status" : undefined}>
					{label}
				</span>
				{measured && (
					<span data-gen="count" className="ui-gen-count">
						{measured}
					</span>
				)}
				{action != null && (
					<span data-gen="action" className="ui-gen-action">
						{action}
					</span>
				)}
			</div>
			{running && measured && count && (
				<progress
					className="ui-gen-bar"
					value={count.done}
					max={count.total}
					aria-label={measured}
				/>
			)}
		</>
	);
}

export interface GenerationErrorProps {
	/** What failed, in the user's terms. */
	title: string;
	/** A short reference a person can quote. */
	code?: string;
	/** The safe, actionable cause. */
	message: string;
	/** Technical detail behind a disclosure. The feature redacts it first. */
	detail?: string;
	className?: string;
}

export function GenerationError({
	title,
	code,
	message,
	detail,
	className,
}: GenerationErrorProps): JSX.Element {
	return (
		<div data-slot="generation-error" className={cn("ui-gen-error", className)}>
			<div className="ui-gen-error-h">
				<span>{title}</span>
				{code && <span className="ui-gen-error-code">{code}</span>}
			</div>
			<div className="ui-gen-error-body">{message}</div>
			{detail && (
				<details>
					<summary>Details</summary>
					<pre>{detail}</pre>
				</details>
			)}
		</div>
	);
}
