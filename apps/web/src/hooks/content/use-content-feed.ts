/* The content list's data: query, filter, page, and the request they drive.
 *
 * Search is debounced so a keystroke is not a request, and any change to the
 * query or the type filter resets to the first page — paging into a result set
 * that no longer exists is how you land on an empty page 4.
 */
import { useEffect, useMemo, useState } from "react";
import type { ProjectFeedSort } from "@maleo/shared";
import { CONTENT_PAGE_SIZE, fetchContentFeed } from "@api/feed.ts";
import type { ContentFeedItem } from "@models/content/feed-item.ts";
import type { ContentTypeFilter } from "@models/content/filters.ts";
import { feedRowFromItem, type ContentRowModel } from "@models/content/feed-row.ts";

const SEARCH_DEBOUNCE_MS = 300;

export interface ContentFeedModel {
	sort: ProjectFeedSort;
	setSort: (v: ProjectFeedSort) => void;
	rows: ContentRowModel[];
	total: number;
	loading: boolean;
	error: string | null;
	searchInput: string;
	setSearchInput: (v: string) => void;
	typeFilter: ContentTypeFilter;
	setTypeFilter: (v: ContentTypeFilter) => void;
	/** Whether anything is narrowing the list. An empty result means two
	 *  different things — this workspace holds nothing, or these filters match
	 *  nothing in it — and the empty state has to say which. */
	isFiltered: boolean;
	pageCount: number;
	currentPage: number;
	rangeStart: number;
	rangeEnd: number;
	/** Page boundaries, derived here so the page never needs the page size. */
	atFirstPage: boolean;
	atLastPage: boolean;
	toPrevPage: () => void;
	toNextPage: () => void;
	clearError: () => void;
	retry: () => void;
}

export function useContentFeed(): ContentFeedModel {
	const [items, setItems] = useState<ContentFeedItem[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [searchInput, setSearchInput] = useState("");
	const [searchQuery, setSearchQuery] = useState("");
	const [typeFilter, setTypeFilter] = useState<ContentTypeFilter>("all");
	const [sort, setSort] = useState<ProjectFeedSort>("modified");
	const [offset, setOffset] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [retryCount, setRetryCount] = useState(0);

	// Debounce the search box so each keystroke does not fire a request.
	useEffect(() => {
		const handle = setTimeout(() => setSearchQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(handle);
	}, [searchInput]);

	// Any filter or search change resets back to the first page.
	useEffect(() => {
		setOffset(0);
	}, [searchQuery, typeFilter, sort]);

	useEffect(() => {
		let alive = true;
		setLoading(true);
		void fetchContentFeed({ offset, searchQuery, typeFilter, sort })
			.then((res) => {
				if (!alive) return;
				setItems(res.items);
				setTotal(res.total);
				setError(null);
			})
			.catch((err: unknown) => {
				if (!alive) return;
				setError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [offset, searchQuery, typeFilter, sort, retryCount]);

	const rows = useMemo<ContentRowModel[]>(() => items.map(feedRowFromItem), [items]);

	return {
		sort,
		setSort,
		rows,
		total,
		loading,
		error,
		searchInput,
		setSearchInput,
		typeFilter,
		setTypeFilter,
		isFiltered: searchQuery.trim().length > 0 || typeFilter !== "all",
		pageCount: Math.max(1, Math.ceil(total / CONTENT_PAGE_SIZE)),
		currentPage: Math.floor(offset / CONTENT_PAGE_SIZE) + 1,
		rangeStart: total === 0 ? 0 : offset + 1,
		rangeEnd: Math.min(offset + rows.length, total),
		atFirstPage: offset === 0,
		atLastPage: offset + CONTENT_PAGE_SIZE >= total,
		toPrevPage: () => setOffset((current) => Math.max(0, current - CONTENT_PAGE_SIZE)),
		toNextPage: () => setOffset((current) => current + CONTENT_PAGE_SIZE),
		clearError: () => setError(null),
		retry: () => {
			setError(null);
			setRetryCount((n) => n + 1);
		},
	};
}
