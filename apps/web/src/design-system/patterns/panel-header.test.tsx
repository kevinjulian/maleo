import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { PanelHeader } from "./panel-header.tsx";

const html = (el: React.ReactElement): string => renderToStaticMarkup(el);

describe("PanelHeader", () => {
	it("names the panel with a heading", () => {
		const out = html(<PanelHeader title="Captions" />);
		expect(out).toMatch(/<h2[^>]*>Captions<\/h2>/);
	});

	it("has no close control unless the panel can be closed", () => {
		expect(html(<PanelHeader title="Inspector" />)).not.toContain("<button");
	});

	it("names the close control and puts it after the actions", () => {
		const out = html(
			<PanelHeader
				title="Audit"
				actions={
					<IconButton size="xs" aria-label="Refresh">
						r
					</IconButton>
				}
				onClose={() => {}}
				closeLabel="Close audit"
			/>,
		);
		expect(out).toContain('aria-label="Close audit"');
		expect(out.indexOf('aria-label="Refresh"')).toBeLessThan(
			out.indexOf('aria-label="Close audit"'),
		);
	});

	it("carries its density and an optional second line", () => {
		const out = html(<PanelHeader density="compact" title="Scene" sub="Transform properties" />);
		expect(out).toContain('data-density="compact"');
		expect(out).toContain("Transform properties");
		expect(html(<PanelHeader title="Scene" />)).not.toContain("panel-header-sub");
	});
});
