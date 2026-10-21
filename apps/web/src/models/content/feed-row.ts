/* The feed item as the table renders it.
 *
 * The server feed is already project-centric — one row per project, with the
 * output aggregates resolved in SQL — so a row maps from a single item and
 * there is no client-side merge to do. `updatedAt` is the later of the
 * project's own timestamp and its latest output's, because a render that
 * finished after the last edit is still the most recent thing that happened.
 */
import type { ContentFeedItem } from "./feed-item.ts";

export interface ContentRowModel {
	projectId: string;
	title: string;
	type: "video" | "image" | "text";
	createdAt: number;
	updatedAt: number;
	thumbnailUrl: string | null;
	durationSec: number | null;
}

export function feedRowFromItem(item: ContentFeedItem): ContentRowModel {
	const latestOutputAt = item.latest_output_updated_at ?? 0;
	return {
		projectId: item.id,
		title: item.title,
		type: item.type,
		createdAt: item.created_at,
		updatedAt: Math.max(item.updated_at, latestOutputAt),
		thumbnailUrl: item.thumbnail_url ?? null,
		durationSec:
			item.duration_sec != null && Number.isFinite(item.duration_sec) && item.duration_sec > 0
				? item.duration_sec
				: null,
	};
}
