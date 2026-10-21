import { describe, expect, it } from "vite-plus/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Page, PageHeader, PageTitle } from "./page.tsx";

function sourceFiles(root: string): string[] {
	return readdirSync(root).flatMap((name) => {
		const path = join(root, name);
		return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".tsx") ? [path] : [];
	});
}

/* The optional slots are the point: a page that passes no action must not render
 * an empty action container, or the flex row reserves space for nothing and the
 * title stops being flush on the surfaces that have no page-level controls. */

describe("PageHeader", () => {
	it("renders a title alone, with no empty slots", () => {
		const html = renderToStaticMarkup(<PageHeader title="Content" />);
		expect(html).toContain("Content");
		expect(html).toContain("pg-title");
		expect(html).not.toContain("pg-actions");
		expect(html).not.toContain("pg-lead");
	});

	it("renders supporting text when given", () => {
		const html = renderToStaticMarkup(
			<PageHeader title="Materials" lead="Reusable generation context." />,
		);
		expect(html).toContain("pg-lead");
		expect(html).toContain("Reusable generation context.");
	});

	it("renders the action area when given", () => {
		const html = renderToStaticMarkup(
			<PageHeader title="Content" action={<button type="button">Create</button>} />,
		);
		expect(html).toContain("pg-actions");
		expect(html).toContain("Create");
	});

	/* The heading owns nothing above the title. Library scope tabs used to render
	 * there, which is the hierarchy defect this replaced: page identity comes
	 * first, and sibling navigation follows the header. */
	it("renders nothing before the title", () => {
		const html = renderToStaticMarkup(
			<PageHeader title="References" lead="Images, products, and notes." />,
		);
		expect(html.indexOf("pg-title")).toBeLessThan(html.indexOf("pg-lead"));
		expect(html.indexOf("pg-head-row")).toBeLessThan(html.indexOf("pg-title"));
		expect(html.slice(0, html.indexOf("pg-head-row"))).not.toContain("<nav");
	});

	it("uses one heading level for the page title", () => {
		const html = renderToStaticMarkup(<PageHeader title="Video" />);
		expect(html).toContain("<h1");
		expect(html.match(/<h1/g)?.length).toBe(1);
	});
});

/* The title on its own, for the four headers that cannot use `PageHeader` — a
 * sub-page editor with a Back control, the centred launcher, project setup
 * beside its icon, the storyboard toolbar. Each of those used to declare its own
 * type; the class is the thing they now share, and it has to stay spelled in the
 * file that owns the stylesheet or it leaks back into four clusters. */
describe("PageTitle", () => {
	it("emits the page-title class by default", () => {
		expect(renderToStaticMarkup(<PageTitle>Storyboard</PageTitle>)).toBe(
			'<h1 class="pg-title">Storyboard</h1>',
		);
	});

	it("emits the section-title class for a detail view within a page", () => {
		expect(renderToStaticMarkup(<PageTitle level="sub">New preset</PageTitle>)).toBe(
			'<h1 class="pg-title-sub">New preset</h1>',
		);
	});

	it("is the only place either spelling is written", () => {
		const offenders = sourceFiles(join(import.meta.dirname, "..")).filter((path) => {
			if (path.endsWith("page.tsx") || path.endsWith(".test.tsx")) return false;
			return /className="[^"]*\bpg-title/.test(readFileSync(path, "utf8"));
		});
		expect(offenders).toEqual([]);
	});
});

describe("Page", () => {
	it("wraps children in the padded container", () => {
		const html = renderToStaticMarkup(
			<Page>
				<span>body</span>
			</Page>,
		);
		expect(html).toContain('class="pg"');
		expect(html).toContain("body");
	});

	it("offers a narrower measure for form-shaped surfaces", () => {
		expect(
			renderToStaticMarkup(
				<Page width="narrow">
					<span />
				</Page>,
			),
		).toContain("pg-narrow");
	});
});
