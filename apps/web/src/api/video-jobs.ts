import { get, post } from "./client.ts";
import type { Job } from "@models/video/render-job.ts";

export interface VideoJobsPage {
	items: Job[];
	total: number;
	limit: number;
	offset: number;
	has_more: boolean;
	next_offset: number | null;
	projects: { id: string; title: string }[];
}
export function fetchVideoJobs(query: URLSearchParams): Promise<VideoJobsPage> {
	return get(`/api/video/jobs?${query}`);
}
export function retryVideoRender(id: string, qs: string): Promise<void> {
	return post(`/api/video/render/${encodeURIComponent(id)}/retry?${qs}`, {});
}
