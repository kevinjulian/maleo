import { describe, expect, it } from "vite-plus/test";
import {
	attributionOf,
	filtersFromSearch,
	filtersToSearch,
	EMPTY_GALLERY_FILTERS,
	type GalleryFilters,
} from "./gallery-filters.ts";

const image = (over: Partial<Parameters<typeof attributionOf>[0]> = {}) => ({
	project_id: null,
	project_title: null,
	workspace: "acme",
	...over,
});

/* Attribution is the gallery's one hard requirement: a tile showing every
 * project's output has to say which one an image came from. Mislabelling is worse
 * than saying nothing, so each case is pinned. */
describe("attribution", () => {
	it("names the project when an image has one", () => {
		expect(attributionOf(image({ project_id: "p1", project_title: "Spring spot" }))).toBe(
			"Spring spot",
		);
	});

	it("names the workspace when an image belongs to no project", () => {
		// A lab or reference image genuinely has no project. That is an answer, not
		// a gap, so it must not read as "unknown".
		expect(attributionOf(image())).toBe("acme");
	});

	it("falls back to the workspace when the project was deleted", () => {
		// The LEFT JOIN keeps the image; only the title is gone. A dangling id would
		// be worse than the workspace it still belongs to.
		expect(attributionOf(image({ project_id: "gone", project_title: null }))).toBe("acme");
	});
});

describe("filters in the url", () => {
	it("defaults to everything when the query is empty", () => {
		expect(filtersFromSearch("")).toEqual(EMPTY_GALLERY_FILTERS);
	});

	it("round-trips a narrowed view", () => {
		const filters: GalleryFilters = { source: "clip", project: "p1", search: "coat" };
		expect(filtersFromSearch(filtersToSearch(filters))).toEqual(filters);
	});

	it("keeps a plain gallery url plain", () => {
		// Defaults are omitted so /images does not grow ?source=all&project=…
		expect(filtersToSearch(EMPTY_GALLERY_FILTERS)).toBe("");
	});

	it("ignores a source it does not recognise", () => {
		expect(filtersFromSearch("?source=nonsense").source).toBe("all");
	});

	/* No workspace case. The gallery shows the ACTIVE workspace and offers no
	   control to change it, so a `?workspace=` in a gallery link would be a second
	   answer to a question the switcher already decides — and one the shell's own
	   chip would contradict. */
	it("carries the workspace parameter in neither direction", () => {
		expect(filtersToSearch({ source: "all", project: "", search: "" })).toBe("");
		expect(Object.keys(filtersFromSearch("?workspace=veronika"))).not.toContain("workspace");
	});

	it("reads each filter independently", () => {
		expect(filtersFromSearch("?source=agent").source).toBe("agent");
		expect(filtersFromSearch("?project=p9").project).toBe("p9");
		expect(filtersFromSearch("?q=blue+cube").search).toBe("blue cube");
	});
});
