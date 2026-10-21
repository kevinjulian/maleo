/* The speech gallery's filter vocabulary and its attribution rule.
 *
 * Deliberately parallel to models/images/gallery-filters.ts rather than shared
 * with it: the two galleries agree on shape and disagree on vocabulary, and the
 * disagreement is the point. Speech has no `reference` source and images have no
 * `scene` one, so one union covering both would let each gallery offer a filter
 * value its medium can never produce — a control that always returns nothing.
 */
import type { LedgerClip } from "./clip.ts";

export const SPEECH_PAGE_SIZE = 60;

export type SpeechSourceFilter = "all" | "lab" | "scene" | "agent";

/* Product vocabulary, not the column's. "scene" is a database value; an operator
 * thinks in terms of the surface that produced the clip. */
export const SPEECH_SOURCE_FILTERS: ReadonlyArray<{ value: SpeechSourceFilter; label: string }> = [
	{ value: "all", label: "All" },
	{ value: "scene", label: "Projects" },
	{ value: "lab", label: "Lab" },
	{ value: "agent", label: "Assistant" },
];

/* No `workspace`, for the same reason the image gallery has none: the gallery
 * shows the ACTIVE workspace and offers no control to change it, so a workspace
 * in the filter vocabulary would be a second answer to a question one control
 * already decides — and, in the URL, a link that silently disagreed with the
 * workspace the shell says is active. */
export interface SpeechFilters {
	source: SpeechSourceFilter;
	/** A project id, or "" for no project filter. */
	project: string;
	search: string;
}

export const EMPTY_SPEECH_FILTERS: SpeechFilters = { source: "all", project: "", search: "" };

function isSpeechSourceFilter(value: string | null | undefined): value is SpeechSourceFilter {
	return value === "all" || value === "lab" || value === "scene" || value === "agent";
}

/** Read filters off a query string, so a narrowed gallery is shareable. */
export function speechFiltersFromSearch(search: string): SpeechFilters {
	const params = new URLSearchParams(search);
	const source = params.get("source");
	return {
		source: isSpeechSourceFilter(source) ? source : "all",
		project: params.get("project")?.trim() ?? "",
		search: params.get("q")?.trim() ?? "",
	};
}

/** The inverse. Defaults are omitted so a plain /speech stays a plain url. */
export function speechFiltersToSearch(filters: SpeechFilters): string {
	const params = new URLSearchParams();
	if (filters.source !== "all") params.set("source", filters.source);
	if (filters.project) params.set("project", filters.project);
	if (filters.search) params.set("q", filters.search);
	const query = params.toString();
	return query ? `?${query}` : "";
}

/* Where a clip came from, in one line. A project name when it has one, the
 * workspace when it does not — and that is a real answer, not a fallback: a lab
 * synthesis belongs to no project, which the ledger records as a null rather than
 * as "unknown". */
export function clipAttributionOf(
	clip: Pick<LedgerClip, "project_id" | "project_title" | "workspace">,
): string {
	if (clip.project_id && clip.project_title) return clip.project_title;
	return clip.workspace;
}

/** mm:ss for a clip's duration. Null durations happen — an older row, or a format
 *  the prober could not read — and read as an em dash rather than as 0:00, which
 *  would claim the clip is empty. */
export function formatClipDuration(seconds: number | null): string {
	if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
	const whole = Math.round(seconds);
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
