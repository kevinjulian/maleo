import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchField } from "./search-field.tsx";

const html = (value: string): string =>
	renderToStaticMarkup(
		<SearchField label="Search materials" value={value} onValueChange={() => {}} />,
	);

describe("SearchField", () => {
	it("is a named search input whose placeholder defaults to its name", () => {
		const out = html("");
		expect(out).toContain('type="search"');
		expect(out).toContain('aria-label="Search materials"');
		expect(out).toContain('placeholder="Search materials"');
	});

	it("offers one clear control, and only with a query", () => {
		expect(html("")).not.toContain('data-slot="search-clear"');
		const out = html("logo");
		expect(out.match(/data-slot="search-clear"/g)?.length).toBe(1);
		expect(out).toContain('aria-label="Clear search"');
	});

	it("keeps the glyph out of the input, so text cannot run under it", () => {
		const out = html("logo");
		expect(out.indexOf("<svg")).toBeLessThan(out.indexOf("<input"));
		expect(out).not.toContain("position:absolute");
	});
});
