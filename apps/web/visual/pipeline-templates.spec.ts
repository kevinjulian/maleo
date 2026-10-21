import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { mockAdmin } from "./admin-fixture.ts";
import catalog from "./fixtures/agent-templates.json" with { type: "json" };

const workflow = catalog.definitions.find((item) => item.id === "workflow:plan_story")!;
const stage = catalog.definitions.find((item) => item.id === "operation:plan_story:direction")!;
const operation = catalog.definitions.find(
	(item) => item.id === "operation:planning:route-direction",
)!;
const prompt = catalog.definitions.find(
	(item) => item.id === "prompt:content:directionRouterPrompt",
)!;
const workflowPath = `/god/pipelines/workflows/${encodeURIComponent(workflow.id)}`;
const inspector = (page: Page) =>
	page.getByRole("region", { name: "Contextual inspector", exact: true });
const stageLink = (page: Page) =>
	page
		.getByRole("region", { name: "Execution stages", exact: true })
		.locator(`[data-template-row="${stage.id}"]`);
const primaryLink = (page: Page, id: string) =>
	inspector(page)
		.locator(`.template-inspector-content > section [data-template-row="${id}"]`)
		.first();
const drawer = (page: Page) => page.getByRole("region", { name: "Definition drawer", exact: true });
const drawerLink = (page: Page, id: string) =>
	drawer(page).locator(`[data-template-row="${id}"]`).first();
const destinations = (page: Page) =>
	page.getByRole("navigation", { name: "Explorer destinations" });
test.beforeEach(async ({ context, page }) => {
	await replayApi(context, resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har"));
	await mockAdmin(page);
});

test("two selections expose Direction, catalog order and links without replacing workflow list", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto("/god/pipelines");
	await expect(destinations(page).getByRole("link")).toHaveText([
		"Workflows",
		"Tools",
		"Instructions",
	]);
	await page
		.locator(".template-list")
		.evaluate((element) => element.setAttribute("data-preserved", "yes"));
	await page
		.getByRole("navigation", { name: "Choose workflow" })
		.getByRole("link", { name: workflow.label, exact: true })
		.click();
	await expect(page.locator(".template-list")).toHaveAttribute("data-preserved", "yes");
	expect(
		await page
			.locator(".template-stage-pipeline [data-template-row]")
			.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-template-row"))),
	).toEqual(workflow.steps);
	const stageRow = page
		.locator(".template-stage-pipeline > li")
		.filter({ has: page.locator(`[data-template-row="${stage.id}"]`) });
	await expect(stageRow).toContainText("1 instruction");
	await expect(stageRow).not.toContainText("0 tools");
	await expect(page.getByRole("table", { name: "Execution stages", exact: true })).toHaveCount(0);
	await expect(page.locator(".template-stage-connection")).toHaveCount(0);
	await stageLink(page).focus();
	await page.keyboard.press("Enter");
	await expect(stageLink(page)).toBeFocused();
	await expect(inspector(page)).toContainText(stage.description);
	await expect(primaryLink(page, prompt.id)).toBeVisible();
	await expect(inspector(page).getByRole("region", { name: "Tools", exact: true })).toHaveCount(0);
	await expect(inspector(page)).toContainText("Runs when free-text direction");
	await expect(inspector(page).getByRole("table")).toHaveCount(0);
	const boxes = await page
		.locator(".template-list,.template-stages,.template-inspector")
		.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().x));
	expect(boxes[0]!).toBeLessThan(boxes[1]!);
	expect(boxes[1]!).toBeLessThan(boxes[2]!);
	await page
		.getByRole("navigation", { name: "Choose workflow" })
		.getByRole("link", { name: /Generate story assets/i })
		.click();
	await expect(page.locator(".template-list")).toHaveAttribute("data-preserved", "yes");
	await expect(page).not.toHaveURL(/stage=/);
});

