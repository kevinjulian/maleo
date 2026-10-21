/* The collection's "nothing to show" state, as one component.
 *
 * It lived in `catalog/library-chrome.tsx`, which was fine while the library was
 * the only surface with collections. It is not: the images and speech galleries
 * render the same thing, and because the component was in another cluster they
 * each wrote the class by hand — which is the leak the census reports and the
 * reason this file exists rather than an export moving one directory.
 *
 * Four spellings before convergence: this component's inline style object (at
 * 13.5px, and invisible to every structural check), `.pl-empty` (the same
 * declarations as a class), `.gal-empty` (56px padding, 14px, `--fg-dim`) and
 * `.cat-busy` for the loading case.
 *
 * It now carries the three request states a collection has — EmptyState,
 * LoadingState and ErrorState — the one function that picks between them, and
 * the Pager that moves a server-paged collection through its pages.
 */
import type { JSX, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Callout } from "@design-system/components/note.tsx";
import { Spinner } from "@design-system/components/spinner.tsx";

/* The four things a collection region can be, decided in one place.
 *
 * "Nothing here" and "we could not find out" both have zero rows, which is how
 * surfaces came to say "No presets yet" beside their own error, or while still
 * loading. Rows win: a list that has data keeps showing it through a refresh
 * or a failed one, and reports the failure beside it (ErrorState `inline`).
 * Only with no rows does the region become a state. */
export type CollectionPhase = "ready" | "loading" | "failed" | "empty";

export function collectionPhase({
	count,
	loading,
	failed,
}: {
	count: number;
	loading: boolean;
	failed: boolean;
}): CollectionPhase {
	if (count > 0) return "ready";
	if (loading) return "loading";
	if (failed) return "failed";
	return "empty";
}

export interface EmptyStateProps {
	/** The line where the records would be. */
	label: ReactNode;
	/** A heading above it, for the surfaces that say what is empty before they
	 *  say why. The galleries do; a filtered library list does not need to. */
	title?: ReactNode;
}

/* Success with nothing to show. Never rendered for a failure or a pending
 * load: those are ErrorState and LoadingState. */
export function EmptyState({ label, title }: EmptyStateProps): JSX.Element {
	return (
		<div className="collection-empty" data-slot="empty-state">
			{title ? <strong className="collection-empty-title">{title}</strong> : null}
			{label}
		</div>
	);
}

/* Pending work in the region the rows will fill. A polite status, so it is
 * announced once and not on every frame of the spinner. */
export function LoadingState({ label }: { label: string }): JSX.Element {
	return (
		<div className="collection-empty" data-slot="loading-state" role="status" aria-busy="true">
			<Spinner size="md" />
			{label}
		</div>
	);
}

export interface ErrorStateProps {
	/** What failed, in the operator's terms: "Could not load materials". */
	title: ReactNode;
	/** The safe detail the feature chose to show. For a failed load say what
	 *  happened in plain terms; a raw client error names the route and the
	 *  server's text, which is not the operator's to read. */
	message?: ReactNode;
	/** Offered only when the feature can meaningfully try again. */
	onRetry?: () => void;
	/** The retry is running. */
	retrying?: boolean;
	/** `inline` sits above rows that are still shown; the default fills the
	 *  region when there is nothing to show. */
	inline?: boolean;
}

/* A failed load or action, with a way to recover where there is one. An alert,
 * so it is announced when it appears. */
export function ErrorState({
	title,
	message,
	onRetry,
	retrying = false,
	inline = false,
}: ErrorStateProps): JSX.Element {
	const retry = onRetry ? (
		<Button variant="secondary" size="sm" loading={retrying} onClick={onRetry}>
			Try again
		</Button>
	) : null;
	if (inline) {
		return (
			<Callout
				tone="error"
				as="div"
				role="alert"
				data-slot="error-state"
				data-variant="inline"
				className="tw:flex tw:items-center tw:justify-between tw:gap-3"
			>
				<span className="tw:min-w-0">
					<strong className="tw:font-semibold">{title}</strong>
					{message ? <> {message}</> : null}
				</span>
				{retry}
			</Callout>
		);
	}
	return (
		<div className="collection-empty" data-slot="error-state" data-variant="region" role="alert">
			<strong className="collection-empty-title">{title}</strong>
			{message}
			{retry}
		</div>
	);
}

export interface PagerProps {
	/** Names the navigation: "Export pages". */
	label: string;
	/** The 1-based rows shown and the collection's size. */
	range: { start: number; end: number; total: number };
	/** Where this page sits, when the feature knows the page count. */
	page?: { current: number; count: number };
	hasPrevious: boolean;
	hasNext: boolean;
	/** A page is loading: both directions wait for it. */
	busy?: boolean;
	onPrevious: () => void;
	onNext: () => void;
}

/* Previous/next over a server-paged collection, under its rows. Three surfaces
 * wrote this by hand (Projects, Video, God Mode) with three labels and three
 * counts. Hidden when everything fits: a pager with nowhere to go is noise. */
export function Pager({
	label,
	range,
	page,
	hasPrevious,
	hasNext,
	busy = false,
	onPrevious,
	onNext,
}: PagerProps): JSX.Element | null {
	if (!hasPrevious && !hasNext) return null;
	return (
		<nav aria-label={label} className="collection-pager" data-slot="pager">
			<span className="collection-pager-count">
				{range.start}–{range.end} of {range.total}
			</span>
			<span className="collection-pager-actions">
				<Button variant="secondary" size="sm" disabled={busy || !hasPrevious} onClick={onPrevious}>
					{Ic.chevronLeft(ICON.sm)} Previous
				</Button>
				{page && (
					<span className="collection-pager-count">
						Page {page.current} of {page.count}
					</span>
				)}
				<Button variant="secondary" size="sm" disabled={busy || !hasNext} onClick={onNext}>
					Next {Ic.chevronRight(ICON.sm)}
				</Button>
			</span>
		</nav>
	);
}
