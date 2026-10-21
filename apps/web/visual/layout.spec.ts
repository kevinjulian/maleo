/* Computed-value probes for the layout tokens and the boxes they place.
 *
 * A screenshot says two renders differ; it does not say which value moved.
 * These assert the values themselves, and they are the ones the layering work
 * has already broken twice: a <link>-order split resolved --page-pad to its
 * mobile 28px on desktop, and layering components.css made its desktop
 * redefinition of --page-pad and --topbar-h lose to unlayered tokens.css,
 * which shortened every page by 8px.
 *
 * Expected values are written out rather than read from the sheet on purpose —
 * a probe that derives its expectation from the thing it checks asserts
 * nothing. They come from `styles/tokens.css`; change them there and here
 * together.
 */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WIDTHS } from "./screens.ts";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

/** The breakpoint the desktop token overrides and the sidebar turn on at. */
const DESKTOP_FROM = 1024;
/** The breakpoint below which the gutter tightens. Three tiers, not two: the
 *  sidebar and the topbar switch at 1024, the gutter also narrows at 640. */
const PHONE_UPTO = 640;
const SIDEBAR_W = 240;
const PAGE_PAD = { phone: "16px", tablet: "28px", desktop: "32px" };
const TOPBAR_H = "48px";

const pagePadFor = (width: number): string =>
	width <= PHONE_UPTO ? PAGE_PAD.phone : width >= DESKTOP_FROM ? PAGE_PAD.desktop : PAGE_PAD.tablet;

interface Box {
	x: number;
	y: number;
	width: number;
	display: string;
}

interface Probe {
	pagePad: string;
	topbarH: string;
	sidebar: Box | null;
	topbar: (Box & { height: number }) | null;
	main: Box | null;
	h1: Box | null;
}

const refPng =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' fill='%23222'/%3E%3Ccircle cx='60' cy='50' r='28' fill='%23f4f4f5'/%3E%3Crect x='25' y='82' width='70' height='12' rx='6' fill='%23a3e635'/%3E%3C/svg%3E";

async function stubImageSurfaceApis(context: Parameters<typeof replayApi>[0]): Promise<void> {
	await context.route("**/api/settings/image-provider", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				selected_provider: "codex",
				effective_provider: "codex",
				selection_error: null,
				source: "global",
				worker_configured: true,
				providers: [
					{ id: "cloudflare-ai", label: "Cloudflare Workers AI", health: "down" },
					{ id: "codex", label: "Codex Imagegen", health: "ready" },
				],
			}),
		});
	});
	await context.route("**/api/image-gen/health", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ configured: true, ok: true, queue_depth: 0 }),
		});
	});
	await context.route("**/api/image-gen/images**", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ items: [] }),
		});
	});
	await context.route("**/api/operations/catalogue**", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				images: [
					{
						id: "ref-1",
						label: "Reference Host",
						tags: ["character"],
						kind: "character",
						note: "white jacket",
						seed: 7,
						default: false,
						src: refPng,
						workspace: "default",
						collection: "characters",
						item_id: "host",
					},
				],
				voices: [],
				products: [],
			}),
		});
	});
}

test.beforeEach(async ({ context }) => {
	await replayApi(context, HAR);
});

for (const width of WIDTHS) {
	const desktop = width >= DESKTOP_FROM;

	test(`layout tokens @ ${width}`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/content");
		await page.locator("main").first().waitFor({ state: "visible" });
		// A cold dev server can serve the document before the stylesheet, and
		// every value below reads as unstyled if it does. Wait on a token this
		// test does not assert, so the guard cannot make the assertions pass.
		await page.waitForFunction(
			() =>
				getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w").trim() !== "",
		);
		await page.evaluate(() => document.fonts.ready);

		const probe: Probe = await page.evaluate(() => {
			const root = getComputedStyle(document.documentElement);
			const box = (selector: string): Box | null => {
				const el = document.querySelector(selector);
				if (!el) return null;
				const rect = el.getBoundingClientRect();
				return { x: rect.x, y: rect.y, width: rect.width, display: getComputedStyle(el).display };
			};
			return {
				pagePad: root.getPropertyValue("--page-pad").trim(),
				topbarH: root.getPropertyValue("--topbar-h").trim(),
				sidebar: box(".sidebar"),
				topbar: (() => {
					const el = document.querySelector("header.ui-topbar");
					if (!el) return null;
					const rect = el.getBoundingClientRect();
					return {
						x: rect.x,
						y: rect.y,
						width: rect.width,
						height: rect.height,
						display: getComputedStyle(el).display,
					};
				})(),
				main: box("main"),
				h1: box("h1"),
			};
		});

		expect(probe.pagePad).toBe(pagePadFor(width));
		expect(probe.topbarH).toBe(TOPBAR_H);

		// The sidebar is the fixed desktop rail; below the breakpoint the drawer
		// replaces it and it must not take layout space.
		expect(probe.sidebar?.display).toBe(desktop ? "flex" : "none");
		if (desktop) expect(probe.sidebar?.width).toBe(SIDEBAR_W);

		// One top bar at every width, over the content column and --topbar-h tall.
		expect(probe.topbar?.display).toBe("flex");
		expect(probe.topbar?.height).toBe(Number.parseInt(TOPBAR_H, 10));
		expect(probe.topbar?.x).toBe(desktop ? SIDEBAR_W : 0);

		// main clears the rail rather than sliding under it, and fills the rest.
		expect(probe.main?.x).toBe(desktop ? SIDEBAR_W : 0);
		expect(probe.main?.width).toBe(width - (desktop ? SIDEBAR_W : 0));

		// The page's own padding is --page-pad, so h1 sits exactly that far in
		// from main's edge. This is the assertion the <link>-order bug failed.
		const pad = Number.parseInt(pagePadFor(width), 10);
		expect(probe.h1?.x).toBe((probe.main?.x ?? 0) + pad);
	});
}