test("chips open the drawer beside the step; drawer history survives reload, Back and Forward", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto(workflowPath);
	await stageLink(page).click();
	await expect(primaryLink(page, operation.id)).toHaveAttribute("href", /peek=operation/);
	await primaryLink(page, operation.id).click();
	await expect(
		drawer(page).getByRole("heading", { name: operation.label, exact: true }),
	).toBeVisible();
	await expect(page.locator(".template-inspector .template-pane-head h2")).toHaveText(stage.label);
	await drawerLink(page, prompt.id).click();
	await expect(drawer(page).locator("[data-template-prompt]")).toHaveText(
		prompt.instructions!.join("\n\n"),
	);
	await page.reload();
	await expect(drawer(page).locator("[data-template-prompt]")).toBeVisible();
	await drawer(page).getByRole("button", { name: "Back", exact: true }).click();
	await expect(
		drawer(page).getByRole("heading", { name: operation.label, exact: true }),
	).toBeVisible();
	await page.goBack();
	await expect(drawer(page)).toHaveCount(0);
	await expect(
		inspector(page).getByRole("heading", { name: stage.label, exact: true }),
	).toBeVisible();
	await page.goForward();
	await expect(
		drawer(page).getByRole("heading", { name: operation.label, exact: true }),
	).toBeVisible();
	await drawer(page).getByRole("button", { name: "Close", exact: true }).click();
	await expect(drawer(page)).toHaveCount(0);
	await expect(stageLink(page)).toHaveAttribute("aria-current", "true");
	const href = await primaryLink(page, prompt.id).getAttribute("href");
	const tab = await page.context().newPage();
	await mockAdmin(tab);
	await tab.goto(href!);
	await expect(drawer(tab).locator("[data-template-prompt]")).toBeVisible();
	await tab.close();
});

test("workflow detail separates the chat assistant's tools from its steps", async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto(workflowPath);
	const assistant = inspector(page).getByRole("region", { name: "Chat assistant", exact: true });
	await expect(assistant).toContainText("not to any step");
	await assistant
		.getByRole("region", { name: "Optional capabilities", exact: true })
		.locator('[data-template-row="tool:search_web"]')
		.click();
	await expect(
		drawer(page).getByRole("region", { name: "Assistant availability", exact: true }),
	).toContainText(workflow.label);
	await expect(drawer(page).getByRole("region", { name: "Consumers", exact: true })).toContainText(
		"Not a step in any workflow",
	);
});

test("purpose and capability inventories search complete catalog and copy exact instructions", async ({
	page,
	context,
}) => {
	await page.goto(`/god/pipelines/tools?context=${encodeURIComponent(workflow.id)}`);
	await expect(page.locator(".template-list [data-template-row]")).toHaveCount(
		catalog.definitions.filter((item) => item.kind === "tool").length,
	);
	await expect(page.getByRole("combobox")).toHaveCount(0);
	await expect(page.getByRole("link", { name: "Skip to stages", exact: true })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "Research", exact: true })).toBeVisible();
	await destinations(page).getByRole("link", { name: "Instructions", exact: true }).click();
	const search = page.getByRole("searchbox", { name: "Search instructions", exact: true });
	await search.fill(prompt.id);
	await page.reload();
	await expect(search).toHaveValue(prompt.id);
	await expect(page.locator(".template-list [data-template-row]")).toHaveCount(1);
	await page
		.locator(".template-list")
		.getByRole("link", { name: prompt.label, exact: true })
		.click();
	await expect(
		inspector(page).getByRole("region", { name: "Consumers", exact: true }),
	).toContainText(workflow.label);
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await inspector(page).getByRole("button", { name: "Copy instructions", exact: true }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		prompt.instructions!.join("\n\n"),
	);
	await inspector(page).getByRole("button", { name: "Back", exact: true }).click();
	await expect(page.locator(`.template-list [data-template-row="${prompt.id}"]`)).toBeFocused();
	await search.fill("no-matches-here");
	await expect(page.locator(".template-list")).toContainText("No definitions match");
	await page.getByRole("button", { name: "Clear search", exact: true }).click();
	await expect(page.locator(".template-list [data-template-row]")).toHaveCount(
		catalog.definitions.filter((item) => item.kind === "prompt").length,
	);
	await search.fill(prompt.instructions![0]!.slice(0, 40));
	await expect(page.locator(".template-list [data-template-row]")).not.toHaveCount(0);
});

