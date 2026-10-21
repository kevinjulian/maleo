import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";

/* Comments stripped: this file's header names the very chrome it removed —
 * `selectedId`, `() => undefined`, 288x512 — so asserting against the raw text
 * would match the explanation rather than the code. */
const src = (): string =>
	readFileSync(`${import.meta.dirname}/templates-library.tsx`, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

/* The page used to render the editor's Templates rail verbatim, which handed a
 * top-level surface a panel header, a close button that closed nothing, an
 * Active marker for a project that was not open, and a preview sized for a rail.
 * The rows are the library's now; the editor behind them is still the editor's. */
describe("Library > Video Templates is a catalogue, not an embedded panel", () => {
	test("it does not mount the editor's templates panel", () => {
		expect(src()).not.toContain("TimelineTemplatesPanel");
	});

	test("it renders the shared catalogue row", () => {
		expect(src()).toContain('className="collection-card collection-card-row"');
	});

	/* The tell for panel chrome on a page: handlers that exist only to satisfy a
	 * prop, wired to a function that does nothing. */
	test("it passes no no-op handlers and no project-only selection", () => {
		const source = src();
		expect(source).not.toContain("() => undefined");
		expect(source).not.toContain("selectedId");
		expect(source).not.toContain("selectable");
	});

	test("the preview is sized for a page, not for a 288px rail", () => {
		const source = src();
		expect(source).not.toContain("288");
		expect(source).toContain("const PREVIEW_WIDTH = 360;");
	});
});

/* Create and edit stay one implementation, shared with the editor. */
describe("the shared template editor is what edits a template", () => {
	test("the catalogue opens the editor modal rather than reimplementing it", () => {
		const source = src();
		expect(source).toContain("TimelineTemplateEditorModal");
		expect(source).toContain('from "@components/timeline/timeline-template-panel.tsx"');
	});

	test("create and edit both route through the shared editor state", () => {
		const source = src();
		expect(source).toContain('setEditor({ mode: "create"');
		expect(source).toContain('setEditor({ mode: "edit"');
	});

	/* A shipped template has no row to PATCH: the API answers a write to a fixture
	 * with a 409, so editing one has to produce the operator's own copy. The
	 * recorded API fixture holds no shipped template, so this is asserted here
	 * rather than driven through the page. */
	test("editing a shipped template creates a copy instead of writing to it", () => {
		const source = src();
		expect(source).toContain("isFixtureRow(target)");
		expect(source).toContain("createTimelineTemplate({ ...input, name: `${input.name} (copy)` })");
		expect(source).toContain("updateTimelineTemplate(id, input)");
	});

	test("a shipped row offers the copy rather than an edit that would 409", () => {
		expect(src()).toContain("Copy to a template you can edit");
	});
});
