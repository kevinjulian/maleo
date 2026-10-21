/* Record api responses for an IMAGE project.
 *
 * Run against a live api and a web server on MALEO_VISUAL_PORT:
 *   MALEO_WEB_PORT=3031 bun src/app/serve.ts &
 *   bun visual/record-image-fixture.ts
 *
 * Separate from api.har on purpose, so the phone suite can cover the
 * ChatSplit branch.: re-recording that one needs every service every
 * covered screen touches, and this needs a single project of a single kind.
 *
 * It exists because ChatSplit — the chat pane for the image and text
 * workspaces — only renders for a project of those kinds, and the main fixture
 * is a video project. That branch shipped with no coverage at all. */
import { chromium } from "@playwright/test";
const PROJECT = "00000000-0000-4000-8000-000000000002";
const PORT = Number(process.env.MALEO_VISUAL_PORT ?? 3031);
const HAR = new URL("./fixtures/api-image.har", import.meta.url).pathname;
const browser = await chromium.launch();
const ctx = await browser.newContext({
	baseURL: `http://127.0.0.1:${PORT}`,
	recordHar: { path: HAR, urlFilter: "**/api/**", mode: "full", content: "embed" },
});
const page = await ctx.newPage();
await page.goto(`/content/${PROJECT}`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await ctx.close();
await browser.close();
console.log("recorded", HAR);
