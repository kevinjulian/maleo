/* The gallery's filter vocabulary and its attribution rule.
 *
 * Pure and separately testable: the component renders what these return, and the
 * attribution rule in particular is the thing most worth pinning — a tile that
 * mislabels where an image came from is worse than one that says nothing.
 */
import type { LedgerImage } from "@models/image-lab/image-job.ts";

export const GALLERY_PAGE_SIZE = 60;

export type SourceFilter = "all" | "lab" | "clip" | "reference" | "agent";

/* Product vocabulary, not the column's. "clip" is a database value; an operator
 * thinks in terms of the surface that produced the image. */
export const SOURCE_FILTERS: ReadonlyArray<{ value: SourceFilter; label: string }> = [
	{ value: "all", label: "All" },
	{ value: "clip", label: "Projects" },
	{ value: "lab", label: "Lab" },
	{ value: "reference", label: "References" },
	{ value: "agent", label: "Assistant" },
];

/* No `workspace`. The gallery shows the ACTIVE workspace and offers no control
 * to change it, so a workspace in the filter vocabulary would be a second answer
 * to a question one control already decides — and, in the URL, a link that
 * silently disagreed with the workspace the shell says is active. */
export interface GalleryFilters {
	source: SourceFilter;
	/** A project id, or "" for no project filter. */
	project: string;
	search: string;
}

export const EMPTY_GALLERY_FILTERS: GalleryFilters = { source: "all", project: "", search: "" };

function isSourceFilter(value: string | null | undefined): value is SourceFilter {
	return (
		value === "all" ||
		value === "lab" ||
		value === "clip" ||
		value === "reference" ||
		value === "agent"
	);
}

/** Read filters off a query string, so a narrowed gallery is shareable. */
export function filtersFromSearch(search: string): GalleryFilters {
	const params = new URLSearchParams(search);
	const source = params.get("source");
	return {
		source: isSourceFilter(source) ? source : "all",
		project: params.get("project")?.trim() ?? "",
		search: params.get("q")?.trim() ?? "",
	};
}

/** The inverse. Defaults are omitted so a plain /images stays a plain url. */
export function filtersToSearch(filters: GalleryFilters): string {
	const params = new URLSearchParams();
	if (filters.source !== "all") params.set("source", filters.source);
	if (filters.project) params.set("project", filters.project);
	if (filters.search) params.set("q", filters.search);
	const query = params.toString();
	return query ? `?${query}` : "";
}

/* Where an image came from, in one line.
 *
 * A project name when it has one. A workspace when it does not — and that is a
 * real answer, not a fallback: a lab or reference image belongs to no project,
 * which the ledger records as a null rather than as "unknown".
 *
 * An image whose project was deleted keeps its row and its workspace but loses
 * its title, so it reads as its workspace rather than as a dangling id. */
export function attributionOf(
	image: Pick<LedgerImage, "project_id" | "project_title" | "workspace">,
): string {
	if (image.project_id && image.project_title) return image.project_title;
	return image.workspace;
}
