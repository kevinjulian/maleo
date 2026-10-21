import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { Toolbar, ToolbarAction, ToolbarGroup } from "./toolbar.tsx";

const html = (el: React.ReactElement): string => renderToStaticMarkup(el);
const noop = (): void => {};

describe("Toolbar", () => {
	it("is a named group, not role=toolbar: every action stays a tab stop", () => {
		const out = html(
			<Toolbar label="Timeline tools">
				<ToolbarGroup>
					<ToolbarAction label="Undo" onAction={noop} />
				</ToolbarGroup>
			</Toolbar>,
		);
		expect(out).toContain('role="group" aria-label="Timeline tools"');
		expect(out).not.toContain('role="toolbar"');
		expect(out).not.toContain('tabindex="-1"');
	});

	it("names a group only when it is given a name", () => {
		expect(html(<ToolbarGroup label="Zoom">z</ToolbarGroup>)).toContain(
			'role="group" aria-label="Zoom"',
		);
		expect(html(<ToolbarGroup>z</ToolbarGroup>)).not.toContain("role=");
	});
});

describe("ToolbarAction", () => {
	it("names an icon-only action by its label and hints with the longer text", () => {
		const out = html(<ToolbarAction label="Undo" hint="Undo (⌘Z)" icon="u" onAction={noop} />);
		expect(out).toContain('aria-label="Undo"');
		expect(out).toContain('title="Undo (⌘Z)"');
		expect(out).toContain('data-slot="icon-button"');
	});

	it("names a labelled action by its text", () => {
		const out = html(
			<ToolbarAction label="Organize range" hint="Organize into lanes" onAction={noop}>
				Organize range
			</ToolbarAction>,
		);
		expect(out).toContain('data-slot="button"');
		expect(out).not.toContain("aria-label");
		expect(out).toContain('title="Organize into lanes"');
	});

	it("is a toggle only when given a state", () => {
		expect(html(<ToolbarAction label="Insights" on onAction={noop} />)).toContain(
			'aria-pressed="true"',
		);
		expect(html(<ToolbarAction label="Insights" on={false} onAction={noop} />)).toContain(
			'aria-pressed="false"',
		);
		expect(html(<ToolbarAction label="Split" onAction={noop} />)).not.toContain("aria-pressed");
		expect(
			html(
				<ToolbarAction label="Speed" on onAction={noop}>
					1.5×
				</ToolbarAction>,
			),
		).toContain('aria-pressed="true"');
	});

	it("reports a running command and stays in the tab order", () => {
		const out = html(
			<ToolbarAction label="Export" busy onAction={noop}>
				Export
			</ToolbarAction>,
		);
		expect(out).toContain('aria-busy="true"');
		expect(out).not.toMatch(/\sdisabled=""/);
	});
});
