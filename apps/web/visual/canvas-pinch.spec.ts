/* A two-finger pinch on the preview canvas (`p2-preview-editing` task 4.5):
 * the canvas surface turns two touch pointers into the engine's pinch and
 * twist, the selected element scales about its centre, and one Undo restores it. */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");

test("pinching out scales the selected element and one undo restores it", async ({
	page,
	context,
}) => {
	await replayApi(context, HAR);
	await page.goto(`/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}`);
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	const clip = page.locator('[data-clipid="text:1"]');
	await clip.scrollIntoViewIfNeeded();
	await clip.tap();
	const box = page.locator(".tl2-clipbox");
	await expect(box).toHaveAttribute("aria-label", "Selected clip transform");
	const size = () =>
		box.evaluate((el) => ({
			width: parseFloat(el.style.width),
			height: parseFloat(el.style.height),
		}));
	const before = await size();
	const rect = (await box.boundingBox())!;
	const cx = rect.x + rect.width / 2,
		cy = rect.y + rect.height / 2;
	const cdp = await context.newCDPSession(page);
	const touch = (
		type: "touchStart" | "touchMove" | "touchEnd",
		points: { x: number; y: number; id: number }[],
	) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
	await touch("touchStart", [{ x: cx - 10, y: cy, id: 0 }]);
	await touch("touchStart", [
		{ x: cx - 10, y: cy, id: 0 },
		{ x: cx + 10, y: cy, id: 1 },
	]);
	for (const spread of [15, 20])
		await touch("touchMove", [
			{ x: cx - spread, y: cy, id: 0 },
			{ x: cx + spread, y: cy, id: 1 },
		]);
	await touch("touchEnd", []);
	await expect.poll(async () => (await size()).width).toBeGreaterThan(before.width * 1.5);
	const after = await size();
	expect(after.width / after.height).toBeCloseTo(before.width / before.height, 4);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect.poll(size).toEqual(before);
});
