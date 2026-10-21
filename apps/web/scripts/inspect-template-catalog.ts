import { chromium, expect } from "@playwright/test";

const apiOrigin = process.env.MALEO_TEMPLATE_TEST_API;
const cookie = process.env.MALEO_TEMPLATE_TEST_COOKIE;
if (!apiOrigin || !cookie)
	throw new Error("Isolated API origin and synthetic owner cookie required");
const origin = "http://127.0.0.1:3034";
const server = Bun.spawn(["bun", "src/app/serve.ts"], {
	cwd: new URL("..", import.meta.url).pathname,
	env: {
		...process.env,
		NODE_ENV: "production",
		MALEO_WEB_PORT: "3034",
		MALEO_API_URLS: "",
		MALEO_API_URL: apiOrigin,
	},
	stdout: "pipe",
	stderr: "pipe",
});
let browser;
try {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			if ((await fetch(origin)).ok) break;
		} catch {
			/* startup */
		}
		if (attempt === 99) throw new Error("Production web failed to start");
		await Bun.sleep(100);
	}
	browser = await chromium.launch();
	const context = await browser.newContext();
	await context.addCookies(
		cookie.split("; ").map((value) => {
			const split = value.indexOf("=");
			return { name: value.slice(0, split), value: value.slice(split + 1), url: origin };
		}),
	);
	const page = await context.newPage();
	const errors: string[] = [];
	const scripts: Promise<string>[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("response", (response) => {
		if (response.url().endsWith(".js")) scripts.push(response.text());
	});
	await page.goto(`${origin}/god/users`);
	await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
	expect((await Promise.all(scripts)).some((text) => text.includes("react-flow__node"))).toBe(
		false,
	);
	const response = page.waitForResponse((value) =>
		value.url().includes("/api/admin/agent-templates"),
	);
	await page.getByRole("button", { name: "AI Explorer", exact: true }).click();
	expect((await response).status()).toBe(200);
	const catalogResponse = await context.request.get(`${origin}/api/admin/agent-templates`);
	expect(catalogResponse.status()).toBe(200);
	const catalog = await catalogResponse.json();
	const workflow = catalog.definitions.find(
		(item: { id: string }) => item.id === "workflow:plan_story",
	);
	const stageItem = catalog.definitions.find(
		(item: { id: string }) => item.id === "operation:plan_story:direction",
	);
	const operation = catalog.definitions.find(
		(item: { id: string }) => item.id === "operation:planning:route-direction",
	);
	const prompt = catalog.definitions.find(
		(item: { id: string }) => item.id === "prompt:content:directionRouterPrompt",
	);
	expect(workflow).toBeTruthy();
	expect(stageItem).toBeTruthy();
	expect(prompt).toBeTruthy();
	await expect(page.getByRole("navigation", { name: "Choose workflow" })).toBeVisible();
	for (const width of [1600, 768, 320])
		for (const theme of ["light", "dark"] as const) {
			const screen = await browser.newContext({
				viewport: { width, height: 1000 },
				hasTouch: width === 320,
				isMobile: width === 320,
				colorScheme: theme,
				reducedMotion: "reduce",
			});
			await screen.addCookies(await context.cookies());
			await screen.addInitScript((value) => localStorage.setItem("theme", value), theme);
			const view = await screen.newPage();
			view.on("pageerror", (error) => errors.push(error.message));
			const effects: string[] = [];
			view.on("request", (request) => {
				if (
					request.url().includes("/api/") &&
					request.method() !== "GET" &&
					!request.url().includes("/api/auth")
				)
					effects.push(request.url());
			});
			await view.goto(`${origin}/god/pipelines`);
			const workflowLink = view
				.getByRole("navigation", { name: "Choose workflow" })
				.getByRole("link", { name: workflow.label, exact: true });
			await workflowLink.focus();
			await view.keyboard.press("Enter");
			const stageLink = view.locator(
				`.template-stage-pipeline [data-template-row="${stageItem.id}"]`,
			);
			expect(
				await view
					.locator(".template-stage-pipeline [data-template-row]")
					.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-template-row"))),
			).toEqual(workflow.steps);
			await stageLink.focus();
			await view.keyboard.press("Enter");
			const inspector = view.getByRole("region", { name: "Contextual inspector", exact: true });
			await expect(inspector).toContainText(stageItem.description);
			await expect(inspector.getByRole("region", { name: "Tools", exact: true })).toContainText(
				"No tools exposed",
			);
			await inspector
				.locator(`.template-inspector-content > section [data-template-row="${operation.id}"]`)
				.first()
				.click();
			await inspector
				.locator(`.template-inspector-content > section [data-template-row="${prompt.id}"]`)
				.first()
				.click();
			await expect(inspector.locator("[data-template-prompt]")).toHaveText(
				prompt.instructions.join("\n\n"),
			);
			await view.reload();
			await expect(inspector.locator("[data-template-prompt]")).toBeVisible();
			await inspector.getByRole("button", { name: "Back", exact: true }).click();
			await expect(
				inspector.getByRole("heading", { name: operation.label, exact: true }),
			).toBeVisible();
			await view.goBack();
			await expect(
				inspector.getByRole("heading", { name: stageItem.label, exact: true }),
			).toBeVisible();
			await view.goForward();
			await expect(
				inspector.getByRole("heading", { name: operation.label, exact: true }),
			).toBeVisible();
			await view.keyboard.press("Escape");
			await inspector.getByRole("button", { name: "Back", exact: true }).click();
			await expect(stageLink).toBeVisible();
			await view
				.getByRole("navigation", { name: "Explorer destinations" })
				.getByRole("link", { name: "Instructions", exact: true })
				.click();
			const search = view.getByRole("searchbox", { name: "Search instructions", exact: true });
			await search.fill(prompt.id);
			await view.reload();
			await expect(search).toHaveValue(prompt.id);
			await view
				.locator(".template-list")
				.getByRole("link", { name: prompt.label, exact: true })
				.click();
			await expect(inspector.locator("[data-template-prompt]")).toHaveText(
				prompt.instructions.join("\n\n"),
			);
			await expect(inspector.getByRole("region", { name: "Consumers", exact: true })).toContainText(
				workflow.label,
			);
			expect(await view.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				width,
			);
			expect(effects).toEqual([]);
			await screen.close();
		}
	const memberCookie = process.env.MALEO_TEMPLATE_TEST_MEMBER_COOKIE;
	if (!memberCookie)
		throw new Error("Synthetic member cookie required for connected authorization proof");
	const memberScreen = await browser.newContext({
		viewport: { width: 320, height: 900 },
		hasTouch: true,
		isMobile: true,
	});
	await memberScreen.addCookies(
		memberCookie.split("; ").map((value) => {
			const split = value.indexOf("=");
			return { name: value.slice(0, split), value: value.slice(split + 1), url: origin };
		}),
	);
	const memberPage = await memberScreen.newPage();
	let memberCatalogReads = 0;
	memberPage.on("request", (request) => {
		if (request.url().includes("/api/admin/agent-templates")) memberCatalogReads++;
	});
	await memberPage.goto(
		`${origin}/god/pipelines/definitions/prompts?inspect=${encodeURIComponent(prompt.id)}`,
	);
	await expect(
		memberPage.getByRole("heading", { name: "Instance owner access required", exact: true }),
	).toBeVisible();
	expect(memberCatalogReads).toBe(0);
	await expect(memberPage.locator("[data-template-prompt]")).toHaveCount(0);
	await memberScreen.close();
	expect(errors).toEqual([]);
	console.log(
		"connected template proof: production web -> isolated authenticated API 200; workflow list/stages/docked inspector, purpose search, exact prompt text, history/reload, named consumers and sequential coarse phone passed; graph dependencies absent",
	);
} finally {
	await browser?.close();
	server.kill();
	await server.exited;
}
