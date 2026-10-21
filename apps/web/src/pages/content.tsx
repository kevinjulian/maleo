/* The content route: the project list, and the way into the editor. */
import { useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { useContentFeed } from "@hooks/content/use-content-feed.ts";
import { ContentTable, ContentToolbar } from "@components/content/content-table.tsx";
import { EmptyState, Pager } from "@design-system/patterns/collection.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Page, PageHeader } from "@design-system/components/page.tsx";
import { useActiveWorkspace } from "@hooks/workspace/use-active-workspace.ts";
import "./content.css";
import { Chip } from "@design-system/components/chip.tsx";
import { Callout } from "@design-system/components/note.tsx";

interface ContentPageProps {
	onOpenProject?: (projectId: string) => void;
	onCreate?: () => void;
}

export function ContentPage({ onOpenProject, onCreate }: ContentPageProps = {}): JSX.Element {
	const workspace = useActiveWorkspace();
	const feed = useContentFeed();
	// Local to the click: a brief "Opening editor…" while the route changes.
	const [opening, setOpening] = useState<string | null>(null);
	const [view, setView] = useState<"list" | "grid">("list");

	function openProjectEditor(projectId: string): void {
		setOpening(projectId);
		feed.clearError();
		onOpenProject?.(projectId);
		setTimeout(() => setOpening((current) => (current === projectId ? null : current)), 150);
	}

	return (
		<Page>
			<PageHeader
				title="Projects"
				lead={`Projects in ${workspace}. Pick one to continue, or create a new project.`}
				action={
					<>
						<Chip>{feed.total} projects</Chip>
						{onCreate && (
							<Button type="button" variant="primary" onClick={onCreate}>
								{Ic.plus(ICON.md)} New project
							</Button>
						)}
					</>
				}
			/>

			{feed.error && (
				<Callout as="div" tone="error" className="content-error" role="alert">
					<span>Could not load projects.</span>
					<Button type="button" size="sm" variant="secondary" onClick={feed.retry}>
						Retry
					</Button>
				</Callout>
			)}

			<section className="content-card" aria-label="Projects">
				<ContentToolbar
					searchInput={feed.searchInput}
					view={view}
					onView={setView}
					sort={feed.sort}
					onSort={feed.setSort}
					onSearchInput={feed.setSearchInput}
					typeFilter={feed.typeFilter}
					onTypeFilter={feed.setTypeFilter}
				/>

				{feed.loading ? (
					<div className="content-loading" role="status">
						Loading projects…
					</div>
				) : feed.error ? null : feed.rows.length === 0 ? (
					/* Names the workspace, and only when the load succeeded — the error
					   card above already owns the failure case, and a failed load also
					   has zero rows. Most workspaces own nothing after scoping, so a
					   correct empty list is the ordinary case and would otherwise be
					   indistinguishable from the app being broken. */
					feed.isFiltered ? (
						<EmptyState
							title={`Nothing in ${workspace} matches`}
							label="No projects in this workspace match the current filters."
						/>
					) : (
						<EmptyState
							title={`${workspace} has no projects yet`}
							label="Create a project to start, or switch workspace to see another's work."
						/>
					)
				) : (
					<ContentTable rows={feed.rows} view={view} onOpen={openProjectEditor} />
				)}

				{feed.total > 0 && !feed.error ? (
					<Pager
						label="Project pages"
						range={{ start: feed.rangeStart, end: feed.rangeEnd, total: feed.total }}
						page={{ current: feed.currentPage, count: feed.pageCount }}
						hasPrevious={!feed.atFirstPage}
						hasNext={!feed.atLastPage}
						busy={feed.loading}
						onPrevious={feed.toPrevPage}
						onNext={feed.toNextPage}
					/>
				) : null}
			</section>

			{opening ? (
				<div className="content-opening" role="status">
					Opening editor…
				</div>
			) : null}
		</Page>
	);
}
