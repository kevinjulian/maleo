/* The image lab's requests. The lab and its gallery render what these return;
 * neither builds a URL or calls the client itself. */
import { del, get, post } from "./client.ts";

export function fetchImageGenHealth<T>(): Promise<T> {
	return get<T>("/api/image-gen/health");
}

/** Recorded images, newest first. Unscoped by default: this reads the ledger,
 *  which spans every workspace and project — not one workspace's prompt list. */
export function fetchImages<T>(
	opts: {
		limit?: number;
		offset?: number;
		workspace?: string;
		/** "none" selects images belonging to no project. */
		project?: string;
		source?: "lab" | "clip" | "reference" | "agent";
		search?: string;
	} = {},
): Promise<{ items: T[] }> {
	const params = new URLSearchParams();
	if (opts.limit != null) params.set("limit", String(opts.limit));
	if (opts.offset != null) params.set("offset", String(opts.offset));
	if (opts.workspace) params.set("workspace", opts.workspace);
	if (opts.project) params.set("project", opts.project);
	if (opts.source) params.set("source", opts.source);
	if (opts.search?.trim()) params.set("q", opts.search.trim());
	const query = params.toString();
	return get<{ items: T[] }>(`/api/image-gen/images${query ? `?${query}` : ""}`);
}

export interface StartImageJob {
	prompt: string;
	workspace?: string;
	aspect: string;
	reference_image_urls?: string[];
}

export function startImageGeneration(
	body: StartImageJob,
): Promise<{ job_id?: string; error?: string }> {
	return post<{ job_id?: string; error?: string }>("/api/image-gen/generate", body);
}

export function fetchImageJob<T>(jobId: string): Promise<T> {
	return get<T>(`/api/image-gen/jobs/${jobId}`);
}

/** The gallery's project filter options, within one workspace. No workspace
 *  facet: the gallery shows the active workspace and offers no way out of it. */
export function fetchImageFacets(
	workspace: string,
): Promise<{ projects: Array<{ id: string; title: string }> }> {
	return get<{ projects: Array<{ id: string; title: string }> }>(
		`/api/image-gen/images/facets?workspace=${encodeURIComponent(workspace)}`,
	);
}

export function starImage(id: string): Promise<void> {
	return post(`/api/image-gen/images/${encodeURIComponent(id)}/star`, {});
}

/** Hides the image. The ledger row survives, because it is the artifact side of a
 *  metered, billed generation. */
export function deleteImage(id: string): Promise<void> {
	return del(`/api/image-gen/images/${encodeURIComponent(id)}`);
}
