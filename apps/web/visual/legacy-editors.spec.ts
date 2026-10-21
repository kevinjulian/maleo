/* Image and text projects are retired: an existing one opens as a manual editor.
 *
 * Built from the fixture project's real detail, retyped and given slides or posts,
 * so the editor loads through the same route a stored legacy project does. Each
 * case checks the work loads and saves by hand, and that no chat or generation
 * control is left to reach for. */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { FIXTURE_PROJECT_ID } from "./screens.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

type Detail = { project: Record<string, unknown>; storyboards: Array<Record<string, unknown>> };

async function legacyProject(
	context: BrowserContext,
	type: "image" | "text",
	storyboard: Record<string, unknown>,
): Promise<string[]> {
	const har = JSON.parse(await readFile(HAR, "utf8")) as {
		log: { entries: Array<{ request: { url: string }; response: { content: { text: string } } }> };
	};
	const entry = har.log.entries.find((item) =>
		item.request.url.endsWith(`/api/operations/projects/${FIXTURE_PROJECT_ID}`),
	);
	if (!entry) throw new Error("project fixture missing");
	const detail = JSON.parse(entry.response.content.text) as Detail;
	const legacy: Detail = {
		...detail,
		project: { ...detail.project, type },
		storyboards: [{ ...detail.storyboards[0], storyboard_json: storyboard }],
	};
	await replayApi(context, HAR);
	await context.route("**/api/operations/projects/*", (route) =>
		new URL(route.request().url()).pathname === `/api/operations/projects/${FIXTURE_PROJECT_ID}`
			? route.fulfill({ json: legacy })
			: route.fallback(),
	);
	/* What the editor saves, so a hand edit can be seen leaving the page. */
	const saved: string[] = [];
	await context.route(
		`**/api/operations/projects/${FIXTURE_PROJECT_ID}/storyboards**`,
		async (route) => {
			if (route.request().method() !== "POST") return route.fallback();
			saved.push(route.request().postData() ?? "");
			return route.fulfill({ status: 201, json: { storyboard: { id: "saved", version: 2 } } });
		},
	);
	return saved;
}

async function expectNoAi(page: Page): Promise<void> {
	await expect(page.locator(".cv-chatpane")).toHaveCount(0);
	await expect(page.locator(".cv-chatreopen")).toHaveCount(0);
	await expect(page.getByRole("button", { name: /^Generate/ })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Regenerate" })).toHaveCount(0);
}

for (const width of [320, 1440]) {
	test(`a legacy image project opens as a manual editor at ${width}px`, async ({
		page,
		context,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		const saved = await legacyProject(context, "image", {
			slides: [{ caption: "Feed it daily", visual: "a jar" }],
		});
		await page.goto(`/content/${FIXTURE_PROJECT_ID}`, { waitUntil: "domcontentloaded" });
		const caption = page.getByRole("textbox", { name: "Caption" });
		await expect(caption).toHaveValue("Feed it daily");
		await expectNoAi(page);

		await caption.fill("Feed it twice a day");
		await expect
			.poll(() => saved.some((body) => body.includes("Feed it twice a day")), { timeout: 10_000 })
			.toBe(true);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width,
		);
	});

	test(`a legacy text project opens as a manual editor at ${width}px`, async ({
		page,
		context,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		const saved = await legacyProject(context, "text", { posts: [{ body: "Keep it warm." }] });
		await page.goto(`/content/${FIXTURE_PROJECT_ID}`, { waitUntil: "domcontentloaded" });
		const post = page.getByPlaceholder("Write a post…");
		await expect(post).toHaveValue("Keep it warm.");
		await expectNoAi(page);

		await post.fill("Keep it somewhere warm.");
		await expect
			.poll(() => saved.some((body) => body.includes("Keep it somewhere warm.")), {
				timeout: 10_000,
			})
			.toBe(true);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width,
		);
	});
}
