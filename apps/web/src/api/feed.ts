/* The content feed request. The list screen renders what this returns; it
 * does not build the URL or call the client itself. */
import { get } from "./client.ts";
import type { ProjectFeedSort } from "@maleo/shared";
import type { ContentTypeFilter } from "@models/content/filters.ts";
import type { ContentFeedResponse } from "@models/content/feed-item.ts";
// Re-exported so callers name the wire types through the module that fetches them.
export type {
	ContentFeedItem,
	ContentFeedResponse,
	ContentProjectSummary,
} from "@models/content/feed-item.ts";

export const CONTENT_PAGE_SIZE = 20;

export function contentFeedUrl({
	offset,
	searchQuery,
	typeFilter,
	sort,
}: {
	offset: number;
	searchQuery: string;
	typeFilter: ContentTypeFilter;
	sort?: ProjectFeedSort;
}): string {
	const params = new URLSearchParams({ limit: String(CONTENT_PAGE_SIZE), offset: String(offset) });
	if (searchQuery) params.set("search", searchQuery);
	if (typeFilter !== "all") params.set("type", typeFilter);
	if (sort && sort !== "modified") params.set("sort", sort);
	return `/api/operations/content/feed?${params.toString()}`;
}

export function fetchContentFeed(q: {
	sort?: ProjectFeedSort;
	offset: number;
	searchQuery: string;
	typeFilter: ContentTypeFilter;
}): Promise<ContentFeedResponse> {
	return get<ContentFeedResponse>(contentFeedUrl(q));
}