test("Tools and Instructions open every chip, workflows and steps included, in the drawer", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto(`/god/pipelines/instructions?inspect=${encodeURIComponent(prompt.id)}`);
	await inspector(page)
		.getByRole("region", { name: "Consumers", exact: true })
		.getByRole("link", { name: `${workflow.label} / ${stage.label}`, exact: true })
		.click();
	await expect(page).toHaveURL(/\/god\/pipelines\/instructions\?/);
	await expect(drawer(page).getByRole("heading", { name: stage.label, exact: true })).toBeVisible();
	await expect(drawer(page).getByRole("region", { name: "Part of", exact: true })).toContainText(
		"step 2 of 4",
	);
	await drawer(page)
		.getByRole("region", { name: "Part of", exact: true })
		.getByRole("link", { name: workflow.label, exact: true })
		.click();
	await expect(
		drawer(page).getByRole("region", { name: "Workflow steps", exact: true }).getByRole("link"),
	).toHaveCount(workflow.steps.length);
	await drawer(page).getByRole("button", { name: "Back", exact: true }).click();
	await expect(drawer(page).getByRole("heading", { name: stage.label, exact: true })).toBeVisible();
	await expect(page.locator(".template-inspector .template-pane-head h2")).toHaveText(prompt.label);
});

test("Implementation persists with complete contracts and bounded fidelity", async ({ page }) => {
	await page.setViewportSize({ width: 1400, height: 1000 });
	await page.goto(workflowPath);
	await inspector(page).getByText("Technical details", { exact: true }).click();
	await expect(page).toHaveURL(/impl=1/);
	await page.reload();
	await inspector(page).getByText("Workflow coverage and boundaries", { exact: true }).click();
	const coverage = inspector(page).getByRole("table", { name: "Workflow coverage", exact: true });
	const tableFrame = inspector(page).getByRole("region", {
		name: "Workflow coverage table",
		exact: true,
	});
	await expect(tableFrame).toHaveClass(/ui-table-scroll/);
	await expect(tableFrame).toHaveCSS("border-top-width", "1px");
	await expect(tableFrame).toHaveAttribute("tabindex", "0");
	expect(
		await coverage.evaluate((element) => element.getBoundingClientRect().width),
	).toBeGreaterThanOrEqual(620);
	await tableFrame.focus();
	await page.keyboard.press("ArrowRight");
	await expect.poll(() => tableFrame.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
	await expect(coverage).toContainText("derived");
	await expect(coverage).toContainText("declared");
	await expect(
		inspector(page).getByText("Verification evidence not published for current revision."),
	).toBeVisible();
	expect(await coverage.innerText()).not.toMatch(/Verified|\d+%/);
	await page.goto("/god/pipelines/tools?inspect=tool%3Agenerate_frame&impl=1");
	await expect(
		inspector(page).getByRole("table", { name: "Input contract", exact: true }),
	).toBeVisible();
	await inspector(page)
		.getByRole("table", { name: "Input contract", exact: true })
		.scrollIntoViewIfNeeded();
	await expect(page).toHaveScreenshot("ai-explorer-standard-table.png");
	await inspector(page).getByText("Technical", { exact: true }).click();
	await expect(
		inspector(page).getByRole("table", { name: "Technical", exact: true }),
	).toContainText("tool:generate_frame");
});

test("catalog changes immediately update stage links; availability stays separate", async ({
	page,
}) => {
	const changed = {
		...catalog,
		revision: "changed",
		relationships: [
			...catalog.relationships,
			{
				from: stage.id,
				to: "tool:view_timeline",
				kind: "uses_tool",
				provenance: { kind: "declared", source: stage.source },
			},
		],
	};
	await page.goto(`${workflowPath}?stage=${encodeURIComponent(stage.id)}`);
	await expect(inspector(page).getByRole("region", { name: "Tools", exact: true })).toHaveCount(0);
	await page.route("**/api/admin/agent-templates", (route) => route.fulfill({ json: changed }));
	await page.getByRole("button", { name: "Refresh definitions", exact: true }).click();
	await expect(
		inspector(page)
			.getByRole("region", { name: "Tools", exact: true })
			.locator('[data-template-row="tool:view_timeline"]'),
	).toBeVisible();
});

test("errors, revoked access, unavailable IDs, compatibility and retry remain explicit", async ({
	page,
}) => {
	let status = 500;
	await page.route("**/api/admin/agent-templates", (route) =>
		route.fulfill({ status, json: status === 200 ? catalog : { error: "refused" } }),
	);
	await page.goto(`/god/pipelines/instructions?inspect=${encodeURIComponent(prompt.id)}`);
	await expect(page.getByRole("alert")).toContainText("Could not load definitions");
	status = 200;
	await page.getByRole("button", { name: "Try again", exact: true }).click();
	await expect(inspector(page).locator("[data-template-prompt]")).toBeVisible();
	status = 403;
	await page.getByRole("button", { name: "Refresh definitions", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Definitions cleared");
	await expect(page.locator(".template-columns")).toHaveCount(0);
	status = 200;
	await page.goto(`${workflowPath}?stage=foreign&inspect=${encodeURIComponent(prompt.id)}`);
	await expect(page.locator(".template-inspector [role=alert]")).toContainText("foreign");
	await expect(page).toHaveURL(/peek=prompt/);
	await expect(drawer(page).locator("[data-template-prompt]")).toBeVisible();
	await page.goto("/god/pipelines/definitions/profiles?inspect=profile%3Aedit");
	await expect(inspector(page)).toContainText("not an independently callable workflow");
	await expect(page).not.toHaveURL(/definitions/);
	await page.route("**/api/admin/agent-templates", (route) =>
		route.fulfill({ json: { ...catalog, schemaVersion: 999 } }),
	);
	await page.getByRole("button", { name: "Refresh definitions", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("requires catalog schema");
	await page.route("**/api/admin/agent-templates", (route) =>
		route.fulfill({
			json: { schemaVersion: 2, revision: "empty", definitions: [], relationships: [] },
		}),
	);
	await page.getByRole("button", { name: "Try again", exact: true }).click();
	await expect(page.getByText("No definitions deployed.")).toBeVisible();
});

test("missing metadata, copy failure and removed selected dependency retain recovery", async ({
	page,
}) => {
	await page.route("**/api/admin/agent-templates", (route) =>
		route.fulfill({
			json: {
				...catalog,
				definitions: catalog.definitions.map((entry) => ({
					...entry,
					summary: undefined,
					capabilities: undefined,
					purpose: undefined,
				})),
			},
		}),
	);
	await page.goto("/god/pipelines/tools");
	await expect(page.getByRole("region", { name: "Other capabilities", exact: true })).toBeVisible();
	await page.goto(`/god/pipelines/instructions?inspect=${encodeURIComponent(prompt.id)}`);
	await page.evaluate(() =>
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async () => {
					throw new Error("Clipboard denied");
				},
			},
		}),
	);
	await inspector(page).getByRole("button", { name: "Copy instructions", exact: true }).click();
	await expect(inspector(page).getByRole("status")).toContainText("Copy failed. Select the text");
	await expect(inspector(page).locator("[data-template-prompt]")).toHaveText(
		prompt.instructions!.join("\n\n"),
	);
	const removed = {
		...catalog,
		definitions: catalog.definitions.filter((entry) => entry.id !== prompt.id),
		relationships: catalog.relationships.filter(
			(edge) => edge.from !== prompt.id && edge.to !== prompt.id,
		),
	};
	await page.route("**/api/admin/agent-templates", (route) => route.fulfill({ json: removed }));
	await page.getByRole("button", { name: "Refresh definitions", exact: true }).click();
	await expect(inspector(page).getByRole("alert")).toContainText(prompt.id);
	await inspector(page).getByRole("button", { name: "Back", exact: true }).click();
	await expect(
		page.getByRole("searchbox", { name: "Search instructions", exact: true }),
	).toBeVisible();
});

test("member denied before catalog fetch", async ({ page }) => {
	let reads = 0;
	await page.route("**/api/admin/agent-templates", (route) => {
		reads++;
		return route.fulfill({ status: 403, json: { error: "denied" } });
	});
	await page.route("**/api/auth/get-session", (route) =>
		route.fulfill({
			json: { user: { id: "member", email: "member@example.com", name: "Member", role: "member" } },
		}),
	);
	await page.goto(workflowPath);
	await expect(
		page.getByRole("heading", { name: "Instance owner access required", exact: true }),
	).toBeVisible();
	expect(reads).toBe(0);
});

for (const width of [320, 1600])
	for (const theme of ["light", "dark"] as const)
		test(`explorer ${theme} ${width}`, async ({ page }) => {
			await page.setViewportSize({ width, height: 1000 });
			await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
			await page.emulateMedia({ reducedMotion: "reduce" });
			await page.goto(`${workflowPath}?stage=${encodeURIComponent(stage.id)}`);
			await expect(
				inspector(page).getByRole("heading", { name: stage.label, exact: true }),
			).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				width,
			);
			await expect(page).toHaveScreenshot(`ai-explorer-${theme}-${width}.png`);
			await page.goto(workflowPath);
			await expect(page.getByRole("list", { name: "Execution stages", exact: true })).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				width,
			);
			await expect(page).toHaveScreenshot(`ai-explorer-stages-${theme}-${width}.png`);
			await page.goto(
				`${workflowPath}?stage=${encodeURIComponent(stage.id)}&peek=${encodeURIComponent(operation.id)}`,
			);
			await expect(
				drawer(page).getByRole("heading", { name: operation.label, exact: true }),
			).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				width,
			);
			await expect(page).toHaveScreenshot(`ai-explorer-drawer-${theme}-${width}.png`);
		});

