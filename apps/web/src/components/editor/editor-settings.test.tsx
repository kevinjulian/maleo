import { describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_PANEL_GROUPS, SETTINGS_PANEL_GROUPS, STYLE_PANEL_GROUPS } from "./panel-groups.ts";

describe("the panel groups by product domain", () => {
	test("each rail renders its own domains, and together they are the whole taxonomy", () => {
		expect(STYLE_PANEL_GROUPS.map((g) => g.title)).toEqual([
			"Creative direction",
			"Style reference",
			"Brand",
			"Data callout",
		]);
		expect(SETTINGS_PANEL_GROUPS.map((g) => g.title)).toEqual(["Output", "Audio"]);
		expect(ALL_PANEL_GROUPS).toEqual([...STYLE_PANEL_GROUPS, ...SETTINGS_PANEL_GROUPS]);
	});

	/* Captions own their font; a second control here would fight the caption tool. */
	test("Brand carries the retention overlays and no caption font", () => {
		const brand = STYLE_PANEL_GROUPS.find((g) => g.id === "brand")!;
		expect(brand.paths).toContain("pacingDevices");
		expect(brand.paths.some((p) => p.includes("brandFont"))).toBe(false);
	});

	/* Historical rails are not the grouping model for this surface. Asserted on the panel
	 * source rather than a rendered tree because the headings are what a reader reaches
	 * for when adding a control, and a stray `<ScanGroup title="Templates">` is the drift
	 * worth catching. */
	test("no historical rail survives as a group heading", () => {
		const source = readFileSync(`${import.meta.dirname}/editor-settings.tsx`, "utf8");
		for (const rail of ["Templates", "Data & retention"]) {
			expect(source).not.toContain(`<ScanGroup title="${rail}"`);
		}
		expect(source).not.toContain("<PanelSection");
		expect(source).not.toContain("<PanelGroup");
	});

	/* The split is the point: creative controls in Style, mechanics in Project. Asserted on
	 * CONTROL labels rather than group headings — the headings are grouping, which has been
	 * reorganised twice now, while a control moving between panels is the real regression. */
	test("keeps creative controls in Style and mechanics in Project Settings", () => {
		const source = readFileSync(`${import.meta.dirname}/editor-settings.tsx`, "utf8");
		const styleStart = source.indexOf("export function StylePanel");
		const settingsStart = source.indexOf("export function SettingsPanel");
		const stylePanel = source.slice(styleStart, source.indexOf("function DirectionFields"));
		const settingsPanel = source.slice(
			settingsStart,
			source.indexOf("export default SettingsPanel"),
		);
		// A slice that missed its boundary reads as the whole file and every assertion
		// below passes on a superset, so check the bounds before trusting them.
		expect(styleStart).toBeGreaterThan(0);
		expect(settingsStart).toBeGreaterThan(styleStart);
		expect(stylePanel.length).toBeLessThan(source.length);
		expect(settingsPanel.length).toBeLessThan(source.length);

		expect(stylePanel).toContain("StyleReferencePicker");
		expect(stylePanel).toContain('"Accent"');
		expect(stylePanel).toContain('"Chapter pills"');
		expect(stylePanel).toContain('"Progress bar"');
		expect(settingsPanel).toContain("Project Settings");
		expect(settingsPanel).toContain('"Aspect ratio"');
		expect(settingsPanel).toContain('"Render backend"');
		expect(settingsPanel).toContain('"Image provider"');
		expect(settingsPanel).not.toContain('"Accent"');
		expect(settingsPanel).not.toContain("StyleReferencePicker");
		expect(settingsPanel).not.toContain('"Chapter pills"');
	});
});

/* Style edits in place. A drill-in drawer per element was a second surface for every
 * value, so the panel must not grow one back. */
describe("the Style panel edits inline in collapsed sections", () => {
	const source = readFileSync(`${import.meta.dirname}/editor-settings.tsx`, "utf8");
	const stylePanel = source.slice(
		source.indexOf("export function StylePanel"),
		source.indexOf("function DirectionFields"),
	);

	test("no section opens expanded and nothing opens another surface", () => {
		expect(stylePanel).toContain("<InspectorSection");
		expect(stylePanel).not.toContain("defaultOpen");
		expect(stylePanel).not.toContain("ElementDetail");
		expect(stylePanel).not.toContain("actions.open(");
	});

	test("caption font is not a Style control", () => {
		expect(stylePanel).not.toContain("brandFont");
		expect(stylePanel).not.toContain("Caption font");
	});

	test("every brand property keeps its default actions", () => {
		for (const label of [
			"Accent",
			"Chapter pills",
			"Pill style",
			"Progress bar",
			"Watermark",
			"Background",
		]) {
			expect(stylePanel).toMatch(new RegExp(`<PropertyRow\\s+label="${label}"`));
		}
	});
});

describe("content detail image provider settings", () => {
	/* The image provider control lives on the project panel, so the global
	 * Settings surface must not offer a second one. That surface is a page plus a feature directory now,
	 * not a single file, so scan all of it: naming one file would let the
	 * control reappear in a sibling and still pass. */
	test("does not expose provider control anywhere on the global Settings surface", () => {
		const root = `${import.meta.dirname}/../..`;
		const files = [
			`${root}/pages/settings.tsx`,
			...readdirSync(`${root}/models/settings`, { recursive: true, encoding: "utf8" })
				.map((rel) => `${root}/models/settings/${rel}`)
				.filter((p) => /\.tsx?$/.test(p)),
		];
		expect(files.length).toBeGreaterThan(1);
		for (const file of files) {
			const src = readFileSync(file, "utf8");
			expect(src.includes("ImageProviderChoices")).toBe(false);
			expect(src.includes("/api/settings/image-provider")).toBe(false);
		}
	});
});

describe("app-global provider controls avoid workspace claims", () => {
	const panel = readFileSync(join(import.meta.dirname, "editor-settings.tsx"), "utf8");

	test("neither app-global provider claims to be workspace-scoped", () => {
		expect(panel).not.toContain(
			'valueSummary(imageProviders?.selected_provider, "Workspace default")',
		);
		expect(panel).not.toContain('source: "workspace" | "env" | "default"');
	});

	test("provider controls do not repeat global-scope explainer copy", () => {
		const model = readFileSync(
			join(import.meta.dirname, "../../models/settings/image-provider.ts"),
			"utf8",
		);
		const textProvider = readFileSync(
			join(import.meta.dirname, "text-provider-select.tsx"),
			"utf8",
		);
		expect(model).not.toContain("Applies to every project");
		expect(textProvider).not.toContain("Applies to every project");
	});

	test("the API reports the source as global, not workspace", () => {
		const routes = readFileSync(
			join(import.meta.dirname, "../../../../../apps/api/src/routes/settings.ts"),
			"utf8",
		);
		expect(routes).toMatch(/source:\s*selected\s*\?\s*\(?"global" as const/);
		expect(routes).not.toMatch(/source:\s*selected\s*\?\s*\(?"workspace" as const/);
	});
});
