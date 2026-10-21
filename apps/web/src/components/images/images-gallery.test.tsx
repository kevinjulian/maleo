import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ImagesGallery } from "./images-gallery.tsx";
import { EMPTY_GALLERY_FILTERS } from "@models/images/gallery-filters.ts";

// Static render + source assertions (the harness has no DOM or event layer).
const html = (): string =>
	renderToStaticMarkup(<ImagesGallery filters={EMPTY_GALLERY_FILTERS} onFilters={() => {}} />);

describe("ImagesGallery", () => {
	test("renders as a page, using the shared header rather than a ninth idiom", () => {
		const out = html();
		expect(out).toContain("pg-title");
		expect(out).toContain("Images");
	});

	test("offers a filter for each producing source", () => {
		const out = html();
		// Product vocabulary, not column values.
		for (const label of ["All", "Projects", "Lab", "References", "Assistant"]) {
			expect(out).toContain(label);
		}
	});

	test("counts images, not prompts", () => {
		const src = readFileSync(`${import.meta.dirname}/images-gallery.tsx`, "utf8");
		// The surface this replaces rendered `{items.length} images` over a
		// prompt-per-row table, so the number was never a count of images.
		expect(src).toContain('items.length === 1 ? "image" : "images"');
	});

	test("reads the ledger for the active workspace, not one workspace's prompt list", () => {
		const src = readFileSync(`${import.meta.dirname}/images-gallery.tsx`, "utf8");
		expect(src).toContain("fetchImages<LedgerImage>");
		expect(src).not.toContain("fetchPromptHistory");
	});

	test("names the workspace it is empty for, and only when the load succeeded", () => {
		const src = readFileSync(`${import.meta.dirname}/images-gallery.tsx`, "utf8");
		// Most workspaces own nothing, so a correct empty gallery is the ordinary
		// case. Without the workspace in the copy it reads as "the images are
		// gone"; without the phase check it renders on top of the failure.
		// A template literal: the heading is a prop on the shared `EmptyState` now.
		expect(src).toContain("No images in ${workspace} yet");
		/* Emptiness is decided by `collectionPhase`, which never returns "empty"
		 * for a failed or pending load; the gallery renders EmptyState only then. */
		expect(src).toContain(
			"collectionPhase({ count: items.length, loading, failed: error !== null })",
		);
		expect(src).toContain('phase === "empty" ? (');
	});

	test("hides an image rather than erasing the record", () => {
		const src = readFileSync(`${import.meta.dirname}/images-gallery.tsx`, "utf8");
		expect(src).toContain("deleteImage(id)");
	});

	test("says so when a recovered image has no prompt", () => {
		const src = readFileSync(`${import.meta.dirname}/images-gallery.tsx`, "utf8");
		// A backfilled row's prompt was never recorded; an empty box would read as
		// "generated with no prompt", which is a different claim.
		expect(src).toContain("Prompt not recorded");
	});
});

/* An operator narrows by project and source. Workspace is NOT one of the axes:
 * the gallery shows the ACTIVE workspace, and a filter here would be the one
 * remaining way to see another tenant's images while the shell says otherwise. */
describe("narrowing controls", () => {
	const src = (): string => readFileSync(`${import.meta.dirname}/images-gallery.tsx`, "utf8");

	test("renders a control for each filter axis it still has", () => {
		const out = html();
		expect(out).toContain('aria-label="Filter images by project"');
		expect(out).toContain('aria-label="Filter images by source"');
	});

	test("offers no workspace control at all", () => {
		// Removed, not hidden. One control decides the tenant, and it is the
		// switcher in the shell.
		const out = html();
		expect(out).not.toContain('aria-label="Filter images by workspace"');
		expect(out).not.toContain("All workspaces");
	});

	test("offers an unnarrowed option on the project select", () => {
		expect(html()).toContain("All projects");
	});

	test("each control reports through onFilters, keeping filters URL-backed", () => {
		// State lives with the caller, which mirrors it into the address bar — a
		// control holding its own state would make a narrowed view unshareable.
		expect(src()).toContain("onFilters({ ...filters, project: e })");
		expect(src()).toContain(
			"const setSource = (source: SourceFilter): void => onFilters({ ...filters, source });",
		);
	});

	test("passes both filter axes and the active workspace to the fetch", () => {
		const code = src();
		expect(code).toContain('source: filters.source === "all" ? undefined : filters.source');
		expect(code).toContain("project: filters.project || undefined");
		// From the switcher, not from a filter. Image reads share a route family
		// with the generation calls, so the api client does not add it for them.
		expect(code).toContain("const workspace = useActiveWorkspace();");
		expect(code).toContain("workspace,");
	});

	test("scopes its project options to the active workspace", () => {
		// An unscoped facet would offer another tenant's project TITLES in the
		// dropdown — a disclosure that survives every filter applied afterwards.
		expect(src()).toContain("fetchImageFacets(workspace)");
	});
});
