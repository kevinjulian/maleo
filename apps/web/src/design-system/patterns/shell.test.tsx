import { expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarNavigation } from "./sidebar-navigation.tsx";
import { Topbar, TopbarLeading, TopbarStatus, TopbarActions } from "./topbar.tsx";
const groups = [
	{ label: "Library", items: [{ id: "elements", label: "Elements", onNavigate: () => {} }] },
];
test("navigation names selected destination in both expanded and icon rail", () => {
	for (const variant of ["expanded", "rail", "drawer"] as const) {
		const html = renderToStaticMarkup(
			<SidebarNavigation
				groups={groups}
				current="elements"
				variant={variant}
				header="Workspace"
				footer="Version"
			/>,
		);
		expect(html).toContain('aria-current="page"');
		expect(html).toContain('aria-label="Elements"');
		expect(html).toContain("Workspace");
		expect(html).toContain("Version");
		expect(html.includes('class="ui-sidebar-label"')).toBe(variant !== "rail");
	}
});
test("owner actions occupy footer without losing navigation semantics", () => {
	const html = renderToStaticMarkup(
		<SidebarNavigation
			groups={groups}
			footerItems={[{ id: "god", label: "God Mode", onNavigate: () => {} }]}
			footer="maleo"
		/>,
	);
	expect(html).toContain('aria-label="Navigation footer"');
	expect(html.indexOf("God Mode")).toBeGreaterThan(html.indexOf("ui-sidebar-footer-region"));
});
test("app and editor topbar retain status and actions as labelled content", () => {
	for (const variant of ["app", "editor"] as const) {
		const html = renderToStaticMarkup(
			<Topbar variant={variant}>
				<TopbarLeading>Project</TopbarLeading>
				<TopbarStatus>
					<span role="status">Saving</span>
				</TopbarStatus>
				<TopbarActions>
					<button>Export</button>
				</TopbarActions>
			</Topbar>,
		);
		expect(html).toContain('role="status"');
		expect(html).toContain("Saving");
		expect(html).toContain("Export");
		expect(html).toContain(`<header data-slot="topbar" data-variant="${variant}"`);
	}
});
