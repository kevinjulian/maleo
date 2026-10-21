import type { JobStatus } from "./render-job.ts";
export const EXPORT_STATUSES: JobStatus[] = [
	"queued",
	"running",
	"done",
	"done_with_fallback",
	"error",
	"cancelled",
];
/** Rows per page of the export collection; the server caps at its own limit. */
export const EXPORT_PAGE_SIZE = 60;
export interface ExportFilters {
	search: string;
	project: string;
	status: string;
	offset: number;
}
export function exportFilters(search: string): ExportFilters {
	const params = new URLSearchParams(search);
	const offset = Number(params.get("offset") ?? 0);
	return {
		search: params.get("search") ?? "",
		project: params.get("project") ?? "",
		status: EXPORT_STATUSES.some((status) => status === params.get("status"))
			? params.get("status")!
			: "",
		offset: Number.isSafeInteger(offset) && offset > 0 ? offset : 0,
	};
}
export function exportQuery(filters: ExportFilters, workspace: string): URLSearchParams {
	const params = new URLSearchParams({ workspace });
	if (filters.search) params.set("search", filters.search);
	if (filters.project) params.set("project", filters.project);
	if (filters.status) params.set("status", filters.status);
	if (filters.offset) params.set("offset", String(filters.offset));
	return params;
}