test.describe("coarse phone navigation", () => {
	test.use({ hasTouch: true, isMobile: true });
	test("sequential keyboard, Back, direct links and resize preserve selections", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 320, height: 900 });
		await page.goto("/god/pipelines");
		await expect(page.getByRole("link", { name: "Skip to inspector", exact: true })).toHaveCount(0);
		const workflowLink = page
			.getByRole("navigation", { name: "Choose workflow" })
			.getByRole("link", { name: workflow.label, exact: true });
		expect((await workflowLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		await workflowLink.focus();
		await page.keyboard.press("Enter");
		await expect(page.locator(".template-list")).toBeHidden();
		await expect(page.locator(".template-stages")).toBeVisible();
		await stageLink(page).focus();
		await page.keyboard.press("Enter");
		await expect(page.locator(".template-stages")).toBeHidden();
		await primaryLink(page, prompt.id).click();
		await page.reload();
		await expect(drawer(page).locator("[data-template-prompt]")).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			320,
		);
		await drawer(page).getByRole("button", { name: "Close", exact: true }).click();
		await expect(
			inspector(page).getByRole("heading", { name: stage.label, exact: true }),
		).toBeVisible();
		await inspector(page).getByRole("button", { name: "Back", exact: true }).click();
		await expect(stageLink(page)).toBeVisible();
		await expect(stageLink(page)).toBeFocused();
		await page.getByRole("button", { name: "Back to workflows", exact: true }).click();
		await expect(workflowLink).toBeFocused();
		await page.goto(`${workflowPath}?stage=${encodeURIComponent(stage.id)}`);
		await page.setViewportSize({ width: 1600, height: 1000 });
		await expect(stageLink(page)).toBeVisible();
		await expect(
			inspector(page).getByRole("heading", { name: stage.label, exact: true }),
		).toBeVisible();
		await page.setViewportSize({ width: 320, height: 900 });
		await expect(stageLink(page)).toBeHidden();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			320,
		);
	});
});