for (const width of [320, 1440] as const) {
	test(`image lab controls render without overlap @ ${width}`, async ({ page, context }) => {
		await stubImageSurfaceApis(context);
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/images/lab");
		await page.locator("[data-slot='prompt-composer']").waitFor({ state: "visible" });
		await page.evaluate(() => document.fonts.ready);

		const probe = await page.evaluate(() => {
			const rect = (selector: string) => {
				const el = document.querySelector(selector);
				if (!el) return null;
				const r = el.getBoundingClientRect();
				return {
					left: r.left,
					right: r.right,
					top: r.top,
					bottom: r.bottom,
					width: r.width,
					height: r.height,
				};
			};
			const row = rect("[data-slot='prompt-composer']");
			const tools = rect(".ui-prompt-tools");
			const input = rect("[data-prompt='input']");
			const send = rect("[data-prompt='submit']");
			const provider = rect(".imagelab-provider-trigger");
			const refs = rect(".imagelab-tool-btn");
			const aspects = rect(".imagelab-ratio-trigger");
			const overlap = (a: NonNullable<typeof row>, b: NonNullable<typeof row>) =>
				Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) > 1 &&
				Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) > 1;
			return {
				scrollWidth: document.documentElement.scrollWidth,
				innerWidth: window.innerWidth,
				row,
				tools,
				input,
				send,
				provider,
				refs,
				aspects,
				headerCount: document.querySelectorAll(".imagelab-header").length,
				bottomNavCount: document.querySelectorAll(".bottomnav.app-nav").length,
				inputSendOverlap: input && send ? overlap(input, send) : true,
			};
		});

		expect(probe.scrollWidth).toBeLessThanOrEqual(probe.innerWidth);
		for (const box of [
			probe.row,
			probe.tools,
			probe.input,
			probe.send,
			probe.provider,
			probe.refs,
			probe.aspects,
		]) {
			expect(box).not.toBeNull();
			expect(box?.left).toBeGreaterThanOrEqual(0);
			expect(box?.right).toBeLessThanOrEqual(width);
		}
		expect(probe.input?.width).toBeGreaterThanOrEqual(width === 320 ? 220 : 360);
		expect(probe.inputSendOverlap).toBe(false);
		expect(probe.headerCount).toBe(0);
		expect(probe.bottomNavCount).toBe(0);

		/* The provider is deployment-wide configuration, chosen in God Mode. Image
		 * Lab shows it as a read-only label and opens no picker. */
		await expect(page.locator(".imagelab-provider-trigger")).toHaveAttribute(
			"title",
			/instance owner/,
		);
		await page.locator(".imagelab-provider-trigger").click();
		await expect(page.locator('[data-slot="select-popup"]:visible')).toHaveCount(0);

		await page.locator(".imagelab-ratio-trigger").click();
		const options = page.locator('[data-slot="select-list"]:visible');
		await expect(options).toBeVisible();
		await expect(options.getByRole("option")).toHaveCount(3);
		await options.getByRole("option", { name: /9:16/ }).click();
		await expect(page.locator(".imagelab-ratio-trigger b")).toHaveText("9:16");
	});

	test(`reference library renders catalogue media @ ${width}`, async ({ page, context }) => {
		await stubImageSurfaceApis(context);
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/library/references");
		await page.locator("[data-slot='media-card'] img").waitFor({ state: "visible" });
		await page.evaluate(() => document.fonts.ready);

		const probe = await page.evaluate(() => {
			const img = document.querySelector("[data-slot='media-card'] img");
			const card = document.querySelector("[data-slot='media-card']");
			const imgRect = img?.getBoundingClientRect();
			const cardRect = card?.getBoundingClientRect();
			return {
				scrollWidth: document.documentElement.scrollWidth,
				innerWidth: window.innerWidth,
				imgSrc: img?.getAttribute("src") ?? "",
				imgWidth: imgRect?.width ?? 0,
				imgHeight: imgRect?.height ?? 0,
				cardLeft: cardRect?.left ?? -1,
				cardRight: cardRect?.right ?? Infinity,
			};
		});

		expect(probe.scrollWidth).toBeLessThanOrEqual(probe.innerWidth);
		expect(probe.imgSrc).toContain("data:image/svg+xml");
		expect(probe.imgWidth).toBeGreaterThan(40);
		expect(probe.imgHeight).toBeGreaterThan(40);
		expect(probe.cardLeft).toBeGreaterThanOrEqual(0);
		expect(probe.cardRight).toBeLessThanOrEqual(width);
	});
}
