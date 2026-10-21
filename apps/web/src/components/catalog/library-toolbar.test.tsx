import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { LibraryToolbar } from "./library-toolbar.tsx";

/* Static render plus source assertions: the harness has no DOM or event layer,
 * so behaviour that needs a click is asserted at the source and driven for real
 * by the Playwright checks. */

const GROUPS = [
	{ id: "story", label: "Story" },
	{ id: "visual", label: "Visual" },
] as const;

describe("LibraryToolbar", () => {
	test("renders one search field, labelled by its placeholder", () => {
		const html = renderToStaticMarkup(
			<LibraryToolbar query="" onQuery={() => undefined} placeholder="Search materials" />,
		);
		expect(html.match(/<input/g)?.length).toBe(1);
		expect(html).toContain('type="search"');
		expect(html).toContain("Search materials");
	});

	test("a surface with no groups gets search alone, not empty chips", () => {
		const html = renderToStaticMarkup(
			<LibraryToolbar query="" onQuery={() => undefined} placeholder="Search voices" />,
		);
		expect(html).not.toContain("catalog-groups");
	});

	test("groups render only when the surface can act on them", () => {
		const withoutHandler = renderToStaticMarkup(
			<LibraryToolbar query="" onQuery={() => undefined} placeholder="Search" groups={GROUPS} />,
		);
		expect(withoutHandler).not.toContain("catalog-groups");

		const withHandler = renderToStaticMarkup(
			<LibraryToolbar
				query=""
				onQuery={() => undefined}
				placeholder="Search"
				groups={GROUPS}
				onGroup={() => undefined}
			/>,
		);
		expect(withHandler).toContain("catalog-groups");
		expect(withHandler).toContain("Story");
		expect(withHandler).toContain("Visual");
	});

	/* The unfiltered state is a value the toolbar can express, not the absence of
	 * one: Materials shows every group section under it. */
	test("no active group means All is pressed", () => {
		const html = renderToStaticMarkup(
			<LibraryToolbar
				query=""
				onQuery={() => undefined}
				placeholder="Search"
				groups={GROUPS}
				group={null}
				onGroup={() => undefined}
			/>,
		);
		expect(html).toContain("All");
		expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
		expect(html.slice(0, html.indexOf("Story"))).toContain('aria-pressed="true"');
	});

	test("an active group is the only pressed chip", () => {
		const html = renderToStaticMarkup(
			<LibraryToolbar
				query=""
				onQuery={() => undefined}
				placeholder="Search"
				groups={GROUPS}
				group="visual"
				onGroup={() => undefined}
			/>,
		);
		expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
		expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Visual</);
	});

	test("the clear control appears only when there is something to clear", () => {
		const empty = renderToStaticMarkup(
			<LibraryToolbar query="" onQuery={() => undefined} placeholder="Search" />,
		);
		expect(empty).not.toContain("Clear search");

		const typed = renderToStaticMarkup(
			<LibraryToolbar query="brand" onQuery={() => undefined} placeholder="Search" />,
		);
		expect(typed).toContain('aria-label="Clear search"');
	});

	test("the group row is announced as a group", () => {
		const html = renderToStaticMarkup(
			<LibraryToolbar
				query=""
				onQuery={() => undefined}
				placeholder="Search"
				groups={GROUPS}
				onGroup={() => undefined}
				groupLabel="Filter by material group"
			/>,
		);
		expect(html).toContain('aria-label="Filter by material group"');
	});
});

describe("LibraryToolbar behaviour wired at the source", () => {
	const src = (): string => readFileSync(`${import.meta.dirname}/library-toolbar.tsx`, "utf8");
	/* Search behaviour is the shared SearchField's; the toolbar composes it. */
	const field = (): string =>
		readFileSync(`${import.meta.dirname}/../../design-system/components/search-field.tsx`, "utf8");

	test("the toolbar searches through the shared SearchField", () => {
		expect(src()).toContain("<SearchField");
	});

	test("clearing returns focus to the field", () => {
		expect(field()).toContain("input.current?.focus();");
	});

	test("Escape clears a non-empty query", () => {
		expect(field()).toContain('e.key === "Escape"');
	});

	/* Otherwise the unfiltered state is only reachable by finding All, and the
	 * chip an operator just pressed becomes the one control that does nothing. */
	test("pressing the active chip again clears the filter, where there is one to clear to", () => {
		expect(src()).toContain("onChange(withAll && active === g.id ? null : g.id)");
	});
});

/* References is Images, Products or Notes and never all three: they render
 * through different components, so there is no combined view for All to show. */
describe("surfaces with no unfiltered view", () => {
	test("All is not offered when the surface cannot render it", () => {
		const html = renderToStaticMarkup(
			<LibraryToolbar
				query=""
				onQuery={() => undefined}
				placeholder="Search images"
				groups={GROUPS}
				group="story"
				onGroup={() => undefined}
				allowAll={false}
			/>,
		);
		expect(html).toContain("catalog-groups");
		expect(html).not.toContain(">All<");
		expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
	});
});
