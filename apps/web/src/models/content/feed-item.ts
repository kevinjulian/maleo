/* The shape of a content feed row as the server sends it.
 *
 * A wire type is a description, not a request, so it belongs beside the rules
 * that read it rather than beside the fetch that returns it: `feed-row.ts`
 * maps from this without reaching up into the api layer.
 */
export interface ContentProjectSummary {
	id: string;
	title: string;
	type: "video" | "image" | "text";
	status: string;
	target_platform: string | null;
	campaign_id: string | null;
	brief_json: {
		goal?: string | null;
	} | null;
	reference_notes: string | null;
	created_at: number;
	updated_at: number;
	output_count?: number;
}

export interface ContentFeedItem extends ContentProjectSummary {
	thumbnail_url?: string | null;
	duration_sec?: number | null;
	output_count?: number;
	campaign_name?: string | null;
	latest_output_status?: string | null;
	latest_output_updated_at?: number | null;
}

export interface ContentFeedResponse {
	items: ContentFeedItem[];
	total: number;
	limit: number;
	offset: number;
}
