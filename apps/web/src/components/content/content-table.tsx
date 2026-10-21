/* The content list's presentation: toolbar, list, pager, empty state.
 * State lives in `hooks/content/use-content-feed.ts`. */
import { useState, type JSX } from "react";
import { PROJECT_FEED_SORTS, type ProjectFeedSort } from "@maleo/shared";
import { assetUrl } from "@api/client.ts";
import { MediaCard, MediaGrid } from "@design-system/patterns/media.tsx";
import { Select, onSelect } from "@design-system/components/select.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import type { ContentTypeFilter } from "@models/content/filters.ts";
import type { ContentRowModel } from "@models/content/feed-row.ts";
import { SearchField } from "@design-system/components/search-field.tsx";
import { Toolbar, ToolbarGroup } from "@design-system/patterns/toolbar.tsx";
import { ChipButton } from "@design-system/components/chip.tsx";
import { Chip } from "@design-system/components/chip.tsx";

const CONTENT_TYPE_FILTERS: Array<{ value: ContentTypeFilter; label: string }> = [
	{ value: "all", label: "All" },
	{ value: "video", label: "Video" },
	{ value: "image", label: "Image" },
	{ value: "text", label: "Text" },
];

function compactDate(ts: number): string {
	return new Date(ts).toLocaleString("id-ID", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function ContentRow({
	row,
	view,
	onClick,
}: {
	row: ContentRowModel;
	view: "list" | "grid";
	onClick: () => void;
}): JSX.Element {
	const [broken, setBroken] = useState(false);
	const duration =
		row.durationSec == null
			? "Duration unknown"
			: `${Math.floor(row.durationSec / 60)}:${String(Math.floor(row.durationSec % 60)).padStart(2, "0")}`;
	return (
		<MediaCard
			className="content-row"
			layout={view}
			aspect={16 / 9}
			preview={
				row.thumbnailUrl ? (
					<img
						src={assetUrl(row.thumbnailUrl)}
						alt=""
						loading="lazy"
						onError={() => setBroken(true)}
					/>
				) : null
			}
			unavailable={broken ? "Preview unavailable" : row.thumbnailUrl ? undefined : "No preview"}
			unavailableIcon={
				row.type === "video"
					? Ic.film(ICON.md)
					: row.type === "image"
						? Ic.image(ICON.md)
						: Ic.type(ICON.md)
			}
			title={row.title}
			label={row.title}
			meta={
				<>
					<Chip>{row.type}</Chip>
					{row.type === "video" && <span>{duration}</span>}
					<span>created {compactDate(row.createdAt)}</span>
					<span>edited {compactDate(row.updatedAt)}</span>
				</>
			}
			onActivate={onClick}
		/>
	);
}

export function ContentToolbar({
	searchInput,
	onSearchInput,
	typeFilter,
	onTypeFilter,
	view,
	onView,
	sort,
	onSort,
}: {
	view: "list" | "grid";
	onView: (v: "list" | "grid") => void;
	sort: ProjectFeedSort;
	onSort: (v: ProjectFeedSort) => void;
	searchInput: string;
	onSearchInput: (v: string) => void;
	typeFilter: ContentTypeFilter;
	onTypeFilter: (v: ContentTypeFilter) => void;
}): JSX.Element {
	return (
		<Toolbar label="Search and filter projects" className="collection-toolbar">
			<SearchField
				label="Search projects"
				placeholder="Search title or description"
				value={searchInput}
				onValueChange={onSearchInput}
			/>
			<ToolbarGroup label="Filter projects by type" className="chip-row">
				{CONTENT_TYPE_FILTERS.map((filter) => (
					<ChipButton
						key={filter.value}
						variant="inline"
						on={typeFilter === filter.value}
						onClick={() => onTypeFilter(filter.value)}
					>
						{filter.label}
					</ChipButton>
				))}
			</ToolbarGroup>
			<Select
				aria-label="Sort projects"
				value={sort}
				width="auto"
				size="md"
				onValueChange={onSelect(PROJECT_FEED_SORTS, onSort)}
				options={[
					{ value: "modified", label: "Modified, newest first" },
					{ value: "modified-asc", label: "Modified, oldest first" },
					{ value: "name", label: "Name, A–Z" },
					{ value: "name-desc", label: "Name, Z–A" },
				]}
			/>
			<ToolbarGroup label="Project view">
				<ChipButton variant="inline" on={view === "list"} onClick={() => onView("list")}>
					List
				</ChipButton>
				<ChipButton variant="inline" on={view === "grid"} onClick={() => onView("grid")}>
					Grid
				</ChipButton>
			</ToolbarGroup>
		</Toolbar>
	);
}

export function ContentTable({
	rows,
	view = "list",
	onOpen,
}: {
	rows: ContentRowModel[];
	view?: "list" | "grid";
	onOpen: (projectId: string) => void;
}): JSX.Element {
	return (
		<MediaGrid label="Projects" layout={view} min={260} className="content-list">
			{rows.map((row) => (
				<ContentRow
					key={`${row.projectId}:${row.thumbnailUrl}`}
					row={row}
					view={view}
					onClick={() => onOpen(row.projectId)}
				/>
			))}
		</MediaGrid>
	);
}
