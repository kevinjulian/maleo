import { useEffect, useState, type JSX } from "react";
import { useVideoRender } from "@hooks/video/use-video-render.ts";
import { ExportRow } from "@components/video/export-row.tsx";
import { ExportDetails } from "@components/video/export-details.tsx";
import { Page, PageHeader } from "@design-system/components/page.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Chip } from "@design-system/components/chip.tsx";
import { SearchField } from "@design-system/components/search-field.tsx";
import { Select } from "@design-system/components/select.tsx";
import { Modal } from "@design-system/components/modal.tsx";
import { Toolbar } from "@design-system/patterns/toolbar.tsx";
import {
	EmptyState,
	LoadingState,
	ErrorState,
	Pager,
} from "@design-system/patterns/collection.tsx";
import { MediaGrid } from "@design-system/patterns/media.tsx";
import { EXPORT_PAGE_SIZE, EXPORT_STATUSES } from "@models/video/export-filters.ts";

export function VideoPage({
	onOpenProject,
	onNewProject,
}: {
	onOpenProject?: (id: string) => void;
	onNewProject?: () => void;
}): JSX.Element {
	const render = useVideoRender();
	const [selected, setSelected] = useState<string | null>(null);
	useEffect(
		() => setSelected(null),
		[
			render.workspace,
			render.filters.search,
			render.filters.project,
			render.filters.status,
			render.filters.offset,
		],
	);
	const job = render.jobs.find((j) => j.id === selected);
	const filtered = Boolean(
		render.filters.search || render.filters.project || render.filters.status,
	);
	return (
		<Page>
			<PageHeader
				title="Video"
				lead={`Project exports in ${render.workspace}.`}
				action={
					<>
						<Chip>
							{render.total} export {render.total === 1 ? "attempt" : "attempts"}
						</Chip>
						{onNewProject && (
							<Button variant="primary" onClick={onNewProject}>
								{Ic.plus(ICON.md)} New project
							</Button>
						)}
					</>
				}
			/>
			<Toolbar label="Search and filter exports" className="collection-toolbar">
				<SearchField
					label="Search project titles"
					placeholder="Search projects"
					value={render.filters.search}
					onValueChange={(search) => render.applyFilters({ search })}
				/>
				<Select
					aria-label="Filter exports by project"
					width="auto"
					size="md"
					value={render.filters.project}
					onValueChange={(project) => render.applyFilters({ project })}
					options={[
						{ value: "", label: "All projects" },
						...render.projects.map((p) => ({ value: p.id, label: p.title })),
					]}
				/>
				<Select
					aria-label="Filter exports by status"
					width="auto"
					size="md"
					value={render.filters.status}
					onValueChange={(status) => render.applyFilters({ status })}
					options={[
						{ value: "", label: "All statuses" },
						...EXPORT_STATUSES.map((value) => ({ value, label: value.replaceAll("_", " ") })),
					]}
				/>
			</Toolbar>
			{render.error && (
				<ErrorState
					inline={render.jobs.length > 0}
					title="Could not update exports"
					message={render.error}
					onRetry={render.refresh}
					retrying={render.loading}
				/>
			)}
			{render.jobs.length > 0 ? (
				<MediaGrid label="Project export attempts" layout="list">
					{render.jobs.map((j) => (
						<ExportRow key={j.id} job={j} onDetails={() => setSelected(j.id)} />
					))}
				</MediaGrid>
			) : render.loading ? (
				<LoadingState label="Loading exports…" />
			) : (
				!render.error && (
					<EmptyState
						title={filtered ? "No matching exports" : "No project exports yet"}
						label={
							filtered ? (
								<>
									<span>Change the search or filters. </span>
									<Button
										variant="secondary"
										onClick={() => render.applyFilters({ search: "", project: "", status: "" })}
									>
										Reset filters
									</Button>
								</>
							) : (
								"Export a video from a project. It will appear here."
							)
						}
					/>
				)
			)}
			<Pager
				label="Export pages"
				range={{
					start: render.jobs.length ? render.filters.offset + 1 : 0,
					end: render.filters.offset + render.jobs.length,
					total: render.total,
				}}
				hasPrevious={render.filters.offset > 0}
				hasNext={render.hasMore}
				busy={render.loading}
				onPrevious={() =>
					render.applyFilters({ offset: Math.max(0, render.filters.offset - EXPORT_PAGE_SIZE) })
				}
				onNext={() => render.applyFilters({ offset: render.nextOffset ?? 0 })}
			/>
			{job && (
				<Modal
					dismissOnBack
					title={`Export: ${job.project_title || "Untitled project"}`}
					sub={`${job.status.replaceAll("_", " ")} · ${job.id}`}
					width={800}
					onClose={() => setSelected(null)}
				>
					<ExportDetails
						key={job.id}
						job={job}
						actionError={render.error}
						onRefresh={render.refresh}
						onOpenProject={onOpenProject}
						onRetry={render.retryJob}
					/>
				</Modal>
			)}
		</Page>
	);
}