test("selection shares Providers and Security styling and metadata is clickable", async ({
	page,
	context,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto(workflowPath);
	await stageLink(page).locator("small").click();
	await expect(stageLink(page)).toHaveAttribute("aria-current", "true");
	await expect(
		inspector(page).getByRole("heading", { name: stage.label, exact: true }),
	).toBeVisible();
	const appearance = (locator: ReturnType<Page["locator"]>) =>
		locator.evaluate((element) => {
			const style = getComputedStyle(element);
			const marker = getComputedStyle(element, "::before");
			return {
				color: style.color,
				weight: style.fontWeight,
				background: style.backgroundColor,
				marker: marker.backgroundColor,
				markerWidth: marker.width,
				padding: style.padding,
			};
		});
	const selected = await appearance(stageLink(page));
	expect(selected.background).toBe("rgba(0, 0, 0, 0)");
	const reference = await context.newPage();
	await mockAdmin(reference);
	await reference.emulateMedia({ reducedMotion: "reduce" });
	for (const path of ["/god/providers", "/god/security"]) {
		await reference.goto(path);
		const row = reference.locator(".settings-row").first();
		await row.click();
		await expect(row).toHaveAttribute("aria-current", "true");
		expect(await appearance(row)).toEqual(selected);
	}
	await reference.close();
});
